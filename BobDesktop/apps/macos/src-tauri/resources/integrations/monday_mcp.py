#!/usr/bin/env python3
"""Monday.com connector MCP for Bob Work."""

from __future__ import annotations

import json

from integration_mcp_base import e2e_mode, http_json, run_stdio_server, token_from_env, tool_result

TOOLS = [
    {
        "name": "monday_list_boards",
        "description": (
            "List Monday.com boards accessible to the connected account. "
            "On large enterprise accounts, unscoped board listing can hang — "
            "prefer workspace_id when known."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
                "workspace_id": {
                    "type": "string",
                    "description": (
                        "Optional Monday workspace id. Use \"main\" for the Main "
                        "workspace. When omitted, boards are loaded from Main plus "
                        "open workspaces."
                    ),
                },
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
        headers={
            # Monday personal tokens are sent raw (not Bearer).
            "Authorization": token,
            "API-Version": "2024-10",
        },
        timeout=20,
    )


def _require_data(data: dict) -> dict:
    if data.get("errors"):
        raise RuntimeError(
            f"Monday GraphQL error: {json.dumps(data.get('errors'), ensure_ascii=False)[:500]}"
        )
    return data.get("data") or {}


def _boards_for_workspace_ids(token: str, workspace_ids: list, limit: int) -> list:
    """Fetch boards for specific workspaces.

    Important: unscoped `boards(limit: N)` can hang on large Monday accounts
    (e.g. enterprise). Always scope with workspace_ids. The Main workspace is
    represented as GraphQL null.
    """
    if not workspace_ids:
        return []
    data = monday_query(
        token,
        """
        query ($ids: [ID], $limit: Int!) {
          boards(limit: $limit, workspace_ids: $ids) {
            id
            name
            state
            workspace_id
          }
        }
        """,
        {"ids": workspace_ids, "limit": limit},
    )
    return list(_require_data(data).get("boards") or [])


def list_monday_boards(token: str, limit: int, workspace_id: str | None = None) -> list:
    limit = min(max(int(limit), 1), 50)
    if workspace_id:
        normalized = workspace_id.strip().lower()
        ids: list = [None] if normalized in {"main", "null", "default"} else [workspace_id.strip()]
        return _boards_for_workspace_ids(token, ids, limit)

    boards: list = []
    seen: set[str] = set()

    # Main workspace first — reliable and fast even on huge accounts.
    for board in _boards_for_workspace_ids(token, [None], limit):
        board_id = str(board.get("id") or "")
        if board_id and board_id not in seen:
            seen.add(board_id)
            boards.append(board)
        if len(boards) >= limit:
            return boards[:limit]

    # Then open workspaces (closed enterprise workspaces are often empty via API).
    workspaces = _require_data(
        monday_query(
            token,
            "query ($limit: Int!) { workspaces(limit: $limit, kind: open) { id name kind } }",
            {"limit": 20},
        )
    ).get("workspaces") or []
    for workspace in workspaces:
        remaining = limit - len(boards)
        if remaining <= 0:
            break
        ws_id = workspace.get("id")
        if not ws_id:
            continue
        for board in _boards_for_workspace_ids(token, [ws_id], remaining):
            board_id = str(board.get("id") or "")
            if board_id and board_id not in seen:
                seen.add(board_id)
                enriched = dict(board)
                enriched.setdefault("workspace", workspace.get("name"))
                boards.append(enriched)
            if len(boards) >= limit:
                return boards[:limit]
    return boards[:limit]


def handle_call(name: str, arguments: dict) -> dict:
    token = token_from_env("MONDAY_API_TOKEN")
    if not token:
        raise RuntimeError(
            "MONDAY_API_TOKEN is missing in the MCP process. "
            "Reconnect Monday.com in Bob Work → Integrations, disable Sandbox if it is on, then retry."
        )

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
        limit = min(max(int(arguments.get("limit") or 10), 1), 50)
        workspace_id = arguments.get("workspace_id")
        workspace_id = str(workspace_id).strip() if workspace_id is not None else None
        boards = list_monday_boards(token, limit, workspace_id)
        return tool_result({"boards": boards, "count": len(boards)})

    if name == "monday_search_items":
        query = str(arguments.get("query", "")).strip()
        limit = min(max(int(arguments.get("limit") or 10), 1), 50)
        # Prefer items_page when available; fall back to legacy items_by_column_values-free search.
        data = monday_query(
            token,
            """
            query ($term: String!, $limit: Int!) {
              items_page(limit: $limit, query_params: { term: $term }) {
                items { id name board { id name } }
              }
            }
            """,
            {"term": query, "limit": limit},
        )
        if data.get("errors"):
            # Older schemas reject root items_page — surface a clear message.
            raise RuntimeError(
                "Monday item search is unavailable for this account/API version. "
                f"Detail: {json.dumps(data.get('errors'), ensure_ascii=False)[:400]}"
            )
        items = ((data.get("data") or {}).get("items_page") or {}).get("items", [])
        return tool_result({"items": items, "query": query})

    if name == "monday_create_update":
        item_id = str(arguments.get("item_id", "")).strip()
        body = str(arguments.get("body", "")).strip()
        data = monday_query(
            token,
            "mutation ($item_id: ID!, $body: String!) { create_update(item_id: $item_id, body: $body) { id } }",
            {"item_id": item_id, "body": body},
        )
        update = _require_data(data).get("create_update")
        return tool_result({"update": update, "item_id": item_id})

    raise KeyError(name)


if __name__ == "__main__":
    run_stdio_server("bob-work-monday", "1.0.0", TOOLS, handle_call)
