import json
import os
import pathlib
import subprocess
import tempfile
import unittest


SERVER = pathlib.Path(__file__).with_name("ssh_mcp.py")


class SshMcpProcessTests(unittest.TestCase):
    def test_json_rpc_exec_read_write_and_browse(self):
        with tempfile.TemporaryDirectory() as folder:
            root = pathlib.Path(folder)
            bin_dir = root / "bin"
            remote = root / "remote"
            bin_dir.mkdir()
            remote.mkdir()
            profiles = root / "servers.json"
            profiles.write_text(json.dumps([{
                "id": "local-e2e",
                "name": "Local SSH E2E",
                "host": "127.0.0.1",
                "port": 2222,
                "user": "bob",
                "remoteRoot": "/srv/app",
                "localMirrorPath": str(root / "mirror"),
                "enabled": True,
            }]))
            ssh = bin_dir / "ssh"
            ssh.write_text(
                "#!/usr/bin/env python3\n"
                "import os, pathlib, sys\n"
                "remote = pathlib.Path(os.environ['BOB_SSH_TEST_REMOTE'])\n"
                "command = sys.argv[-1]\n"
                "if 'cat >' in command:\n"
                "    (remote / 'notes.txt').write_bytes(sys.stdin.buffer.read())\n"
                "elif 'head -c' in command:\n"
                "    sys.stdout.buffer.write((remote / 'notes.txt').read_bytes())\n"
                "elif 'for f in' in command:\n"
                "    print('file\\tnotes.txt')\n"
                "    print('directory\\tsrc')\n"
                "elif 'BOB_SSH_OK' in command:\n"
                "    print('BOB_SSH_OK', end='')\n"
                "else:\n"
                "    print('executed:' + command)\n"
            )
            ssh.chmod(0o755)
            env = {
                **os.environ,
                "PATH": f"{bin_dir}:{os.environ.get('PATH', '')}",
                "BOB_SSH_PROFILES": str(profiles),
                "BOB_SSH_TEST_REMOTE": str(remote),
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
                response = json.loads(process.stdout.readline())
                self.assertNotIn("error", response)
                return response["result"].get("structuredContent", response["result"])

            initialized = exchange({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}})
            self.assertEqual(initialized["serverInfo"]["name"], "bob-work-ssh")
            tools = exchange({"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
            self.assertIn("ssh_write", {item["name"] for item in tools["tools"]})

            def call(request_id, name, arguments):
                return exchange({
                    "jsonrpc": "2.0", "id": request_id, "method": "tools/call",
                    "params": {"name": name, "arguments": arguments},
                })

            executed = call(3, "ssh_exec", {"serverId": "local-e2e", "command": "printf hello"})
            self.assertIn("executed:printf hello", executed["stdout"])
            call(4, "ssh_write", {"serverId": "local-e2e", "path": "notes.txt", "content": "écriture SSH réelle"})
            self.assertEqual((remote / "notes.txt").read_text(), "écriture SSH réelle")
            read = call(5, "ssh_read", {"serverId": "local-e2e", "path": "notes.txt"})
            self.assertEqual(read["stdout"], "écriture SSH réelle")
            browsed = call(6, "ssh_browse", {"serverId": "local-e2e", "path": ""})
            self.assertEqual(browsed["entries"][0], {"kind": "file", "name": "notes.txt"})
            process.stdin.close()
            self.assertEqual(process.wait(timeout=5), 0)
            process.stdout.close()
            process.stderr.close()


if __name__ == "__main__":
    unittest.main()
