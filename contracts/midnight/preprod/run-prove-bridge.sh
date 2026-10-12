#!/usr/bin/env bash
# Run the holder prove bridge (127.0.0.1:6310) from a midnight-js 4.1.1 workspace.
#   MIDNIGHT_RUNTIME_DIR  dir with node_modules/@midnight-ntwrk/* and the compiled policy-cover-v2
#                         (default /workspace/Midnight-GrokBot-Agent/.plutusshield-run)
#   BLOCKFROST_MIDNIGHT_PREPROD_ID or MIDNIGHT_INDEXER_URL  Preprod indexer (read from
#                         $PLUTUSSHIELD_SECRETS/blockfrost-midnight-preprod.env when unset)
# Never submits, never holds a seed. Ctrl-C to stop.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
R="${MIDNIGHT_RUNTIME_DIR:-/workspace/Midnight-GrokBot-Agent/.plutusshield-run}"
S="${PLUTUSSHIELD_SECRETS:-/workspace/PlutusShield-secrets}"
if [ -z "${BLOCKFROST_MIDNIGHT_PREPROD_ID:-}" ] && [ -z "${MIDNIGHT_INDEXER_URL:-}" ] && [ -f "$S/blockfrost-midnight-preprod.env" ]; then
  export $(grep '^BLOCKFROST_MIDNIGHT_PREPROD_ID=' "$S/blockfrost-midnight-preprod.env" | xargs)
fi
export POLICY_COVER_OUT="${POLICY_COVER_OUT:-$R/policy-cover-v2}"
cp "$HERE/prove-bridge.mjs" "$R/prove-bridge.mjs"
cd "$R"
REDACT='s/(project_id=)[^&[:space:]"]+/\1…/g; s/nightpreprod[A-Za-z0-9]+/nightpreprod…/g'
exec node --no-warnings prove-bridge.mjs "$@" > >(sed -u -E "$REDACT") 2> >(sed -u -E "$REDACT" >&2)
