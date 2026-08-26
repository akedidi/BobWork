#!/usr/bin/env python3
"""Built-in background web reader and explicit Chrome control MCP for Bob Work.

Ordinary documentation/API research is fetched without opening a visible app.
Chrome tools are reserved for explicit browser-control requests. AppleScript is
executed inside Bob Work (Unix bridge) so Automation TCC attaches to Bob Work.
"""

from __future__ import annotations

import ipaddress
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import time
import urllib.error
import urllib.request
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urlsplit


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
        "description": "Open a URL visibly in Google Chrome. Use only when the user explicitly asks to open or control Chrome; never use for ordinary research or API/documentation retrieval.",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
    {
        "name": "chrome_read_front_tab",
        "description": "Read the active Chrome tab. Use only when the user explicitly asks about an existing Chrome tab.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "chrome_list_tabs",
        "description": "List visible Chrome tabs. Use only when the user explicitly asks to inspect or control Chrome.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "chrome_activate_tab",
        "description": "Focus Chrome and activate a tab by index (1-based). Use only after an explicit browser-control request.",
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
        "description": "Navigate a visible Chrome tab. Use only when the user explicitly asks to navigate or interact with Chrome.",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
    {
        "name": "chrome_execute_js",
        "description": "Execute JavaScript in the active Chrome tab. Use only for an explicit Chrome interaction or a page that requires its authenticated/JavaScript state.",
        "inputSchema": {
            "type": "object",
            "properties": {"script": {"type": "string"}},
            "required": ["script"],
        },
    },
    {
        "name": "web_fetch",
        "description": "Fetch an HTTP(S) page, API or documentation in the background and return its content. Does not open Chrome or any visible window. Preferred for research and source comparison.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "url": {"type": "string"},
            },
            "required": ["url"],
        },
    },
    {
        "name": "browser_snapshot",
        "description": "Compatibility alias for background web_fetch. Fetches title, headings and text without opening Chrome or another visible window.",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
            "required": ["url"],
        },
    },
]


def require_macos() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("Chrome control MCP requires macOS")


def require_visible_chrome_intent() -> None:
    if os.environ.get("BOB_WORK_ALLOW_VISIBLE_CHROME", "").strip() != "1":
        raise PermissionError(
            "Visible Chrome control was not explicitly requested by the user. "
            "Use web_fetch for background research, documentation and APIs."
        )


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
    require_visible_chrome_intent()
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
    require_visible_chrome_intent()
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
    require_visible_chrome_intent()
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
    require_visible_chrome_intent()
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
    require_visible_chrome_intent()
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
    require_visible_chrome_intent()
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


def chrome_front_window_bounds():
    """Return Chrome's front-window bounds without requiring Accessibility access."""
    script = '''
tell application "Google Chrome"
  if it is not running then return "NO_CHROME"
  if (count of windows) = 0 then return "NO_WINDOW"
  activate
  delay 0.2
  set windowBounds to bounds of front window
  return (item 1 of windowBounds as text) & "|||" & (item 2 of windowBounds as text) & "|||" & (item 3 of windowBounds as text) & "|||" & (item 4 of windowBounds as text)
end tell
'''
    result = run_osascript(script)
    if result.returncode != 0:
        return None
    try:
        left, top, right, bottom = (int(value.strip()) for value in result.stdout.strip().split("|||"))
        width = right - left
        height = bottom - top
        if width < 100 or height < 100:
            return None
        return left, top, width, height
    except (TypeError, ValueError):
        return None


def cleanup_old_snapshots(directory: Path, max_age_seconds: float = 2 * 24 * 60 * 60) -> None:
    cutoff = time.time() - max_age_seconds
    for candidate in directory.glob("chrome-*"):
        try:
            if candidate.is_file() and candidate.stat().st_mtime < cutoff:
                candidate.unlink()
        except OSError:
            continue


