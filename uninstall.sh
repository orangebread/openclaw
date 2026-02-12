#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/openclaw-uninstall-$(id -u)-$(basename "${ROOT_DIR}")"
LOCK_PID_FILE="${LOCK_DIR}/pid"

DRY_RUN=0

die() {
  printf "uninstall.sh: %s\n" "$1" >&2
  exit 1
}

info() {
  printf "%s\n" "$1"
}

warn() {
  printf "uninstall.sh: %s\n" "$1" >&2
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

trim_whitespace() {
  local value
  value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

run_cmd() {
  if (( DRY_RUN == 1 )); then
    local quoted
    printf -v quoted '%q ' "$@"
    info "[dry-run] ${quoted% }"
    return 0
  fi
  "$@"
}

run_step() {
  local label
  label="$1"
  shift
  info "==> ${label}"
  "$@"
}

load_openclaw_env_file() {
  local env_path
  env_path="${OPENCLAW_UNINSTALL_ENV_FILE:-${ROOT_DIR}/.env}"
  [[ -f "${env_path}" ]] || return 0

  local line line_no key raw_value value
  line_no=0
  local loaded_count=0
  local unsupported_count=0

  while IFS= read -r line || [[ -n "${line}" ]]; do
    line_no=$((line_no + 1))
    line="${line%$'\r'}"
    line="$(trim_whitespace "${line}")"
    [[ -z "${line}" ]] && continue
    [[ "${line}" == \#* ]] && continue

    if [[ "${line}" == export[[:space:]]* ]]; then
      line="${line#export}"
      line="$(trim_whitespace "${line}")"
    fi

    if [[ "${line}" != *=* ]]; then
      if [[ "${line}" == OPENCLAW_* ]]; then
        warn "Skipping unsupported OPENCLAW env syntax at line ${line_no} in configured env file."
        unsupported_count=$((unsupported_count + 1))
      fi
      continue
    fi

    key="$(trim_whitespace "${line%%=*}")"
    raw_value="${line#*=}"
    raw_value="$(trim_whitespace "${raw_value}")"

    [[ "${key}" =~ ^OPENCLAW_[A-Za-z0-9_]+$ ]] || continue
    [[ -n "${!key:-}" ]] && continue

    if [[ "${raw_value}" == *'$('* || "${raw_value}" == *'${'* || "${raw_value}" == *'`'* ]]; then
      warn "Skipping OPENCLAW env line ${line_no}; shell expansion syntax is not supported."
      unsupported_count=$((unsupported_count + 1))
      continue
    fi

    value="${raw_value}"
    if [[ "${value}" == \"* ]]; then
      if [[ "${#value}" -lt 2 || "${value: -1}" != '"' ]]; then
        warn "Skipping OPENCLAW env line ${line_no}; unmatched double quote."
        unsupported_count=$((unsupported_count + 1))
        continue
      fi
      value="${value:1:${#value}-2}"
    elif [[ "${value}" == \'* ]]; then
      if [[ "${#value}" -lt 2 || "${value: -1}" != "'" ]]; then
        warn "Skipping OPENCLAW env line ${line_no}; unmatched single quote."
        unsupported_count=$((unsupported_count + 1))
        continue
      fi
      value="${value:1:${#value}-2}"
    fi

    export "${key}=${value}"
    loaded_count=$((loaded_count + 1))
  done <"${env_path}"

  if (( loaded_count > 0 )); then
    info "Loaded ${loaded_count} OpenClaw env var(s) from configured env file."
  fi
  if (( unsupported_count > 0 )); then
    warn "Skipped ${unsupported_count} unsupported OPENCLAW env line(s); supported format is OPENCLAW_KEY=value with optional single/double quotes."
  fi
}

acquire_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    printf "%s\n" "$$" >"${LOCK_PID_FILE}"
    return 0
  fi

  local existing_pid
  existing_pid="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    die "Another uninstall.sh run is in progress (pid ${existing_pid}). Wait for it to finish and retry."
  fi

  rm -rf "${LOCK_DIR}" 2>/dev/null || true
  mkdir "${LOCK_DIR}" 2>/dev/null || die "Failed to acquire lock directory: ${LOCK_DIR}"
  printf "%s\n" "$$" >"${LOCK_PID_FILE}"
}

cleanup_lock() {
  if [[ -f "${LOCK_PID_FILE}" ]]; then
    local owner_pid
    owner_pid="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
    if [[ "${owner_pid}" == "$$" ]]; then
      rm -rf "${LOCK_DIR}" 2>/dev/null || true
    fi
  fi
}

detect_platform() {
  local kernel
  kernel="$(uname -s)"
  case "${kernel}" in
    Darwin) printf "macos\n" ;;
    Linux) printf "linux\n" ;;
    *) die "Unsupported platform: ${kernel}. This script supports macOS and Linux only." ;;
  esac
}

resolve_gateway_port() {
  local config_path
  config_path="${OPENCLAW_CONFIG_PATH:-${HOME}/.openclaw/openclaw.json}"
  node - "$config_path" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
const fallback = 18789;
if (!configPath) {
  process.stdout.write(String(fallback));
  process.exit(0);
}

try {
  const cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const raw = cfg?.gateway?.port;
  if (Number.isFinite(raw) && raw > 0) {
    process.stdout.write(String(Math.floor(raw)));
    process.exit(0);
  }
} catch {}

process.stdout.write(String(fallback));
NODE
}

resolve_service_ids() {
  node - <<'NODE'
const raw = (process.env.OPENCLAW_PROFILE ?? "").trim();
const normalized = raw && raw.toLowerCase() !== "default" ? raw : "";
const launchLabel = normalized ? `ai.openclaw.${normalized}` : "ai.openclaw.gateway";
const systemdUnit = normalized ? `openclaw-gateway-${normalized}.service` : "openclaw-gateway.service";
process.stdout.write(`${launchLabel}\n${systemdUnit}\n`);
NODE
}

list_listening_pids() {
  local port
  port="$1"
  lsof -nP -iTCP:"${port}" -sTCP:LISTEN -t 2>/dev/null | sort -u || true
}

is_openclaw_listener() {
  local cmdline
  cmdline="$1"
  [[ "${cmdline}" == *"/openclaw.mjs"* ]] \
    || [[ "${cmdline}" == *"/dist/index.js"* ]] \
    || [[ "${cmdline}" == *"/dist/index.mjs"* ]] \
    || [[ "${cmdline}" == *"/scripts/run-node.mjs"* ]] \
    || [[ "${cmdline}" == *"/openclaw-gateway"* ]] \
    || [[ "${cmdline}" == "openclaw-gateway"* ]] \
    || [[ "${cmdline}" == "openclaw "* ]] \
    || [[ "${cmdline}" == *" openclaw "* ]]
}

wait_for_pids_exit() {
  local attempts
  attempts="$1"
  shift

  local i pid alive
  for ((i = 0; i < attempts; i += 1)); do
    alive=0
    for pid in "$@"; do
      if kill -0 "${pid}" 2>/dev/null; then
        alive=1
        break
      fi
    done
    if [[ "${alive}" -eq 0 ]]; then
      return 0
    fi
    sleep 0.2
  done
  return 1
}

terminate_pids() {
  local -a pids
  pids=("$@")
  [[ "${#pids[@]}" -gt 0 ]] || return 0

  run_cmd kill -TERM "${pids[@]}" 2>/dev/null || true
  if (( DRY_RUN == 1 )); then
    return 0
  fi
  if wait_for_pids_exit 25 "${pids[@]}"; then
    return 0
  fi

  run_cmd kill -KILL "${pids[@]}" 2>/dev/null || true
  wait_for_pids_exit 15 "${pids[@]}" || die "Failed to stop listener PIDs: ${pids[*]}"
}

stop_service_via_cli() {
  if [[ -f "${ROOT_DIR}/openclaw.mjs" ]]; then
    if run_cmd node openclaw.mjs daemon stop; then
      return 0
    fi
    warn "Local daemon stop command failed; continuing with platform cleanup."
  fi

  if command -v openclaw >/dev/null 2>&1; then
    if run_cmd openclaw daemon stop; then
      return 0
    fi
    warn "Global daemon stop command failed; continuing with platform cleanup."
  fi
}

uninstall_service_via_cli() {
  if [[ -f "${ROOT_DIR}/openclaw.mjs" ]]; then
    if run_cmd node openclaw.mjs daemon uninstall; then
      return 0
    fi
    warn "Local daemon uninstall command failed; continuing with platform cleanup."
  fi

  if command -v openclaw >/dev/null 2>&1; then
    if run_cmd openclaw daemon uninstall; then
      return 0
    fi
    warn "Global daemon uninstall command failed; continuing with platform cleanup."
  fi
}

cleanup_macos_service() {
  local label plist_path domain
  label="$1"
  plist_path="$2"
  domain="gui/$(id -u)"

  need_cmd launchctl

  run_cmd launchctl bootout "${domain}/${label}" >/dev/null 2>&1 || true
  run_cmd launchctl bootout "${domain}" "${plist_path}" >/dev/null 2>&1 || true
  run_cmd launchctl unload "${plist_path}" >/dev/null 2>&1 || true

  if [[ -f "${plist_path}" ]]; then
    local trash_dir trash_dest
    trash_dir="${HOME}/.Trash"
    trash_dest="${trash_dir}/$(basename "${plist_path}")"
    run_cmd mkdir -p "${trash_dir}"
    if (( DRY_RUN == 1 )); then
      info "Would move LaunchAgent plist to Trash: ${plist_path} -> ${trash_dest}"
      return 0
    fi
    if run_cmd mv "${plist_path}" "${trash_dest}"; then
      info "Moved LaunchAgent plist to Trash: ${trash_dest}"
    else
      warn "Could not move ${plist_path} to Trash; leaving file in place."
    fi
  else
    info "LaunchAgent plist not present: ${plist_path}"
  fi
}

cleanup_linux_service() {
  local unit_name unit_path
  unit_name="$1"
  unit_path="$2"

  need_cmd systemctl

  run_cmd systemctl --user disable --now "${unit_name}" >/dev/null 2>&1 || true
  run_cmd systemctl --user stop "${unit_name}" >/dev/null 2>&1 || true

  if [[ -f "${unit_path}" ]]; then
    if (( DRY_RUN == 1 )); then
      info "Would remove systemd unit file: ${unit_path}"
    else
      run_cmd rm -f "${unit_path}"
      info "Removed systemd unit file: ${unit_path}"
    fi
  else
    info "systemd unit file not present: ${unit_path}"
  fi

  run_cmd systemctl --user daemon-reload >/dev/null 2>&1 || true
}

cleanup_openclaw_listeners() {
  local port
  port="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    warn "lsof not found; skipping listener cleanup on port ${port}."
    return 0
  fi

  local pid cmdline
  local -a openclaw_pids
  local -a foreign_listeners
  openclaw_pids=()
  foreign_listeners=()

  while IFS= read -r pid; do
    [[ -n "${pid}" ]] || continue
    cmdline="$(ps -o command= -p "${pid}" 2>/dev/null || true)"
    [[ -n "${cmdline}" ]] || continue
    if is_openclaw_listener "${cmdline}"; then
      openclaw_pids+=("${pid}")
    else
      foreign_listeners+=("${pid}:${cmdline}")
    fi
  done < <(list_listening_pids "${port}")

  if [[ "${#openclaw_pids[@]}" -gt 0 ]]; then
    info "Stopping OpenClaw listener(s) on port ${port}: ${openclaw_pids[*]}"
    terminate_pids "${openclaw_pids[@]}"
  else
    info "No OpenClaw listeners detected on port ${port}."
  fi

  if [[ "${#foreign_listeners[@]}" -gt 0 ]]; then
    warn "Port ${port} still has non-OpenClaw listener(s): ${foreign_listeners[*]}"
  fi
}

verify_macos_uninstall() {
  local label plist_path domain
  label="$1"
  plist_path="$2"
  domain="gui/$(id -u)"

  if launchctl print "${domain}/${label}" >/dev/null 2>&1; then
    die "LaunchAgent ${domain}/${label} is still loaded."
  fi

  if [[ -f "${plist_path}" ]]; then
    die "LaunchAgent plist still exists at ${plist_path}."
  fi
}

verify_linux_uninstall() {
  local unit_name unit_path
  unit_name="$1"
  unit_path="$2"

  if [[ -f "${unit_path}" ]]; then
    die "systemd unit file still exists at ${unit_path}."
  fi

  if systemctl --user is-enabled "${unit_name}" >/dev/null 2>&1; then
    die "systemd unit ${unit_name} is still enabled."
  fi
}

parse_args() {
  local arg
  for arg in "$@"; do
    case "${arg}" in
      --dry-run)
        DRY_RUN=1
        ;;
      --help|-h)
        cat <<'EOF'
Usage: ./uninstall.sh [--dry-run]

Completely remove the local OpenClaw Gateway service (launchd/systemd) for the current profile.

Options:
  --dry-run  Print actions without changing system state.
EOF
        exit 0
        ;;
      *)
        die "Unknown argument: ${arg}"
        ;;
    esac
  done
}

main() {
  parse_args "$@"

  trap cleanup_lock EXIT INT TERM
  acquire_lock
  cd "${ROOT_DIR}"
  load_openclaw_env_file

  need_cmd node
  need_cmd ps
  if ! command -v lsof >/dev/null 2>&1; then
    warn "lsof not found; listener cleanup verification will be limited."
  fi

  local platform gateway_port launch_label systemd_unit
  local plist_path systemd_unit_path
  platform="$(detect_platform)"
  gateway_port="$(resolve_gateway_port)"
  mapfile -t __ids < <(resolve_service_ids)
  launch_label="${__ids[0]}"
  systemd_unit="${__ids[1]}"
  plist_path="${HOME}/Library/LaunchAgents/${launch_label}.plist"
  systemd_unit_path="${HOME}/.config/systemd/user/${systemd_unit}"

  info "OpenClaw service uninstall: stop + uninstall + cleanup + verify"
  info "Detected platform: ${platform}"
  info "Gateway port: ${gateway_port}"

  run_step "Stop Gateway service via CLI (best effort)" stop_service_via_cli
  run_step "Uninstall Gateway service via CLI (best effort)" uninstall_service_via_cli

  case "${platform}" in
    macos)
      run_step "Remove launchd artifacts (${launch_label})" cleanup_macos_service "${launch_label}" "${plist_path}"
      ;;
    linux)
      run_step "Remove systemd artifacts (${systemd_unit})" cleanup_linux_service "${systemd_unit}" "${systemd_unit_path}"
      ;;
    *)
      die "Unsupported platform: ${platform}"
      ;;
  esac

  run_step "Stop remaining OpenClaw listeners on port ${gateway_port}" cleanup_openclaw_listeners "${gateway_port}"

  if (( DRY_RUN == 0 )); then
    case "${platform}" in
      macos)
        run_step "Verify launchd service removal" verify_macos_uninstall "${launch_label}" "${plist_path}"
        ;;
      linux)
        run_step "Verify systemd service removal" verify_linux_uninstall "${systemd_unit}" "${systemd_unit_path}"
        ;;
    esac
  fi

  info "OpenClaw service uninstall completed."
}

main "$@"
