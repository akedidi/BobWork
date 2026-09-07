#!/usr/bin/env bash
# Regenerates the Expo native project and uses a project-local DerivedData folder,
# preventing old pods/modules and old Xcode objects from leaking into a release.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
RELEASE_ROOT="$ROOT/.release"
DERIVED_DATA="$RELEASE_ROOT/ios-derived-data"
ARCHIVE="$RELEASE_ROOT/BobMobile.xcarchive"
MODE="${1:-simulator}"

if [[ "$MODE" != "prepare" && "$MODE" != "simulator" && "$MODE" != "archive" && "$MODE" != "verify" ]]; then
  echo "Usage: bash scripts/release-ios.sh [prepare|simulator|archive|verify] [app-path]" >&2
  exit 2
fi
if [[ -n "${EXPO_PUBLIC_BOB_MOBILE_DEV_SCREEN:-}" || -n "${REACT_NATIVE_PACKAGER_HOSTNAME:-}" ]]; then
  echo "Refusing a Release build with development-only environment variables." >&2
  exit 1
fi

clean_directory() {
  local path="$1"
  case "$path" in
    "$ROOT"/.expo|"$ROOT"/dist|"$ROOT"/build|"$ROOT"/ios/build|"$ROOT"/.release) ;;
    *) echo "Refusing to clean unexpected path: $path" >&2; exit 1 ;;
  esac
  if [[ -d "$path" ]]; then
    find "$path" -mindepth 1 -delete
    rmdir "$path" 2>/dev/null || true
  fi
}

prepare() {
  echo "Removing Expo, Xcode and previous Release outputs..."
  clean_directory "$ROOT/.expo"
  clean_directory "$ROOT/dist"
  clean_directory "$ROOT/build"
  clean_directory "$ROOT/ios/build"
  clean_directory "$ROOT/.release"
  mkdir -p "$RELEASE_ROOT"

  cd "$ROOT"
  # ios/ is generated and intentionally rebuilt from app.json + package.json.
  pnpm exec expo prebuild --clean --platform ios
}

case "$MODE" in
  prepare)
    prepare
    ;;
  simulator)
    prepare
    xcodebuild \
      -workspace "$ROOT/ios/BobMobile.xcworkspace" \
      -scheme BobMobile \
      -configuration Release \
      -sdk iphonesimulator \
      -derivedDataPath "$DERIVED_DATA" \
      CODE_SIGNING_ALLOWED=NO \
      clean build
    APP="$(find "$DERIVED_DATA/Build/Products" -maxdepth 2 -type d -name 'BobMobile.app' -print -quit)"
    [[ -n "$APP" ]] || { echo "Release simulator app not found." >&2; exit 1; }
    node "$SCRIPT_DIR/verify-release-ios.mjs" "$APP"
    ;;
  archive)
    prepare
    xcodebuild \
      -workspace "$ROOT/ios/BobMobile.xcworkspace" \
      -scheme BobMobile \
      -configuration Release \
      -destination 'generic/platform=iOS' \
      -derivedDataPath "$DERIVED_DATA" \
      -archivePath "$ARCHIVE" \
      clean archive
    node "$SCRIPT_DIR/verify-release-ios.mjs" "$ARCHIVE/Products/Applications/BobMobile.app"
    ;;
  verify)
    [[ -n "${2:-}" ]] || { echo "An .app path is required for verify." >&2; exit 2; }
    node "$SCRIPT_DIR/verify-release-ios.mjs" "$2"
    ;;
esac
