#!/usr/bin/env bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
PROJECT_ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd -P)"
DATA_HOME="${XDG_DATA_HOME:-$HOME/.local/share}"
DESKTOP_DIR="$DATA_HOME/applications"
ICON_DIR="$DATA_HOME/icons/hicolor/512x512/apps"
DESKTOP_FILE="$DESKTOP_DIR/open-agent-office.desktop"
ICON_FILE="$ICON_DIR/open-agent-office.png"
SOURCE_ICON="$PROJECT_ROOT/apps/office/assets/open-agent-office.png"
[[ -f "$PROJECT_ROOT/apps/office/dist/index.html" ]] || { echo "Production build missing: run corepack pnpm build first." >&2; exit 1; }
[[ -f "$SOURCE_ICON" ]] || { echo "Application icon missing: $SOURCE_ICON" >&2; exit 1; }
[[ -x "$SCRIPT_DIR/launch-desktop.sh" ]] || chmod +x "$SCRIPT_DIR/launch-desktop.sh"
mkdir -p "$DESKTOP_DIR" "$ICON_DIR"
install -m 0644 "$SOURCE_ICON" "$ICON_FILE"
cat > "$DESKTOP_FILE" <<EOF
[Desktop Entry]
Type=Application
Name=Open Agent Office
Comment=Local multi-agent visual office
Exec=$SCRIPT_DIR/launch-desktop.sh
Icon=$ICON_FILE
Terminal=false
Categories=Development;Office;
StartupNotify=true
StartupWMClass=open-agent-office
EOF
chmod 0644 "$DESKTOP_FILE"
if command -v update-desktop-database >/dev/null 2>&1; then update-desktop-database "$DESKTOP_DIR"; fi
if [[ "${XDG_CURRENT_DESKTOP:-}" == *GNOME* ]] && command -v gsettings >/dev/null 2>&1; then
  current="$(gsettings get org.gnome.shell favorite-apps 2>/dev/null || true)"
  if [[ "$current" != *"'open-agent-office.desktop'"* ]]; then
    python3 - "$current" <<'PY'
import ast, subprocess, sys
try:
    favorites = ast.literal_eval(sys.argv[1].strip())
except (ValueError, SyntaxError):
    favorites = []
if not isinstance(favorites, list):
    favorites = []
favorites.append('open-agent-office.desktop')
subprocess.run(['gsettings', 'set', 'org.gnome.shell', 'favorite-apps', str(favorites)], check=True)
PY
    echo "GNOME favorite added: Open Agent Office"
  else
    echo "GNOME favorite already present"
  fi
else
  echo "Desktop detected: ${XDG_CURRENT_DESKTOP:-unknown}. Entry installed; pin it from the application menu."
fi
[[ -r "$DESKTOP_FILE" && -r "$ICON_FILE" && -x "$SCRIPT_DIR/launch-desktop.sh" ]] || { echo "Desktop installation verification failed." >&2; exit 1; }
echo "Installed: $DESKTOP_FILE"
echo "Icon: $ICON_FILE"
