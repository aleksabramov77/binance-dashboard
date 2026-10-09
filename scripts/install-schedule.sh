#!/usr/bin/env bash
# Ставит launchd-задачу: снимок Binance Earn для binance-dashboard в 09:00 и 21:00 каждый день.
# Удаление: launchctl bootout gui/$(id -u)/com.binance-dashboard.snapshot && rm ~/Library/LaunchAgents/com.binance-dashboard.snapshot.plist
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.binance-dashboard.snapshot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
PNPM="$(command -v pnpm)"
NODE_DIR="$(dirname "$(command -v node)")"

mkdir -p "$PROJECT_DIR/data" "$HOME/Library/LaunchAgents"
cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$PROJECT_DIR</string>
  <key>ProgramArguments</key>
  <array><string>$PNPM</string><string>snapshot</string></array>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>$NODE_DIR:/usr/bin:/bin</string></dict>
  <key>StartCalendarInterval</key>
  <array>
    <dict><key>Hour</key><integer>9</integer><key>Minute</key><integer>0</integer></dict>
    <dict><key>Hour</key><integer>21</integer><key>Minute</key><integer>0</integer></dict>
  </array>
  <key>StandardOutPath</key><string>$PROJECT_DIR/data/snapshot.log</string>
  <key>StandardErrorPath</key><string>$PROJECT_DIR/data/snapshot.log</string>
</dict>
</plist>
PLIST

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "Готово: $LABEL, снимки в 09:00 и 21:00. Лог: $PROJECT_DIR/data/snapshot.log"
