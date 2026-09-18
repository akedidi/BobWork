#!/usr/bin/env bash
# Double-click installer: ensure tools → extract sources → import signing
# identity → build → sign → install /Applications/Bob Work.app
set -euo pipefail

cd "$(dirname "$0")"
HERE="$(pwd)"
LOG_DIR="$HOME/Library/Logs/BobWork"
mkdir -p "$LOG_DIR"
LOG="$LOG_DIR/install-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG") 2>&1

echo "=============================================="
echo " Bob Work — install from source"
echo " Log: $LOG"
echo "=============================================="
echo

ZIP="$HERE/bob-work-sources.zip"
P12="$HERE/signing/bob-work-apple-development.p12"
P12_PASS_FILE="$HERE/signing/bob-work-apple-development.p12.password"
WORK_ROOT="${BOB_WORK_INSTALL_DIR:-$HOME/Library/Application Support/BobWork/source-install}"
BUILD_DIR="$WORK_ROOT/BobDesktop"
DATA_DIR="$HOME/Library/Application Support/com.bobwork.desktop"
NODE_VERSION="22.16.0"
PNPM_VERSION="10.11.0"

if [[ ! -f "$ZIP" ]]; then
  echo "Missing $ZIP (keep it next to this .command)." >&2
  read -r -p "Press Enter to close…" _
  exit 1
fi
if [[ ! -f "$P12" || ! -f "$P12_PASS_FILE" ]]; then
  echo "Missing signing materials under $HERE/signing/" >&2
  echo "Expected:" >&2
  echo "  bob-work-apple-development.p12" >&2
  echo "  bob-work-apple-development.p12.password" >&2
  read -r -p "Press Enter to close…" _
  exit 1
fi
P12_PASS="$(tr -d '\r\n' <"$P12_PASS_FILE")"

export PATH="$HOME/.local/bob-work-tools/bin:$HOME/.local/bob-work-tools/node/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:$PATH"

step() { echo; echo "==> $*"; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# True when the toolchain Bob Work needs to compile native/Swift bridges is usable.
# Accepts either full Xcode.app or Command Line Tools.
xcode_devtools_ok() {
  xcode-select -p >/dev/null 2>&1 || return 1
  need_cmd clang || return 1
  need_cmd codesign || return 1
  need_cmd xcrun || return 1
  xcrun --find clang >/dev/null 2>&1 || return 1
  xcrun --find swiftc >/dev/null 2>&1 || return 1
  xcrun --sdk macosx --show-sdk-path >/dev/null 2>&1 || return 1
  # Reject a broken/empty CLT install (path exists but compiler fails).
  echo 'int main(void){return 0;}' | clang -x c - -o /tmp/bob-work-clang-smoke >/dev/null 2>&1 || return 1
  rm -f /tmp/bob-work-clang-smoke
  return 0
}

install_xcode_clt() {
  echo "Installing Xcode Command Line Tools…"
  # Preferred non-GUI path when Apple publishes a CLT package via softwareupdate.
  local probe_file="/tmp/.com.apple.dt.CommandLineTools.installondemand.in-progress"
  touch "$probe_file"
  local label=""
  label="$(
    softwareupdate -l 2>&1 \
      | sed -nE 's/^[[:space:]]*\*?[[:space:]]*Label:[[:space:]]*(Command Line Tools.*)$/\1/p' \
      | tail -1 || true
  )"
  if [[ -z "$label" ]]; then
    label="$(
      softwareupdate -l 2>&1 \
        | grep -F 'Command Line Tools' \
        | sed -E 's/^[[:space:]]*\*[[:space:]]*//' \
        | sed -E 's/^Label:[[:space:]]*//' \
        | tail -1 || true
    )"
  fi
  if [[ -n "$label" ]]; then
    echo "softwareupdate package: $label"
    softwareupdate -i "$label" --verbose || true
  else
    echo "No softwareupdate CLT label found; opening the system installer dialog…"
    xcode-select --install 2>/dev/null || true
  fi
  rm -f "$probe_file"

  echo "Waiting for developer tools to become usable…"
  local i
  for i in $(seq 1 180); do
    if xcode_devtools_ok; then
      return 0
    fi
    # If the user/system finished CLT install mid-wait, point xcode-select at it.
    if [[ -d /Library/Developer/CommandLineTools ]]; then
      xcode-select -s /Library/Developer/CommandLineTools 2>/dev/null || true
    fi
    sleep 5
  done
  return 1
}

