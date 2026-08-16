#!/usr/bin/env python3
"""Built-in Computer Use MCP for Bob Work (macOS).

Takes control of the local Mac through `open`, AppleScript and System Events.
AppleScript is preferably executed inside Bob Work (Unix bridge) so Accessibility
TCC attaches to Bob Work rather than python3/osascript.

Background-first (ChatGPT Work style): do not steal focus unless `bring_to_front`
or `activate` is explicitly true. Prefer Accessibility UI actions and scriptable
app commands that work while Bob Work stays frontmost.

Tools: list_apps, open_app, focus_app, get_app_state, ui_click, ui_set_value,
app_command, capture_screen, desktop_click, desktop_type, press_key,
accessibility_status.
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
        "description": (
            "Ouvre une application macOS sans la mettre au premier plan par défaut "
            "(open -g). Passe activate=true seulement si l’utilisateur demande explicitement "
            "de basculer vers l’app."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app": {"type": "string", "description": "Nom de l’app (Telegram) ou chemin .app"},
                "wait_seconds": {"type": "number"},
                "activate": {
                    "type": "boolean",
                    "description": "Si true, met l’app au premier plan. Défaut false.",
                },
            },
            "required": ["app"],
        },
    },
    {
        "name": "focus_app",
        "description": (
            "Met une application au premier plan. À n’utiliser qu’en dernier recours "
            "(saisie clavier globale, fenêtre masquée). Préférer ui_click / ui_set_value / "
            "app_command en arrière-plan."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {"app": {"type": "string"}},
            "required": ["app"],
        },
    },
    {
        "name": "get_app_state",
        "description": (
            "Lit l’état d’une app (fenêtre, frontmost, éléments UI Accessibilité) "
            "sans la mettre au premier plan."
        ),
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
        "name": "ui_click",
        "description": (
            "Clique un élément UI via Accessibilité (bouton, menu, etc.) sans mettre "
            "l’app au premier plan. Préférer cet outil à focus_app + desktop_click."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app": {"type": "string"},
                "label": {
                    "type": "string",
                    "description": "Nom / description / titre de l’élément (ex. Play, Search).",
                },
                "role": {
                    "type": "string",
                    "description": "Rôle AX optionnel : button, text field, menu item, checkbox, radio button, link, tab, row.",
                },
                "window": {
                    "type": "integer",
                    "description": "Index de fenêtre 1-based (défaut 1).",
                },
            },
            "required": ["app", "label"],
        },
    },
    {
        "name": "ui_set_value",
        "description": (
            "Écrit dans un champ texte via Accessibilité sans focus fenêtre. "
            "Préférer à desktop_type quand un champ est identifiable."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app": {"type": "string"},
                "value": {"type": "string"},
                "label": {"type": "string", "description": "Label du champ si connu."},
                "window": {"type": "integer"},
            },
            "required": ["app", "value"],
        },
    },
    {
        "name": "app_command",
        "description": (
            "Exécute des commandes AppleScript dans `tell application \"App\"` "
            "sans activate (ex. Music play). Pour le contrôle "
            "scriptable en arrière-plan. ATTENTION: Pour Spotify, n'inventez "
            "JAMAIS d'URI spotify:track. Utilisez plutôt open_url_scheme "
            "avec 'spotify:search:track:TITRE artist:ARTISTE', puis capture_screen et desktop_click."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "app": {"type": "string"},
                "commands": {
                    "type": "string",
                    "description": "Corps AppleScript à l’intérieur du tell application (sans activate).",
                },
            },
            "required": ["app", "commands"],
        },
    },
    {
        "name": "capture_screen",
        "description": (
            "Capture l’écran (ou la fenêtre cible si possible) pour observer visuellement "
            "sans forcer le focus. Maximum 3 captures par tâche."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "bring_to_front": {
                    "type": "boolean",
                    "description": "Si true, active l’app cible avant capture. Défaut false.",
                },
            },
        },
    },
    {
        "name": "desktop_click",
        "description": (
            "Clique aux coordonnées écran. N’active pas l’app par défaut. "
            "Préférer ui_click. bring_to_front=true seulement si nécessaire."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "x": {"type": "number"},
                "y": {"type": "number"},
                "button": {"type": "string", "enum": ["left", "right"]},
                "clicks": {"type": "integer", "minimum": 1, "maximum": 2},
                "bring_to_front": {"type": "boolean"},
            },
            "required": ["x", "y"],
        },
    },
    {
        "name": "desktop_type",
        "description": (
            "Tape du texte via événements clavier. Sur macOS la saisie globale va "
            "à l’app au premier plan : préférer ui_set_value. bring_to_front requis "
            "si tu dois vraiment taper au clavier."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "text": {"type": "string"},
                "app": {"type": "string"},
                "bring_to_front": {"type": "boolean"},
            },
            "required": ["text"],
        },
    },
    {
        "name": "press_key",
        "description": (
            "Envoie une touche. Comme desktop_type, cible l’app frontmost : "
            "préférer ui_click / app_command. bring_to_front seulement si nécessaire."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "key": {"type": "string"},
                "command": {"type": "boolean"},
                "shift": {"type": "boolean"},
                "option": {"type": "boolean"},
                "control": {"type": "boolean"},
                "bring_to_front": {"type": "boolean"},
            },
            "required": ["key"],
        },
    },
]

# One MCP process serves one Bob run. Keeping the target here lets every visual
# observation know which app Bob was asked to operate — without forcing focus.
ACTIVE_TARGET_APP: str | None = None
CAPTURE_COUNT = 0
MAX_VISUAL_CAPTURES = 3


def e2e_mode() -> bool:
    if os.environ.get("BOB_COMPUTER_USE_E2E", "").strip().lower() in {"1", "true", "e2e"}:
        return True
    marker = os.environ.get("BOB_COMPUTER_USE", "").strip().lower()
    return marker.startswith("e2e")


def require_macos() -> None:
    if sys.platform != "darwin":
        raise RuntimeError("Computer Use MCP requires macOS")


BRIDGE_REQUIRED_ERROR = (
    "Le pont de contrôle natif de Bob Work est indisponible. Relancez l’app Bob Work, "
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
    return _run_via_bob_work(socket_path, {"script": script})


def _run_native_via_bob_work(action: str, **parameters) -> subprocess.CompletedProcess[str]:
    socket_path = (
        os.environ.get("BOB_WORK_APPLESCRIPT_SOCKET", "").strip()
        or str(Path.home() / ".bob" / "run" / "applescript.sock")
    )
    if not Path(socket_path).exists():
        return subprocess.CompletedProcess(
            args=["bob-work-native-input", socket_path],
            returncode=1,
            stdout="",
            stderr=BRIDGE_REQUIRED_ERROR,
        )
    try:
        return _run_via_bob_work(socket_path, {"action": action, **parameters})
    except Exception as error:  # noqa: BLE001
        return subprocess.CompletedProcess(
            args=["bob-work-native-input", socket_path],
            returncode=1,
            stdout="",
            stderr=f"{BRIDGE_REQUIRED_ERROR} ({error})",
        )


def _run_via_bob_work(socket_path: str, request: dict) -> subprocess.CompletedProcess[str]:
    import socket
    import time

    payload = (json.dumps(request, ensure_ascii=False) + "\n").encode("utf-8")
    chunks: list[bytes] = []
    for attempt in range(20):
        try:
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.settimeout(30)
                client.connect(socket_path)
                client.sendall(payload)
                while True:
                    chunk = client.recv(65536)
                    if not chunk:
                        break
                    chunks.append(chunk)
                    if b"\n" in chunk:
                        break
            break
        except (ConnectionRefusedError, FileNotFoundError):
            if attempt == 19:
                raise
            time.sleep(0.1)
    raw = b"".join(chunks).decode("utf-8", errors="replace").strip()
    data = json.loads(raw) if raw else {"ok": False, "stdout": "", "stderr": "empty bridge response"}
    ok = bool(data.get("ok"))
    stdout = str(data.get("stdout") or "")
    stderr = str(data.get("stderr") or "")
    return subprocess.CompletedProcess(
        args=["bob-work-bridge", socket_path],
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
    result = _run_native_via_bob_work("status")
    if result.returncode != 0:
        return {"ok": False, "accessibility": "denied", **accessibility_hint(result.stderr)}
    return {
        "ok": True,
        "accessibility": "granted",
        "controller": "Bob Work native input",
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
    result = subprocess.run(["ps", "-axo", "command="], capture_output=True, text=True, check=False)
    names = []
    for line in result.stdout.splitlines():
        marker = ".app/Contents/MacOS/"
        if marker not in line:
            continue
        name = Path(line.split(marker, 1)[0]).name.removesuffix(".app")
        if name and name not in names:
            names.append(name)
    out = []
    for name in names[:limit]:
        out.append({"name": name, "running": True})
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


def open_app(app: str, wait_seconds: float = 1.0, activate: bool = False) -> dict:
    global ACTIVE_TARGET_APP
    if e2e_mode():
        name = normalize_app_name(app)
        return {
            "ok": True,
            "mode": "e2e",
            "opened": name,
            "path": f"/Applications/{name}.app",
            "activated": bool(activate),
            "frontmost": bool(activate),
        }
    require_macos()
    name = normalize_app_name(app)
    path = resolve_app_path(name)
    # -g: do not bring the application to the foreground
    open_cmd = ["open", "-g"]
    if path:
        open_cmd.append(path)
    else:
        open_cmd.extend(["-a", name])
    completed = subprocess.run(open_cmd, capture_output=True, text=True, check=False)
    if completed.returncode != 0:
        return {
            "ok": False,
            "app": name,
            "error": (completed.stderr or completed.stdout or "open failed").strip(),
            "hint": f"Vérifiez que « {name} » est installé (ex. /Applications/Telegram.app).",
        }
    if wait_seconds and wait_seconds > 0:
        import time

        time.sleep(min(float(wait_seconds), 5.0))
    ACTIVE_TARGET_APP = name
    if activate:
        focused = focus_app(name, launch_if_needed=False)
        return {
            "ok": True,
            "app": name,
            "path": path,
            "activated": True,
            "frontmost": focused.get("frontmost", False),
            "frontmost_app": focused.get("frontmost_app"),
        }
    return {
        "ok": True,
        "app": name,
        "path": path,
        "activated": False,
        "frontmost": False,
        "background": True,
        "hint": "App ouverte en arrière-plan. Utilise ui_click / ui_set_value / app_command sans focus_app.",
    }


def focus_app(app: str, launch_if_needed: bool = True) -> dict:
    global ACTIVE_TARGET_APP
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "focused": normalize_app_name(app)}
    require_macos()
    name = normalize_app_name(app)
    if launch_if_needed:
        result = subprocess.run(["open", "-a", name], capture_output=True, text=True, check=False)
        if result.returncode != 0:
            return {"ok": False, "app": name, "error": (result.stderr or result.stdout).strip()}
    escaped = escape_applescript(name)
    script = f'''tell application "System Events"
set targetProcess to first process whose name is "{escaped}"
set frontmost of targetProcess to true
delay 0.2
set frontName to name of first process whose frontmost is true
return frontName
end tell'''
    activated = run_osascript(script)
    if activated.returncode != 0:
        return {"ok": False, "app": name, **accessibility_hint(activated.stderr)}
    frontmost_app = activated.stdout.strip()
    ACTIVE_TARGET_APP = name
    return {
        "ok": True,
        "app": name,
        "focused": frontmost_app.lower() == name.lower(),
        "frontmost": frontmost_app.lower() == name.lower(),
        "frontmost_app": frontmost_app,
    }


def _maybe_bring_to_front(bring_to_front: bool) -> dict | None:
    if not bring_to_front or not ACTIVE_TARGET_APP:
        return None
    focused = focus_app(ACTIVE_TARGET_APP, launch_if_needed=False)
    if not focused.get("ok") or not focused.get("frontmost"):
        return {
            "ok": False,
            "error": f"Impossible de mettre {ACTIVE_TARGET_APP} au premier plan.",
            **focused,
        }
    return None


def get_app_state(app: str, max_elements: int = 25) -> dict:
    global ACTIVE_TARGET_APP
    if e2e_mode():
        name = normalize_app_name(app)
        return {
            "ok": True,
            "mode": "e2e",
            "app": name,
            "window": f"{name} — Main",
            "frontmost": False,
            "elements": [
                {"role": "button", "label": "New Message"},
                {"role": "text field", "label": "Search"},
            ],
        }
    name = normalize_app_name(app)
    ACTIVE_TARGET_APP = name
    escaped = escape_applescript(name)
    limit = max(1, min(int(max_elements or 25), 80))
    # Do not set frontmost — read AX tree in the background.
    state = run_osascript(f'''tell application "System Events"
set targetProcess to first process whose name is "{escaped}"
set isFrontmost to frontmost of targetProcess
set windowTitle to ""
try
  if (count of windows of targetProcess) > 0 then
    set windowTitle to name of window 1 of targetProcess
  end if
end try
set elementLines to {{}}
try
  tell window 1 of targetProcess
    set candidates to {{}}
    try
      set candidates to candidates & (every button)
    end try
    try
      set candidates to candidates & (every text field)
    end try
    try
      set candidates to candidates & (every checkbox)
    end try
    try
      set candidates to candidates & (every radio button)
    end try
    try
      set candidates to candidates & (every static text)
    end try
    try
      set candidates to candidates & (every UI element whose role is "AXLink" or role is "AXMenuItem" or role is "AXTab" or role is "AXRow")
    end try
    set collected to 0
    repeat with el in candidates
      if collected >= {limit} then exit repeat
      set roleName to ""
      set labelName to ""
      try
        set roleName to role of el as string
      end try
      try
        set labelName to name of el as string
      end try
      if labelName is "" then
        try
          set labelName to description of el as string
        end try
      end if
      if labelName is "" then
        try
          set labelName to title of el as string
        end try
      end if
      if labelName is not "" then
        set end of elementLines to roleName & tab & labelName
        set collected to collected + 1
      end if
    end repeat
  end tell
end try
set AppleScript's text item delimiters to linefeed
set elementsText to elementLines as string
set AppleScript's text item delimiters to ""
return (isFrontmost as string) & linefeed & windowTitle & linefeed & elementsText
end tell''')
    if state.returncode != 0:
        return {"ok": False, "app": name, **accessibility_hint(state.stderr)}
    lines = state.stdout.splitlines()
    is_frontmost = bool(lines) and lines[0].strip().lower() == "true"
    window = lines[1].strip() if len(lines) > 1 else ""
    elements = []
    for line in lines[2:]:
        if "\t" in line:
            role, label = line.split("\t", 1)
        else:
            role, label = "", line
        role = role.strip()
        label = label.strip()
        if not label:
            continue
        elements.append({"role": role or "unknown", "label": label})
    return {
        "ok": True,
        "app": name,
        "frontmost": is_frontmost,
        "window": window,
        "elements": elements,
        "background_control": True,
        "hint": (
            "Contrôle en arrière-plan : utilise ui_click / ui_set_value / app_command. "
            "N’appelle focus_app que si l’élément est inaccessible ou si la saisie clavier "
            "globale est indispensable. capture_screen sans bring_to_front si l’arbre est pauvre."
        ),
    }


def _role_query(role: str | None) -> str:
    if not role:
        return ""
    mapping = {
        "button": "button",
        "text field": "text field",
        "textfield": "text field",
        "checkbox": "checkbox",
        "radio button": "radio button",
        "menu item": "menu item",
        "menuitem": "menu item",
        "link": "UI element whose role is \"AXLink\"",
        "tab": "UI element whose role is \"AXTab\"",
        "row": "UI element whose role is \"AXRow\"",
        "static text": "static text",
    }
    key = role.strip().lower()
    return mapping.get(key, "UI element")


def ui_click(app: str, label: str, role: str | None = None, window: int = 1) -> dict:
    global ACTIVE_TARGET_APP
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "clicked": label, "app": normalize_app_name(app)}
    require_macos()
    name = normalize_app_name(app)
    ACTIVE_TARGET_APP = name
    escaped_app = escape_applescript(name)
    escaped_label = escape_applescript(label)
    win = max(1, int(window or 1))
    role_ref = _role_query(role)
    if role_ref and "whose role" not in role_ref:
        target = f'first {role_ref} whose name is "{escaped_label}" or description is "{escaped_label}" or title is "{escaped_label}"'
    elif role_ref:
        target = f'first {role_ref} whose name is "{escaped_label}" or description is "{escaped_label}" or title is "{escaped_label}"'
    else:
        target = (
            f'first UI element whose (name is "{escaped_label}" or description is "{escaped_label}" '
            f'or title is "{escaped_label}")'
        )
    script = f'''tell application "System Events"
tell process "{escaped_app}"
  tell window {win}
    set targetElement to {target}
    click targetElement
  end tell
end tell
end tell
return "clicked"'''
    result = run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, "app": name, "label": label, **accessibility_hint(result.stderr)}
    return {
        "ok": True,
        "app": name,
        "clicked": label,
        "role": role,
        "frontmost_changed": False,
        "background": True,
    }


def ui_set_value(app: str, value: str, label: str | None = None, window: int = 1) -> dict:
    global ACTIVE_TARGET_APP
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "app": normalize_app_name(app), "value": value}
    require_macos()
    name = normalize_app_name(app)
    ACTIVE_TARGET_APP = name
    escaped_app = escape_applescript(name)
    escaped_value = escape_applescript(value)
    win = max(1, int(window or 1))
    if label:
        escaped_label = escape_applescript(label)
        target = (
            f'first text field whose name is "{escaped_label}" or description is "{escaped_label}" '
            f'or title is "{escaped_label}"'
        )
    else:
        target = "text field 1"
    script = f'''tell application "System Events"
tell process "{escaped_app}"
  tell window {win}
    set targetField to {target}
    set value of targetField to "{escaped_value}"
  end tell
end tell
end tell
return "set"'''
    result = run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, "app": name, **accessibility_hint(result.stderr)}
    return {
        "ok": True,
        "app": name,
        "value_length": len(value),
        "label": label,
        "frontmost_changed": False,
        "background": True,
    }


def app_command(app: str, commands: str) -> dict:
    """Run AppleScript inside tell application without activate."""
    global ACTIVE_TARGET_APP
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "app": normalize_app_name(app), "commands": commands}
    require_macos()
    name = normalize_app_name(app)
    ACTIVE_TARGET_APP = name
    body = (commands or "").strip()
    if not body:
        return {"ok": False, "error": "commands is empty"}
    lowered = body.lower()
    # Keep the script inside the target app — block nested System Events / shell escapes.
    for banned in ("do shell script", "system events", "tell application \"finder\"", "activate"):
        if banned in lowered:
            return {
                "ok": False,
                "error": f"Commande interdite dans app_command : « {banned} ». Utilise ui_* ou focus_app.",
            }
    escaped_app = escape_applescript(name)
    script = f'tell application "{escaped_app}"\n{body}\nend tell'
    result = run_osascript(script)
    if result.returncode != 0:
        return {"ok": False, "app": name, **accessibility_hint(result.stderr)}
    return {
        "ok": True,
        "app": name,
        "stdout": result.stdout.strip(),
        "frontmost_changed": False,
        "background": True,
    }


def _window_id_for_app(app: str) -> str | None:
    escaped = escape_applescript(normalize_app_name(app))
    result = run_osascript(f'''tell application "System Events"
tell process "{escaped}"
  if (count of windows) is 0 then return ""
  try
    return value of attribute "AXWindowNumber" of window 1 as string
  end try
  return ""
end tell
end tell''')
    if result.returncode != 0:
        return None
    value = result.stdout.strip()
    return value if value.isdigit() else None


def capture_screen(bring_to_front: bool = False) -> dict:
    """Return a visual observation without forcing focus by default."""
    global CAPTURE_COUNT
    import base64
    import tempfile

    if e2e_mode():
        return {
            "content": [{"type": "text", "text": json.dumps({"ok": True, "mode": "e2e"})}],
            "structuredContent": {"ok": True, "mode": "e2e"},
            "isError": False,
        }
    require_macos()
    CAPTURE_COUNT += 1
    if CAPTURE_COUNT > MAX_VISUAL_CAPTURES:
        return tool_result({
            "ok": False,
            "capture_limit_reached": True,
            "error": "Limite de 3 captures atteinte pour cette tâche.",
            "hint": (
                "N’ajoutez plus d’images. Utilisez les observations déjà reçues, les actions "
                "clavier ciblées ou demandez une vérification à l’utilisateur."
            ),
        })
    focus_error = _maybe_bring_to_front(bool(bring_to_front))
    if focus_error:
        return tool_result(focus_error)
    executable = shutil.which("screencapture") or "/usr/sbin/screencapture"
    with tempfile.TemporaryDirectory(prefix="bob-work-screen-") as folder:
        path = str(Path(folder) / "screen.png")
        cmd = [executable, "-x", "-t", "png"]
        window_id = _window_id_for_app(ACTIVE_TARGET_APP) if ACTIVE_TARGET_APP else None
        if window_id:
            cmd.extend(["-l", window_id])
        cmd.append(path)
        completed = subprocess.run(cmd, capture_output=True, text=True, check=False)
        if (completed.returncode != 0 or not Path(path).is_file()) and window_id:
            # Fallback to full display if window capture failed.
            completed = subprocess.run(
                [executable, "-x", "-t", "png", path],
                capture_output=True,
                text=True,
                check=False,
            )
            window_id = None
        if completed.returncode != 0 or not Path(path).is_file():
            message = (completed.stderr or completed.stdout or "screen capture failed").strip()
            data = {
                "ok": False,
                "screen_recording_required": True,
                "error": message,
                "hint": (
                    "Autorisez Bob Work dans Réglages Système → Confidentialité et sécurité → "
                    "Enregistrement de l’écran, puis relancez l’application."
                ),
            }
            return tool_result(data)
        sips = shutil.which("sips") or "/usr/bin/sips"
        jpeg_path = str(Path(folder) / "screen.jpg")
        converted = subprocess.run(
            [sips, "-Z", "1200", "-s", "format", "jpeg", "-s", "formatOptions", "55", path, "--out", jpeg_path],
            capture_output=True,
            check=False,
        )
        image_path = Path(jpeg_path) if converted.returncode == 0 and Path(jpeg_path).is_file() else Path(path)
        encoded = base64.b64encode(image_path.read_bytes()).decode("ascii")
        mime_type = "image/jpeg" if image_path.suffix == ".jpg" else "image/png"
    data = {
        "ok": True,
        "observation": "window" if window_id else "screen",
        "target_app": ACTIVE_TARGET_APP,
        "capture": CAPTURE_COUNT,
        "remaining_captures": MAX_VISUAL_CAPTURES - CAPTURE_COUNT,
        "frontmost_changed": bool(bring_to_front),
        "instruction": (
            "Inspect without stealing focus when possible. Prefer ui_click / ui_set_value / "
            "app_command, then verify."
        ),
    }
    return {
        "content": [
            {"type": "image", "data": encoded, "mimeType": mime_type},
            {"type": "text", "text": json.dumps(data, ensure_ascii=False)},
        ],
        "structuredContent": data,
        "isError": False,
    }


def desktop_click(
    x: float,
    y: float,
    button: str = "left",
    clicks: int = 1,
    bring_to_front: bool = False,
) -> dict:
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "clicked": True, "x": x, "y": y, "button": button, "clicks": clicks}
    require_macos()
    focus_error = _maybe_bring_to_front(bool(bring_to_front))
    if focus_error:
        return focus_error
    count = max(1, min(int(clicks or 1), 2))
    result = _run_native_via_bob_work(
        "click", x=float(x), y=float(y), button=button, clicks=count
    )
    if result.returncode != 0:
        return {"ok": False, "x": x, "y": y, **accessibility_hint(result.stderr)}
    return {
        "ok": True,
        "clicked": True,
        "x": int(x),
        "y": int(y),
        "button": button,
        "clicks": count,
        "frontmost_changed": bool(bring_to_front),
    }


def desktop_type(text: str, app: str | None = None, bring_to_front: bool = False) -> dict:
    global ACTIVE_TARGET_APP
    if e2e_mode():
        return {"ok": True, "mode": "e2e", "typed": text, "app": app}
    require_macos()
    target = app or ACTIVE_TARGET_APP
    if target:
        ACTIVE_TARGET_APP = normalize_app_name(target)
    if bring_to_front and ACTIVE_TARGET_APP:
        focus = focus_app(ACTIVE_TARGET_APP, launch_if_needed=bool(app))
        if not focus.get("ok"):
            return focus
        if not focus.get("frontmost"):
            return {"ok": False, "error": "L’application cible n’est pas au premier plan.", **focus}
    elif not bring_to_front:
        return {
            "ok": False,
            "error": (
                "desktop_type envoie les frappes à l’app au premier plan. "
                "Préfère ui_set_value, ou passe bring_to_front=true en dernier recours."
            ),
            "hint": "Utilise ui_set_value pour écrire sans voler le focus.",
        }
    result = _run_native_via_bob_work("type", text=text)
    if result.returncode != 0:
        return {"ok": False, **accessibility_hint(result.stderr)}
    return {"ok": True, "typed": text, "length": len(text), "frontmost_changed": bool(bring_to_front)}


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
    bring_to_front: bool = False,
) -> dict:
    if e2e_mode():
        return {
            "ok": True,
            "mode": "e2e",
            "key": key,
            "modifiers": {"command": command, "shift": shift, "option": option, "control": control},
        }
    require_macos()
    if bring_to_front and ACTIVE_TARGET_APP:
        focused = focus_app(ACTIVE_TARGET_APP, launch_if_needed=False)
        if not focused.get("frontmost"):
            return {"ok": False, "error": "L’application cible n’est pas au premier plan.", **focused}
    elif not bring_to_front and ACTIVE_TARGET_APP:
        return {
            "ok": False,
            "error": (
                "press_key cible l’app au premier plan. Préfère ui_click / app_command, "
                "ou passe bring_to_front=true en dernier recours."
            ),
        }
    raw = (key or "").strip().lower()
    if raw.isdigit():
        key_code = int(raw)
    elif raw in KEY_CODES:
        key_code = KEY_CODES[raw]
    elif len(raw) == 1:
        ansi = {"a": 0, "s": 1, "d": 2, "f": 3, "h": 4, "g": 5, "z": 6, "x": 7,
                "c": 8, "v": 9, "b": 11, "q": 12, "w": 13, "e": 14, "r": 15,
                "y": 16, "t": 17, "k": 40, "l": 37, "m": 46, "n": 45, "p": 35,
                "o": 31, "u": 32, "i": 34, "j": 38}
        key_code = ansi.get(raw)
        if key_code is None:
            return {"ok": False, "error": f"Unsupported key: {key}"}
    else:
        return {"ok": False, "error": f"Unsupported key: {key}"}
    result = _run_native_via_bob_work(
        "key",
        key_code=key_code,
        command=command,
        shift=shift,
        option=option,
        control=control,
    )
    if result.returncode != 0:
        return {"ok": False, **accessibility_hint(result.stderr)}
    return {
        "ok": True,
        "key": key,
        "modifiers": {"command": command, "shift": shift, "option": option, "control": control},
        "frontmost_changed": bool(bring_to_front),
    }


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
                activate=bool(arguments.get("activate")),
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
    if name == "ui_click":
        role = arguments.get("role")
        return tool_result(
            ui_click(
                str(arguments.get("app") or ""),
                str(arguments.get("label") or ""),
                str(role) if role else None,
                window=int(arguments.get("window") or 1),
            )
        )
    if name == "ui_set_value":
        label = arguments.get("label")
        return tool_result(
            ui_set_value(
                str(arguments.get("app") or ""),
                str(arguments.get("value") or ""),
                str(label) if label else None,
                window=int(arguments.get("window") or 1),
            )
        )
    if name == "app_command":
        return tool_result(
            app_command(
                str(arguments.get("app") or ""),
                str(arguments.get("commands") or ""),
            )
        )
    if name == "capture_screen":
        return capture_screen(bring_to_front=bool(arguments.get("bring_to_front")))
    if name == "desktop_click":
        return tool_result(
            desktop_click(
                float(arguments.get("x") or 0),
                float(arguments.get("y") or 0),
                str(arguments.get("button") or "left"),
                int(arguments.get("clicks") or 1),
                bring_to_front=bool(arguments.get("bring_to_front")),
            )
        )
    if name == "desktop_type":
        app = arguments.get("app")
        return tool_result(
            desktop_type(
                str(arguments.get("text") or ""),
                str(app) if app else None,
                bring_to_front=bool(arguments.get("bring_to_front")),
            )
        )
    if name == "press_key":
        return tool_result(
            press_key(
                str(arguments.get("key") or ""),
                command=bool(arguments.get("command")),
                shift=bool(arguments.get("shift")),
                option=bool(arguments.get("option")),
                control=bool(arguments.get("control")),
                bring_to_front=bool(arguments.get("bring_to_front")),
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
