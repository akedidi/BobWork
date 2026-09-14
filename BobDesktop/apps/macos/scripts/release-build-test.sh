#!/usr/bin/env bash
# Release build for the Bob Work-test side-by-side variant (separate bundle id / data).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
# shellcheck source=app-identity.sh
source "$SCRIPT_DIR/app-identity.sh"
TAURI_DIR="$APP_DIR/src-tauri"
MANIFEST="$TAURI_DIR/Cargo.toml"
TARGET_DIR="${CARGO_TARGET_DIR:-$TAURI_DIR/target}"
DIST_DIR="$APP_DIR/dist"
TEST_CONFIG="$TAURI_DIR/tauri.test.conf.json"
APP_NAME="$BOB_WORK_TEST_PRODUCT_NAME"
MODE="${1:-app}"
INCREMENTAL=0
if [[ "$MODE" == "incremental" ]]; then
  MODE="app"
  INCREMENTAL=1
fi

if [[ "$MODE" != "prepare" && "$MODE" != "app" && "$MODE" != "dmg" ]]; then
  echo "Usage: bash scripts/release-build-test.sh [prepare|app|dmg|incremental]" >&2
  exit 2
fi
if [[ ! -f "$TEST_CONFIG" ]]; then
  echo "Missing test Tauri config: $TEST_CONFIG" >&2
  exit 1
fi
if [[ -n "${VITE_BOB_WORK_E2E:-}" || -n "${TAURI_DEV_HOST:-}" ]]; then
  echo "Refusing a release build with development/E2E environment variables." >&2
  exit 1
fi

cd "$APP_DIR"
bash "$SCRIPT_DIR/rust-cache-guard.sh"
python3 "$SCRIPT_DIR/build-test-icons.py"

if [[ "$INCREMENTAL" -eq 1 ]]; then
  echo "Incremental Bob Work-test build (Cargo Release artifacts kept)..."
else
  echo "Removing reusable Release and frontend outputs (Bob Work-test)..."
  cargo clean --manifest-path "$MANIFEST" --release
  if [[ -d "$DIST_DIR" ]]; then
    find "$DIST_DIR" -mindepth 1 -delete
    rmdir "$DIST_DIR" 2>/dev/null || true
  fi
fi

if [[ "$MODE" == "prepare" ]]; then
  echo "Clean Release inputs prepared for Bob Work-test."
  exit 0
fi

SIGN_ID="${APPLE_SIGNING_IDENTITY:-${BOB_WORK_SIGN_IDENTITY:-}}"
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

TAURI_CONFIG_ARGS=(--config "$TEST_CONFIG")
if [[ -n "$SIGN_ID" ]]; then
  SIGNING_CONFIG="$TARGET_DIR/release/tauri.test-signing.conf.json"
  mkdir -p "$(dirname "$SIGNING_CONFIG")"
  node -e 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], `${JSON.stringify({ bundle: { macOS: { signingIdentity: process.argv[2] } } }, null, 2)}\n`)' "$SIGNING_CONFIG" "$SIGN_ID"
  TAURI_CONFIG_ARGS+=(--config "$SIGNING_CONFIG")
elif [[ "$MODE" == "dmg" ]]; then
  echo "A stable Apple Development or Developer ID signing identity is required to package a DMG." >&2
  exit 1
fi

if [[ "$MODE" == "app" ]]; then
  pnpm exec tauri build --bundles app --features custom-protocol "${TAURI_CONFIG_ARGS[@]}"
else
  pnpm exec tauri build --features custom-protocol "${TAURI_CONFIG_ARGS[@]}"
fi

RELEASE_APP="$TARGET_DIR/release/bundle/macos/$APP_NAME.app"
bash "$SCRIPT_DIR/ensure-test-app.sh" release >/dev/null

BOB_WORK_TAURI_CONFIG=tauri.test.conf.json node "$SCRIPT_DIR/verify-release-bundle.mjs" "$RELEASE_APP"
echo "✓ Bob Work-test release ready: $RELEASE_APP"
