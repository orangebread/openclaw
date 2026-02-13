#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOCK_DIR="${TMPDIR:-/tmp}/openclaw-start-$(id -u)-$(basename "${ROOT_DIR}")"
LOCK_PID_FILE="${LOCK_DIR}/pid"

die() {
  printf "start.sh: %s\n" "$1" >&2
  exit 1
}

info() {
  printf "%s\n" "$1"
}

warn() {
  printf "start.sh: %s\n" "$1" >&2
}

trim_whitespace() {
  local value
  value="$1"
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  printf "%s" "$value"
}

load_openclaw_env_file() {
  local env_path
  env_path="${OPENCLAW_START_ENV_FILE:-${ROOT_DIR}/.env}"
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
    if [[ -n "${!key:-}" ]]; then
      continue
    fi

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

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

run_step() {
  local label
  label="$1"
  shift
  info "==> ${label}"
  "$@"
}

check_node_version() {
  local version major
  version="$(node -v 2>/dev/null || true)"
  [[ -n "$version" ]] || die "Node is not available in PATH"
  version="${version#v}"
  major="${version%%.*}"
  [[ "$major" =~ ^[0-9]+$ ]] || die "Unable to parse Node version: $version"
  if (( major < 22 )); then
    die "Node 22+ required (found v$version)"
  fi
}

resolve_config_path() {
  if [[ -n "${OPENCLAW_CONFIG_PATH:-}" ]]; then
    printf "%s\n" "${OPENCLAW_CONFIG_PATH}"
    return 0
  fi
  printf "%s\n" "${HOME}/.openclaw/openclaw.json"
}

validate_config_json() {
  local config_path
  config_path="$1"
  [[ -f "$config_path" ]] || die "Missing config: $config_path (set OPENCLAW_CONFIG_PATH to override)"
  node -e 'const fs=require("fs"); JSON.parse(fs.readFileSync(process.argv[1], "utf8"));' "$config_path" >/dev/null
}

plugin_enable_state() {
  local config_path plugin_id
  config_path="$1"
  plugin_id="$2"
  node - "$config_path" "$plugin_id" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
const pluginId = process.argv[3];
if (!configPath || !pluginId) {
  process.stdout.write("error");
  process.exit(0);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  process.stdout.write("error");
  process.exit(0);
}

const plugins = cfg?.plugins ?? {};
if (plugins.enabled === false) {
  process.stdout.write("disabled");
  process.exit(0);
}

const deny = Array.isArray(plugins.deny) ? plugins.deny : [];
if (deny.includes(pluginId)) {
  process.stdout.write("disabled");
  process.exit(0);
}

const allow = Array.isArray(plugins.allow) ? plugins.allow : [];
if (allow.length > 0 && !allow.includes(pluginId)) {
  process.stdout.write("disabled");
  process.exit(0);
}

const entry = plugins?.entries?.[pluginId];
if (entry?.enabled === true) {
  process.stdout.write("enabled");
  process.exit(0);
}

// Bundled plugins (including "whatsapp") are disabled by default unless explicitly enabled.
process.stdout.write("disabled");
NODE
}

enable_plugin_in_config() {
  local config_path plugin_id
  config_path="$1"
  plugin_id="$2"
  node - "$config_path" "$plugin_id" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
const pluginId = process.argv[3];
if (!configPath || !pluginId) {
  process.exit(1);
}

const raw = fs.readFileSync(configPath, "utf8");
const cfg = JSON.parse(raw);

const plugins = { ...(cfg.plugins ?? {}) };
const entries = { ...(plugins.entries ?? {}) };
entries[pluginId] = { ...(entries[pluginId] ?? {}), enabled: true };
plugins.entries = entries;

// If an allowlist exists and is non-empty, ensure the plugin is allowlisted too.
if (Array.isArray(plugins.allow) && plugins.allow.length > 0 && !plugins.allow.includes(pluginId)) {
  plugins.allow = [...plugins.allow, pluginId];
}

cfg.plugins = plugins;

const next = JSON.stringify(cfg, null, 2) + "\n";
const tmpPath = `${configPath}.tmp`;
fs.writeFileSync(tmpPath, next, "utf8");
fs.renameSync(tmpPath, configPath);
NODE
}

ensure_required_plugins() {
  # WhatsApp is the default chat channel id ("whatsapp"); if the bundled plugin is disabled,
  # it won't show up in the Channels UI and many "happy path" flows won't work.
  local config_path
  config_path="$1"
  local state
  state="$(plugin_enable_state "$config_path" "whatsapp" || true)"
  if [[ -z "$state" || "$state" == "error" ]]; then
    die "Unable to query plugin status from config: $config_path"
  fi
  if [[ "$state" == "enabled" ]]; then
    return 0
  fi

  if [[ "${OPENCLAW_START_FIX_PLUGINS:-}" == "1" ]]; then
    info "Enabling required bundled plugin: whatsapp (writes to your OpenClaw config)"
    enable_plugin_in_config "$config_path" "whatsapp"
    state="$(plugin_enable_state "$config_path" "whatsapp" || true)"
    [[ "$state" == "enabled" ]] || die "Failed to enable required plugin: whatsapp"
    return 0
  fi

  if [[ "${OPENCLAW_START_STRICT_PLUGINS:-}" == "1" ]]; then
    die "Required plugin \"whatsapp\" is $state. Fix: set plugins.entries.whatsapp.enabled=true in $config_path (or re-run with OPENCLAW_START_FIX_PLUGINS=1)."
  fi

  warn "WhatsApp plugin is $state; continuing anyway. (Enable via plugins.entries.whatsapp.enabled=true in $config_path, or re-run with OPENCLAW_START_FIX_PLUGINS=1.)"
  return 0
}

gateway_mode_state() {
  local config_path
  config_path="$1"
  node - "$config_path" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
if (!configPath) {
  process.stdout.write("error");
  process.exit(0);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  process.stdout.write("error");
  process.exit(0);
}

const raw = cfg?.gateway?.mode;
if (typeof raw !== "string" || raw.trim() === "") {
  process.stdout.write("unset");
  process.exit(0);
}

const mode = raw.trim();
if (mode === "local") {
  process.stdout.write("local");
  process.exit(0);
}
if (mode === "remote") {
  process.stdout.write("remote");
  process.exit(0);
}
process.stdout.write("invalid");
NODE
}

set_gateway_mode_local() {
  local config_path
  config_path="$1"
  node - "$config_path" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
if (!configPath) {
  process.exit(1);
}

const raw = fs.readFileSync(configPath, "utf8");
const cfg = JSON.parse(raw);
const gateway = { ...(cfg.gateway ?? {}) };
gateway.mode = "local";
cfg.gateway = gateway;

const next = JSON.stringify(cfg, null, 2) + "\n";
const tmpPath = `${configPath}.tmp`;
fs.writeFileSync(tmpPath, next, "utf8");
fs.renameSync(tmpPath, configPath);
NODE
}

ensure_gateway_mode_local() {
  local config_path mode
  config_path="$1"
  mode="$(gateway_mode_state "$config_path" || true)"
  if [[ -z "${mode}" || "${mode}" == "error" ]]; then
    die "Unable to determine gateway.mode from config: ${config_path}"
  fi

  if [[ "${mode}" == "local" ]]; then
    return 0
  fi

  if [[ "${OPENCLAW_START_FIX_GATEWAY_MODE:-}" == "1" ]]; then
    info "Setting gateway.mode=local in ${config_path} (OPENCLAW_START_FIX_GATEWAY_MODE=1)"
    set_gateway_mode_local "$config_path"
    mode="$(gateway_mode_state "$config_path" || true)"
    [[ "${mode}" == "local" ]] || die "Failed to set gateway.mode=local in ${config_path}"
    return 0
  fi

  die "gateway.mode is ${mode}. For local service deploy, set gateway.mode=local in ${config_path} (or re-run with OPENCLAW_START_FIX_GATEWAY_MODE=1)."
}

ensure_gateway_auth_ready() {
  local config_path
  config_path="$1"

  node - "$config_path" <<'NODE'
const fs = require("fs");

const configPath = process.argv[2];
if (!configPath) {
  console.error("missing config path");
  process.exit(1);
}

let cfg;
try {
  cfg = JSON.parse(fs.readFileSync(configPath, "utf8"));
} catch {
  console.error(`unable to read config: ${configPath}`);
  process.exit(1);
}

const gateway = cfg?.gateway ?? {};
const auth = gateway?.auth ?? {};
const tailscale = gateway?.tailscale ?? {};

const configToken = typeof auth.token === "string" ? auth.token.trim() : "";
const configPassword = typeof auth.password === "string" ? auth.password.trim() : "";
const envToken =
  (process.env.OPENCLAW_START_GATEWAY_TOKEN || process.env.OPENCLAW_GATEWAY_TOKEN || "").trim();
const modeRaw = typeof auth.mode === "string" ? auth.mode.trim() : "";
const mode = modeRaw || (configPassword ? "password" : "token");
const tailscaleMode = typeof tailscale.mode === "string" ? tailscale.mode.trim() : "off";
const allowTailscale = auth.allowTailscale === true || (tailscaleMode === "serve" && mode !== "password");

if (mode === "token" && !configToken && !envToken && !allowTailscale) {
  console.error(
    "gateway auth mode resolves to token, but no token is configured. Set gateway.auth.token in config, or set OPENCLAW_START_GATEWAY_TOKEN/OPENCLAW_GATEWAY_TOKEN before running start.sh.",
  );
  process.exit(1);
}

if (mode === "password" && !configPassword) {
  console.error(
    "gateway auth mode resolves to password, but gateway.auth.password is missing in config. Set gateway.auth.password before running start.sh.",
  );
  process.exit(1);
}
NODE
}

gateway_token_override() {
  if [[ -n "${OPENCLAW_START_GATEWAY_TOKEN:-}" ]]; then
    printf "%s\n" "${OPENCLAW_START_GATEWAY_TOKEN}"
    return 0
  fi
  if [[ -n "${OPENCLAW_GATEWAY_TOKEN:-}" ]]; then
    printf "%s\n" "${OPENCLAW_GATEWAY_TOKEN}"
    return 0
  fi
  printf "\n"
}

install_gateway_service() {
  local token
  token="$(gateway_token_override)"
  if [[ -n "${token}" ]]; then
    OPENCLAW_GATEWAY_TOKEN="${token}" node openclaw.mjs daemon install --force --runtime node
    return 0
  fi
  node openclaw.mjs daemon install --force --runtime node
}

acquire_lock() {
  if mkdir "${LOCK_DIR}" 2>/dev/null; then
    printf "%s\n" "$$" >"${LOCK_PID_FILE}"
    return 0
  fi

  local existing_pid
  existing_pid="$(cat "${LOCK_PID_FILE}" 2>/dev/null || true)"
  if [[ -n "${existing_pid}" ]] && kill -0 "${existing_pid}" 2>/dev/null; then
    die "Another start.sh run is in progress (pid ${existing_pid}). Wait for it to finish and retry."
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

ensure_platform_prereqs() {
  local platform
  platform="$1"
  case "${platform}" in
    macos)
      need_cmd launchctl
      ;;
    linux)
      need_cmd systemctl
      if ! systemctl --user show-environment >/dev/null 2>&1; then
        die "systemctl --user is unavailable for this shell session. Log in with a user systemd session and retry."
      fi
      ;;
    *)
      die "Unknown platform: ${platform}"
      ;;
  esac
}

