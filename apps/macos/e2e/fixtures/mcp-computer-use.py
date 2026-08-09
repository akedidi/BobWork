#!/usr/bin/env python3
"""MCP fixture simulating desktop computer-use and browser-control tools."""

from __future__ import annotations

import json
import sys


def send(request_id, result):
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=False), flush=True)


def send_error(request_id, message: str):
    print(
        json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": -32601, "message": message}},
            ensure_ascii=False,
        ),
        flush=True,
    )


TOOLS = [
    {
        "name": "list_apps",
        "description": "Liste les applications ouvertes disponibles pour le contrôle bureau.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "get_app_state",
        "description": "Retourne l'état d'accessibilité simulé d'une application.",
        "inputSchema": {
            "type": "object",
            "properties": {"app": {"type": "string"}},
            "required": ["app"],
        },
    },
    {
        "name": "browser_snapshot",
        "description": "Capture un aperçu simulé de la page active du navigateur.",
        "inputSchema": {
            "type": "object",
            "properties": {"url": {"type": "string"}},
        },
    },
    {
        "name": "browser_click",
        "description": "Simule un clic dans le navigateur contrôlé.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "selector": {"type": "string"},
                "x": {"type": "number"},
                "y": {"type": "number"},
            },
        },
    },
    {
        "name": "desktop_click",
        "description": "Simule un clic sur l'interface bureau.",
        "inputSchema": {
            "type": "object",
            "properties": {"x": {"type": "number"}, "y": {"type": "number"}},
            "required": ["x", "y"],
        },
    },
]


def handle_call(name: str, arguments: dict) -> dict:
    if name == "list_apps":
        payload = {
            "apps": [
                {"name": "Bob Work", "focused": True},
                {"name": "Google Chrome", "focused": False},
                {"name": "Finder", "focused": False},
            ]
        }
    elif name == "get_app_state":
        app = arguments.get("app", "Bob Work")
        payload = {
            "app": app,
            "focused": app == "Bob Work",
            "elements": [
                {"role": "button", "label": "Envoyer le prompt"},
                {"role": "textbox", "label": "Sur quoi travailler ?"},
            ],
        }
    elif name == "browser_snapshot":
        browser = arguments.get("browser", "web")
        url = arguments.get("url") or "https://example.com"
        title = "Example Domain"
        if browser == "chrome":
            title = "Google Chrome — Example Domain"
        payload = {
            "browser": browser,
            "url": url,
            "title": title,
            "text": f"{title}\nThis domain is for use in illustrative examples.",
        }
    elif name == "browser_click":
        payload = {
            "clicked": True,
            "selector": arguments.get("selector"),
            "x": arguments.get("x"),
            "y": arguments.get("y"),
        }
    elif name == "desktop_click":
        payload = {
            "clicked": True,
            "x": arguments.get("x"),
            "y": arguments.get("y"),
        }
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
                "serverInfo": {"name": "mcp-computer-use-e2e", "version": "1.0.0"},
            },
        )
    elif method == "tools/list":
        send(request_id, {"tools": TOOLS})
    elif method == "tools/call":
        tool_name = params.get("name")
        arguments = params.get("arguments") or {}
        try:
            send(request_id, handle_call(tool_name, arguments))
        except KeyError:
            send_error(request_id, f"Unknown tool: {tool_name}")
    elif method == "notifications/initialized":
        continue
    elif request_id is not None:
        send_error(request_id, f"Unsupported method: {method}")
