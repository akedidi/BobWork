#!/usr/bin/env python3
"""Built-in Chrome control MCP for Bob Work.

Opens Google Chrome via macOS `open` and controls tabs through AppleScript.
AppleScript is preferably executed inside Bob Work (Unix bridge) so Automation
TCC attaches to Bob Work rather than python3/osascript.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import time
from pathlib import Path


def send(request_id, result):
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=False), flush=True)


def send_error(request_id, message: str, code: int = -32000):
    print(
        json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
            ensure_ascii=False,
        ),
        flush=True,
    )


TOOLS = [
    {
        "name": "chrome_open_url",
        "description": "Open a URL in Google Chrome (new tab or existing window).",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
    {
        "name": "chrome_read_front_tab",
        "description": "Read the title and URL of the active tab in the front Chrome window.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "chrome_list_tabs",
        "description": "List Chrome windows and tabs with windowIndex, tabIndex, title and URL.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "chrome_activate_tab",
        "description": "Focus a Chrome window and activate a tab by index (1-based).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "window_index": {"type": "integer", "minimum": 1},
                "tab_index": {"type": "integer", "minimum": 1},
            },
            "required": ["window_index", "tab_index"],
        },
    },
    {
        "name": "chrome_navigate",
        "description": "Navigate the active tab of the front Chrome window to a URL.",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
    {
        "name": "chrome_execute_js",
        "description": "Execute JavaScript in the active tab and return the result as text.",
        "inputSchema": {
            "type": "object",
            "properties": {"script": {"type": "string"}},
            "required": ["script"],
        },
    },
    {
        "name": "browser_snapshot",
        "description": "Open a URL in Chrome, wait briefly, then return the active tab snapshot (title, URL, headings, visible text).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
                "browser": {"type": "string"},
                "wait_seconds": {"type": "number"},
            },
        },
    },
]


def require_macos() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("Chrome control MCP requires macOS")


BRIDGE_REQUIRED_ERROR = (
    "Le pont AppleScript de Bob Work est indisponible. Relancez l’app Bob Work, "
    "puis autorisez **Bob Work → Google Chrome** (pas python3, pas osascript) dans "
    "Réglages Système → Confidentialité et sécurité → Automatisation."
)


def run_osascript(script: str) -> subprocess.CompletedProcess[str]:
    """Run AppleScript inside Bob Work only — never spawn osascript/python3 TCC."""
    socket_path = (
        os.environ.get("BOB_WORK_APPLESCRIPT_SOCKET", "").strip()
        or str(Path.home() / ".bob" / "run" / "applescript.sock")
    )
    if not socket_path or not Path(socket_path).exists():
        return subprocess.CompletedProcess(
            args=["bob-work-applescript", socket_path or "missing"],
            returncode=1,
            stdout="",
            stderr=BRIDGE_REQUIRED_ERROR,
        )
    try:
        return _run_osascript_via_bob_work(socket_path, script)
    except Exception as error:  # noqa: BLE001 — do not fall back to /usr/bin/osascript
        return subprocess.CompletedProcess(
            args=["bob-work-applescript", socket_path],
            returncode=1,
            stdout="",
            stderr=f"{BRIDGE_REQUIRED_ERROR} ({error})",
        )


def _run_osascript_via_bob_work(socket_path: str, script: str) -> subprocess.CompletedProcess[str]:
    import socket

    payload = (json.dumps({"script": script}, ensure_ascii=False) + "\n").encode("utf-8")
    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
        client.settimeout(30)
        client.connect(socket_path)
        client.sendall(payload)
        chunks: list[bytes] = []
        while True:
            chunk = client.recv(65536)
            if not chunk:
                break
            chunks.append(chunk)
            if b"\n" in chunk:
                break
    raw = b"".join(chunks).decode("utf-8", errors="replace").strip()
    data = json.loads(raw) if raw else {"ok": False, "stdout": "", "stderr": "empty bridge response"}
    ok = bool(data.get("ok"))
    stdout = str(data.get("stdout") or "")
    stderr = str(data.get("stderr") or "")
    return subprocess.CompletedProcess(
        args=["bob-work-applescript", socket_path],
        returncode=0 if ok else 1,
        stdout=stdout,
        stderr=stderr,
    )


def escape_applescript(value: str) -> str:
    return value.replace("\\", "\\\\").replace('"', '\\"')


def automation_error(result: subprocess.CompletedProcess[str]) -> dict:
    stderr = result.stderr.strip() or "AppleScript failed"
    return {
        "ok": False,
        "browser": "Google Chrome",
        "automation_required": True,
        "error": stderr,
    }


def chrome_open_url(url: str) -> dict:
    require_macos()
    if shutil.which("open") is None:
        raise RuntimeError("macOS open command unavailable")
    if not url.startswith(("http://", "https://")):
        raise ValueError("url must be http(s)")
    result = subprocess.run(
        ["open", "-a", "Google Chrome", url],
        capture_output=True,
        text=True,
        check=False,
    )
    payload = {
        "opened": result.returncode == 0,
        "url": url,
        "browser": "Google Chrome",
        "returncode": result.returncode,
    }
    if result.stderr.strip():
        payload["stderr"] = result.stderr.strip()
    if result.returncode != 0:
        payload["hint"] = "Install Google Chrome or grant Automatisation for this MCP tool."
    return payload


def chrome_read_front_tab() -> dict:
    require_macos()
    script = '''
tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WINDOW"
  set theUrl to URL of active tab of front window
  set theTitle to title of active tab of front window
  return theTitle & "|||" & theUrl
end tell
'''
    result = run_osascript(script)
    if result.returncode != 0:
        return automation_error(result)
    raw = result.stdout.strip()
    if raw == "NO_WINDOW":
        return {"ok": False, "browser": "Google Chrome", "error": "no_chrome_window"}
    if "|||" not in raw:
        return {"ok": False, "browser": "Google Chrome", "error": raw}
    title, url = raw.split("|||", 1)
    return {"ok": True, "browser": "Google Chrome", "title": title, "url": url}


def chrome_list_tabs() -> dict:
    require_macos()
    script = '''
tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WINDOW"
  set output to ""
  repeat with w from 1 to count of windows
    repeat with t from 1 to count of tabs of window w
      set theTab to tab t of window w
      set output to output & w & ":" & t & "|||" & title of theTab & "|||" & URL of theTab & linefeed
    end repeat
  end repeat
  return output
end tell
'''
    result = run_osascript(script)
    if result.returncode != 0:
        return automation_error(result)
    raw = result.stdout.strip()
    if raw == "NO_WINDOW":
        return {"ok": True, "browser": "Google Chrome", "tabs": []}
    tabs = []
    for line in raw.splitlines():
        if not line.strip():
            continue
        prefix, title, url = line.split("|||", 2)
        window_index, tab_index = prefix.split(":", 1)
        tabs.append(
            {
                "windowIndex": int(window_index),
                "tabIndex": int(tab_index),
                "title": title,
                "url": url,
            }
        )
    return {"ok": True, "browser": "Google Chrome", "tabs": tabs}


def chrome_activate_tab(window_index: int, tab_index: int) -> dict:
    require_macos()
    if window_index < 1 or tab_index < 1:
        raise ValueError("window_index and tab_index must be >= 1")
    script = f'''
tell application "Google Chrome"
  if (count of windows) < {window_index} then return "NO_WINDOW"
  set targetWindow to window {window_index}
  if (count of tabs of targetWindow) < {tab_index} then return "NO_TAB"
  set active tab index of targetWindow to {tab_index}
  set index of targetWindow to 1
  activate
  return "OK"
end tell
'''
    result = run_osascript(script)
    if result.returncode != 0:
        return automation_error(result)
    raw = result.stdout.strip()
    if raw == "NO_WINDOW":
        return {"ok": False, "browser": "Google Chrome", "error": "no_chrome_window"}
    if raw == "NO_TAB":
        return {"ok": False, "browser": "Google Chrome", "error": "no_chrome_tab"}
    return {
        "ok": True,
        "browser": "Google Chrome",
        "windowIndex": window_index,
        "tabIndex": tab_index,
    }


def chrome_navigate(url: str) -> dict:
    require_macos()
    if not url.startswith(("http://", "https://")):
        raise ValueError("url must be http(s)")
    escaped = escape_applescript(url)
    script = f'''
tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WINDOW"
  set URL of active tab of front window to "{escaped}"
  return URL of active tab of front window
end tell
'''
    result = run_osascript(script)
    if result.returncode != 0:
        return automation_error(result)
    raw = result.stdout.strip()
    if raw == "NO_WINDOW":
        return {"ok": False, "browser": "Google Chrome", "error": "no_chrome_window"}
    return {"ok": True, "browser": "Google Chrome", "url": raw}


def chrome_execute_js(script: str) -> dict:
    require_macos()
    if not script.strip():
        raise ValueError("script is required")
    escaped = escape_applescript(script)
    applescript = f'''
tell application "Google Chrome"
  if (count of windows) = 0 then return "NO_WINDOW"
  set jsResult to execute active tab of front window javascript "{escaped}"
  if jsResult is missing value then return ""
  return jsResult as text
end tell
'''
    result = run_osascript(applescript)
    if result.returncode != 0:
        return automation_error(result)
    raw = result.stdout.strip()
    if raw == "NO_WINDOW":
        return {"ok": False, "browser": "Google Chrome", "error": "no_chrome_window"}
    return {"ok": True, "browser": "Google Chrome", "result": raw}


PAGE_OUTLINE_JS = (
    "(function(){function c(s,n){s=String(s||'').replace(/\\s+/g,' ').trim();"
    "return s.length>n?s.slice(0,n)+'\\u2026':s}"
    "var h=[].slice.call(document.querySelectorAll('h1,h2,h3'),0,12)"
    ".map(function(el){return c(el.innerText,80)}).filter(Boolean);"
    "var a=[].slice.call(document.querySelectorAll('button,[role=button],input[type=submit],a[href]'),0,16)"
    ".map(function(el){return c(el.innerText||el.value||el.getAttribute('aria-label')||'',60)}).filter(Boolean);"
    "return JSON.stringify({title:document.title||'',url:location.href||'',headings:h,actions:a,"
    "text:c((document.body&&document.body.innerText)||'',1200)})})()"
)


def page_outline() -> dict:
    executed = chrome_execute_js(PAGE_OUTLINE_JS)
    if not executed.get("ok"):
        return {"ok": False, "error": executed.get("error")}
    raw = str(executed.get("result") or "").strip()
    if not raw:
        return {"ok": False, "error": "empty_outline"}
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return {"ok": False, "error": "invalid_outline", "raw": raw[:400]}
    if not isinstance(parsed, dict):
        return {"ok": False, "error": "invalid_outline"}
    parsed["ok"] = True
    return parsed


def browser_snapshot(arguments: dict) -> dict:
    url = arguments.get("url") or "https://example.com"
    wait_seconds = float(arguments.get("wait_seconds") or 2.0)
    opened = chrome_open_url(url)
    time.sleep(max(0.5, min(wait_seconds, 8.0)))
    tab = chrome_read_front_tab()
    outline = page_outline() if tab.get("ok") else {"ok": False}
    title = (
        outline.get("title")
        or (tab.get("title") if tab.get("ok") else None)
        or "Google Chrome"
    )
    active_url = (
        outline.get("url")
        or (tab.get("url") if tab.get("ok") else None)
        or url
    )
    headings = outline.get("headings") if isinstance(outline.get("headings"), list) else []
    actions = outline.get("actions") if isinstance(outline.get("actions"), list) else []
    excerpt = str(outline.get("text") or "").strip()
    if tab.get("ok"):
        text = f"{title}\nActive URL: {active_url}"
        if headings:
            text += "\nHeadings: " + " · ".join(str(item) for item in headings[:8])
        if excerpt:
            text += "\n" + excerpt
    else:
        text = f"Google Chrome opened {url}. Enable Automatisation to read the active tab."
    return {
        "ok": bool(tab.get("ok")),
        "browser": arguments.get("browser") or "chrome",
        "requested_url": url,
        "opened": opened,
        "tab": tab,
        "outline": outline,
        "title": title,
        "url": active_url,
        "headings": headings,
        "actions": actions,
        "text": text,
        "snapshot": True,
    }


def handle_call(name: str, arguments: dict) -> dict:
    if name == "chrome_open_url":
        payload = chrome_open_url(str(arguments.get("url", "")))
    elif name == "chrome_read_front_tab":
        payload = chrome_read_front_tab()
    elif name == "chrome_list_tabs":
        payload = chrome_list_tabs()
    elif name == "chrome_activate_tab":
        payload = chrome_activate_tab(
            int(arguments.get("window_index", 0)),
            int(arguments.get("tab_index", 0)),
        )
    elif name == "chrome_navigate":
        payload = chrome_navigate(str(arguments.get("url", "")))
    elif name == "chrome_execute_js":
        payload = chrome_execute_js(str(arguments.get("script", "")))
    elif name == "browser_snapshot":
        payload = browser_snapshot(arguments)
    else:
        raise KeyError(name)
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
        "structuredContent": payload,
        "isError": False,
    }


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    request = json.loads(line)
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    if method == "initialize":
        send(
            request_id,
            {
                "protocolVersion": "2025-06-18",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "bob-work-chrome-control", "version": "1.1.0"},
            },
        )
    elif method == "tools/list":
        send(request_id, {"tools": TOOLS})
    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments") or {}
        try:
            send(request_id, handle_call(tool_name, arguments))
        except Exception as error:  # noqa: BLE001
            send_error(request_id, str(error))
    elif method == "notifications/initialized":
        continue
    elif request_id is not None:
        send_error(request_id, f"Unsupported method: {method}", -32601)
