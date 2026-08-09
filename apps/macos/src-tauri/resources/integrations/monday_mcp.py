#!/usr/bin/env python3
"""Monday.com connector MCP for Bob Work."""

from __future__ import annotations

from integration_mcp_base import e2e_mode, http_json, run_stdio_server, token_from_env, tool_result

TOOLS = [
    {
        "name": "monday_list_boards",
        "description": "List Monday.com boards accessible to the connected account.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
        },
    },
    {
        "name": "monday_search_items",
        "description": "Search items across Monday.com boards.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            "required": ["query"],
        },
    },
    {
        "name": "monday_create_update",
        "description": "Post an update on a Monday.com item.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "item_id": {"type": "string"},
                "body": {"type": "string"},
            },
            "required": ["item_id", "body"],
        },
    },
]


def monday_query(token: str, query: str, variables: dict | None = None) -> dict:
    return http_json(
        "POST",
        "https://api.monday.com/v2",
        token,
        body={"query": query, "variables": variables or {}},
        headers={"Authorization": token},
    )


def handle_call(name: str, arguments: dict) -> dict:
    token = token_from_env("MONDAY_API_TOKEN")
    if not token:
        raise RuntimeError("MONDAY_API_TOKEN is required")

    if e2e_mode("MONDAY_API_TOKEN"):
        if name == "monday_list_boards":
            return tool_result({"boards": [{"id": "1", "name": "E2E Roadmap"}], "mode": "e2e"})
        if name == "monday_search_items":
            return tool_result(
                {
                    "items": [{"id": "10", "name": "E2E task", "board": {"name": "Roadmap"}}],
                    "query": arguments.get("query", ""),
                    "mode": "e2e",
                }
            )
        if name == "monday_create_update":
            return tool_result({"id": "update-e2e", "item_id": arguments.get("item_id"), "mode": "e2e"})
        raise KeyError(name)

    if name == "monday_list_boards":
        limit = int(arguments.get("limit") or 25)
        data = monday_query(
            token,
            f"query {{ boards(limit: {limit}) {{ id name state }} }}",
        )
        boards = (data.get("data") or {}).get("boards", [])
        return tool_result({"boards": boards})

    if name == "monday_search_items":
        query = str(arguments.get("query", "")).strip()
        limit = int(arguments.get("limit") or 10)
        data = monday_query(
            token,
            "query ($term: String!, $limit: Int!) { items_page(limit: $limit, query_params: {term: $term}) { items { id name board { name } } } }",
            {"term": query, "limit": limit},
        )
        items = ((data.get("data") or {}).get("items_page") or {}).get("items", [])
        return tool_result({"items": items, "query": query})

    if name == "monday_create_update":
        item_id = str(arguments.get("item_id", "")).strip()
        body = str(arguments.get("body", "")).strip()
        data = monday_query(
            token,
            'mutation ($item_id: ID!, $body: String!) { create_update(item_id: $item_id, body: $body) { id } }',
            {"item_id": item_id, "body": body},
        )
        update = (data.get("data") or {}).get("create_update")
        return tool_result({"update": update, "item_id": item_id})

    raise KeyError(name)


if __name__ == "__main__":
    run_stdio_server("bob-work-monday", "1.0.0", TOOLS, handle_call)
