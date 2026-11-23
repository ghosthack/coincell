#!/bin/sh
# Run coincell as a login item on this Mac: it starts when you log in and is restarted if it stops.
# It must run in your own desktop session for the macOS Keychain (where saved logins are kept) to
# be available to it; a coincell started over SSH cannot reach the Keychain.
#   npm run service            install and start (or restart after an update)
#   npm run service -- remove  stop and remove
set -e
LABEL=com.ghosthack.coincell
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR=$(cd "$(dirname "$0")/.." && pwd)
DOMAIN="gui/$(id -u)"
launchctl bootout "$DOMAIN/$LABEL" 2>/dev/null || true
if [ "$1" = "remove" ]; then rm -f "$PLIST"; echo "coincell is no longer a login item."; exit 0; fi
NODE=$(command -v node || zsh -lic 'command -v node' 2>/dev/null | tail -1)
[ -x "$NODE" ] || { echo "node was not found"; exit 1; }
mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key><array><string>$NODE</string><string>src/server.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$HOME/Library/Logs/coincell.log</string>
  <key>StandardErrorPath</key><string>$HOME/Library/Logs/coincell.log</string>
</dict></plist>
PLIST
launchctl bootstrap "$DOMAIN" "$PLIST"
echo "coincell is a login item now. Log: ~/Library/Logs/coincell.log"
