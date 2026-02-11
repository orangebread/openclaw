#!/usr/bin/env bash
set -euo pipefail

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

main() {
  info "OpenClaw dev start: validate + rebuild Control UI + run gateway"

  need_cmd node
  need_cmd pnpm
  check_node_version

  local config_path
  config_path="$(resolve_config_path)"
  info "Validating config JSON: $config_path"
  validate_config_json "$config_path"

  info "Validating required plugins..."
  ensure_required_plugins "$config_path"

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
