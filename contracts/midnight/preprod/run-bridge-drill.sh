#!/usr/bin/env bash
# Bridge submit drill on Midnight Preprod: prove-bridge proves proveCover, a headless
# wallet balances + submits it the way Lace does. Shares the relay wallet lock.
# Relies on MIDNIGHT_WALLET_FACADE waitForSynced dust-balance (>0) / dust-stall bypass
# so Preprod dust index crawl does not block a funded wallet for hours.
#   ./run-bridge-drill.sh --key <policy-key.json> [--dry-run]
# MIDNIGHT_NODE_URL picks the submit node; on a stalled submit the drill probes that
# node (health, best block, pending pool) and logs a stall row in the public record.
# Submit is a watched node submit that logs every pool status (default);
# PLUTUSSHIELD_DRILL_SUBMIT_MODE=wallet uses the facade submitTransaction instead.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
H=${MIDNIGHT_AGENT_DIR:-/workspace/Midnight-GrokBot-Agent}; R=${MIDNIGHT_RUNTIME_DIR:-$H/.plutusshield-run}
S="${PLUTUSSHIELD_SECRETS:-/workspace/PlutusShield-secrets}"
cp "$HERE/prove-bridge.mjs" "$HERE/bridge-submit-drill.mjs" "$HERE/node-watch-submit.mjs" "$R/"
cd "$R"
exec 9>"$R/.wallet.lock"
flock -w 3600 9 || { echo "wallet lock wait timed out; nothing submitted" >&2; exit 1; }
[ -n "${BLOCKFROST_MIDNIGHT_PREPROD_ID:-}" ] || export $(grep '^BLOCKFROST_MIDNIGHT_PREPROD_ID=' "$S/blockfrost-midnight-preprod.env" | xargs)
export POLICY_COVER_OUT="${POLICY_COVER_OUT:-$R/policy-cover-v2}"
export MIDNIGHT_WALLET_FACADE=$H/packages/preprod-hello-stub/src/wallet-facade.mjs
export MIDNIGHT_PROOF_SERVER_URL="${MIDNIGHT_PROOF_SERVER_URL:-${MIDNIGHT_PROOF_SERVER:-http://127.0.0.1:6300}}"
export MIDNIGHT_PROOF_SERVER="${MIDNIGHT_PROOF_SERVER:-$MIDNIGHT_PROOF_SERVER_URL}"
export MIDNIGHT_LOAD_ENV=$H/packages/preprod-hello-stub/src/load-env.mjs
export PLUTUSSHIELD_DRILL_RECORD="${PLUTUSSHIELD_DRILL_RECORD:-$(cd "$HERE/.." && pwd)/deployments/preprod-v2-bridge-drill.json}"
export PLUTUSSHIELD_DRILL_TX_OUT="${PLUTUSSHIELD_DRILL_TX_OUT:-$R/bridge-drill-last-tx.hex}"
REDACT='s/(project_id=)[^&[:space:]"]+/\1…/g; s/nightpreprod[A-Za-z0-9]+/nightpreprod…/g'
exec node --max-old-space-size=6144 --no-warnings bridge-submit-drill.mjs "$@" > >(sed -u -E "$REDACT") 2> >(sed -u -E "$REDACT" >&2)
