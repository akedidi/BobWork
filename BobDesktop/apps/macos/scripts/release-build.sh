#!/usr/bin/env bash
# Builds a production bundle after removing every reusable release output, then
# certifies the packaged app. Debug artifacts remain available for development.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$APP_DIR/src-tauri"
MANIFEST="$TAURI_DIR/Cargo.toml"
TARGET_DIR="${CARGO_TARGET_DIR:-$TAURI_DIR/target}"
DIST_DIR="$APP_DIR/dist"
MODE="${1:-app}"

if [[ "$MODE" != "prepare" && "$MODE" != "app" && "$MODE" != "dmg" ]]; then
  echo "Usage: bash scripts/release-build.sh [prepare|app|dmg]" >&2
  exit 2
fi
if [[ -n "${VITE_BOB_WORK_E2E:-}" || -n "${TAURI_DEV_HOST:-}" ]]; then
  echo "Refusing a release build with development/E2E environment variables." >&2
  exit 1
fi

cd "$APP_DIR"
bash "$SCRIPT_DIR/rust-cache-guard.sh"

echo "Removing reusable Release and frontend outputs..."
cargo clean --manifest-path "$MANIFEST" --release
if [[ -d "$DIST_DIR" ]]; then
  find "$DIST_DIR" -mindepth 1 -delete
  rmdir "$DIST_DIR" 2>/dev/null || true
fi

if [[ "$MODE" == "prepare" ]]; then
  echo "Clean Release inputs prepared."
  exit 0
fi

if [[ "$MODE" == "app" ]]; then
  pnpm exec tauri build --bundles app
else
  pnpm exec tauri build
fi

node "$SCRIPT_DIR/verify-release-bundle.mjs" "$TARGET_DIR/release/bundle/macos/Bob Work.app"
