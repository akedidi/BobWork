#!/usr/bin/env bash
# Build/refresh a real macOS .app for Bob Work so UNUserNotificationCenter
# can register com.bobwork.desktop in System Settings → Notifications.
#
# Bare `tauri dev` / `cargo run` cannot: macOS requires a .app, and on recent
# macOS a real code-signing identity (Apple Development), not ad-hoc "-".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROFILE="${1:-debug}"
INSTALL_APPS="${INSTALL_APPS:-0}"
BIN="$ROOT/src-tauri/target/$PROFILE/bob-work"
APP_DIR="$ROOT/src-tauri/target/$PROFILE/bundle/macos"
APP="$APP_DIR/Bob Work.app"
CONTENTS="$APP/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
IDENTIFIER="com.bobwork.desktop"
EXECUTABLE="bob-work"
ENTITLEMENTS="$ROOT/src-tauri/entitlements.plist"

if [[ ! -x "$BIN" ]]; then
  echo "Missing binary: $BIN" >&2
  echo "Build first (e.g. pnpm tauri build --debug, or pnpm dev:tauri once)." >&2
  exit 1
fi

mkdir -p "$MACOS_DIR" "$RESOURCES"
# Prefer a full Tauri-bundled .app when present; otherwise wrap the binary.
if [[ -d "$APP" && -x "$APP/Contents/MacOS/$EXECUTABLE" ]]; then
  cp -f "$BIN" "$APP/Contents/MacOS/$EXECUTABLE"
  chmod +x "$APP/Contents/MacOS/$EXECUTABLE"
else
  cp -f "$BIN" "$MACOS_DIR/$EXECUTABLE"
  chmod +x "$MACOS_DIR/$EXECUTABLE"
  if [[ -f "$ROOT/src-tauri/icons/icon.icns" ]]; then
    cp -f "$ROOT/src-tauri/icons/icon.icns" "$RESOURCES/icon.icns"
  fi
  VERSION="$(
    python3 -c "import json; print(json.load(open('$ROOT/src-tauri/tauri.conf.json'))['version'])"
  )"
  cat > "$CONTENTS/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>en</string>
  <key>CFBundleDisplayName</key>
  <string>Bob Work</string>
  <key>CFBundleExecutable</key>
  <string>${EXECUTABLE}</string>
  <key>CFBundleIconFile</key>
  <string>icon.icns</string>
  <key>CFBundleIdentifier</key>
  <string>${IDENTIFIER}</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>Bob Work</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>${VERSION}</string>
  <key>CFBundleVersion</key>
  <string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSHighResolutionCapable</key>
  <true/>
  <key>NSUserNotificationAlertStyle</key>
  <string>alert</string>
  <key>NSMicrophoneUsageDescription</key>
  <string>Bob Work utilise le microphone uniquement lorsque vous démarrez la dictée vocale.</string>
  <key>NSSpeechRecognitionUsageDescription</key>
  <string>Bob Work utilise la reconnaissance vocale Apple pour transcrire votre dictée dans le prompt.</string>
  <key>NSAppleEventsUsageDescription</key>
  <string>Bob Work peut contrôler une application uniquement après votre autorisation explicite.</string>
</dict>
</plist>
EOF
fi

# Prefer a local Apple Development identity — required for UN prompts on modern macOS.
SIGN_ID="${BOB_WORK_SIGN_IDENTITY:-}"
if [[ -z "$SIGN_ID" ]]; then
  SIGN_ID="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
      | head -1
  )"
fi
if [[ -z "$SIGN_ID" ]]; then
  SIGN_ID="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
      | head -1
  )"
fi

if [[ -n "$SIGN_ID" && -f "$ENTITLEMENTS" ]]; then
  echo "Signing with: $SIGN_ID" >&2
  codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$APP"
elif [[ -n "$SIGN_ID" ]]; then
  echo "Signing with: $SIGN_ID" >&2
  codesign --force --deep --options runtime --sign "$SIGN_ID" "$APP"
else
  echo "Warning: no Apple Development identity found; ad-hoc sign (notifications may fail on recent macOS)." >&2
  codesign --force --deep --sign - "$APP" >/dev/null 2>&1 || true
fi

if [[ "$INSTALL_APPS" == "1" ]]; then
  ditto "$APP" "/Applications/Bob Work.app"
  if [[ -n "$SIGN_ID" && -f "$ENTITLEMENTS" ]]; then
    codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "/Applications/Bob Work.app"
  fi
  echo "/Applications/Bob Work.app"
else
  echo "$APP"
fi
