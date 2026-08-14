#!/usr/bin/env python3
"""MCP stdio server for the Brief Mission IBM Python plugin."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import ibm_pursuit  # noqa: E402

TOOLS = [
    {
        "name": "ibm_connector_status",
        "description": "État des connecteurs Brief Mission IBM (APIs ouvertes, NewsAPI optionnel, MCP local). Jamais Slack ni Microsoft.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "ibm_client_snapshot",
        "description": "Snapshot public d’un compte (faits Wikipedia/Wikidata/DuckDuckGo + actus RSS).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "company": {"type": "string"},
                "country": {"type": "string"},
                "sector": {"type": "string"},
            },
            "required": ["company"],
        },
    },
    {
        "name": "ibm_screen_plays",
        "description": "Classe 3–4 plays IBM informatifs (preuve publique, offre, risque, question d’atelier).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "objective": {"type": "string"},
                "sector": {"type": "string"},
                "constraints": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 4},
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
    text = ibm_pursuit.dumps(data)
    return {"content": [{"type": "text", "text": text}], "structuredContent": data, "isError": False}


def handle_call(name: str, arguments: dict) -> dict:
    if name == "ibm_connector_status":
        return tool_result(ibm_pursuit.connector_status())
    if name == "ibm_client_snapshot":
        return tool_result(
            ibm_pursuit.client_snapshot(
                company=str(arguments.get("company") or ""),
                country=str(arguments.get("country") or "France"),
                sector=str(arguments.get("sector") or "industrie"),
            )
        )
    if name == "ibm_screen_plays":
        return tool_result(
            ibm_pursuit.screen_plays(
                objective=str(arguments.get("objective") or ""),
                sector=str(arguments.get("sector") or "industrie"),
                constraints=str(arguments.get("constraints") or ""),
                limit=int(arguments.get("limit") or 4),
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
                    "serverInfo": {"name": "bob-work-ibm-pursuit", "version": "1.0.0"},
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
