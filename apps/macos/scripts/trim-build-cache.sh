#!/usr/bin/env bash
# Keep Cargo/Tauri build artefacts from silently filling the disk.
#
# By default, the cache is cleaned only when it reaches 8 GiB. Override the
# threshold with BOB_WORK_CACHE_MAX_GIB or use --force for an immediate clean.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
MANIFEST="$APP_DIR/src-tauri/Cargo.toml"
TARGET_DIR="$APP_DIR/src-tauri/target"
MAX_GIB="${BOB_WORK_CACHE_MAX_GIB:-8}"
FORCE=0
DRY_RUN=0

usage() {
  cat <<'EOF'
Usage: bash scripts/trim-build-cache.sh [--force] [--dry-run] [--max-gib N]

Options:
  --force      Clean regardless of the current cache size
  --dry-run    Report what would happen without deleting anything
  --max-gib N  Clean when the cache reaches N GiB (default: 8)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --)
      shift
      ;;
    --force)
      FORCE=1
      shift
      ;;
    --dry-run)
      DRY_RUN=1
      shift
      ;;
    --max-gib)
      if [[ $# -lt 2 ]]; then
        echo "Missing value after --max-gib" >&2
        usage >&2
        exit 2
      fi
      MAX_GIB="$2"
      shift 2
      ;;
    --help|-h)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ ! "$MAX_GIB" =~ ^[1-9][0-9]*$ ]]; then
  echo "The cache threshold must be a positive whole number of GiB: $MAX_GIB" >&2
  exit 2
fi

if [[ ! -d "$TARGET_DIR" ]]; then
  echo "Cargo/Tauri cache: 0 GiB; nothing to clean."
  exit 0
fi

CACHE_KIB="$(du -sk "$TARGET_DIR" | awk '{print $1}')"
MAX_KIB=$((MAX_GIB * 1024 * 1024))
CACHE_GIB="$(awk -v kib="$CACHE_KIB" 'BEGIN { printf "%.1f", kib / 1024 / 1024 }')"

if [[ "$FORCE" -eq 0 && "$CACHE_KIB" -lt "$MAX_KIB" ]]; then
  echo "Cargo/Tauri cache: ${CACHE_GIB} GiB; below the ${MAX_GIB} GiB threshold."
  exit 0
fi

if [[ "$DRY_RUN" -eq 1 ]]; then
  echo "Would clean ${CACHE_GIB} GiB from: $TARGET_DIR"
  exit 0
fi

echo "Cleaning ${CACHE_GIB} GiB of regenerable Cargo/Tauri artefacts..."
cargo clean --manifest-path "$MANIFEST"
echo "Cargo/Tauri build cache cleaned."
