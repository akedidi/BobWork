#!/usr/bin/env python3
"""GitHub connector MCP for Bob Work."""

from __future__ import annotations

import urllib.parse

from integration_mcp_base import e2e_mode, http_json, run_stdio_server, token_from_env, tool_result

TOOLS = [
    {
        "name": "github_list_repos",
        "description": "List repositories visible to the connected GitHub account.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "limit": {"type": "integer", "minimum": 1, "maximum": 100},
            },
        },
    },
    {
        "name": "github_search_issues",
        "description": "Search GitHub issues and pull requests.",
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
        "name": "github_get_pull_request",
        "description": "Fetch metadata for a pull request.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "owner": {"type": "string"},
                "repo": {"type": "string"},
                "number": {"type": "integer", "minimum": 1},
            },
            "required": ["owner", "repo", "number"],
        },
    },
]


def handle_call(name: str, arguments: dict) -> dict:
    token = token_from_env("GITHUB_TOKEN", "GH_TOKEN")
    if not token:
        raise RuntimeError("GITHUB_TOKEN or GH_TOKEN is required")

    if e2e_mode("GITHUB_TOKEN", "GH_TOKEN"):
        if name == "github_list_repos":
            limit = int(arguments.get("limit") or 10)
            repos = [
                {"full_name": "bob-work/demo", "private": False},
                {"full_name": "bob-work/plugins", "private": False},
            ][:limit]
            return tool_result({"repos": repos, "count": len(repos), "mode": "e2e"})
        if name == "github_search_issues":
            return tool_result(
                {
                    "items": [{"title": "E2E issue", "number": 1, "state": "open"}],
                    "query": arguments.get("query", ""),
                    "mode": "e2e",
                }
            )
        if name == "github_get_pull_request":
            return tool_result(
                {
                    "title": "E2E pull request",
                    "number": arguments.get("number"),
                    "state": "open",
                    "mode": "e2e",
                }
            )
        raise KeyError(name)

    if name == "github_list_repos":
        limit = int(arguments.get("limit") or 30)
        data = http_json(
            "GET",
            f"https://api.github.com/user/repos?per_page={limit}&sort=updated",
            token,
            headers={"User-Agent": "bob-work-github-mcp"},
        )
        repos = [
            {"full_name": item.get("full_name"), "private": item.get("private"), "url": item.get("html_url")}
            for item in data
        ]
        return tool_result({"repos": repos, "count": len(repos)})

    if name == "github_search_issues":
        query = str(arguments.get("query", "")).strip()
        limit = int(arguments.get("limit") or 10)
        url = f"https://api.github.com/search/issues?q={urllib.parse.quote(query)}&per_page={limit}"
        data = http_json("GET", url, token, headers={"User-Agent": "bob-work-github-mcp"})
        items = [
            {
                "title": item.get("title"),
                "number": item.get("number"),
                "state": item.get("state"),
                "url": item.get("html_url"),
            }
            for item in data.get("items", [])
        ]
        return tool_result({"items": items, "total_count": data.get("total_count", len(items))})

    if name == "github_get_pull_request":
        owner = str(arguments.get("owner", "")).strip()
        repo = str(arguments.get("repo", "")).strip()
        number = int(arguments.get("number"))
        url = f"https://api.github.com/repos/{owner}/{repo}/pulls/{number}"
        data = http_json("GET", url, token, headers={"User-Agent": "bob-work-github-mcp"})
        return tool_result(
            {
                "title": data.get("title"),
                "number": data.get("number"),
                "state": data.get("state"),
                "url": data.get("html_url"),
                "user": (data.get("user") or {}).get("login"),
            }
        )

    raise KeyError(name)


if __name__ == "__main__":
    run_stdio_server("bob-work-github", "1.0.0", TOOLS, handle_call)
