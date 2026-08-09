#!/usr/bin/env python3
"""Minimal MCP stdio server used by Bob Work E2E tests."""

from __future__ import annotations

import json
import sys


def send(request_id, result):
    payload = {"jsonrpc": "2.0", "id": request_id, "result": result}
    print(json.dumps(payload, ensure_ascii=False), flush=True)


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
                    "serverInfo": {"name": "mcp-e2e-echo", "version": "1.0.0"},
                },
            )
        elif method == "tools/list":
            send(
                request_id,
                {
                    "tools": [
                        {
                            "name": "echo_text",
                            "description": "Renvoie le texte reçu pour valider le serveur MCP E2E.",
                            "inputSchema": {
                                "type": "object",
                                "properties": {"text": {"type": "string"}},
                                "required": ["text"],
                            },
                        }
                    ]
                },
            )
        elif method == "tools/call" and request.get("params", {}).get("name") == "echo_text":
            text = request.get("params", {}).get("arguments", {}).get("text", "")
            send(
                request_id,
                {
                    "content": [{"type": "text", "text": f"echo:{text}"}],
                    "structuredContent": {"echo": text},
                    "isError": False,
                },
            )
        else:
            print(
                json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": request_id,
                        "error": {"code": -32601, "message": "Method not found"},
                    },
                    ensure_ascii=False,
                ),
                flush=True,
            )


if __name__ == "__main__":
    main()
