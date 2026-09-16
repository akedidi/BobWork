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
# Optional Rust/Tauri target. Use `universal-apple-darwin` for Intel + Apple Silicon.
TAURI_TARGET="${TAURI_TARGET:-}"

if [[ "$MODE" != "prepare" && "$MODE" != "app" && "$MODE" != "dmg" ]]; then
  echo "Usage: bash scripts/release-build.sh [prepare|app|dmg]" >&2
  echo "Optional: TAURI_TARGET=universal-apple-darwin bash scripts/release-build.sh dmg" >&2
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

SIGN_ID="${APPLE_SIGNING_IDENTITY:-${BOB_WORK_SIGN_IDENTITY:-}}"
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

TAURI_CONFIG_ARGS=()
if [[ "${BOB_WORK_FORCE_ADHOC:-0}" == "1" ]]; then
  SIGNING_CONFIG="$TARGET_DIR/release/tauri.local-signing.conf.json"
  mkdir -p "$(dirname "$SIGNING_CONFIG")"
  node -e 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], `${JSON.stringify({ bundle: { macOS: { signingIdentity: "-" } } }, null, 2)}\n`)' "$SIGNING_CONFIG"
  TAURI_CONFIG_ARGS=(--config "$SIGNING_CONFIG")
elif [[ -n "$SIGN_ID" ]]; then
  SIGNING_CONFIG="$TARGET_DIR/release/tauri.local-signing.conf.json"
  mkdir -p "$(dirname "$SIGNING_CONFIG")"
  node -e 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], `${JSON.stringify({ bundle: { macOS: { signingIdentity: process.argv[2] } } }, null, 2)}\n`)' "$SIGNING_CONFIG" "$SIGN_ID"
  TAURI_CONFIG_ARGS=(--config "$SIGNING_CONFIG")
elif [[ "$MODE" == "dmg" ]]; then
  echo "A stable Apple Development or Developer ID signing identity is required to package a DMG." >&2
  exit 1
fi

TAURI_TARGET_ARGS=()
if [[ -n "$TAURI_TARGET" ]]; then
  TAURI_TARGET_ARGS=(--target "$TAURI_TARGET")
fi

if [[ "$MODE" == "app" ]]; then
  # bash 3.2 + set -u rejects empty "${arr[@]}" — use ${arr[@]+"${arr[@]}"}
  pnpm exec tauri build --bundles app --features custom-protocol \
    ${TAURI_CONFIG_ARGS[@]+"${TAURI_CONFIG_ARGS[@]}"} \
    ${TAURI_TARGET_ARGS[@]+"${TAURI_TARGET_ARGS[@]}"}
else
  pnpm exec tauri build --features custom-protocol \
    ${TAURI_CONFIG_ARGS[@]+"${TAURI_CONFIG_ARGS[@]}"} \
    ${TAURI_TARGET_ARGS[@]+"${TAURI_TARGET_ARGS[@]}"}
fi

if [[ -n "$TAURI_TARGET" ]]; then
  RELEASE_APP="$TARGET_DIR/$TAURI_TARGET/release/bundle/macos/Bob Work.app"
else
  RELEASE_APP="$TARGET_DIR/release/bundle/macos/Bob Work.app"
fi

# Tauri's ad-hoc signature uses the executable cdhash as its designated
# requirement. That identity changes after every build, so macOS keeps showing
# Bob Work as enabled in Privacy & Security while AXIsProcessTrusted rejects the
# new executable. Re-sign every local Release with a stable Apple Development
# identity (or the stable local fallback used by development builds).
TAURI_TARGET="$TAURI_TARGET" INSTALL_APPS="${INSTALL_APPS:-0}" bash "$SCRIPT_DIR/ensure-dev-app.sh" release >/dev/null

node "$SCRIPT_DIR/verify-release-bundle.mjs" "$RELEASE_APP"

if [[ -n "$TAURI_TARGET" ]]; then
  DMG_DIR="$TARGET_DIR/$TAURI_TARGET/release/bundle/dmg"
else
  DMG_DIR="$TARGET_DIR/release/bundle/dmg"
fi
if [[ "$MODE" == "dmg" ]]; then
  DMG="$(find "$DMG_DIR" -maxdepth 1 -name '*.dmg' -print 2>/dev/null | head -1 || true)"
  if [[ -n "$DMG" ]]; then
    echo "DMG: $DMG"
    lipo -archs "$RELEASE_APP/Contents/MacOS/bob-work" 2>/dev/null || true
  fi
fi