resolve_gateway_port() {
  local config_path
  config_path="$1"
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

  kill -TERM "${pids[@]}" 2>/dev/null || true
  if wait_for_pids_exit 25 "${pids[@]}"; then
    return 0
  fi

  kill -KILL "${pids[@]}" 2>/dev/null || true
  wait_for_pids_exit 15 "${pids[@]}" || die "Failed to stop listener PIDs: ${pids[*]}"
}

ensure_gateway_port_reusable() {
  local port
  port="$1"

  if ! command -v lsof >/dev/null 2>&1; then
    warn "lsof not found; cannot auto-stop dev listeners on port ${port}. Continuing."
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
    if [[ -z "${cmdline}" ]]; then
      continue
    fi
    if is_openclaw_listener "${cmdline}"; then
      openclaw_pids+=("${pid}")
    else
      foreign_listeners+=("${pid}:${cmdline}")
    fi
  done < <(list_listening_pids "${port}")

  if [[ "${#foreign_listeners[@]}" -gt 0 ]]; then
    die "Port ${port} is held by non-OpenClaw process(es): ${foreign_listeners[*]}"
  fi

  if [[ "${#openclaw_pids[@]}" -gt 0 ]]; then
    info "Stopping existing OpenClaw listener(s) on port ${port}: ${openclaw_pids[*]}"
    terminate_pids "${openclaw_pids[@]}"
  fi
}

