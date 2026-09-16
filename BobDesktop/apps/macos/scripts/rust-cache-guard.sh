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
# v2 excludes bundled `resources/` (plugin zips). Those already rebuild
# `bob-work` through build.rs; hashing them here forced a full `cargo clean`.
STAMP="$TARGET_DIR/.bob-work-rust-inputs.v2.sha256"
LEGACY_STAMP="$TARGET_DIR/.bob-work-rust-inputs.sha256"
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
    python3 - "$TAURI_DIR" <<'PY'
import hashlib
import pathlib
import sys

tauri = pathlib.Path(sys.argv[1])
inputs = [tauri / "Cargo.toml", tauri / "Cargo.lock", tauri / "build.rs"]
# Plugin zips and other bundled files already rebuild `bob-work` via
# `cargo:rerun-if-changed=resources`. Hashing them here wiped the whole
# Cargo cache (~8 GiB, ~10 min) on every archive refresh.
native = tauri / "native"
if native.is_dir():
    inputs.extend(path for path in native.rglob("*") if path.is_file())
for path in sorted(set(inputs)):
    relative = path.relative_to(tauri).as_posix()
    print(relative, hashlib.sha256(path.read_bytes()).hexdigest())
PY
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

if [[ -z "$PREVIOUS" && -f "$LEGACY_STAMP" ]]; then
  mkdir -p "$TARGET_DIR"
  printf '%s\n' "$CURRENT" > "$STAMP"
  echo "Rust cache fingerprint formula updated; keeping existing artifacts ($CURRENT)."
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
