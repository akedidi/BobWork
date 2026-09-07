#!/usr/bin/env python3
"""Built-in multi-server SSH tools for Bob Work.

Uses the user's OpenSSH agent/keys and native known_hosts verification. Profiles
are written by Bob Work; secrets and passwords are never accepted by this MCP.
"""
from __future__ import annotations

import json
import os
import pathlib
import subprocess
import sys
from typing import Any

ROOT = pathlib.Path(__file__).resolve().parent
PROFILES = pathlib.Path(os.environ.get("BOB_SSH_PROFILES", ROOT / "servers.json"))
MAX_FILE = 2_000_000

TOOLS = [
    {"name": "ssh_servers", "description": "Liste les serveurs SSH activés configurés dans Bob Work.", "inputSchema": {"type": "object", "properties": {}}},
    {"name": "ssh_exec", "description": "Exécute une commande sur un serveur SSH configuré.", "inputSchema": {"type": "object", "properties": {"serverId": {"type": "string"}, "command": {"type": "string"}}, "required": ["serverId", "command"]}},
    {"name": "ssh_read", "description": "Lit un fichier sous la racine distante autorisée.", "inputSchema": {"type": "object", "properties": {"serverId": {"type": "string"}, "path": {"type": "string"}, "maxBytes": {"type": "integer", "minimum": 1, "maximum": MAX_FILE}}, "required": ["serverId", "path"]}},
    {"name": "ssh_write", "description": "Écrit un fichier sous la racine distante autorisée. Demander confirmation avant d'écraser un fichier important.", "inputSchema": {"type": "object", "properties": {"serverId": {"type": "string"}, "path": {"type": "string"}, "content": {"type": "string"}}, "required": ["serverId", "path", "content"]}},
    {"name": "ssh_browse", "description": "Liste un répertoire sous la racine distante autorisée.", "inputSchema": {"type": "object", "properties": {"serverId": {"type": "string"}, "path": {"type": "string"}}, "required": ["serverId"]}},
    {"name": "ssh_sync", "description": "Synchronise explicitement le workspace distant avec son miroir local, sans supprimer les fichiers de destination.", "inputSchema": {"type": "object", "properties": {"serverId": {"type": "string"}, "direction": {"type": "string", "enum": ["pull", "push"]}}, "required": ["serverId", "direction"]}},
]

def profiles() -> list[dict[str, Any]]:
    try:
        return [p for p in json.loads(PROFILES.read_text()) if p.get("enabled")]
    except (OSError, ValueError):
        return []

def profile(server_id: str) -> dict[str, Any]:
    item = next((p for p in profiles() if p.get("id") == server_id), None)
    if not item:
        raise RuntimeError("Serveur SSH introuvable ou désactivé")
    return item

def remote_path(item: dict[str, Any], value: str) -> str:
    relative = str(value or "").strip().lstrip("/")
    if "\x00" in relative or ".." in relative.split("/"):
        raise RuntimeError("Chemin distant non autorisé")
    root = str(item["remoteRoot"]).rstrip("/")
    return root if not relative else f"{root}/{relative}"

def quote(value: str) -> str:
    return "'" + value.replace("'", "'\\''") + "'"

def ssh_args(item: dict[str, Any]) -> list[str]:
    args = ["ssh", "-o", "BatchMode=yes", "-o", "ConnectTimeout=12", "-o", "StrictHostKeyChecking=accept-new", "-p", str(item.get("port", 22))]
    if item.get("identityFile"):
        args += ["-i", item["identityFile"]]
    return args + [f"{item['user']}@{item['host']}"]

def execute(item: dict[str, Any], command: str, content: bytes | None = None) -> dict[str, Any]:
    if not command.strip() or len(command) > 32768:
        raise RuntimeError("Commande SSH vide ou trop longue")
    done = subprocess.run(ssh_args(item) + [command], input=content, capture_output=True, timeout=120, check=False)
    return {"stdout": done.stdout.decode("utf-8", "replace"), "stderr": done.stderr.decode("utf-8", "replace"), "exitCode": done.returncode}

def call(name: str, args: dict[str, Any]) -> Any:
    if name == "ssh_servers":
        return [{k: p.get(k) for k in ("id", "name", "host", "port", "user", "remoteRoot")} for p in profiles()]
    item = profile(str(args.get("serverId", "")))
    if name == "ssh_exec":
        return execute(item, str(args.get("command", "")))
    if name == "ssh_sync":
        direction = str(args.get("direction", ""))
        if direction not in ("pull", "push"):
            raise RuntimeError("Direction de synchronisation invalide")
        local = pathlib.Path(str(item["localMirrorPath"]))
        local.mkdir(parents=True, exist_ok=True)
        transport = ["ssh", "-p", str(item.get("port", 22)), "-o", "BatchMode=yes", "-o", "StrictHostKeyChecking=accept-new"]
        if item.get("identityFile"):
            transport += ["-i", os.path.expanduser(item["identityFile"])]
        remote = f"{item['user']}@{item['host']}:{quote(str(item['remoteRoot']).rstrip('/') + '/')}"
        command = ["rsync", "-az", "--exclude", ".git/", "-e", " ".join(quote(part) for part in transport)]
        command += [remote, str(local) + "/"] if direction == "pull" else [str(local) + "/", remote]
        done = subprocess.run(command, capture_output=True, timeout=600, check=False)
        return {"localPath": str(local), "stdout": done.stdout.decode("utf-8", "replace"), "stderr": done.stderr.decode("utf-8", "replace"), "exitCode": done.returncode}
    path = remote_path(item, str(args.get("path", "")))
    if name == "ssh_read":
        return execute(item, f"head -c {min(max(int(args.get('maxBytes', 512000)), 1), MAX_FILE)} -- {quote(path)}")
    if name == "ssh_write":
        content = str(args.get("content", "")).encode()
        if len(content) > MAX_FILE:
            raise RuntimeError("Le fichier distant dépasse 2 Mo")
        parent = os.path.dirname(path)
        return execute(item, f"mkdir -p -- {quote(parent)} && cat > {quote(path)}", content)
    if name == "ssh_browse":
        command = f"cd -- {quote(path)} && for f in ./* ./.[!.]* ./..?*; do [ -e \"$f\" ] || continue; if [ -d \"$f\" ]; then t=directory; else t=file; fi; printf '%s\\t%s\\n' \"$t\" \"${{f#./}}\"; done"
        result = execute(item, command)
        result["entries"] = [{"kind": line.split("\t", 1)[0], "name": line.split("\t", 1)[1]} for line in result["stdout"].splitlines() if "\t" in line]
        return result
    raise RuntimeError(f"Outil inconnu: {name}")

def result(value: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "structuredContent": value, "isError": False}

def main() -> None:
    for raw in sys.stdin:
        try:
            request = json.loads(raw)
            rid, method = request.get("id"), request.get("method")
            if method == "initialize":
                payload = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "bob-work-ssh", "version": "1.0.0"}}
            elif method == "tools/list": payload = {"tools": TOOLS}
            elif method == "tools/call": payload = result(call(request.get("params", {}).get("name", ""), request.get("params", {}).get("arguments", {})))
            elif method == "notifications/initialized": continue
            else: raise RuntimeError(f"Méthode MCP inconnue: {method}")
            print(json.dumps({"jsonrpc": "2.0", "id": rid, "result": payload}, ensure_ascii=False), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"jsonrpc": "2.0", "id": locals().get("rid"), "error": {"code": -32000, "message": str(exc)}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
