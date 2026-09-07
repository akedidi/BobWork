#!/usr/bin/env bash
# Smoke test against a real IBM Bob Shell install (not fake-bob).
# Intended for pre-release / manual CI with secrets — never replaces WDIO fake-bob.
#
# Usage:
#   BOB_API_KEY=… ./apps/macos/scripts/smoke-bob-shell.sh
#   # or BOBSHELL_API_KEY
#
# Exit codes:
#   0  smoke passed (or skipped when BOB_SMOKE_SKIP_IF_NO_KEY=1 and no key)
#   2  skipped (no key / bob missing) when skip mode enabled
#   1  failure

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
SKIP_IF_NO_KEY="${BOB_SMOKE_SKIP_IF_NO_KEY:-0}"
BOB_BIN="${BOB_WORK_BOB_PATH:-}"
if [[ -z "${BOB_BIN}" ]]; then
  BOB_BIN="$(command -v bob || true)"
fi

API_KEY="${BOB_API_KEY:-${BOBSHELL_API_KEY:-}}"

skip() {
  local reason="$1"
  if [[ "${SKIP_IF_NO_KEY}" == "1" ]]; then
    echo "SKIP: ${reason}"
    exit 2
  fi
  echo "FAIL: ${reason}" >&2
  exit 1
}

if [[ -z "${BOB_BIN}" || ! -x "${BOB_BIN}" ]]; then
  skip "Bob Shell binary not found (set BOB_WORK_BOB_PATH or install bob on PATH)"
fi

if [[ -z "${API_KEY}" ]]; then
  skip "BOB_API_KEY / BOBSHELL_API_KEY not set"
fi

VERSION_OUT="$("${BOB_BIN}" --version 2>&1 || true)"
echo "Bob binary: ${BOB_BIN}"
echo "Bob version: ${VERSION_OUT}"

if ! echo "${VERSION_OUT}" | grep -Eq '2\.|[0-9]+\.[0-9]+'; then
  echo "WARN: unexpected version string (continuing)"
fi

WORKSPACE="$(mktemp -d "${TMPDIR:-/tmp}/bob-work-smoke.XXXXXX")"
cleanup() { rm -rf "${WORKSPACE}"; }
trap cleanup EXIT

export BOB_API_KEY="${API_KEY}"
export BOBSHELL_API_KEY="${API_KEY}"

# Headless ask-mode: no MCP/subagents, one turn, trust temp workspace only.
set +e
OUTPUT="$(
  "${BOB_BIN}" run \
    --format stream-json \
    --mode=ask \
    --max-turns 1 \
    --disable-mcp \
    --disable-subagents \
    --accept-license \
    --trust \
    --workspace "${WORKSPACE}" \
    "Reply with exactly the token BOB_SMOKE_OK and nothing else." \
    2>"${WORKSPACE}/stderr.log"
)"
STATUS=$?
set -e

echo "${OUTPUT}" >"${WORKSPACE}/stdout.log"
if [[ ${STATUS} -ne 0 ]]; then
  echo "FAIL: bob run exited ${STATUS}" >&2
  echo "--- stderr ---" >&2
  cat "${WORKSPACE}/stderr.log" >&2 || true
  echo "--- stdout ---" >&2
  cat "${WORKSPACE}/stdout.log" >&2 || true
  exit 1
fi

contains_token() {
  if command -v rg >/dev/null 2>&1; then
    echo "$1" | rg -q 'BOB_SMOKE_OK'
  else
    echo "$1" | grep -Eq 'BOB_SMOKE_OK'
  fi
}

if ! contains_token "${OUTPUT}"; then
  # stream-json may wrap text in JSON events — also accept concatenated text deltas
  if ! SMOKE_LOG="${WORKSPACE}/stdout.log" python3 - <<'PY'
import json, os, sys
path = os.environ["SMOKE_LOG"]
text = open(path, encoding="utf-8", errors="ignore").read()
if "BOB_SMOKE_OK" in text:
    raise SystemExit(0)
for line in text.splitlines():
    line = line.strip()
    if not line.startswith("{"):
        continue
    try:
        obj = json.loads(line)
    except json.JSONDecodeError:
        continue
    if "BOB_SMOKE_OK" in json.dumps(obj, ensure_ascii=False):
        raise SystemExit(0)
raise SystemExit(1)
PY
  then
    echo "FAIL: smoke token BOB_SMOKE_OK not found in Bob output" >&2
    echo "--- stdout (truncated) ---" >&2
    head -c 4000 "${WORKSPACE}/stdout.log" >&2 || true
    exit 1
  fi
fi

echo "OK: real Bob Shell smoke passed (${VERSION_OUT%%$'\n'*})"
exit 0
