#!/usr/bin/env python3
"""Shared stdio MCP helpers for Bob Work integration connectors."""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable


def send(request_id: Any, result: dict) -> None:
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=False), flush=True)


def send_error(request_id: Any, message: str, code: int = -32000) -> None:
    print(
        json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
            ensure_ascii=False,
        ),
        flush=True,
    )


def token_from_env(*names: str) -> str:
    for name in names:
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def e2e_mode(*env_names: str) -> bool:
    token = token_from_env(*env_names)
    return token.startswith("e2e-")


def http_json(
    method: str,
    url: str,
    token: str,
    body: dict | None = None,
    headers: dict[str, str] | None = None,
) -> Any:
    payload = None
    req_headers = {"Authorization": f"Bearer {token}", "Accept": "application/json"}
    if headers:
        req_headers.update(headers)
    if body is not None:
        payload = json.dumps(body).encode("utf-8")
        req_headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=payload, method=method, headers=req_headers)
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            raw = response.read().decode("utf-8")
            return json.loads(raw) if raw.strip() else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {error.code}: {detail[:500]}") from error


def tool_result(payload: Any) -> dict:
    return {
        "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
        "structuredContent": payload,
        "isError": False,
    }


def run_stdio_server(
    server_name: str,
    version: str,
    tools: list[dict],
    handle_call: Callable[[str, dict], dict],
) -> None:
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
                    "serverInfo": {"name": server_name, "version": version},
                },
            )
        elif method == "tools/list":
            send(request_id, {"tools": tools})
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
