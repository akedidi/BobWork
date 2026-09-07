#!/usr/bin/env python3
"""MCP stdio server for the CTO Investissements Python plugin."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import cto_market  # noqa: E402

TOOLS = [
    {
        "name": "cto_connector_status",
        "description": "État des connecteurs CTO (Stooq, Finnhub optionnel, MCP local, MCP distant optionnel).",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "cto_market_snapshot",
        "description": "Snapshot de cotations pour une watchlist CTO (Compte-Titres).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "symbols": {"type": "array", "items": {"type": "string"}},
                "limit": {"type": "integer", "minimum": 1, "maximum": 30},
            },
        },
    },
    {
        "name": "cto_screen_ideas",
        "description": "Classe des idées d’actions pour un CTO (informatif uniquement).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "horizon": {"type": "string", "enum": ["court", "moyen", "long"]},
                "region": {"type": "string", "enum": ["EU", "US", "ALL"]},
                "limit": {"type": "integer", "minimum": 1, "maximum": 12},
            },
        },
    },
]


def send(request_id, result: dict) -> None:
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=False), flush=True)


def send_error(request_id, message: str, code: int = -32000) -> None:
    print(
        json.dumps({"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}}, ensure_ascii=False),
        flush=True,
    )


def tool_result(data: dict) -> dict:
    text = cto_market.dumps(data)
    return {"content": [{"type": "text", "text": text}], "structuredContent": data, "isError": False}


def handle_call(name: str, arguments: dict) -> dict:
    if name == "cto_connector_status":
        return tool_result(cto_market.connector_status())
    if name == "cto_market_snapshot":
        symbols = arguments.get("symbols") if isinstance(arguments.get("symbols"), list) else None
        symbol_list = [str(item) for item in (symbols or [])] or None
        return tool_result(cto_market.market_snapshot(symbols=symbol_list, limit=int(arguments.get("limit") or 12)))
    if name == "cto_screen_ideas":
        return tool_result(
            cto_market.screen_ideas(
                horizon=str(arguments.get("horizon") or "moyen"),
                region=str(arguments.get("region") or "ALL"),
                limit=int(arguments.get("limit") or 5),
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
                    "serverInfo": {"name": "bob-work-cto-invest", "version": "1.2.0"},
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
