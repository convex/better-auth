#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

AUDIT_ONLY=false
if [ "$#" -eq 1 ] && [ "$1" = --audit-only ]; then
  AUDIT_ONLY=true
elif [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--audit-only]" >&2
  exit 1
fi

CONVEX_URL="http://127.0.0.1:3210"
ADMIN_KEY="${CONVEX_ADMIN_KEY:?Backend harness required}"

convex() {
  npx convex "$@" --url "$CONVEX_URL" --admin-key "$ADMIN_KEY"
}

convex env set SITE_URL http://localhost:5176
convex env set BETTER_AUTH_SECRET e2e-test-secret-key-do-not-use-in-production
for registration in eager lazy; do
  convex env set OAUTH_ROUTE_REGISTRATION "$registration"
  for basepath in /api/auth /custom/auth; do
    convex env set AUDIT_AUTH_BASE_PATH "$basepath"
    convex deploy --typecheck enable -y
    if [ "$basepath" = /api/auth ]; then
      if [ "$AUDIT_ONLY" = false ]; then
        echo "Running OAuth provider tests ($registration)..."
        OAUTH_ROUTE_REGISTRATION="$registration" npx playwright test --config playwright.http.config.ts --project oauth
        OAUTH_ROUTE_REGISTRATION="$registration" npx playwright test --config playwright.surfaces-browser.config.ts
      fi
      echo "Running route regression tests ($registration)..."
      OAUTH_ROUTE_REGISTRATION="$registration" AUDIT_AUTH_BASE_PATH="$basepath" npx playwright test --config playwright.http.config.ts --project routes
      if [ "$registration" = eager ]; then
        echo "Running adapter regression tests..."
        npx playwright test --config playwright.http.config.ts --project adapter
      fi
    else
      OAUTH_ROUTE_REGISTRATION="$registration" AUDIT_AUTH_BASE_PATH="$basepath" npx playwright test audit/custom-path.spec.ts --config playwright.http.config.ts --project routes
    fi
  done
done
