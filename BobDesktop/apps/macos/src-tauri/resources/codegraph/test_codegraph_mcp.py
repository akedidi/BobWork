import importlib.util
import json
import os
import pathlib
import subprocess
import tempfile
import unittest


SERVER = pathlib.Path(__file__).with_name("codegraph_mcp.py")
SPEC = importlib.util.spec_from_file_location("codegraph_mcp", SERVER)
codegraph = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(codegraph)


class FakeParser:
    class Tree:
        class Node:
            type = "module"
            children = []
        root_node = Node()

    def parse(self, _source):
        return self.Tree()


class CodeGraphMcpTests(unittest.TestCase):
    def test_indexes_searches_and_builds_call_edges(self):
        with tempfile.TemporaryDirectory() as folder:
            base = pathlib.Path(folder)
            root = base / "workspace"
            root.mkdir()
            runtime = base / "runtime"
            package = runtime / "python"
            package.mkdir(parents=True)
            (runtime / "runtime.json").write_text("{}")
            (package / "tree_sitter_language_pack.py").write_text(
                "class Parser:\n"
                "    class Tree:\n"
                "        class Node:\n"
                "            type='module'\n"
                "            children=[]\n"
                "        root_node=Node()\n"
                "    def parse(self, source): return self.Tree()\n"
                "def get_parser(language): return Parser()\n"
            )
            (root / "billing.py").write_text(
                "def calculate_total(items):\n"
                "    return sum(items)\n\n"
                "def checkout(cart):\n"
                "    return calculate_total(cart)\n"
            )
            (root / "ui.ts").write_text(
                "export function renderCheckout() { return checkout([]) }\n"
            )
            previous_runtime = codegraph.RUNTIME_ROOT
            previous_index = codegraph.INDEX_ROOT
            codegraph.RUNTIME_ROOT = runtime
            codegraph.INDEX_ROOT = root / "indexes"
            try:
                indexed = codegraph.index_workspace(root)
                self.assertEqual(indexed["files"], 2)
                self.assertGreaterEqual(indexed["symbols"], 3)
                self.assertTrue(codegraph.hybrid_search(root, "shopping cart total", 5))
                self.assertTrue(any(item["caller"] == "checkout" for item in codegraph.callers(root, "calculate_total")))
                self.assertTrue(any(item["name"] == "calculate_total" for item in codegraph.callees(root, "checkout")))
                impact = codegraph.impact(root, "calculate_total", 3)
                self.assertIn("billing.py", impact["affectedFiles"])
                unchanged = codegraph.index_workspace(root)
                self.assertEqual(unchanged["indexed"], 0)
                self.assertEqual(unchanged["unchanged"], 2)
            finally:
                codegraph.RUNTIME_ROOT = previous_runtime
                codegraph.INDEX_ROOT = previous_index

    def test_json_rpc_process_indexes_and_queries_a_workspace(self):
        with tempfile.TemporaryDirectory() as folder:
            base = pathlib.Path(folder)
            home = base / "home"
            workspace = base / "workspace"
            runtime = base / "runtime"
            package = runtime / "python"
            home.mkdir()
            workspace.mkdir()
            package.mkdir(parents=True)
            (runtime / "runtime.json").write_text("{}")
            (package / "tree_sitter_language_pack.py").write_text(
                "class Parser:\n"
                "    class Tree:\n"
                "        class Node:\n"
                "            type='module'\n"
                "            children=[]\n"
                "        root_node=Node()\n"
                "    def parse(self, source): return self.Tree()\n"
                "def get_parser(language): return Parser()\n"
            )
            (workspace / "orders.py").write_text(
                "def total_order(lines):\n"
                "    return sum(lines)\n\n"
                "def submit_order(lines):\n"
                "    return total_order(lines)\n"
            )
            env = {
                **os.environ,
                "HOME": str(home),
                "BOB_CODEGRAPH_RUNTIME_ROOT": str(runtime),
                "PYTHONPATH": str(package),
                "PYTHONNOUSERSITE": "1",
            }
            process = subprocess.Popen(
                [os.environ.get("PYTHON", "python3"), str(SERVER)],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
                env=env,
            )
            self.addCleanup(lambda: process.poll() is None and process.kill())

            def exchange(request):
                process.stdin.write(json.dumps(request) + "\n")
                process.stdin.flush()
                return json.loads(process.stdout.readline())

            initialized = exchange({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
            self.assertEqual(initialized["result"]["serverInfo"]["name"], "bob-work-codegraph")
            tools = exchange({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
            self.assertIn("codegraph_impact", {item["name"] for item in tools["result"]["tools"]})
            indexed = exchange({
                "jsonrpc": "2.0", "id": 3, "method": "tools/call",
                "params": {"name": "codegraph_index", "arguments": {"workspace": str(workspace)}},
            })
            self.assertEqual(indexed["result"]["structuredContent"]["files"], 1)
            callers = exchange({
                "jsonrpc": "2.0", "id": 4, "method": "tools/call",
                "params": {
                    "name": "codegraph_callers",
                    "arguments": {"workspace": str(workspace), "symbol": "total_order"},
                },
            })
            self.assertEqual(callers["result"]["structuredContent"][0]["caller"], "submit_order")
            process.stdin.close()
            self.assertEqual(process.wait(timeout=5), 0)
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
