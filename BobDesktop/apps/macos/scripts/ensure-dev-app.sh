#!/usr/bin/env bash
# Sign/install a real Tauri-bundled macOS .app for Bob Work so UNUserNotificationCenter
# can register com.bobwork.desktop in System Settings → Notifications.
#
# Bare `tauri dev` / `cargo run` cannot: macOS requires a .app, and on recent
# macOS a real code-signing identity (Apple Development), not ad-hoc "-".
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=app-identity.sh
source "$ROOT/scripts/app-identity.sh"

PROFILE="${1:-debug}"
INSTALL_APPS="${INSTALL_APPS:-0}"
# When building `universal-apple-darwin`, Tauri writes under target/<triple>/...
TAURI_TARGET="${TAURI_TARGET:-}"
if [[ -n "$TAURI_TARGET" ]]; then
  APP_DIR="$ROOT/src-tauri/target/$TAURI_TARGET/$PROFILE/bundle/macos"
else
  APP_DIR="$ROOT/src-tauri/target/$PROFILE/bundle/macos"
fi
APP="$APP_DIR/$BOB_WORK_PROD_PRODUCT_NAME.app"
IDENTIFIER="$BOB_WORK_PROD_IDENTIFIER"
EXECUTABLE="$BOB_WORK_PROD_EXECUTABLE"
ENTITLEMENTS="$ROOT/src-tauri/entitlements.plist"
APP_ICON="$APP/Contents/Resources/icon.icns"
# A plain ad-hoc signature gets a designated requirement based on its cdhash.
# That hash changes after every build and makes macOS TCC reject permissions
# that the user already granted. Keep a stable local-development requirement
# when the login keychain cannot use the Apple Development private key.
DEV_REQUIREMENT="=designated => identifier \"$IDENTIFIER\""

# Only install the real bundle produced by Tauri. A plain `cargo build` binary
# expects the Vite development server and therefore opens a blank window when
# copied into an .app on its own. The bundled executable already contains the
# matching frontend and must never be overwritten here.
if [[ ! -d "$APP" || ! -x "$APP/Contents/MacOS/$EXECUTABLE" ]]; then
  echo "Missing packaged application: $APP" >&2
  echo "Build it first with: pnpm exec tauri build --debug --bundles app" >&2
  exit 1
fi

# Notification Center always takes the sender icon from the application
# bundle. Refuse to install an incomplete bundle, which would make macOS show
# a generic executable icon in Bob Work notifications.
if [[ ! -f "$APP_ICON" ]]; then
  echo "Missing application icon used by macOS notifications: $APP_ICON" >&2
  exit 1
fi
if [[ "$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIconFile' "$APP/Contents/Info.plist" 2>/dev/null || true)" != "icon.icns" ]]; then
  echo "Invalid CFBundleIconFile in $APP/Contents/Info.plist (expected icon.icns)" >&2
  exit 1
fi

# Prefer a local Apple Development identity — required for UN prompts on modern macOS.
# Enterprise source installs can force a stable ad-hoc signature (no Apple account).
SIGN_ID="${BOB_WORK_SIGN_IDENTITY:-}"
if [[ "${BOB_WORK_FORCE_ADHOC:-0}" == "1" ]]; then
  SIGN_ID=""
elif [[ -z "$SIGN_ID" ]]; then
  SIGN_ID="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
      | head -1
  )"
fi
if [[ -z "$SIGN_ID" && "${BOB_WORK_FORCE_ADHOC:-0}" != "1" ]]; then
  SIGN_ID="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Developer ID Application:[^"]*\)".*/\1/p' \
      | head -1
  )"
fi

sign_stable_adhoc() {
  local target="$1"
  if [[ -f "$ENTITLEMENTS" ]]; then
    codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" \
      --requirements "$DEV_REQUIREMENT" --sign - "$target"
  else
    codesign --force --deep --options runtime \
      --requirements "$DEV_REQUIREMENT" --sign - "$target"
  fi
}

if [[ -n "$SIGN_ID" && -f "$ENTITLEMENTS" ]]; then
  echo "Signing with: $SIGN_ID" >&2
  if ! codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$APP"; then
    echo "Warning: Apple Development signing failed; using a stable local-development signature." >&2
    sign_stable_adhoc "$APP"
  fi
elif [[ -n "$SIGN_ID" ]]; then
  echo "Signing with: $SIGN_ID" >&2
  codesign --force --deep --options runtime --sign "$SIGN_ID" "$APP"
else
  echo "Using stable ad-hoc signature (identifier $IDENTIFIER)." >&2
  sign_stable_adhoc "$APP"
fi

if [[ "$INSTALL_APPS" == "1" ]]; then
  # Never keep two processes with the same bundle identifier alive: TCC can
  # otherwise display one Bob Work entry while authorizing another copy.
  pkill -TERM -f "^/Applications/Bob Work.app/Contents/MacOS/$EXECUTABLE$" 2>/dev/null || true
  pkill -TERM -f "^$APP/Contents/MacOS/$EXECUTABLE$" 2>/dev/null || true
  ditto "$APP" "/Applications/Bob Work.app"
  if [[ -n "$SIGN_ID" && -f "$ENTITLEMENTS" ]]; then
    if ! codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "/Applications/Bob Work.app"; then
      echo "Warning: Apple Development signing failed for /Applications; using the stable local-development signature." >&2
      sign_stable_adhoc "/Applications/Bob Work.app"
    fi
  else
    sign_stable_adhoc "/Applications/Bob Work.app"
  fi
  xattr -cr "/Applications/Bob Work.app" 2>/dev/null || true
  echo "/Applications/Bob Work.app"
else
  echo "$APP"
fi
