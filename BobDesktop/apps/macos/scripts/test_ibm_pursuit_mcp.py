#!/usr/bin/env python3
"""Unit checks for the IBM Pursuit Python plugin (no network)."""

from __future__ import annotations

import importlib.util
import os
import subprocess
import sys
import unittest
from pathlib import Path


CONSULTING = Path(__file__).resolve().parents[1] / "src-tauri" / "resources" / "consulting"


def load_pursuit():
    spec = importlib.util.spec_from_file_location("ibm_pursuit", CONSULTING / "ibm_pursuit.py")
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def load_mcp_handle():
    sys.path.insert(0, str(CONSULTING))
    try:
        spec = importlib.util.spec_from_file_location(
            "ibm_pursuit_mcp_server", CONSULTING / "mcp" / "server.py"
        )
        assert spec and spec.loader
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    finally:
        if str(CONSULTING) in sys.path:
            sys.path.remove(str(CONSULTING))


class IbmPursuitPythonPluginTests(unittest.TestCase):
    def setUp(self) -> None:
        os.environ["BOB_IBM_PURSUIT"] = "e2e-fixture"
        self.pursuit = load_pursuit()
        self.mcp = load_mcp_handle()

    def test_connector_status_blocks_slack_and_microsoft(self) -> None:
        result = self.mcp.handle_call("ibm_connector_status", {})
        payload = result["structuredContent"]
        self.assertIn("slack", payload["blockedIntegrations"])
        self.assertTrue(any("microsoft" in item for item in payload["blockedIntegrations"]))
        self.assertTrue(payload["tiers"]["T3_local_mcp_cli"]["available"])

    def test_client_snapshot_fixture(self) -> None:
        result = self.mcp.handle_call(
            "ibm_client_snapshot",
            {"company": "Schneider Electric", "country": "France", "sector": "industrie"},
        )
        payload = result["structuredContent"]
        self.assertGreaterEqual(len(payload["facts"]), 5)
        self.assertGreaterEqual(len(payload["signals"]), 3)
        self.assertIn("offre commerciale", payload["disclaimer"].lower())

    def test_screen_plays_returns_ibm_offers(self) -> None:
        result = self.mcp.handle_call(
            "ibm_screen_plays",
            {
                "objective": "moderniser la data platform et lancer 2 cas d’usage IA générative sur la supply chain, sans lock-in cloud unique",
                "sector": "industrie",
                "constraints": "pas slack pas microsoft",
                "limit": 4,
            },
        )
        plays = result["structuredContent"]["plays"]
        self.assertGreaterEqual(len(plays), 3)
        self.assertLessEqual(len(plays), 4)
        self.assertTrue(all(play.get("proofUrl", "").startswith("https://www.ibm.com") for play in plays))

    def test_rejects_microsoft_remote_mcp(self) -> None:
        os.environ["IBM_PURSUIT_REMOTE_MCP_URL"] = "https://graph.microsoft.com/mcp"
        self.assertTrue(self.pursuit.is_blocked_remote("https://graph.microsoft.com/mcp"))
        self.assertTrue(self.pursuit.is_blocked_remote("https://ibm.slack.com/mcp"))
        self.assertFalse(self.pursuit.is_blocked_remote("https://example.test/mcp"))

    def test_cli_entrypoint_json(self) -> None:
        env = os.environ.copy()
        env["BOB_IBM_PURSUIT"] = "e2e-fixture"
        completed = subprocess.run(
            [
                sys.executable,
                str(CONSULTING / "scripts" / "brief_pursuit.py"),
                "--json",
                "--company",
                "Schneider Electric",
            ],
            check=True,
            capture_output=True,
            text=True,
            env=env,
        )
        self.assertIn("snapshot", completed.stdout)
        self.assertIn("plays", completed.stdout)
        self.assertIn("disclaimer", completed.stdout)


if __name__ == "__main__":
    unittest.main()