verify_gateway_status_once() {
  local raw_output
  raw_output="$(node openclaw.mjs gateway status --json 2>&1)" || {
    printf "gateway status command failed: %s\n" "${raw_output}" >&2
    return 1
  }

  local status_tmp parse_status
  status_tmp="$(mktemp "${TMPDIR:-/tmp}/openclaw-status-verify.XXXXXX")" || {
    printf "failed to create temp file for gateway status parse\n" >&2
    return 1
  }
  printf "%s\n" "${raw_output}" >"${status_tmp}"

  node - "${ROOT_DIR}" "${status_tmp}" <<'NODE'
const fs = require("fs");
const path = require("path");

const repoRoot = process.argv[2];
const statusPath = process.argv[3];
const raw = fs.readFileSync(statusPath, "utf8");
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");
if (start === -1 || end === -1 || end < start) {
  process.stderr.write("gateway status did not emit JSON payload");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(raw.slice(start, end + 1));
} catch (err) {
  process.stderr.write(`failed to parse gateway status JSON: ${String(err)}`);
  process.exit(1);
}

const failures = [];

if (payload?.service?.loaded !== true) {
  failures.push("service.loaded is not true");
}

const runtimeStatus = String(payload?.service?.runtime?.status ?? "").toLowerCase();
if (runtimeStatus && runtimeStatus !== "running") {
  failures.push(`service.runtime.status=${runtimeStatus}`);
}

const cmdArgs = Array.isArray(payload?.service?.command?.programArguments)
  ? payload.service.command.programArguments
  : [];
const normalizedRoot = repoRoot ? path.resolve(repoRoot).replace(/\\/g, "/") : "";
const usesLocalDist = cmdArgs.some((entry) => {
  if (typeof entry !== "string") {
    return false;
  }
  const normalized = path.resolve(entry).replace(/\\/g, "/");
  return normalized.startsWith(`${normalizedRoot}/dist/`);
});
if (!usesLocalDist) {
  failures.push("service command is not pointing at this repo's dist build");
}

const portStatus = payload?.port?.status;
if (typeof portStatus === "string" && portStatus !== "busy") {
  failures.push(`gateway port status=${portStatus}`);
}

if (failures.length > 0) {
  process.stderr.write(failures.join("; "));
  process.exit(1);
}
NODE
  parse_status=$?
  rm -f "${status_tmp}" 2>/dev/null || true
  return "${parse_status}"
}

