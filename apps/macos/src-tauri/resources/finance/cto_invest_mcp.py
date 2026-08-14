#!/usr/bin/env python3
"""Compatibility shim — prefer mcp/server.py + cto_market.py in the plugin bundle."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
SERVER = ROOT / "mcp" / "server.py"


def _load_server():
    if str(ROOT) not in sys.path:
        sys.path.insert(0, str(ROOT))
    spec = importlib.util.spec_from_file_location("cto_invest_mcp_server", SERVER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {SERVER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


_server = _load_server()
TOOLS = _server.TOOLS
handle_call = _server.handle_call
main = _server.main
send = _server.send
send_error = _server.send_error
tool_result = _server.tool_result

if __name__ == "__main__":
    main()
