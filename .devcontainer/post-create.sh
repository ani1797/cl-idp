#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

if ! command -v uv >/dev/null 2>&1; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
  export PATH="$HOME/.local/bin:$PATH"
fi

cd "$REPO_ROOT/apps/api"
uv sync --dev

cd "$REPO_ROOT/apps/web"
npm install

echo "Workspace dependencies installed."
echo "Start local emulators manually with: docker compose up -d"
