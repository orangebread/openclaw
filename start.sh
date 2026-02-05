#!/usr/bin/env bash
set -euo pipefail

die() {
  printf "start.sh: %s\n" "$1" >&2
  exit 1
}

info() {
  printf "%s\n" "$1"
}

need_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
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

main() {
  info "OpenClaw dev start: validate + rebuild Control UI + run gateway"

  need_cmd node
  need_cmd pnpm
  check_node_version

  local config_path
  config_path="$(resolve_config_path)"
  info "Validating config JSON: $config_path"
  validate_config_json "$config_path"

  info "Rebuilding Control UI..."
  pnpm ui:build

  [[ -f "dist/control-ui/index.html" ]] || die "Control UI build missing dist/control-ui/index.html (ui:build failed?)"

  info "Starting gateway (dev) ..."
  info "Note: OPENCLAW_GATEWAY_TOKEN is set by this script; it is not printed."

  # Ensure channels/providers are enabled even if the caller environment has dev skip flags set.
  unset OPENCLAW_SKIP_CHANNELS OPENCLAW_SKIP_PROVIDERS CLAWDBOT_SKIP_CHANNELS

  exec env OPENCLAW_GATEWAY_TOKEN="123onmyknee123" pnpm gateway:dev
}

main "$@"
