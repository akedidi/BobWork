#!/usr/bin/env bash
# Sign/install the Bob Work-test side-by-side variant (separate bundle id / binary / data).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=app-identity.sh
source "$ROOT/scripts/app-identity.sh"

PROFILE="${1:-debug}"
INSTALL_APPS="${INSTALL_APPS:-0}"
APP_DIR="$ROOT/src-tauri/target/$PROFILE/bundle/macos"
APP_NAME="$BOB_WORK_TEST_PRODUCT_NAME"
APP="$APP_DIR/$APP_NAME.app"
IDENTIFIER="$BOB_WORK_TEST_IDENTIFIER"
# Tauri `mainBinaryName` should emit bob-work-test; still migrate legacy bob-work.
SOURCE_EXECUTABLE="$BOB_WORK_PROD_EXECUTABLE"
EXECUTABLE="$BOB_WORK_TEST_EXECUTABLE"
BUNDLE_NAME="$BOB_WORK_TEST_BUNDLE_NAME"
ENTITLEMENTS="$ROOT/src-tauri/entitlements.plist"
APP_ICON="$APP/Contents/Resources/icon.icns"
INFO_PLIST="$APP/Contents/Info.plist"
DEV_REQUIREMENT="=designated => identifier \"$IDENTIFIER\""
INSTALL_PATH="/Applications/$APP_NAME.app"
APPLE_EVENTS_USAGE="Bob Work-test uses Automation to control Google Chrome when you enable Chrome control (tabs, navigation, and page actions). This is separate from the release Bob Work app."

plist_set() {
  local plist="$1" key="$2" value="$3"
  /usr/libexec/PlistBuddy -c "Set :$key $value" "$plist" 2>/dev/null \
    || /usr/libexec/PlistBuddy -c "Add :$key string $value" "$plist"
}

normalize_test_bundle() {
  local app_root="$1"
  local macos_dir="$app_root/Contents/MacOS"
  local plist="$app_root/Contents/Info.plist"

  if [[ -x "$macos_dir/$SOURCE_EXECUTABLE" && ! -x "$macos_dir/$EXECUTABLE" ]]; then
    mv "$macos_dir/$SOURCE_EXECUTABLE" "$macos_dir/$EXECUTABLE"
  fi
  if [[ -e "$macos_dir/$SOURCE_EXECUTABLE" && -x "$macos_dir/$EXECUTABLE" ]]; then
    rm -f "$macos_dir/$SOURCE_EXECUTABLE"
  fi
  if [[ ! -x "$macos_dir/$EXECUTABLE" ]]; then
    echo "Missing packaged executable: $macos_dir/$EXECUTABLE" >&2
    echo "Build it first with: pnpm release:test (mainBinaryName=bob-work-test)" >&2
    exit 1
  fi

  plist_set "$plist" "CFBundleExecutable" "$EXECUTABLE"
  plist_set "$plist" "CFBundleIdentifier" "$IDENTIFIER"
  plist_set "$plist" "CFBundleName" "$BUNDLE_NAME"
  plist_set "$plist" "CFBundleDisplayName" "$APP_NAME"
  plist_set "$plist" "NSAppleEventsUsageDescription" "$APPLE_EVENTS_USAGE"
}

if [[ ! -d "$APP" ]]; then
  echo "Missing packaged application: $APP" >&2
  echo "Build it first with: pnpm release:test" >&2
  exit 1
fi

normalize_test_bundle "$APP"

if [[ ! -f "$APP_ICON" ]]; then
  echo "Missing application icon: $APP_ICON" >&2
  exit 1
fi

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
  echo "Signing $APP_NAME with: $SIGN_ID" >&2
  if ! codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$APP"; then
    echo "Warning: Apple Development signing failed; using a stable local-development signature." >&2
    codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" \
      --requirements "$DEV_REQUIREMENT" --sign - "$APP"
  fi
elif [[ -n "$SIGN_ID" ]]; then
  codesign --force --deep --options runtime --sign "$SIGN_ID" "$APP"
else
  echo "Warning: no Apple Development identity found; using a stable local-development signature." >&2
  codesign --force --deep --requirements "$DEV_REQUIREMENT" --sign - "$APP" >/dev/null 2>&1 || true
fi

if [[ "$INSTALL_APPS" == "1" ]]; then
  pkill -TERM -f "^$INSTALL_PATH/Contents/MacOS/$EXECUTABLE$" 2>/dev/null || true
  pkill -TERM -f "^$INSTALL_PATH/Contents/MacOS/$SOURCE_EXECUTABLE$" 2>/dev/null || true
  pkill -TERM -f "^$APP/Contents/MacOS/$EXECUTABLE$" 2>/dev/null || true
  pkill -TERM -f "^$APP/Contents/MacOS/$SOURCE_EXECUTABLE$" 2>/dev/null || true
  ditto "$APP" "$INSTALL_PATH"
  normalize_test_bundle "$INSTALL_PATH"
  if [[ -n "$SIGN_ID" && -f "$ENTITLEMENTS" ]]; then
    if ! codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" --sign "$SIGN_ID" "$INSTALL_PATH"; then
      codesign --force --deep --options runtime --entitlements "$ENTITLEMENTS" \
        --requirements "$DEV_REQUIREMENT" --sign - "$INSTALL_PATH"
    fi
  fi
  echo "$INSTALL_PATH"
else
  echo "$APP"
fi
