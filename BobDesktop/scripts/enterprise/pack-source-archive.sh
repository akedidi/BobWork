#!/usr/bin/env bash
# Build a minimal BobDesktop source zip + Install-Bob-Work.command + signing .p12
# for one-click installs on any Mac.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BOB_DESKTOP="$(cd "$SCRIPT_DIR/../.." && pwd)"
VERSION="$(node -p "require('$BOB_DESKTOP/apps/macos/package.json').version" 2>/dev/null || echo "0.0.0")"
OUT_DIR="${1:-$BOB_DESKTOP/dist-enterprise}"
STAGE="$OUT_DIR/_stage"
BUNDLE_NAME="Bob-Work-${VERSION}-macOS-source"
BUNDLE_DIR="$OUT_DIR/$BUNDLE_NAME"
ZIP_NAME="bob-work-sources.zip"
SIGNING_DIR="$SCRIPT_DIR/signing"
P12="$SIGNING_DIR/bob-work-apple-development.p12"
PASS_FILE="$SIGNING_DIR/bob-work-apple-development.p12.password"

if [[ ! -f "$P12" || ! -f "$PASS_FILE" ]]; then
  echo "Signing identity not exported yet." >&2
  echo "Run first:" >&2
  echo "  bash \"$SCRIPT_DIR/export-signing-identity.sh\"" >&2
  exit 1
fi
if [[ ! -f "$SCRIPT_DIR/Install-Bob-Work.command" ]]; then
  echo "Missing Install-Bob-Work.command" >&2
  exit 1
fi

echo "==> Packaging Bob Work ${VERSION} source install (Apple Development .p12)"
rm -rf "$STAGE" "$BUNDLE_DIR"
mkdir -p "$STAGE" "$BUNDLE_DIR/signing"

rsync -a \
  --exclude '.DS_Store' \
  --exclude '.cursor/' \
  --exclude '.pnpm-store/' \
  --exclude 'node_modules/' \
  --exclude '**/node_modules/' \
  --exclude 'apps/macos/src-tauri/target/' \
  --exclude 'apps/macos/dist/' \
  --exclude 'apps/macos/coverage/' \
  --exclude 'apps/macos/logs/' \
  --exclude 'apps/macos/e2e/' \
  --exclude 'apps/macos/public/runtime-pdf/' \
  --exclude 'apps/macos/test-artifacts/' \
  --exclude 'test-artifacts/' \
  --exclude 'scratch/' \
  --exclude 'dist-enterprise/' \
  --exclude 'scripts/enterprise/signing/' \
  --exclude 'tauri.release.conf.json' \
  --exclude '.env' \
  --exclude '.env.*' \
  "$BOB_DESKTOP/" "$STAGE/BobDesktop/"

find "$STAGE/BobDesktop" -maxdepth 1 -type f \( \
  -name 'fix*.js' -o -name 'rewrite_*.js' -o -name 'extract*.js' \
  -o -name 'settings_part_*' -o -name 'scratch*.js' -o -name 'split_ui.js' \
\) -delete 2>/dev/null || true

# Document runtimes must be present for the Rust include_bytes! build.
for required in \
  "$STAGE/BobDesktop/apps/macos/src-tauri/resources/shared-runtimes/documents/pandoc-darwin-arm64.zip" \
  "$STAGE/BobDesktop/apps/macos/src-tauri/resources/shared-runtimes/documents/tectonic-darwin-arm64.zip" \
  "$STAGE/BobDesktop/apps/macos/src-tauri/resources/shared-runtimes/diagram/diagram-runtime.zip"
do
  if [[ ! -f "$required" ]]; then
    echo "Missing required runtime asset: $required" >&2
    exit 1
  fi
done

cat >"$STAGE/README.txt" <<EOF
Bob Work ${VERSION} — source build package
========================================

Use Install-Bob-Work.command next to bob-work-sources.zip.
The installer imports the bundled Apple Development identity, builds, signs,
and installs /Applications/Bob Work.app.
EOF

(
  cd "$STAGE"
  ditto -c -k --sequesterRsrc --keepParent BobDesktop "$BUNDLE_DIR/$ZIP_NAME"
  zip -q -u "$BUNDLE_DIR/$ZIP_NAME" README.txt
)

cp "$SCRIPT_DIR/Install-Bob-Work.command" "$BUNDLE_DIR/Install-Bob-Work.command"
chmod +x "$BUNDLE_DIR/Install-Bob-Work.command"
umask 077
cp "$P12" "$BUNDLE_DIR/signing/bob-work-apple-development.p12"
cp "$PASS_FILE" "$BUNDLE_DIR/signing/bob-work-apple-development.p12.password"
chmod 600 "$BUNDLE_DIR/signing/"*

cat >"$BUNDLE_DIR/INSTALL.txt" <<EOF
Bob Work ${VERSION} — one-click install
=======================================

1. Keep this whole folder together (do not separate signing/).
2. Double-click Install-Bob-Work.command.
3. Allow Xcode Command Line Tools / keychain access if macOS asks.
4. First run can take 15–40 minutes (tools + compile).
5. Open /Applications/Bob Work.app when done.

The installer signs with the bundled Apple Development identity
(kedidi.anis@gmail.com) so notifications and TCC permissions behave like
your local builds. If Gatekeeper blocks the first launch: right-click → Open.
EOF

rm -rf "$STAGE"

SIZE="$(du -sh "$BUNDLE_DIR/$ZIP_NAME" | awk '{print $1}')"
echo "==> Done: $BUNDLE_DIR"
echo "    $ZIP_NAME ($SIZE)"
echo "    Install-Bob-Work.command"
echo "    signing/bob-work-apple-development.p12 (+ password)"
echo "    INSTALL.txt"
echo
echo "Distribute the folder: $BUNDLE_NAME"
echo "WARNING: the folder contains a private signing key — share only with trusted Macs."
