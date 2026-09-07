#!/usr/bin/env python3
"""Multi-tool MCP fixture simulating common integration server patterns."""

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
        "name": "echo_text",
        "description": "Renvoie le texte reçu.",
        "inputSchema": {
            "type": "object",
            "properties": {"text": {"type": "string"}},
            "required": ["text"],
        },
    },
    {
        "name": "list_known_integrations",
        "description": "Liste les connecteurs simulés disponibles dans ce serveur MCP E2E.",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "mock_github_repos",
        "description": "Simule une liste de dépôts GitHub en lecture seule.",
        "inputSchema": {
            "type": "object",
            "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 10}},
        },
    },
    {
        "name": "mock_graph_mail",
        "description": "Simule une recherche Outlook/Graph.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}},
            "required": ["query"],
        },
    },
]


def handle_call(name: str, arguments: dict) -> dict:
    if name == "echo_text":
        text = arguments.get("text", "")
        return {
            "content": [{"type": "text", "text": f"hub-echo:{text}"}],
            "structuredContent": {"echo": text},
            "isError": False,
        }
    if name == "list_known_integrations":
        payload = {
            "integrations": ["github", "slack", "monday", "microsoft-graph"],
            "server": "mcp-e2e-hub",
        }
        return {
            "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
            "structuredContent": payload,
            "isError": False,
        }
    if name == "mock_github_repos":
        limit = int(arguments.get("limit") or 2)
        repos = [
            {"name": "bob-work/demo", "visibility": "private"},
            {"name": "bob-work/plugins", "visibility": "private"},
            {"name": "bob-work/docs", "visibility": "public"},
        ][:limit]
        return {
            "content": [{"type": "text", "text": json.dumps(repos, ensure_ascii=False)}],
            "structuredContent": {"repos": repos},
            "isError": False,
        }
    if name == "mock_graph_mail":
        query = arguments.get("query", "")
        messages = [
            {"subject": f"Résultat pour {query}", "from": "e2e@contoso.com", "id": "mail-1"},
        ]
        return {
            "content": [{"type": "text", "text": json.dumps(messages, ensure_ascii=False)}],
            "structuredContent": {"messages": messages},
            "isError": False,
        }
    raise KeyError(name)


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        request = json.loads(line)
        request_id = request.get("id")
        method = request.get("method")
        if request_id is None:
            continue
        if method == "initialize":
            send(
                request_id,
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "mcp-e2e-hub", "version": "1.0.0"},
                },
            )
        elif method == "tools/list":
            send(request_id, {"tools": TOOLS})
        elif method == "tools/call":
            params = request.get("params", {})
            tool_name = params.get("name")
            try:
                result = handle_call(tool_name, params.get("arguments") or {})
                send(request_id, result)
            except KeyError:
                send_error(request_id, f"Unknown tool: {tool_name}")
        else:
            send_error(request_id, "Method not found")


if __name__ == "__main__":
    main()
