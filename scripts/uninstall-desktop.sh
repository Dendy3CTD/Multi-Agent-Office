#!/usr/bin/env bash
set -euo pipefail
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
rm -f "$DESKTOP_DIR/open-agent-office.desktop" "$ICON_DIR/open-agent-office.png"
if command -v update-desktop-database >/dev/null 2>&1 && [[ -d "$DESKTOP_DIR" ]]; then update-desktop-database "$DESKTOP_DIR"; fi
if [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] && command -v gsettings >/dev/null 2>&1; then
  python3 - <<'PY'
import ast, subprocess
raw = subprocess.run(['gsettings','get','org.gnome.shell','favorite-apps'], capture_output=True, text=True, check=False).stdout.strip()
try:
    favorites = ast.literal_eval(raw)
except (ValueError, SyntaxError):
    favorites = []
favorites = [item for item in favorites if item != 'open-agent-office.desktop']
subprocess.run(['gsettings','set','org.gnome.shell','favorite-apps',str(favorites)], check=False)
PY
fi
echo "Removed desktop entry and user icon. Project files and settings were not touched."
