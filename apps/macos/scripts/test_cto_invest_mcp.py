#!/usr/bin/env python3
"""Unit checks for the CTO invest Python plugin (no network)."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import unittest
from pathlib import Path


FINANCE = Path(__file__).resolve().parents[1] / "src-tauri" / "resources" / "finance"


def load_market():
    spec = importlib.util.spec_from_file_location("cto_market", FINANCE / "cto_market.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_mcp_handle():
    # Import mcp/server.py with finance root on sys.path so `import cto_market` works.
    sys.path.insert(0, str(FINANCE))
    try:
        spec = importlib.util.spec_from_file_location("cto_mcp_server", FINANCE / "mcp" / "server.py")
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if str(FINANCE) in sys.path:
            sys.path.remove(str(FINANCE))


class CtoInvestPythonPluginTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["BOB_CTO_INVEST"] = "e2e-fixture"
        self.market = load_market()
        self.mcp = load_mcp_handle()

    def test_screen_ideas_returns_investment_results_with_disclaimer(self) -> None:
        result = self.mcp.handle_call("cto_screen_ideas", {"horizon": "moyen", "region": "ALL", "limit": 3})
        payload = result["structuredContent"]
        self.assertIn("disclaimer", payload)
        self.assertIn("conseil en investissement", payload["disclaimer"].lower())
        ideas = payload["ideas"]
        self.assertGreaterEqual(len(ideas), 2)
        symbols = {idea["symbol"] for idea in ideas}
        self.assertTrue({"ASML.AS", "NVDA.US"} & symbols)

    def test_market_snapshot_fixture(self) -> None:
        result = self.mcp.handle_call("cto_market_snapshot", {"limit": 4})
        quotes = result["structuredContent"]["quotes"]
        self.assertEqual(len(quotes), 4)
        self.assertEqual(quotes[0]["mode"], "e2e")

    def test_connector_status_reports_tiers(self) -> None:
        result = self.mcp.handle_call("cto_connector_status", {})
        tiers = result["structuredContent"]["tiers"]
        self.assertIn("T3_local_mcp_cli", tiers)
        self.assertTrue(tiers["T3_local_mcp_cli"]["available"])

    def test_cli_entrypoint_json(self) -> None:
        env = os.environ.copy()
        env["BOB_CTO_INVEST"] = "e2e-fixture"
        completed = subprocess.run(
            [sys.executable, str(FINANCE / "scripts" / "screen_cto.py"), "--json", "--limit", "2"],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertIn("ideas", completed.stdout)
        self.assertIn("disclaimer", completed.stdout)


if __name__ == "__main__":
    unittest.main()
