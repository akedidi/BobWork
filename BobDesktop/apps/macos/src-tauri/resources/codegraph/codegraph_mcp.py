#!/usr/bin/env python3
"""Persistent local CodeGraph MCP server for Bob Work.

The server indexes source code into one SQLite file per workspace.  It combines
language-aware symbol extraction, reference edges, BM25 lexical ranking and a
deterministic hashed embedding.  When the optional Tree-sitter runtime is
installed, syntax trees are used to improve symbol boundaries for every
supported language.  Source text never leaves the computer.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import pathlib
import re
import sqlite3
import sys
import time
from collections import Counter
from typing import Any, Iterable

INDEX_ROOT = pathlib.Path.home() / ".bob" / "codegraph" / "indexes"
RUNTIME_ROOT = pathlib.Path(os.environ.get("BOB_CODEGRAPH_RUNTIME_ROOT", ""))
MAX_FILE_BYTES = 1_500_000
MAX_FILES = 30_000
VECTOR_SIZE = 192
SUPPORTED = {
    ".py": "python", ".js": "javascript", ".jsx": "javascript",
    ".ts": "typescript", ".tsx": "tsx", ".go": "go", ".java": "java",
    ".rs": "rust",
}
IGNORED_DIRS = {
    ".git", ".hg", ".svn", "node_modules", "target", "dist", "build",
    ".next", ".turbo", ".venv", "venv", "__pycache__", ".idea", ".vscode",
}
SYMBOL_PATTERNS = {
    "python": re.compile(r"^\s*(?:async\s+)?(?P<kind>def|class)\s+(?P<name>[A-Za-z_]\w*)", re.M),
    "javascript": re.compile(r"^\s*(?:(?:export\s+)?(?:default\s+)?)?(?P<kind>class|function)\s+(?P<name>[A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name2>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>", re.M),
    "typescript": re.compile(r"^\s*(?:(?:export\s+)?(?:default\s+)?)?(?P<kind>class|function|interface|type|enum)\s+(?P<name>[A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name2>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>", re.M),
    "tsx": re.compile(r"^\s*(?:(?:export\s+)?(?:default\s+)?)?(?P<kind>class|function|interface|type|enum)\s+(?P<name>[A-Za-z_$][\w$]*)|^\s*(?:export\s+)?(?:const|let|var)\s+(?P<name2>[A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>", re.M),
    "go": re.compile(r"^\s*(?P<kind>func|type)\s+(?:\([^)]*\)\s*)?(?P<name>[A-Za-z_]\w*)", re.M),
    "java": re.compile(r"^\s*(?:(?:public|private|protected|static|final|abstract|synchronized|native)\s+)*(?:(?P<kind>class|interface|enum|record)\s+(?P<name>[A-Za-z_]\w*)|(?:[\w<>,.?\[\]]+\s+)+(?P<name2>[A-Za-z_]\w*)\s*\([^;]*\)\s*(?:throws[^\{]+)?\{)", re.M),
    "rust": re.compile(r"^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?P<kind>fn|struct|enum|trait|type|mod)\s+(?P<name>[A-Za-z_]\w*)", re.M),
}
IDENT = re.compile(r"\b[A-Za-z_][A-Za-z0-9_]{2,}\b")
TOKEN = re.compile(r"[A-Za-z_][A-Za-z0-9_]{1,}|[\u00c0-\u024f]{2,}")

TOOLS = [
    {"name": "codegraph_status", "description": "Retourne l’état du runtime et de l’index CodeGraph d’un workspace local.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}}, "required": ["workspace"]}},
    {"name": "codegraph_index", "description": "Crée ou met à jour incrémentalement l’index local Python/JS/TS/Go/Java/Rust. À utiliser seulement pour une analyse transverse du code.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}, "force": {"type": "boolean"}}, "required": ["workspace"]}},
    {"name": "codegraph_search", "description": "Recherche hybride BM25 + embedding dans le code indexé.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}, "query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 50}}, "required": ["workspace", "query"]}},
    {"name": "codegraph_symbol", "description": "Recherche les définitions d’un symbole et leurs emplacements.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}, "symbol": {"type": "string"}}, "required": ["workspace", "symbol"]}},
    {"name": "codegraph_callers", "description": "Liste les symboles qui appellent ou référencent un symbole.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}, "symbol": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}, "required": ["workspace", "symbol"]}},
    {"name": "codegraph_callees", "description": "Liste les symboles appelés depuis une définition donnée.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}, "symbol": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 100}}, "required": ["workspace", "symbol"]}},
    {"name": "codegraph_impact", "description": "Analyse l’impact probable d’une modification de symbole avec dépendances directes et transitives.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}, "symbol": {"type": "string"}, "depth": {"type": "integer", "minimum": 1, "maximum": 5}}, "required": ["workspace", "symbol"]}},
    {"name": "codegraph_delete_index", "description": "Supprime l’index dérivé d’un workspace, jamais ses fichiers source.", "inputSchema": {"type": "object", "properties": {"workspace": {"type": "string"}, "confirmed": {"type": "boolean"}}, "required": ["workspace", "confirmed"]}},
]


def runtime_available() -> bool:
    if not RUNTIME_ROOT or not (RUNTIME_ROOT / "runtime.json").is_file():
        return False
    package_root = RUNTIME_ROOT / "python"
    if package_root.is_dir() and str(package_root) not in sys.path:
        sys.path.insert(0, str(package_root))
    try:
        import tree_sitter_language_pack  # noqa: F401
        return True
    except Exception:
        return False


def workspace_path(value: str) -> pathlib.Path:
    root = pathlib.Path(value).expanduser().resolve()
    if not root.is_dir():
        raise RuntimeError("Workspace CodeGraph introuvable")
    return root


def db_path(root: pathlib.Path) -> pathlib.Path:
    digest = hashlib.sha256(str(root).encode()).hexdigest()[:24]
    return INDEX_ROOT / f"{digest}.sqlite"


def connect(root: pathlib.Path) -> sqlite3.Connection:
    INDEX_ROOT.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(db_path(root))
    db.row_factory = sqlite3.Row
    db.executescript("""
        PRAGMA journal_mode=WAL;
        CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE IF NOT EXISTS files(path TEXT PRIMARY KEY, language TEXT NOT NULL, mtime REAL NOT NULL, size INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS chunks(id INTEGER PRIMARY KEY, path TEXT NOT NULL, start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, text TEXT NOT NULL, terms TEXT NOT NULL, vector TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
        CREATE TABLE IF NOT EXISTS symbols(id INTEGER PRIMARY KEY, name TEXT NOT NULL, kind TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL, end_line INTEGER NOT NULL, signature TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS symbols_name ON symbols(name);
        CREATE INDEX IF NOT EXISTS symbols_path_line ON symbols(path, line);
        CREATE TABLE IF NOT EXISTS refs(name TEXT NOT NULL, path TEXT NOT NULL, line INTEGER NOT NULL, owner TEXT, context TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS refs_name ON refs(name);
    """)
    return db


def source_files(root: pathlib.Path) -> Iterable[pathlib.Path]:
    count = 0
    for current, dirs, files in os.walk(root):
        dirs[:] = [d for d in dirs if d not in IGNORED_DIRS and not d.startswith(".cache")]
        base = pathlib.Path(current)
        for name in files:
            path = base / name
            if path.suffix.lower() not in SUPPORTED:
                continue
            try:
                if path.stat().st_size > MAX_FILE_BYTES:
                    continue
            except OSError:
                continue
            yield path
            count += 1
            if count >= MAX_FILES:
                return


def tokenize(text: str) -> list[str]:
    expanded = re.sub(r"([a-z0-9])([A-Z])", r"\1 \2", text)
    return [token.lower() for token in TOKEN.findall(expanded)]


def embedding(tokens: list[str]) -> list[float]:
    vector = [0.0] * VECTOR_SIZE
    for token in tokens:
        features = [token] + [token[i:i + 3] for i in range(max(0, len(token) - 2))]
        for feature in features:
            raw = hashlib.blake2b(feature.encode(), digest_size=8).digest()
            index = int.from_bytes(raw[:4], "little") % VECTOR_SIZE
            sign = 1.0 if raw[4] & 1 else -1.0
            vector[index] += sign
    norm = math.sqrt(sum(value * value for value in vector)) or 1.0
    return [round(value / norm, 6) for value in vector]


def tree_sitter_symbols(language: str, text: str) -> list[tuple[str, str, int, int, str]]:
    if not runtime_available():
        return []
    try:
        from tree_sitter_language_pack import get_parser
        parser = get_parser(language)
        tree = parser.parse(text.encode("utf-8", "replace"))
    except Exception:
        return []
    kinds = {
        "function_definition": "function", "function_declaration": "function",
        "method_definition": "method", "method_declaration": "method",
        "class_definition": "class", "class_declaration": "class",
        "interface_declaration": "interface", "trait_item": "trait",
        "struct_item": "struct", "enum_item": "enum", "type_declaration": "type",
    }
    found: list[tuple[str, str, int, int, str]] = []
    stack = [tree.root_node]
    raw = text.encode("utf-8", "replace")
    while stack:
        node = stack.pop()
        if node.type in kinds:
            name_node = node.child_by_field_name("name")
            if name_node:
                name = raw[name_node.start_byte:name_node.end_byte].decode("utf-8", "replace")
                signature = text.splitlines()[node.start_point[0]].strip()[:500] if text.splitlines() else name
                found.append((name, kinds[node.type], node.start_point[0] + 1, node.end_point[0] + 1, signature))
        stack.extend(reversed(node.children))
    return found


def regex_symbols(language: str, text: str) -> list[tuple[str, str, int, int, str]]:
    pattern = SYMBOL_PATTERNS[language]
    matches = list(pattern.finditer(text))
    lines = text.splitlines()
    found = []
    for index, match in enumerate(matches):
        name = match.groupdict().get("name") or match.groupdict().get("name2")
        if not name:
            continue
        kind = match.groupdict().get("kind") or "function"
        start = text.count("\n", 0, match.start()) + 1
        end = (text.count("\n", 0, matches[index + 1].start()) if index + 1 < len(matches) else len(lines))
        found.append((name, kind, start, max(start, end), lines[start - 1].strip()[:500]))
    return found


def extract_symbols(language: str, text: str) -> list[tuple[str, str, int, int, str]]:
    ast = tree_sitter_symbols(language, text)
    fallback = regex_symbols(language, text)
    unique = {(name, line): item for item in fallback for name, _kind, line, _end, _sig in [item]}
    for item in ast:
        unique[(item[0], item[2])] = item
    return sorted(unique.values(), key=lambda item: item[2])


def index_workspace(root: pathlib.Path, force: bool = False) -> dict[str, Any]:
    if not runtime_available():
        raise RuntimeError("Le runtime CodeGraph n’est pas installé. Utilisez le bouton d’installation proposé par Bob Work.")
    db = connect(root)
    known = {row["path"]: (row["mtime"], row["size"]) for row in db.execute("SELECT path,mtime,size FROM files")}
    seen: set[str] = set()
    indexed = unchanged = errors = 0
    for path in source_files(root):
        relative = path.relative_to(root).as_posix()
        seen.add(relative)
        try:
            stat = path.stat()
            if not force and known.get(relative) == (stat.st_mtime, stat.st_size):
                unchanged += 1
                continue
            text = path.read_text("utf-8", errors="replace")
            language = SUPPORTED[path.suffix.lower()]
            symbols = extract_symbols(language, text)
            db.execute("DELETE FROM chunks WHERE path=?", (relative,))
            db.execute("DELETE FROM symbols WHERE path=?", (relative,))
            db.execute("DELETE FROM refs WHERE path=?", (relative,))
            db.execute("REPLACE INTO files(path,language,mtime,size) VALUES(?,?,?,?)", (relative, language, stat.st_mtime, stat.st_size))
            lines = text.splitlines()
            for start in range(0, len(lines), 80):
                block = "\n".join(lines[start:start + 100])
                terms = tokenize(block)
                db.execute("INSERT INTO chunks(path,start_line,end_line,text,terms,vector) VALUES(?,?,?,?,?,?)", (relative, start + 1, min(len(lines), start + 100), block, json.dumps(Counter(terms)), json.dumps(embedding(terms))))
            for name, kind, line, end_line, signature in symbols:
                db.execute("INSERT INTO symbols(name,kind,path,line,end_line,signature) VALUES(?,?,?,?,?,?)", (name, kind, relative, line, end_line, signature))
            definitions = {(name, line) for name, _kind, line, _end, _sig in symbols}
            for line_no, line_text in enumerate(lines, 1):
                owner = next((name for name, _kind, start, end, _sig in reversed(symbols) if start <= line_no <= end), None)
                for name in set(IDENT.findall(line_text)):
                    if (name, line_no) not in definitions:
                        db.execute("INSERT INTO refs(name,path,line,owner,context) VALUES(?,?,?,?,?)", (name, relative, line_no, owner, line_text.strip()[:500]))
            indexed += 1
        except (OSError, UnicodeError, sqlite3.Error):
            errors += 1
    removed = set(known) - seen
    for relative in removed:
        for table in ("files", "chunks", "symbols", "refs"):
            db.execute(f"DELETE FROM {table} WHERE path=?", (relative,))
    now = str(time.time())
    db.execute("REPLACE INTO meta(key,value) VALUES('workspace',?)", (str(root),))
    db.execute("REPLACE INTO meta(key,value) VALUES('indexedAt',?)", (now,))
    db.commit()
    counts = {name: db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] for name in ("files", "symbols", "refs", "chunks")}
    db.close()
    return {"workspace": str(root), "indexed": indexed, "unchanged": unchanged, "removed": len(removed), "errors": errors, **counts, "indexPath": str(db_path(root))}


def ensure_index(root: pathlib.Path) -> sqlite3.Connection:
    path = db_path(root)
    if not path.is_file():
        raise RuntimeError("Ce workspace n’est pas encore indexé. Appelez codegraph_index.")
    return connect(root)


def cosine(left: list[float], right: list[float]) -> float:
    return sum(a * b for a, b in zip(left, right))


def hybrid_search(root: pathlib.Path, query: str, limit: int) -> list[dict[str, Any]]:
    db = ensure_index(root)
    rows = list(db.execute("SELECT path,start_line,end_line,text,terms,vector FROM chunks"))
    query_terms = tokenize(query)
    query_counts = Counter(query_terms)
    query_vector = embedding(query_terms)
    doc_freq = Counter()
    for row in rows:
        doc_freq.update(json.loads(row["terms"]).keys())
    average = sum(sum(json.loads(row["terms"]).values()) for row in rows) / max(1, len(rows))
    ranked = []
    for row in rows:
        terms = json.loads(row["terms"])
        length = sum(terms.values())
        bm25 = 0.0
        for term, qf in query_counts.items():
            tf = terms.get(term, 0)
            if not tf:
                continue
            idf = math.log(1 + (len(rows) - doc_freq[term] + 0.5) / (doc_freq[term] + 0.5))
            bm25 += qf * idf * (tf * 2.2) / (tf + 1.2 * (0.25 + 0.75 * length / max(1, average)))
        semantic = max(0.0, cosine(query_vector, json.loads(row["vector"])))
        score = bm25 + semantic * 2.0
        if score > 0:
            ranked.append({"path": row["path"], "startLine": row["start_line"], "endLine": row["end_line"], "score": round(score, 4), "lexicalScore": round(bm25, 4), "semanticScore": round(semantic, 4), "snippet": row["text"][:1200]})
    db.close()
    return sorted(ranked, key=lambda item: item["score"], reverse=True)[:limit]


def symbols(root: pathlib.Path, name: str) -> list[dict[str, Any]]:
    db = ensure_index(root)
    rows = [dict(row) for row in db.execute("SELECT name,kind,path,line,end_line AS endLine,signature FROM symbols WHERE name=? COLLATE NOCASE ORDER BY path,line", (name,))]
    db.close()
    return rows


def callers(root: pathlib.Path, name: str, limit: int = 100) -> list[dict[str, Any]]:
    db = ensure_index(root)
    rows = [dict(row) for row in db.execute("SELECT DISTINCT COALESCE(owner,'<module>') AS caller,path,line,context FROM refs WHERE name=? COLLATE NOCASE ORDER BY path,line LIMIT ?", (name, limit))]
    db.close()
    return rows


def callees(root: pathlib.Path, name: str, limit: int = 100) -> list[dict[str, Any]]:
    db = ensure_index(root)
    definitions = list(db.execute("SELECT path,line,end_line FROM symbols WHERE name=? COLLATE NOCASE", (name,)))
    results: list[dict[str, Any]] = []
    seen = set()
    for definition in definitions:
        for row in db.execute("SELECT DISTINCT refs.name,refs.path,refs.line,refs.context FROM refs JOIN symbols ON symbols.name=refs.name WHERE refs.path=? AND refs.line BETWEEN ? AND ? ORDER BY refs.line", (definition["path"], definition["line"], definition["end_line"])):
            key = (row["name"], row["path"], row["line"])
            if key not in seen:
                seen.add(key)
                results.append(dict(row))
                if len(results) >= limit:
                    db.close()
                    return results
    db.close()
    return results


def impact(root: pathlib.Path, name: str, depth: int) -> dict[str, Any]:
    frontier = {name}
    visited = {name}
    levels = []
    for level in range(1, depth + 1):
        affected = []
        next_frontier = set()
        for symbol in sorted(frontier):
            for item in callers(root, symbol):
                caller = item["caller"]
                affected.append({"via": symbol, **item})
                if caller != "<module>" and caller not in visited:
                    visited.add(caller)
                    next_frontier.add(caller)
        levels.append({"depth": level, "affected": affected})
        frontier = next_frontier
        if not frontier:
            break
    paths = sorted({item["path"] for level in levels for item in level["affected"]})
    return {"symbol": name, "definitions": symbols(root, name), "levels": levels, "affectedFiles": paths, "affectedSymbolCount": max(0, len(visited) - 1)}


def status(root: pathlib.Path) -> dict[str, Any]:
    path = db_path(root)
    result: dict[str, Any] = {"workspace": str(root), "runtimeInstalled": runtime_available(), "indexed": path.is_file(), "indexPath": str(path)}
    if path.is_file():
        db = connect(root)
        result.update({name: db.execute(f"SELECT COUNT(*) FROM {name}").fetchone()[0] for name in ("files", "symbols", "refs", "chunks")})
        row = db.execute("SELECT value FROM meta WHERE key='indexedAt'").fetchone()
        result["indexedAt"] = row[0] if row else None
        db.close()
    return result


def call(name: str, args: dict[str, Any]) -> Any:
    root = workspace_path(str(args.get("workspace", "")))
    if name == "codegraph_status":
        return status(root)
    if name == "codegraph_index":
        return index_workspace(root, bool(args.get("force", False)))
    if name == "codegraph_search":
        return hybrid_search(root, str(args.get("query", "")), min(max(int(args.get("limit", 10)), 1), 50))
    if name == "codegraph_symbol":
        return symbols(root, str(args.get("symbol", "")))
    if name == "codegraph_callers":
        return callers(root, str(args.get("symbol", "")), min(max(int(args.get("limit", 50)), 1), 100))
    if name == "codegraph_callees":
        return callees(root, str(args.get("symbol", "")), min(max(int(args.get("limit", 50)), 1), 100))
    if name == "codegraph_impact":
        return impact(root, str(args.get("symbol", "")), min(max(int(args.get("depth", 2)), 1), 5))
    if name == "codegraph_delete_index":
        if args.get("confirmed") is not True:
            raise RuntimeError("La suppression de l’index doit être confirmée")
        path = db_path(root)
        removed = path.exists()
        if removed:
            path.unlink()
        for suffix in ("-wal", "-shm"):
            pathlib.Path(str(path) + suffix).unlink(missing_ok=True)
        return {"removed": removed, "sourceFilesChanged": False}
    raise RuntimeError(f"Outil CodeGraph inconnu: {name}")


def result(value: Any) -> dict[str, Any]:
    return {"content": [{"type": "text", "text": json.dumps(value, ensure_ascii=False)}], "structuredContent": value, "isError": False}


def main() -> None:
    for raw in sys.stdin:
        try:
            request = json.loads(raw)
            rid, method = request.get("id"), request.get("method")
            if method == "initialize":
                payload = {"protocolVersion": "2025-06-18", "capabilities": {"tools": {}}, "serverInfo": {"name": "bob-work-codegraph", "version": "1.0.0"}}
            elif method == "tools/list":
                payload = {"tools": TOOLS}
            elif method == "tools/call":
                params = request.get("params", {})
                payload = result(call(params.get("name", ""), params.get("arguments", {})))
            elif method == "notifications/initialized":
                continue
            else:
                raise RuntimeError(f"Méthode MCP inconnue: {method}")
            print(json.dumps({"jsonrpc": "2.0", "id": rid, "result": payload}, ensure_ascii=False), flush=True)
        except Exception as exc:  # noqa: BLE001
            print(json.dumps({"jsonrpc": "2.0", "id": locals().get("rid"), "error": {"code": -32000, "message": str(exc)}}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
