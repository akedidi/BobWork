#!/usr/bin/env bash
# Invalidates Cargo artifacts when the compiler or native dependency inputs change.
# Cargo already tracks Rust sources; this guard covers the recurrent stale-cache cases
# caused by toolchain, lockfile, build-script and native bridge changes.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TAURI_DIR="$APP_DIR/src-tauri"
MANIFEST="$TAURI_DIR/Cargo.toml"
TARGET_DIR="${CARGO_TARGET_DIR:-$TAURI_DIR/target}"
STAMP="$TARGET_DIR/.bob-work-rust-inputs.sha256"
DRY_RUN=0

if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=1
elif [[ $# -gt 0 ]]; then
  echo "Usage: bash scripts/rust-cache-guard.sh [--dry-run]" >&2
  exit 2
fi

fingerprint() {
  {
    rustc -vV
    cargo -V
    for input in \
      "$TAURI_DIR/Cargo.toml" \
      "$TAURI_DIR/Cargo.lock" \
      "$TAURI_DIR/build.rs" \
      "$TAURI_DIR/native/local_audio_transcriber.m" \
      "$TAURI_DIR/native/local_audio_transcriber_modern.swift" \
      "$TAURI_DIR/native/system_audio_recorder.m"; do
      [[ -f "$input" ]] && shasum -a 256 "$input"
    done
  } | shasum -a 256 | awk '{print $1}'
}

CURRENT="$(fingerprint)"
PREVIOUS="$(cat "$STAMP" 2>/dev/null || true)"
if [[ "$CURRENT" == "$PREVIOUS" ]]; then
  echo "Rust cache inputs unchanged ($CURRENT)."
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Rust cache would be invalidated: ${PREVIOUS:-missing} -> $CURRENT"
  exit 0
fi

if [[ -d "$TARGET_DIR" ]]; then
  case "$TARGET_DIR" in
    "$TAURI_DIR"/target|"$TAURI_DIR"/target/*|"$APP_DIR"/.build/*) ;;
    *)
      echo "Refusing to clean unexpected Cargo target directory: $TARGET_DIR" >&2
      exit 1
      ;;
  esac
  echo "Rust build inputs changed; invalidating Cargo artifacts."
  cargo clean --manifest-path "$MANIFEST"
fi

mkdir -p "$TARGET_DIR"
printf '%s\n' "$CURRENT" > "$STAMP"
echo "Rust cache guard recorded $CURRENT."