verify_gateway_probe_once() {
  local raw_output
  local token
  token="$(gateway_token_override)"
  if [[ -n "${token}" ]]; then
    raw_output="$(OPENCLAW_GATEWAY_TOKEN="${token}" node openclaw.mjs gateway probe --json 2>&1)" || {
      printf "gateway probe command failed: %s\n" "${raw_output}" >&2
      return 1
    }
  else
    raw_output="$(node openclaw.mjs gateway probe --json 2>&1)" || {
      printf "gateway probe command failed: %s\n" "${raw_output}" >&2
      return 1
    }
  fi

  local probe_tmp parse_status
  probe_tmp="$(mktemp "${TMPDIR:-/tmp}/openclaw-probe-verify.XXXXXX")" || {
    printf "failed to create temp file for gateway probe parse\n" >&2
    return 1
  }
  printf "%s\n" "${raw_output}" >"${probe_tmp}"

  node - "${probe_tmp}" <<'NODE'
const fs = require("fs");

const probePath = process.argv[2];
const raw = fs.readFileSync(probePath, "utf8");
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");
if (start === -1 || end === -1 || end < start) {
  process.stderr.write("gateway probe did not emit JSON payload");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(raw.slice(start, end + 1));
} catch (err) {
  process.stderr.write(`failed to parse gateway probe JSON: ${String(err)}`);
  process.exit(1);
}

if (payload?.ok === true) {
  process.exit(0);
}

const targetError = Array.isArray(payload?.targets)
  ? payload.targets
      .map((target) => target?.connect?.error)
      .find((value) => typeof value === "string" && value.trim().length > 0)
  : undefined;
const reason = targetError || payload?.error || "gateway probe not ok";
process.stderr.write(String(reason));
process.exit(1);
NODE
  parse_status=$?
  rm -f "${probe_tmp}" 2>/dev/null || true
  return "${parse_status}"
}