def capture_chrome_window() -> dict:
    """Capture locally; never send the page or screenshot to an external service."""
    bounds = chrome_front_window_bounds()
    if not bounds:
        return {"ok": False, "error": "chrome_window_bounds_unavailable"}
    executable = shutil.which("screencapture") or "/usr/sbin/screencapture"
    if not Path(executable).exists():
        return {"ok": False, "error": "screencapture_unavailable"}

    directory = Path.home() / "Library" / "Caches" / "com.bobwork.desktop" / "chrome-snapshots"
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    cleanup_old_snapshots(directory)
    token = f"{int(time.time() * 1000)}-{os.getpid()}"
    png_path = directory / f"chrome-{token}.png"
    jpg_path = directory / f"chrome-{token}.jpg"
    left, top, width, height = bounds
    result = subprocess.run(
        [executable, "-x", "-o", f"-R{left},{top},{width},{height}", str(png_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0 or not png_path.is_file() or png_path.stat().st_size == 0:
        try:
            png_path.unlink()
        except OSError:
            pass
        return {
            "ok": False,
            "error": result.stderr.strip() or "screen_recording_permission_required",
        }

    # Keep persisted task events small: a 1100 px JPEG is ample for the card.
    sips = shutil.which("sips") or "/usr/bin/sips"
    if Path(sips).exists():
        converted = subprocess.run(
            [sips, "-Z", "1100", "-s", "format", "jpeg", "-s", "formatOptions", "68", str(png_path), "--out", str(jpg_path)],
            capture_output=True,
            text=True,
            check=False,
        )
        if converted.returncode == 0 and jpg_path.is_file() and jpg_path.stat().st_size > 0:
            try:
                png_path.unlink()
            except OSError:
                pass
            return {"ok": True, "path": str(jpg_path)}
    return {"ok": True, "path": str(png_path)}


def validate_background_url(url: str) -> str:
    parsed = urlsplit(url.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.hostname:
        raise ValueError("url must be a public http(s) URL")
    hostname = parsed.hostname.lower().rstrip(".")
    if hostname == "localhost" or hostname.endswith(".local"):
        raise ValueError("local and private network URLs are not allowed")
    try:
        addresses = socket.getaddrinfo(hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
    except socket.gaierror as error:
        raise ValueError(f"hostname resolution failed: {error}") from error
    for address in addresses:
        ip = ipaddress.ip_address(address[4][0].split("%", 1)[0])
        if not ip.is_global:
            raise ValueError("local and private network URLs are not allowed")
    return parsed.geturl()


class SafeBackgroundRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, message, headers, new_url):
        return super().redirect_request(
            request,
            fp,
            code,
            message,
            headers,
            validate_background_url(new_url),
        )


class BackgroundPageParser(HTMLParser):
    SKIPPED = {"script", "style", "noscript", "svg", "template"}
    BLOCKS = {"p", "div", "section", "article", "main", "header", "footer", "li", "br", "tr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.title_depth = 0
        self.heading_tag = ""
        self.action_tag = ""
        self.title_parts: list[str] = []
        self.heading_parts: list[str] = []
        self.action_parts: list[str] = []
        self.headings: list[str] = []
        self.actions: list[str] = []
        self.text_parts: list[str] = []

    @staticmethod
    def compact(value: str, limit: int = 160) -> str:
        return re.sub(r"\s+", " ", value).strip()[:limit]

    def handle_starttag(self, tag: str, attrs):
        tag = tag.lower()
        if tag in self.SKIPPED:
            self.skip_depth += 1
            return
        if self.skip_depth:
            return
        if tag == "title":
            self.title_depth += 1
        elif tag in {"h1", "h2", "h3"} and not self.heading_tag:
            self.heading_tag = tag
            self.heading_parts = []
        elif tag in {"a", "button"} and not self.action_tag:
            self.action_tag = tag
            self.action_parts = []
        if tag in self.BLOCKS:
            self.text_parts.append("\n")

    def handle_endtag(self, tag: str):
        tag = tag.lower()
        if self.skip_depth:
            if tag in self.SKIPPED:
                self.skip_depth -= 1
            return
        if tag == "title" and self.title_depth:
            self.title_depth -= 1
        if tag == self.heading_tag:
            heading = self.compact(" ".join(self.heading_parts), 100)
            if heading and heading not in self.headings and len(self.headings) < 12:
                self.headings.append(heading)
            self.heading_tag = ""
            self.heading_parts = []
        if tag == self.action_tag:
            action = self.compact(" ".join(self.action_parts), 80)
            if action and action not in self.actions and len(self.actions) < 12:
                self.actions.append(action)
            self.action_tag = ""
            self.action_parts = []
        if tag in self.BLOCKS:
            self.text_parts.append("\n")

    def handle_data(self, data: str):
        if self.skip_depth:
            return
        value = self.compact(data, 500)
        if not value:
            return
        self.text_parts.append(value)
        if self.title_depth:
            self.title_parts.append(value)
        if self.heading_tag:
            self.heading_parts.append(value)
        if self.action_tag:
            self.action_parts.append(value)

    def snapshot(self) -> dict:
        return {
            "title": self.compact(" ".join(self.title_parts), 180),
            "headings": self.headings,
            "actions": self.actions,
            "text": self.compact(" ".join(self.text_parts), 12_000),
        }


def fetch_background_url(url: str) -> dict:
    requested_url = validate_background_url(url)
    request = urllib.request.Request(
        requested_url,
        headers={
            "User-Agent": "BobWork/0.1 (background research; contact: local-user)",
            "Accept": "text/html,application/json,text/plain,application/xml;q=0.9,*/*;q=0.5",
        },
    )
    opener = urllib.request.build_opener(SafeBackgroundRedirectHandler())
    try:
        with opener.open(request, timeout=18) as response:
            final_url = validate_background_url(response.geturl())
            content_type = response.headers.get_content_type().lower()
            charset = response.headers.get_content_charset() or "utf-8"
            body = response.read(2_000_001)
            truncated = len(body) > 2_000_000
            body = body[:2_000_000]
            status = getattr(response, "status", 200)
    except urllib.error.HTTPError as error:
        return {
            "ok": False,
            "requested_url": requested_url,
            "url": error.geturl() or requested_url,
            "status": error.code,
            "error": f"HTTP {error.code}: {error.reason}",
            "fetch_mode": "background",
            "opened": False,
        }
    except urllib.error.URLError as error:
        return {
            "ok": False,
            "requested_url": requested_url,
            "url": requested_url,
            "error": str(error.reason),
            "fetch_mode": "background",
            "opened": False,
        }

    decoded = body.decode(charset, errors="replace")
    title = urlsplit(final_url).hostname or final_url
    headings: list[str] = []
    actions: list[str] = []
    if content_type == "text/html" or decoded.lstrip().lower().startswith(("<!doctype html", "<html")):
        parser = BackgroundPageParser()
        parser.feed(decoded)
        outline = parser.snapshot()
        title = outline["title"] or title
        headings = outline["headings"]
        actions = outline["actions"]
        text = outline["text"]
    elif content_type == "application/json" or decoded.lstrip().startswith(("{", "[")):
        try:
            text = json.dumps(json.loads(decoded), ensure_ascii=False, indent=2)[:12_000]
        except json.JSONDecodeError:
            text = decoded[:12_000]
    else:
        text = re.sub(r"\s+", " ", decoded).strip()[:12_000]

    return {
        "ok": True,
        "requested_url": requested_url,
        "url": final_url,
        "title": title,
        "headings": headings,
        "actions": actions,
        "text": text,
        "status": status,
        "content_type": content_type,
        "truncated": truncated,
        "fetch_mode": "background",
        "opened": False,
        "snapshot": True,
    }


def browser_snapshot(arguments: dict) -> dict:
    """Compatibility name: always fetch in the background, never open Chrome."""
    return fetch_background_url(str(arguments.get("url") or ""))


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
    elif name in {"web_fetch", "browser_snapshot"}:
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
                "serverInfo": {"name": "bob-work-chrome-control", "version": "1.3.0"},
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