ensure_xcode_clt() {
  step "Xcode developer tools (CLT or Xcode.app: clang, swiftc, macOS SDK)"
  if xcode_devtools_ok; then
    echo "Already usable:"
    echo "  xcode-select: $(xcode-select -p)"
    echo "  clang:        $(clang --version 2>/dev/null | head -1)"
    echo "  swiftc:       $(xcrun --find swiftc 2>/dev/null)"
    echo "  macOS SDK:    $(xcrun --sdk macosx --show-sdk-path 2>/dev/null)"
    return 0
  fi

  echo "Missing or broken developer tools — installing Command Line Tools."
  if ! install_xcode_clt; then
    echo "Xcode Command Line Tools are required to build Bob Work." >&2
    echo "Install them (xcode-select --install or from developer.apple.com), then re-run." >&2
    exit 1
  fi

  echo "Developer tools ready:"
  echo "  xcode-select: $(xcode-select -p)"
  echo "  clang:        $(clang --version 2>/dev/null | head -1)"
  echo "  swiftc:       $(xcrun --find swiftc 2>/dev/null)"
  echo "  macOS SDK:    $(xcrun --sdk macosx --show-sdk-path 2>/dev/null)"
}

ensure_python() {
  step "Python 3"
  if need_cmd python3; then
    python3 --version
    return 0
  fi
  echo "python3 is required (normally provided with Command Line Tools)." >&2
  exit 1
}

ensure_node() {
  step "Node.js ${NODE_VERSION}+"
  if need_cmd node; then
    local major
    major="$(node -p "process.versions.node.split('.')[0]")"
    if [[ "$major" -ge 22 ]]; then
      echo "Using $(command -v node) ($(node -v))"
      return 0
    fi
    echo "Found Node $(node -v); installing ${NODE_VERSION} locally…"
  fi
  local arch="x64"
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
  esac
  local base="node-v${NODE_VERSION}-darwin-${arch}"
  local url="https://nodejs.org/dist/v${NODE_VERSION}/${base}.tar.gz"
  local dest="$HOME/.local/bob-work-tools"
  mkdir -p "$dest"
  echo "Downloading $url"
  curl -fsSL "$url" | tar -xz -C "$dest"
  rm -rf "$dest/node"
  mv "$dest/$base" "$dest/node"
  export PATH="$dest/node/bin:$PATH"
  hash -r
  node -v
  npm -v
}

