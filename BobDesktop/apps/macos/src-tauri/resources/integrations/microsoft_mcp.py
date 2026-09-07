#!/usr/bin/env python3
"""Microsoft 365 connector MCP for Bob Work (Graph API)."""

from __future__ import annotations

import urllib.parse

from integration_mcp_base import e2e_mode, http_json, run_stdio_server, token_from_env, tool_result

TOOLS = [
    {
        "name": "graph_search_mail",
        "description": "Search Outlook mail messages via Microsoft Graph.",
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
        "name": "graph_list_teams",
        "description": "List Microsoft Teams joined by the connected account.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        },
    },
    {
        "name": "graph_list_calendar_events",
        "description": "List upcoming Outlook calendar events.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
        },
    },
    {
        "name": "graph_search_onedrive",
        "description": "Search OneDrive files via Microsoft Graph.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "query": {"type": "string"},
                "limit": {"type": "integer", "minimum": 1, "maximum": 50},
            },
            "required": ["query"],
        },
    },
]


def graph_get(token: str, path: str, params: dict | None = None) -> dict:
    query = urllib.parse.urlencode(params or {})
    url = f"https://graph.microsoft.com/v1.0{path}"
    if query:
        url = f"{url}?{query}"
    return http_json("GET", url, token)


def handle_call(name: str, arguments: dict) -> dict:
    token = token_from_env("MICROSOFT_GRAPH_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("MICROSOFT_GRAPH_ACCESS_TOKEN is required")

    if e2e_mode("MICROSOFT_GRAPH_ACCESS_TOKEN"):
        if name == "graph_search_mail":
            return tool_result(
                {
                    "messages": [{"subject": "E2E weekly update", "from": "team@contoso.com"}],
                    "query": arguments.get("query", ""),
                    "mode": "e2e",
                }
            )
        if name == "graph_list_teams":
            return tool_result({"teams": [{"displayName": "E2E Team", "id": "team-1"}], "mode": "e2e"})
        if name == "graph_list_calendar_events":
            return tool_result({"events": [{"subject": "E2E sync", "start": "2026-08-09T10:00:00Z"}], "mode": "e2e"})
        if name == "graph_search_onedrive":
            return tool_result(
                {
                    "files": [{"name": "roadmap.docx", "webUrl": "https://contoso.sharepoint.com/roadmap.docx"}],
                    "query": arguments.get("query", ""),
                    "mode": "e2e",
                }
            )
        raise KeyError(name)

    if name == "graph_search_mail":
        query = str(arguments.get("query", "")).strip()
        limit = int(arguments.get("limit") or 10)
        data = graph_get(token, "/me/messages", {"$search": f'"{query}"', "$top": limit})
        messages = [
            {
                "subject": item.get("subject"),
                "from": ((item.get("from") or {}).get("emailAddress") or {}).get("address"),
                "receivedDateTime": item.get("receivedDateTime"),
            }
            for item in data.get("value", [])
        ]
        return tool_result({"messages": messages, "query": query})

    if name == "graph_list_teams":
        limit = int(arguments.get("limit") or 20)
        data = graph_get(token, "/me/joinedTeams", {"$top": limit})
        teams = [{"id": t.get("id"), "displayName": t.get("displayName")} for t in data.get("value", [])]
        return tool_result({"teams": teams})

    if name == "graph_list_calendar_events":
        limit = int(arguments.get("limit") or 20)
        data = graph_get(
            token,
            "/me/calendarView",
            {"startDateTime": "2020-01-01T00:00:00Z", "endDateTime": "2030-01-01T00:00:00Z", "$top": limit},
        )
        events = [
            {"subject": e.get("subject"), "start": (e.get("start") or {}).get("dateTime"), "end": (e.get("end") or {}).get("dateTime")}
            for e in data.get("value", [])
        ]
        return tool_result({"events": events})

    if name == "graph_search_onedrive":
        query = str(arguments.get("query", "")).strip()
        limit = int(arguments.get("limit") or 10)
        data = graph_get(token, "/me/drive/root/search(q='{}')".format(urllib.parse.quote(query)), {"$top": limit})
        files = [{"name": f.get("name"), "webUrl": f.get("webUrl")} for f in data.get("value", [])]
        return tool_result({"files": files, "query": query})

    raise KeyError(name)


if __name__ == "__main__":
    run_stdio_server("bob-work-microsoft", "1.0.0", TOOLS, handle_call)
