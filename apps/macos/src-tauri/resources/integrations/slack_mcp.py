#!/usr/bin/env python3
"""Slack connector MCP for Bob Work."""

from __future__ import annotations

import urllib.parse

from integration_mcp_base import e2e_mode, http_json, run_stdio_server, token_from_env, tool_result

TOOLS = [
    {
        "name": "slack_search_messages",
        "description": "Search Slack messages in the connected workspace.",
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
        "name": "slack_list_channels",
        "description": "List public and private channels visible to the bot.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 200},
            },
        },
    },
    {
        "name": "slack_post_message",
        "description": "Post a message to a Slack channel.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "channel": {"type": "string"},
                "text": {"type": "string"},
            },
            "required": ["channel", "text"],
        },
    },
]


def slack_api(method: str, token: str, params: dict | None = None, body: dict | None = None) -> dict:
    if body is not None:
        return http_json(
            "POST",
            f"https://slack.com/api/{method}",
            token,
            body=body,
            headers={"Content-Type": "application/json; charset=utf-8"},
        )
    query = urllib.parse.urlencode(params or {})
    url = f"https://slack.com/api/{method}?{query}" if query else f"https://slack.com/api/{method}"
    return http_json("GET", url, token)


def handle_call(name: str, arguments: dict) -> dict:
    token = token_from_env("SLACK_BOT_TOKEN", "SLACK_ACCESS_TOKEN")
    if not token:
        raise RuntimeError("SLACK_BOT_TOKEN or SLACK_ACCESS_TOKEN is required")

    if e2e_mode("SLACK_BOT_TOKEN", "SLACK_ACCESS_TOKEN"):
        if name == "slack_search_messages":
            return tool_result(
                {
                    "messages": [{"text": "E2E standup notes", "channel": "general"}],
                    "query": arguments.get("query", ""),
                    "mode": "e2e",
                }
            )
        if name == "slack_list_channels":
            return tool_result({"channels": [{"name": "general", "id": "C001"}], "mode": "e2e"})
        if name == "slack_post_message":
            return tool_result({"ok": True, "channel": arguments.get("channel"), "mode": "e2e"})
        raise KeyError(name)

    if name == "slack_search_messages":
        query = str(arguments.get("query", "")).strip()
        limit = int(arguments.get("limit") or 10)
        data = slack_api("search.messages", token, {"query": query, "count": limit})
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "slack_search_failed"))
        matches = data.get("messages", {}).get("matches", [])
        return tool_result({"messages": matches, "query": query})

    if name == "slack_list_channels":
        limit = int(arguments.get("limit") or 50)
        data = slack_api("conversations.list", token, {"limit": limit, "types": "public_channel,private_channel"})
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "slack_list_channels_failed"))
        channels = [{"id": c.get("id"), "name": c.get("name")} for c in data.get("channels", [])]
        return tool_result({"channels": channels})

    if name == "slack_post_message":
        channel = str(arguments.get("channel", "")).strip()
        text = str(arguments.get("text", "")).strip()
        data = slack_api("chat.postMessage", token, body={"channel": channel, "text": text})
        if not data.get("ok"):
            raise RuntimeError(data.get("error", "slack_post_message_failed"))
        return tool_result({"ok": True, "channel": channel, "ts": data.get("ts")})

    raise KeyError(name)


if __name__ == "__main__":
    run_stdio_server("bob-work-slack", "1.0.0", TOOLS, handle_call)
