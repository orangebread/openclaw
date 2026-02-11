#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage:
  doctl-with-op.sh 'op://<vault>/<item>/token' <doctl-subcommand> [args...]

Example:
  doctl-with-op.sh 'op://Private/DigitalOcean/token' compute droplet list
EOF
}

if [[ $# -lt 2 ]]; then
  usage
  exit 1
fi

if ! command -v op >/dev/null 2>&1; then
  echo "error: op CLI not found in PATH" >&2
  exit 1
fi

if ! command -v doctl >/dev/null 2>&1; then
  echo "error: doctl not found in PATH" >&2
  exit 1
fi

item_ref="$1"
shift

token="$(op read "$item_ref")"
if [[ -z "${token}" ]]; then
  echo "error: empty token from 1Password reference: $item_ref" >&2
  exit 1
fi

# Keep the token in process environment only for this command execution.
DIGITALOCEAN_ACCESS_TOKEN="$token" doctl "$@"
