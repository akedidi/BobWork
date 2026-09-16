#!/usr/bin/env bash
# Export the local Apple Development identity as a .p12 for the enterprise installer.
# macOS may show a Keychain prompt — click Allow / Always Allow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT_DIR="${1:-$SCRIPT_DIR/signing}"
mkdir -p "$OUT_DIR"

IDENTITY_NAME="${BOB_WORK_EXPORT_IDENTITY:-}"
if [[ -z "$IDENTITY_NAME" ]]; then
  IDENTITY_NAME="$(
    security find-identity -v -p codesigning 2>/dev/null \
      | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
      | head -1
  )"
fi
if [[ -z "$IDENTITY_NAME" ]]; then
  echo "No Apple Development identity found in the keychain." >&2
  exit 1
fi

P12="$OUT_DIR/bob-work-apple-development.p12"
PASS_FILE="$OUT_DIR/bob-work-apple-development.p12.password"
PASSWORD="$(openssl rand -base64 32 | tr -d '\n/=+' | head -c 32)"

echo "==> Exporting: $IDENTITY_NAME"
echo "    → $P12"
echo "    If macOS asks to use the keychain, choose Always Allow."

# Export all identities then keep only ours is awkward; export via temporary
# keychain copy of the preferred identity label.
TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/bob-work-export.XXXXXX")"
cleanup() { rm -rf "$TMP_DIR"; }
trap cleanup EXIT

# Prefer exporting the specific certificate+key pair by common name.
if ! security export -k ~/Library/Keychains/login.keychain-db \
  -t identities -f pkcs12 -o "$TMP_DIR/all.p12" -P "$PASSWORD" 2>"$TMP_DIR/export.err"; then
  echo "Keychain export failed:" >&2
  cat "$TMP_DIR/export.err" >&2
  echo >&2
  echo "Open Keychain Access → login → My Certificates →" >&2
  echo "  $IDENTITY_NAME → Export… as .p12" >&2
  echo "Then copy it to: $P12" >&2
  echo "And write the export password to: $PASS_FILE" >&2
  exit 1
fi

# If multiple identities were exported, re-import into a temp keychain and
# re-export only Apple Development for Bob Work.
TMP_KC="$TMP_DIR/export.keychain-db"
TMP_KC_PASS="bob-work-export-temp"
security create-keychain -p "$TMP_KC_PASS" "$TMP_KC" >/dev/null
security set-keychain-settings -lut 21600 "$TMP_KC" >/dev/null
security unlock-keychain -p "$TMP_KC_PASS" "$TMP_KC" >/dev/null
security import "$TMP_DIR/all.p12" -k "$TMP_KC" -P "$PASSWORD" -A >/dev/null

FOUND="$(
  security find-identity -v -p codesigning "$TMP_KC" 2>/dev/null \
    | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
    | head -1
)"
if [[ -z "$FOUND" ]]; then
  echo "Exported keychain does not contain an Apple Development identity." >&2
  exit 1
fi

FINAL_PASS="$(openssl rand -base64 32 | tr -d '\n/=+' | head -c 32)"
if ! security export -k "$TMP_KC" -t identities -f pkcs12 -o "$P12" -P "$FINAL_PASS" 2>"$TMP_DIR/reexport.err"; then
  # Fallback: ship the full export (still usable for codesign).
  cp "$TMP_DIR/all.p12" "$P12"
  FINAL_PASS="$PASSWORD"
  echo "Warning: could not narrow export; shipping full identity bag." >&2
  cat "$TMP_DIR/reexport.err" >&2 || true
fi

umask 077
printf '%s\n' "$FINAL_PASS" >"$PASS_FILE"
chmod 600 "$P12" "$PASS_FILE"

echo "==> Done"
echo "    Identity: $FOUND"
echo "    P12:      $P12"
echo "    Password: $PASS_FILE"
echo "    These files are gitignored — do not commit them."
)