ensure_pnpm() {
  step "pnpm ${PNPM_VERSION}"
  local tools_bin="$HOME/.local/bob-work-tools/bin"
  mkdir -p "$tools_bin"
  export PATH="$tools_bin:$PATH"

  if need_cmd pnpm; then
    local major
    major="$(pnpm -v | cut -d. -f1)"
    if [[ "$major" -ge 10 ]]; then
      echo "Using $(command -v pnpm) ($(pnpm -v))"
      return 0
    fi
    echo "Found pnpm $(pnpm -v); installing ${PNPM_VERSION} locally under $tools_bin…"
  else
    echo "Installing pnpm ${PNPM_VERSION} locally under $tools_bin…"
  fi

  # Prefer a user-local binary. Avoid `npm install -g` / `corepack enable` when they
  # would write into a Homebrew or system Node prefix (Permission denied on managed Macs).
  local npm_prefix=""
  if need_cmd npm; then
    npm_prefix="$(npm config get prefix 2>/dev/null || true)"
  fi
  local use_local=1
  if [[ -n "$npm_prefix" && -w "$npm_prefix" && -w "$npm_prefix/bin" ]]; then
    use_local=0
  fi

  if [[ "$use_local" -eq 0 ]] && need_cmd corepack; then
    corepack enable >/dev/null 2>&1 || true
    if corepack prepare "pnpm@${PNPM_VERSION}" --activate; then
      hash -r
      if need_cmd pnpm && [[ "$(pnpm -v | cut -d. -f1)" -ge 10 ]]; then
        echo "Using $(command -v pnpm) ($(pnpm -v))"
        return 0
      fi
    fi
  fi

  # Standalone pnpm (no global npm write): https://pnpm.io/installation
  local arch="x64"
  case "$(uname -m)" in
    arm64|aarch64) arch="arm64" ;;
  esac
  local pnpm_url="https://github.com/pnpm/pnpm/releases/download/v${PNPM_VERSION}/pnpm-macos-${arch}"
  echo "Downloading $pnpm_url"
  curl -fsSL "$pnpm_url" -o "$tools_bin/pnpm"
  chmod +x "$tools_bin/pnpm"
  export PATH="$tools_bin:$PATH"
  hash -r
  if ! need_cmd pnpm || [[ "$(pnpm -v | cut -d. -f1)" -lt 10 ]]; then
    echo "Failed to install a usable pnpm ${PNPM_VERSION} under $tools_bin" >&2
    exit 1
  fi
  echo "Using $(command -v pnpm) ($(pnpm -v))"
}

ensure_rust() {
  step "Rust (stable)"
  export PATH="$HOME/.cargo/bin:$PATH"
  if need_cmd rustc && need_cmd cargo; then
    rustc --version
    cargo --version
    return 0
  fi
  echo "Installing rustup (user install, without editing shell profiles)…"
  # --no-modify-path: never touch ~/.bash_profile / ~/.zshrc. Some managed Macs
  # have those files root-owned or immutable; rustup would abort with EACCES.
  # This installer already puts ~/.cargo/bin on PATH for the build session.
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain stable --no-modify-path
  # shellcheck disable=SC1091
  if [[ -f "$HOME/.cargo/env" ]]; then
    # shellcheck disable=SC1090
    source "$HOME/.cargo/env"
  fi
  export PATH="$HOME/.cargo/bin:$PATH"
  hash -r
  if ! need_cmd rustc || ! need_cmd cargo; then
    echo "Rust install finished but rustc/cargo are not on PATH." >&2
    echo "Expected binaries under $HOME/.cargo/bin" >&2
    exit 1
  fi
  rustc --version
  cargo --version
}

import_signing_identity() {
  step "Import Apple Development signing identity"
  KC_DIR="$WORK_ROOT/keychain"
  mkdir -p "$KC_DIR"
  KC="$KC_DIR/bob-work-signing.keychain-db"
  KC_PASS="$(openssl rand -base64 24 | tr -d '\n/=+' | head -c 24)"
  rm -f "$KC"
  security create-keychain -p "$KC_PASS" "$KC" >/dev/null
  security set-keychain-settings -lut 21600 "$KC" >/dev/null
  security unlock-keychain -p "$KC_PASS" "$KC" >/dev/null
  security import "$P12" -k "$KC" -P "$P12_PASS" -A -T /usr/bin/codesign -T /usr/bin/security >/dev/null
  security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KC_PASS" "$KC" >/dev/null
  # Prefer our temp keychain for this session without wiping the user login chain.
  security list-keychains -d user -s "$KC" $(security list-keychains -d user | sed 's/"//g') >/dev/null
  security unlock-keychain -p "$KC_PASS" "$KC" >/dev/null

  SIGN_ID="$(
    security find-identity -v -p codesigning "$KC" 2>/dev/null \
      | sed -n 's/.*"\(Apple Development:[^"]*\)".*/\1/p' \
      | head -1
  )"
  if [[ -z "$SIGN_ID" ]]; then
    echo "Could not load Apple Development identity from the bundled .p12" >&2
    exit 1
  fi
  export BOB_WORK_SIGN_IDENTITY="$SIGN_ID"
  export APPLE_SIGNING_IDENTITY="$SIGN_ID"
  export BOB_WORK_FORCE_ADHOC=0
  echo "Signing as: $SIGN_ID"
  # Persist unlock for child processes in this session.
  export BOB_WORK_SIGNING_KEYCHAIN="$KC"
  export BOB_WORK_SIGNING_KEYCHAIN_PASS="$KC_PASS"
}

