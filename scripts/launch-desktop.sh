#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
OFFICE_ROOT="$PROJECT_ROOT/apps/office"
if [[ ! -f "$OFFICE_ROOT/dist/index.html" ]]; then
  echo "Open Agent Office is not built. Run: corepack pnpm --filter @open-agent-office/office build" >&2; exit 1
fi
if [[ ! -x "$PROJECT_ROOT/node_modules/.bin/electron" && ! -x "$OFFICE_ROOT/node_modules/.bin/electron" ]]; then
  echo "Electron is missing. Run: corepack pnpm install" >&2; exit 1
fi
cd "$PROJECT_ROOT"
exec corepack pnpm --filter @open-agent-office/office exec electron "$OFFICE_ROOT/electron/main.cjs"
