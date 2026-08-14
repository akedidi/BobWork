#!/usr/bin/env python3
"""Built-in Computer Use MCP for Bob Work (macOS).

Takes control of the local Mac through `open`, AppleScript and System Events.
AppleScript is preferably executed inside Bob Work (Unix bridge) so Accessibility
TCC attaches to Bob Work rather than python3/osascript.

Tools: list_apps, open_app, focus_app, get_app_state, desktop_click,
desktop_type, press_key, accessibility_status.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
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
        "name": "accessibility_status",
        "description": "Vérifie si le contrôle bureau / Accessibilité macOS est disponible.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "list_apps",
        "description": "Liste les applications installées (/Applications) et les processus UI en cours.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "running_only": {"type": "boolean"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
        },
    },
    {
        "name": "open_app",
        "description": "Ouvre ou active une application macOS (ex. Telegram, Messages, Safari).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "app": {"type": "string", "description": "Nom de l’app (Telegram) ou chemin .app"},
                "wait_seconds": {"type": "number"},
            },
            "required": ["app"],
        },
    },
    {
        "name": "focus_app",
        "description": "Met une application au premier plan sans la relancer si elle tourne déjà.",
        "inputSchema": {
            "type": "object",
            "properties": {"app": {"type": "string"}},
            "required": ["app"],
        },
    },
    {
        "name": "get_app_state",
        "description": "Lit le titre de fenêtre et une liste d’éléments UI (Accessibilité / System Events).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "app": {"type": "string"},
                "max_elements": {"type": "integer", "minimum": 1, "maximum": 80},
            },
            "required": ["app"],
        },
    },
    {
        "name": "desktop_click",
        "description": "Clique aux coordonnées écran (points) via System Events.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "x": {"type": "number"},
                "y": {"type": "number"},
                "button": {"type": "string", "enum": ["left", "right"]},
            },
            "required": ["x", "y"],
        },
    },
    {
        "name": "desktop_type",
        "description": "Tape du texte dans l’application au premier plan (keystroke System Events).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "app": {"type": "string", "description": "Optionnel : activer cette app avant de taper"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "press_key",
        "description": "Envoie une touche (return, escape, tab, delete) ou un key code numeric.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "command": {"type": "boolean"},
                "shift": {"type": "boolean"},
                "option": {"type": "boolean"},
                "control": {"type": "boolean"},
            },
            "required": ["key"],
        },
    },
]


def e2e_mode() -> bool:
    if os.environ.get("BOB_COMPUTER_USE_E2E", "").strip().lower() in {"1", "true", "e2e"}:
        return True
    marker = os.environ.get("BOB_COMPUTER_USE", "").strip().lower()
    return marker.startswith("e2e")


def require_macos() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("Computer Use MCP requires macOS")


BRIDGE_REQUIRED_ERROR = (
    "Le pont AppleScript de Bob Work est indisponible. Relancez l’app Bob Work, "
    "puis autorisez **Bob Work** (pas python3, pas Terminal, pas osascript) dans "
    "Réglages Système → Confidentialité et sécurité → Accessibilité, "
    "ou Réglages Bob Work → Accès et contrôle → Demander Accessibilité."
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


def accessibility_hint(stderr: str) -> dict:
    lower = stderr.lower()
    denied = any(
        marker in lower
        for marker in ("not allowed", "not authorized", "autorisation", "(-1719)", "(-25211)", "1002")
    )
    return {
        "accessibility_required": True,
        "denied": denied,
        "hint": (
            "Autorisez **Bob Work** (pas python3, pas Terminal) dans "
            "Réglages Système → Confidentialité et sécurité → Accessibilité, "
            "ou Réglages Bob Work → Accès et contrôle → Demander Accessibilité."
        ),
        "error": stderr.strip() or "System Events failed",
    }


def normalize_app_name(app: str) -> str:
    value = (app or "").strip()
    if value.endswith(".app"):
        value = Path(value).stem
    aliases = {
        "telegram": "Telegram",
        "telegram desktop": "Telegram",
        "chrome": "Google Chrome",
        "google chrome": "Google Chrome",
        "safari": "Safari",
        "finder": "Finder",
        "messages": "Messages",
        "mail": "Mail",
        "notes": "Notes",
        "terminal": "Terminal",
        "iterm": "iTerm",
        "vscode": "Visual Studio Code",
        "code": "Visual Studio Code",
        "slack": "Slack",
        "spotify": "Spotify",
    }
    return aliases.get(value.lower(), value)


def resolve_app_path(app: str) -> str | None:
    name = normalize_app_name(app)
    candidates = [
        Path(f"/Applications/{name}.app"),
        Path.home() / "Applications" / f"{name}.app",
        Path(f"/System/Applications/{name}.app"),
    ]
    for path in candidates:
        if path.exists():
            return str(path)
    # Spotlight-ish fallback via mdfind
    if shutil.which("mdfind"):
        query = f'kMDItemKind == "Application" && kMDItemDisplayName == "{name}"c'
        result = subprocess.run(
            ["mdfind", query],
            capture_output=True,
            text=True,
            check=False,
        )
        for line in result.stdout.splitlines():
            if line.strip().endswith(".app"):
                return line.strip()
    return None


def accessibility_status() -> dict:
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "accessibility": "granted"}
    require_macos()
    result = run_osascript(
        'tell application "System Events" to get name of first process whose frontmost is true'
    )
    if result.returncode != 0:
        return {"ok": False, "accessibility": "denied", **accessibility_hint(result.stderr)}
    return {
        "ok": True,
        "accessibility": "granted",
        "frontmost": result.stdout.strip(),
    }


def list_installed_apps(limit: int) -> list[dict]:
    apps = []
    roots = [Path("/Applications"), Path.home() / "Applications", Path("/System/Applications")]
    for root in roots:
        if not root.is_dir():
            continue
        for path in sorted(root.glob("*.app")):
            apps.append({"name": path.stem, "path": str(path), "running": False})
            if len(apps) >= limit:
                return apps
    return apps


def list_running_apps(limit: int) -> list[dict]:
    result = run_osascript(
        'tell application "System Events" to get name of every process whose background only is false'
    )
    if result.returncode != 0:
        raise RuntimeError(json.dumps(accessibility_hint(result.stderr), ensure_ascii=False))
    names = [part.strip() for part in result.stdout.strip().split(",") if part.strip()]
    # osascript may return comma-separated without quotes
    if len(names) == 1 and ", " not in result.stdout and result.stdout.count(",") > 0:
        names = [part.strip() for part in result.stdout.split(",")]
    # Better parse: AppleScript list often like "a, b, c"
    front = run_osascript(
        'tell application "System Events" to get name of first process whose frontmost is true'
    )
    frontmost = front.stdout.strip() if front.returncode == 0 else ""
    out = []
    for name in names[:limit]:
        out.append({"name": name, "focused": name == frontmost, "running": True})
    return out


def list_apps(running_only: bool = False, limit: int = 80) -> dict:
    if e2e_mode():
        return {
            "ok": True,
            "mode": "e2e",
            "apps": [
                {"name": "Bob Work", "focused": True, "running": True},
                {"name": "Telegram", "focused": False, "running": False, "path": "/Applications/Telegram.app"},
                {"name": "Google Chrome", "focused": False, "running": True},
            ][:limit],
        }
    require_macos()
    limit = max(1, min(int(limit or 80), 200))
    if running_only:
        apps = list_running_apps(limit)
    else:
        installed = {item["name"]: item for item in list_installed_apps(limit)}
        try:
            for item in list_running_apps(limit):
                current = installed.get(item["name"], {"name": item["name"]})
                current.update(item)
                installed[item["name"]] = current
        except RuntimeError as error:
            return {"ok": False, "installed": list(installed.values())[:limit], **json.loads(str(error))}
        apps = list(installed.values())[:limit]
    return {"ok": True, "count": len(apps), "apps": apps}


def open_app(app: str, wait_seconds: float = 1.0) -> dict:
    if e2e_mode():
        name = normalize_app_name(app)
        return {"ok": True, "mode": "e2e", "opened": name, "path": f"/Applications/{name}.app"}
    require_macos()
    name = normalize_app_name(app)
    path = resolve_app_path(name)
    if path:
        completed = subprocess.run(["open", path], capture_output=True, text=True, check=False)
    else:
        completed = subprocess.run(["open", "-a", name], capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        return {
            "ok": False,
            "app": name,
            "error": (completed.stderr or completed.stdout or "open failed").strip(),
            "hint": f"Vérifiez que « {name} » est installé (ex. /Applications/Telegram.app).",
        }
    # Activate to bring front
    activate = run_osascript(f'tell application "{escape_applescript(name)}" to activate')
    if wait_seconds and wait_seconds > 0:
        import time

        time.sleep(min(float(wait_seconds), 5.0))
    return {
        "ok": True,
        "app": name,
        "path": path,
        "activated": activate.returncode == 0,
        "activation_error": activate.stderr.strip() if activate.returncode != 0 else None,
    }


def focus_app(app: str) -> dict:
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "focused": normalize_app_name(app)}
    require_macos()
    name = normalize_app_name(app)
    result = run_osascript(f'tell application "{escape_applescript(name)}" to activate')
    if result.returncode != 0:
        return {"ok": False, "app": name, **accessibility_hint(result.stderr)}
    return {"ok": True, "app": name, "focused": True}


def get_app_state(app: str, max_elements: int = 25) -> dict:
    if e2e_mode():
        name = normalize_app_name(app)
        return {
            "ok": True,
            "mode": "e2e",
            "app": name,
            "window": f"{name} — Main",
            "elements": [
                {"role": "button", "label": "New Message"},
                {"role": "text field", "label": "Search"},
            ],
        }
    require_macos()
    name = normalize_app_name(app)
    max_elements = max(1, min(int(max_elements or 25), 80))
    script = f'''
    tell application "{escape_applescript(name)}" to activate
    tell application "System Events"
      tell process "{escape_applescript(name)}"
        set frontmost to true
        set windowTitle to ""
        try
          set windowTitle to name of front window
        end try
        set collected to {{}}
        set uiItems to {{}}
        try
          set uiItems to entire contents of front window
        end try
        set counter to 0
        repeat with uiItem in uiItems
          set counter to counter + 1
          if counter > {max_elements} then exit repeat
          set roleName to ""
          set labelName to ""
          try
            set roleName to role of uiItem as text
          end try
          try
            set labelName to name of uiItem as text
          end try
          if labelName is missing value then set labelName to ""
          set end of collected to (roleName & "\t" & labelName)
        end repeat
        set AppleScript's text item delimiters to "\n"
        set collectedText to collected as text
        set AppleScript's text item delimiters to ""
        return windowTitle & "\n---\n" & collectedText
      end tell
    end tell
    '''
    result = run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, "app": name, **accessibility_hint(result.stderr)}
    raw = result.stdout.strip()
    window, _, body = raw.partition("\n---\n")
    elements = []
    for line in body.splitlines():
        if not line.strip():
            continue
        role, _, label = line.partition("\t")
        elements.append({"role": role.strip(), "label": label.strip()})
    payload = {"ok": True, "app": name, "window": window.strip(), "elements": elements}
    if not elements:
        payload["hint"] = (
            "Aucun élément UI lu. N’utilisez pas osascript/python3. "
            "Autorisez Bob Work dans Réglages Système → Accessibilité, puis réessayez get_app_state."
        )
    return payload


def desktop_click(x: float, y: float, button: str = "left") -> dict:
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "clicked": True, "x": x, "y": y, "button": button}
    require_macos()
    right = button == "right"
    # System Events click at {x, y}
    action = "right click" if right else "click"
    script = f'tell application "System Events" to {action} at {{{int(x)}, {int(y)}}}'
    result = run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, "x": x, "y": y, **accessibility_hint(result.stderr)}
    return {"ok": True, "clicked": True, "x": int(x), "y": int(y), "button": button}


def desktop_type(text: str, app: str | None = None) -> dict:
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "typed": text, "app": app}
    require_macos()
    if app:
        focus = focus_app(app)
        if not focus.get("ok"):
            return focus
    escaped = escape_applescript(text)
    script = f'tell application "System Events" to keystroke "{escaped}"'
    result = run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, **accessibility_hint(result.stderr)}
    return {"ok": True, "typed": text, "length": len(text)}


KEY_CODES = {
    "return": 36,
    "enter": 36,
    "tab": 48,
    "escape": 53,
    "esc": 53,
    "delete": 51,
    "backspace": 51,
    "space": 49,
    "left": 123,
    "right": 124,
    "down": 125,
    "up": 126,
}


def press_key(
    key: str,
    command: bool = False,
    shift: bool = False,
    option: bool = False,
    control: bool = False,
) -> dict:
    if e2e_mode():
        return {
            "ok": True,
            "mode": "e2e",
            "key": key,
            "modifiers": {"command": command, "shift": shift, "option": option, "control": control},
        }
    require_macos()
    raw = (key or "").strip().lower()
    using = []
    if command:
        using.append("command down")
    if shift:
        using.append("shift down")
    if option:
        using.append("option down")
    if control:
        using.append("control down")
    using_clause = f" using {{{', '.join(using)}}}" if using else ""
    if raw.isdigit():
        script = f'tell application "System Events" to key code {int(raw)}{using_clause}'
    elif raw in KEY_CODES:
        script = f'tell application "System Events" to key code {KEY_CODES[raw]}{using_clause}'
    elif len(raw) == 1:
        script = f'tell application "System Events" to keystroke "{escape_applescript(raw)}"{using_clause}'
    else:
        return {"ok": False, "error": f"Unsupported key: {key}"}
    result = run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, **accessibility_hint(result.stderr)}
    return {"ok": True, "key": key, "modifiers": {"command": command, "shift": shift, "option": option, "control": control}}


def tool_result(data: dict) -> dict:
    return {
        "content": [{"type": "text", "text": json.dumps(data, ensure_ascii=False, indent=2)}],
        "structuredContent": data,
        "isError": not data.get("ok", True),
    }


def handle_call(name: str, arguments: dict) -> dict:
    if name == "accessibility_status":
        return tool_result(accessibility_status())
    if name == "list_apps":
        return tool_result(
            list_apps(
                running_only=bool(arguments.get("running_only")),
                limit=int(arguments.get("limit") or 80),
            )
        )
    if name == "open_app":
        return tool_result(
            open_app(
                str(arguments.get("app") or ""),
                wait_seconds=float(arguments.get("wait_seconds") or 1.0),
            )
        )
    if name == "focus_app":
        return tool_result(focus_app(str(arguments.get("app") or "")))
    if name == "get_app_state":
        return tool_result(
            get_app_state(
                str(arguments.get("app") or ""),
                max_elements=int(arguments.get("max_elements") or 25),
            )
        )
    if name == "desktop_click":
        return tool_result(
            desktop_click(
                float(arguments.get("x") or 0),
                float(arguments.get("y") or 0),
                str(arguments.get("button") or "left"),
            )
        )
    if name == "desktop_type":
        app = arguments.get("app")
        return tool_result(
            desktop_type(str(arguments.get("text") or ""), str(app) if app else None)
        )
    if name == "press_key":
        return tool_result(
            press_key(
                str(arguments.get("key") or ""),
                command=bool(arguments.get("command")),
                shift=bool(arguments.get("shift")),
                option=bool(arguments.get("option")),
                control=bool(arguments.get("control")),
            )
        )
    raise KeyError(name)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = message.get("method")
        request_id = message.get("id")
        if method == "initialize":
            send(
                request_id,
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "bob-work-computer-use", "version": "1.0.0"},
                },
            )
            continue
        if method == "notifications/initialized":
            continue
        if method == "tools/list":
            send(request_id, {"tools": TOOLS})
            continue
        if method == "tools/call":
            params = message.get("params") or {}
            name = params.get("name")
            arguments = params.get("arguments") or {}
            try:
                send(request_id, handle_call(str(name), arguments if isinstance(arguments, dict) else {}))
            except KeyError:
                send_error(request_id, f"Unknown tool: {name}")
            except Exception as error:  # noqa: BLE001
                send_error(request_id, str(error))
            continue
        if request_id is not None:
            send_error(request_id, f"Unsupported method: {method}")


if __name__ == "__main__":
    main()
