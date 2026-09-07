#!/usr/bin/env python3
"""Built-in Chrome control MCP for Bob Work.

Opens Google Chrome via macOS `open` and controls tabs through AppleScript when
Automatisation is granted to the MCP process (typically python3).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import time


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
        "description": "Open a URL in Chrome, wait briefly, then return the active tab snapshot.",
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


def run_osascript(script: str) -> subprocess.CompletedProcess[str]:
    return subprocess.run(["osascript", "-e", script], capture_output=True, text=True, check=False)


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


def browser_snapshot(arguments: dict) -> dict:
    url = arguments.get("url") or "https://example.com"
    wait_seconds = float(arguments.get("wait_seconds") or 2.0)
    opened = chrome_open_url(url)
    time.sleep(max(0.5, min(wait_seconds, 8.0)))
    tab = chrome_read_front_tab()
    return {
        "browser": arguments.get("browser") or "chrome",
        "requested_url": url,
        "opened": opened,
        "tab": tab,
        "title": tab.get("title") if tab.get("ok") else "Google Chrome",
        "url": tab.get("url") if tab.get("ok") else url,
        "text": (
            f"{tab.get('title', 'Google Chrome')}\nActive URL: {tab.get('url', url)}"
            if tab.get("ok")
            else f"Google Chrome opened {url}. Enable Automatisation to read the active tab."
        ),
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