verify_enabled_plugins_loaded_once() {
  local raw_output
  raw_output="$(node openclaw.mjs plugins list --json 2>&1)" || {
    printf "plugins list command failed: %s\n" "${raw_output}" >&2
    return 1
  }

  local plugins_tmp parse_status
  plugins_tmp="$(mktemp "${TMPDIR:-/tmp}/openclaw-plugins-verify.XXXXXX")" || {
    printf "failed to create temp file for plugins verification\n" >&2
    return 1
  }
  printf "%s\n" "${raw_output}" >"${plugins_tmp}"

  node - "${plugins_tmp}" <<'NODE'
const fs = require("fs");

const pluginsPath = process.argv[2];
const raw = fs.readFileSync(pluginsPath, "utf8");
const start = raw.indexOf("{");
const end = raw.lastIndexOf("}");
if (start === -1 || end === -1 || end < start) {
  process.stderr.write("plugins list did not emit JSON payload");
  process.exit(1);
}

let payload;
try {
  payload = JSON.parse(raw.slice(start, end + 1));
} catch (err) {
  process.stderr.write(`failed to parse plugins list JSON: ${String(err)}`);
  process.exit(1);
}

const plugins = Array.isArray(payload?.plugins) ? payload.plugins : [];
const failures = [];
for (const plugin of plugins) {
  const enabled = plugin?.enabled === true;
  const status = typeof plugin?.status === "string" ? plugin.status : "";
  if (!enabled || status !== "error") {
    continue;
  }
  const id = typeof plugin?.id === "string" && plugin.id ? plugin.id : "unknown";
  const source = typeof plugin?.source === "string" && plugin.source ? plugin.source : "unknown";
  const error = typeof plugin?.error === "string" && plugin.error ? plugin.error : "unknown error";
  failures.push(`${id} (${source}): ${error}`);
}

if (failures.length > 0) {
  process.stderr.write(`enabled plugins failed to load: ${failures.join(" ; ")}`);
  process.exit(1);
}
NODE
  parse_status=$?
  rm -f "${plugins_tmp}" 2>/dev/null || true
  return "${parse_status}"
}

verify_gateway_status() {
  local attempts_raw delay_raw attempts delay attempt reason
  attempts_raw="${OPENCLAW_START_VERIFY_RETRIES:-12}"
  delay_raw="${OPENCLAW_START_VERIFY_DELAY_SECONDS:-1}"

  [[ "${attempts_raw}" =~ ^[0-9]+$ ]] || die "OPENCLAW_START_VERIFY_RETRIES must be a non-negative integer"
  [[ "${delay_raw}" =~ ^[0-9]+$ ]] || die "OPENCLAW_START_VERIFY_DELAY_SECONDS must be a non-negative integer"

  attempts="${attempts_raw}"
  delay="${delay_raw}"
  (( attempts > 0 )) || die "OPENCLAW_START_VERIFY_RETRIES must be greater than zero"

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    if reason="$(verify_gateway_status_once 2>&1)"; then
      if reason="$(verify_gateway_probe_once 2>&1)"; then
        if reason="$(verify_enabled_plugins_loaded_once 2>&1)"; then
          info "Gateway health verification passed (attempt ${attempt}/${attempts})."
          return 0
        fi
        warn "Plugin load verification attempt ${attempt}/${attempts} failed: ${reason}"
      else
        warn "Gateway probe attempt ${attempt}/${attempts} failed: ${reason}"
      fi
    else
      warn "Gateway status verification attempt ${attempt}/${attempts} failed: ${reason}"
    fi
    if (( attempt < attempts )); then
      sleep "${delay}"
    fi
  done

  die "Gateway service verification failed after ${attempts} attempts."
}

main() {
  trap cleanup_lock EXIT INT TERM
  acquire_lock
  cd "${ROOT_DIR}"

  info "OpenClaw local deploy: validate + rebuild + reinstall service + restart"
  load_openclaw_env_file

  need_cmd node
  need_cmd pnpm
  need_cmd mktemp
  check_node_version
  need_cmd ps

  local config_path
  config_path="$(resolve_config_path)"
  info "Validating config JSON: $config_path"
  validate_config_json "$config_path"

  info "Validating required plugins..."
  ensure_required_plugins "$config_path"
  info "Validating gateway mode..."
  ensure_gateway_mode_local "$config_path"
  info "Validating gateway auth..."
  ensure_gateway_auth_ready "$config_path"

  local platform service_kind gateway_port
  platform="$(detect_platform)"
  case "${platform}" in
    macos) service_kind="launchd user service" ;;
    linux) service_kind="systemd --user service" ;;
    *) die "Unknown platform: ${platform}" ;;
  esac
  info "Detected platform: ${platform} (${service_kind})"
  ensure_platform_prereqs "${platform}"

  gateway_port="$(resolve_gateway_port "$config_path")"
  info "Gateway port: ${gateway_port}"
  ensure_gateway_port_reusable "${gateway_port}"

  run_step "Build OpenClaw dist" pnpm build
  run_step "Build Control UI" pnpm ui:build

  [[ -f "dist/control-ui/index.html" ]] || die "Control UI build missing dist/control-ui/index.html (ui:build failed?)"
  [[ -f "dist/entry.js" || -f "dist/entry.mjs" ]] || die "Build output missing dist/entry.(js|mjs); pnpm build failed."

  run_step "Install ${service_kind} from local build" install_gateway_service
  run_step "Restart ${service_kind}" node openclaw.mjs daemon restart
  run_step "Verify gateway service status + RPC health" verify_gateway_status

  info "OpenClaw service deploy completed successfully."
}

main "$@"
