#!/usr/bin/env bash
# Renders the 1200x630 social cards under assets/cards/ from template.html.
# Needs a static server already running (python3 -m http.server) and chromium.
set -euo pipefail

HOST="${1:-http://localhost:8930}"
OUT_DIR="$(dirname "$0")/../../assets/cards"
GAMES=(hub wordrow clusters heptagram minigrid wordweave edgeways sudoku)

mkdir -p "$OUT_DIR"

for id in "${GAMES[@]}"; do
  chromium --headless=new --disable-gpu --window-size=1200,630 \
    --screenshot="$OUT_DIR/$id.png" \
    "$HOST/tools/cards/template.html?game=$id"
  echo "wrote $OUT_DIR/$id.png"
done
