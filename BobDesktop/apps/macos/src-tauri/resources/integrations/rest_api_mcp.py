#!/usr/bin/env python3
"""Read-only REST API adapter exposed to Bob Shell through MCP stdio."""

from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

from integration_mcp_base import run_stdio_server, tool_result


API_ID = os.environ.get("BOB_WORK_API_ID", "api").strip() or "api"
BASE_URL = os.environ.get("BOB_WORK_API_BASE_URL", "").strip().rstrip("/")
AUTH_MODE = os.environ.get("BOB_WORK_API_AUTH_MODE", "none").strip().lower()
AUTH_NAME = os.environ.get("BOB_WORK_API_AUTH_NAME", "").strip()
SECRET = os.environ.get("BOB_WORK_API_SECRET", "")
TOOL_NAME = f"{re.sub(r'[^a-zA-Z0-9_-]', '_', API_ID)}_api_get"

TOOLS = [
    {
        "name": TOOL_NAME,
        "description": (
            f"Perform a read-only GET request against the configured {API_ID} REST API. "
            "Use a relative path under the configured base URL; authentication is injected automatically."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative endpoint path, for example tv/on_the_air. Leave empty to query the configured URL.",
                },
                "query": {
                    "type": "object",
                    "description": "Optional query parameters. Arrays are encoded as repeated parameters.",
                    "additionalProperties": {
                        "type": ["string", "number", "integer", "boolean", "array", "null"]
                    },
                },
            },
        },
    }
]


def _request_url(path: str, query: dict) -> str:
    parsed_base = urllib.parse.urlsplit(BASE_URL)
    if parsed_base.scheme != "https" or not parsed_base.netloc:
        raise RuntimeError("The configured API base URL must use HTTPS")

    candidate = urllib.parse.urljoin(f"{BASE_URL}/", path.lstrip("/")) if path else BASE_URL
    parsed = urllib.parse.urlsplit(candidate)
    if (parsed.scheme, parsed.netloc) != (parsed_base.scheme, parsed_base.netloc):
        raise RuntimeError("API requests must remain on the configured origin")

    pairs = urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    for key, value in (query or {}).items():
        if value is None:
            continue
        if isinstance(value, list):
            pairs.extend((str(key), str(item)) for item in value)
        else:
            pairs.append((str(key), str(value).lower() if isinstance(value, bool) else str(value)))
    if AUTH_MODE == "query" and SECRET:
        pairs = [(key, value) for key, value in pairs if key != (AUTH_NAME or "api_key")]
        pairs.append((AUTH_NAME or "api_key", SECRET))
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(pairs), ""))


def _redacted_url(url: str) -> str:
    parsed = urllib.parse.urlsplit(url)
    secret_name = AUTH_NAME or "api_key"
    pairs = [
        (key, "<redacted>" if AUTH_MODE == "query" and key == secret_name else value)
        for key, value in urllib.parse.parse_qsl(parsed.query, keep_blank_values=True)
    ]
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, parsed.path, urllib.parse.urlencode(pairs), ""))


def handle_call(name: str, arguments: dict) -> dict:
    if name != TOOL_NAME:
        raise KeyError(name)
    if AUTH_MODE != "none" and not SECRET:
        raise RuntimeError(f"Authentication is not configured for {API_ID}")

    url = _request_url(str(arguments.get("path") or ""), arguments.get("query") or {})
    headers = {"Accept": "application/json", "User-Agent": "BobWork/REST-API-Adapter"}
    if AUTH_MODE == "bearer":
        headers["Authorization"] = f"Bearer {SECRET}"
    elif AUTH_MODE == "header":
        headers[AUTH_NAME or "X-Api-Key"] = SECRET

    request = urllib.request.Request(url, headers=headers, method="GET")
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = response.read(2_000_001)
            if len(payload) > 2_000_000:
                raise RuntimeError("API response exceeds the 2 MB safety limit")
            charset = response.headers.get_content_charset() or "utf-8"
            text = payload.decode(charset, errors="replace")
            try:
                data = json.loads(text)
            except json.JSONDecodeError:
                data = {"text": text}
            return tool_result({"status": response.status, "url": _redacted_url(response.geturl()), "data": data})
    except urllib.error.HTTPError as error:
        body = error.read(64_000).decode("utf-8", errors="replace")
        raise RuntimeError(f"API returned HTTP {error.code}: {body}") from error


if __name__ == "__main__":
    run_stdio_server(f"bob-work-api-{API_ID}", "1.0.0", TOOLS, handle_call)
