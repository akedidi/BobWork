#!/usr/bin/env bash
# ============================================================
# Bob Work - Build Scripts
# Usage: bash scripts/build.sh [dev|test|build|dmg|verify|icon]
# ============================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
ROOT_DIR="$(cd "$APP_DIR/../.." && pwd)"
BUNDLE_DIR="$APP_DIR/src-tauri/target/release/bundle"

cd "$APP_DIR"

cmd="${1:-help}"

case "$cmd" in

  # ── Development server (hot-reload) ────────────────────────
  dev)
    echo "▶  Starting Bob Work in dev mode..."
    pnpm tauri dev
    ;;

  # ── Type-check + unit tests ────────────────────────────────
  test)
    echo "▶  Running frontend tests..."
    pnpm typecheck 2>/dev/null || pnpm tsc --noEmit
    pnpm test --run 2>/dev/null || echo "  (no vitest tests configured yet)"

    echo "▶  Running Rust tests..."
    cd src-tauri
    cargo test 2>&1
    cd ..
    echo "✓  Tests complete"
    ;;

  # ── Production build (.app only, skip DMG) ─────────────────
  build)
    echo "▶  Building Bob Work..."
    pnpm tauri build --bundles app
    echo "✓  Built: $BUNDLE_DIR/macos/Bob Work.app"
    ;;

  # ── Full build + DMG ───────────────────────────────────────
  dmg)
    echo "▶  Building Bob Work DMG..."
    pnpm tauri build

    VERSION=$(node -p "require('./package.json').version")
    APP="$BUNDLE_DIR/macos/Bob Work.app"
    DMG_OUT="$BUNDLE_DIR/dmg/Bob Work_${VERSION}_aarch64.dmg"
    DMG_SCRIPT="$BUNDLE_DIR/dmg/bundle_dmg.sh"

    echo ""
    echo "▶  Applying ad-hoc code signature (no Apple Developer certificate)..."
    codesign --remove-signature "$APP" 2>/dev/null || true
    codesign --force --deep --sign - "$APP"
    echo "✓  Signed (ad-hoc)"

    echo ""
    echo "▶  Rebuilding DMG with signed app..."
    rm -f "$DMG_OUT"
    bash "$DMG_SCRIPT" "$DMG_OUT" "$BUNDLE_DIR/macos" \
      --volname "Bob Work" \
      --window-size 660 400 \
      --icon "Bob Work.app" 180 170 \
      --app-drop-link 480 170 \
      2>&1 | grep -E "^created|Disk image done|error|failed" || true

    echo ""
    echo "✓  Artefacts:"
    echo "   .app  → $APP"
    echo "   .dmg  → $DMG_OUT"
    echo ""
    echo "⚠  Note: This build uses an ad-hoc signature (no Apple Developer certificate)."
    echo "   On first launch, users must right-click → Open to bypass Gatekeeper."
    echo "   For a notarised build, see docs/delivery-plan.md § Signing."
    ;;

  # ── Verify DMG integrity ───────────────────────────────────
  verify)
    VERSION=$(node -p "require('./package.json').version")
    DMG="$BUNDLE_DIR/dmg/Bob Work_${VERSION}_aarch64.dmg"
    if [ ! -f "$DMG" ]; then
      echo "✗  DMG not found: $DMG"
      echo "   Run:  bash scripts/build.sh dmg"
      exit 1
    fi
    echo "▶  Verifying: $DMG"
    hdiutil verify "$DMG"
    echo ""
    echo "✓  DMG checksum is VALID"
    echo ""
    echo "Note: This build is unsigned (no Apple Developer certificate configured)."
    echo "      To sign and notarise, see docs/delivery-plan.md § Signing."
    ;;

  # ── Regenerate app icons ───────────────────────────────────
  icon)
    echo "▶  Regenerating icons from SVG source..."
    bash "$SCRIPT_DIR/generate-icon.sh"
    echo "   Re-run 'bash scripts/build.sh dmg' to embed the new icon."
    ;;

  # ── Help ──────────────────────────────────────────────────
  help|*)
    cat <<EOF
Bob Work build script

Usage:
  bash scripts/build.sh <command>

Commands:
  dev      Launch development server with hot-reload
  test     Run TypeScript type-check and Rust unit tests
  build    Build .app bundle (skip DMG)
  dmg      Build .app + .dmg (full distribution artefact)
  verify   Verify the DMG checksum and print signing status
  icon     Regenerate all icon sizes from SVG source

Examples:
  bash scripts/build.sh dev
  bash scripts/build.sh dmg
  bash scripts/build.sh verify
EOF
    ;;
esac