extract_sources() {
  step "Extract sources"
  mkdir -p "$WORK_ROOT"
  rm -rf "$BUILD_DIR"
  ditto -x -k "$ZIP" "$WORK_ROOT"
  if [[ ! -f "$BUILD_DIR/package.json" ]]; then
    # Zip may contain README + BobDesktop, or only BobDesktop.
    local found
    found="$(find "$WORK_ROOT" -maxdepth 3 -type f -name package.json -path '*/BobDesktop/package.json' | head -1 || true)"
    if [[ -n "$found" ]]; then
      BUILD_DIR="$(dirname "$found")"
    fi
  fi
  if [[ ! -f "$BUILD_DIR/package.json" ]]; then
    echo "Could not find BobDesktop/package.json after extract." >&2
    exit 1
  fi
  echo "Sources: $BUILD_DIR"
}

build_and_install() {
  step "Preserve Bob Work conversations and local conversation workspaces"
  if [[ -d "$DATA_DIR" ]]; then
    echo "Keeping existing application data untouched: $DATA_DIR"
  else
    echo "No existing Bob Work application data found; it will be created on first launch."
  fi

  step "Install JS dependencies"
  cd "$BUILD_DIR"
  pnpm install --frozen-lockfile

  step "Build Release app (signed)"
  # Keep the signing keychain unlocked for codesign prompts.
  if [[ -n "${BOB_WORK_SIGNING_KEYCHAIN:-}" ]]; then
    security unlock-keychain -p "${BOB_WORK_SIGNING_KEYCHAIN_PASS}" "$BOB_WORK_SIGNING_KEYCHAIN" >/dev/null || true
  fi
  INSTALL_APPS=0 pnpm mac:release

  step "Install into /Applications"
  INSTALL_APPS=1 bash apps/macos/scripts/ensure-dev-app.sh release
  xattr -cr "/Applications/Bob Work.app" 2>/dev/null || true

  step "Verify signature"
  codesign --verify --deep --strict "/Applications/Bob Work.app"
  codesign -dv --verbose=2 "/Applications/Bob Work.app" 2>&1 | sed -n '1,20p'
}

cleanup_keychain() {
  if [[ -n "${BOB_WORK_SIGNING_KEYCHAIN:-}" && -f "${BOB_WORK_SIGNING_KEYCHAIN}" ]]; then
    security delete-keychain "$BOB_WORK_SIGNING_KEYCHAIN" >/dev/null 2>&1 || true
  fi
}
trap cleanup_keychain EXIT

ensure_xcode_clt
ensure_python
ensure_node
ensure_pnpm
ensure_rust
import_signing_identity
extract_sources
build_and_install

echo
echo "=============================================="
echo " Done. Bob Work is installed at:"
echo "   /Applications/Bob Work.app"
echo
echo " First launch: if Gatekeeper blocks the app,"
echo " right-click → Open (once)."
echo " Then grant Notifications / Accessibility / Mic"
echo " / Speech / Automation when prompted."
echo "=============================================="
echo
if [[ "${BOB_WORK_NONINTERACTIVE:-0}" == "1" ]]; then
  open -na "/Applications/Bob Work.app" || true
else
  read -r -p "Press Enter to open Bob Work…" _
  open -na "/Applications/Bob Work.app" || true
fi
