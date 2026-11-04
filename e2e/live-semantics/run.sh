#!/usr/bin/env bash
# Deploys the scratch app to the local backend started by ../backendHarness.js
# and runs the Convex semantics suite against it. Usage, from e2e/:
#   node backendHarness.js 'bash live-semantics/run.sh'
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONVEX_URL="${CONVEX_SEMANTICS_URL:-http://127.0.0.1:3210}"
ADMIN_KEY="${CONVEX_ADMIN_KEY:?CONVEX_ADMIN_KEY must be set (the backend harness injects it)}"
# Use the repo root's pinned convex CLI rather than letting npx resolve one;
# this directory has no node_modules of its own.
CONVEX_CLI="$SCRIPT_DIR/../../node_modules/convex/bin/main.js"
pushd "$SCRIPT_DIR" > /dev/null
node "$CONVEX_CLI" deploy --url "$CONVEX_URL" --admin-key "$ADMIN_KEY" -y --typecheck disable
popd > /dev/null
pushd "$SCRIPT_DIR/../.." > /dev/null
CONVEX_SEMANTICS_URL="$CONVEX_URL" CONVEX_ADMIN_KEY="$ADMIN_KEY" npx vitest run src/client/convex-semantics.test.ts "$@"
popd > /dev/null
