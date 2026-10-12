#!/usr/bin/env bash
# Bridge submit drill on Midnight Preprod: prove-bridge proves proveCover, a headless
# wallet balances + submits it the way Lace does. Shares the relay wallet lock.
#   ./run-bridge-drill.sh --key <policy-key.json> [--dry-run]
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
H=${MIDNIGHT_AGENT_DIR:-/workspace/Midnight-GrokBot-Agent}; R=${MIDNIGHT_RUNTIME_DIR:-$H/.plutusshield-run}
S="${PLUTUSSHIELD_SECRETS:-/workspace/PlutusShield-secrets}"
cp "$HERE/prove-bridge.mjs" "$HERE/bridge-submit-drill.mjs" "$R/"
cd "$R"
exec 9>"$R/.wallet.lock"
flock -w 3600 9 || { echo "wallet lock wait timed out; nothing submitted" >&2; exit 1; }
[ -n "${BLOCKFROST_MIDNIGHT_PREPROD_ID:-}" ] || export $(grep '^BLOCKFROST_MIDNIGHT_PREPROD_ID=' "$S/blockfrost-midnight-preprod.env" | xargs)
export POLICY_COVER_OUT="${POLICY_COVER_OUT:-$R/policy-cover-v2}"
export MIDNIGHT_WALLET_FACADE=$H/packages/preprod-hello-stub/src/wallet-facade.mjs
export MIDNIGHT_LOAD_ENV=$H/packages/preprod-hello-stub/src/load-env.mjs
export PLUTUSSHIELD_DRILL_RECORD="${PLUTUSSHIELD_DRILL_RECORD:-$(cd "$HERE/.." && pwd)/deployments/preprod-v2-bridge-drill.json}"
REDACT='s/(project_id=)[^&[:space:]"]+/\1…/g; s/nightpreprod[A-Za-z0-9]+/nightpreprod…/g'
exec node --max-old-space-size=6144 --no-warnings bridge-submit-drill.mjs "$@" > >(sed -u -E "$REDACT") 2> >(sed -u -E "$REDACT" >&2)
