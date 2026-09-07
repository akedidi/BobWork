#!/usr/bin/env python3
"""MCP stdio server wrapping the Docling CLI for Bob Work prompts."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import docling_runtime  # noqa: E402

TOOLS = [
    {
        "name": "docling_status",
        "description": "État de la CLI Docling (venv Bob Work, version, modèles, capacités).",
        "inputSchema": {"type": "object", "properties": {}},
    },
    {
        "name": "docling_ensure_runtime",
        "description": "Installe ou répare la CLI Docling épinglée (venv ~/.bob/runtimes/docling).",
        "inputSchema": {
            "type": "object",
            "properties": {"force": {"type": "boolean"}},
        },
    },
    {
        "name": "docling_convert",
        "description": (
            "Convertit un PDF, Office, image, HTML ou audio via la CLI Docling. "
            "Sorties : md, json, html, text, doctags. OCR, tableaux, formules, code, graphiques."
        ),
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string", "description": "Fichier local, dossier ou URL"},
                "to": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Formats: md, json, yaml, html, text, doctags, chunks",
                },
                "output": {"type": "string"},
                "ocr": {"type": "boolean"},
                "forceOcr": {"type": "boolean"},
                "ocrEngine": {"type": "string"},
                "ocrLang": {"type": "string"},
                "ocrMode": {"type": "string"},
                "tables": {"type": "boolean"},
                "tableMode": {"type": "string", "enum": ["fast", "accurate"]},
                "pipeline": {"type": "string", "enum": ["legacy", "standard", "vlm", "asr"]},
                "vlmModel": {"type": "string"},
                "asrModel": {"type": "string"},
                "pageRange": {"type": "string"},
                "imageExportMode": {"type": "string", "enum": ["placeholder", "embedded", "referenced"]},
                "enrichCode": {"type": "boolean"},
                "enrichFormula": {"type": "boolean"},
                "enrichPictureClasses": {"type": "boolean"},
                "enrichPictureDescription": {"type": "boolean"},
                "enrichChartExtraction": {"type": "boolean"},
                "pdfPassword": {"type": "string"},
            },
            "required": ["source"],
        },
    },
    {
        "name": "docling_ocr",
        "description": "OCR d’un PDF ou d’une image (full page) puis export Markdown/texte.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "ocrLang": {"type": "string"},
                "ocrEngine": {"type": "string"},
                "output": {"type": "string"},
                "to": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["source"],
        },
    },
    {
        "name": "docling_extract_tables",
        "description": "Extrait la structure des tableaux (mode accurate) en Markdown et JSON.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "output": {"type": "string"},
                "pageRange": {"type": "string"},
            },
            "required": ["source"],
        },
    },
    {
        "name": "docling_enrich",
        "description": "Conversion enrichie : code, formules, classification d’images, description, extraction de graphiques.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "output": {"type": "string"},
                "code": {"type": "boolean"},
                "formula": {"type": "boolean"},
                "pictureClasses": {"type": "boolean"},
                "pictureDescription": {"type": "boolean"},
                "charts": {"type": "boolean"},
            },
            "required": ["source"],
        },
    },
    {
        "name": "docling_transcribe",
        "description": "Transcription audio/vidéo via le pipeline ASR Docling (Whisper).",
        "inputSchema": {
            "type": "object",
            "properties": {
                "source": {"type": "string"},
                "asrModel": {"type": "string"},
                "output": {"type": "string"},
            },
            "required": ["source"],
        },
    },
    {
        "name": "docling_models_download",
        "description": "Télécharge les modèles Docling (layout, tableformer, OCR, VLM) dans le cache Bob Work.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "models": {"type": "array", "items": {"type": "string"}},
                "all": {"type": "boolean"},
            },
        },
    },
]


def send(request_id, result: dict) -> None:
    print(json.dumps({"jsonrpc": "2.0", "id": request_id, "result": result}, ensure_ascii=False), flush=True)


def send_error(request_id, message: str, code: int = -32000) -> None:
    print(
        json.dumps(
            {"jsonrpc": "2.0", "id": request_id, "error": {"code": code, "message": message}},
            ensure_ascii=False,
        ),
        flush=True,
    )


def tool_result(data: dict) -> dict:
    text = json.dumps(data, ensure_ascii=False, indent=2)
    return {"content": [{"type": "text", "text": text}], "structuredContent": data, "isError": not data.get("ok", True)}


def handle_call(name: str, arguments: dict) -> dict:
    if name == "docling_status":
        return tool_result({**docling_runtime.status_payload(), "ok": True})
    if name == "docling_ensure_runtime":
        return tool_result(docling_runtime.ensure_runtime(force=bool(arguments.get("force"))))
    if name == "docling_convert":
        options = {
            "to": arguments.get("to") or ["md"],
            "output": arguments.get("output"),
            "ocr": arguments.get("ocr"),
            "forceOcr": arguments.get("forceOcr"),
            "ocrEngine": arguments.get("ocrEngine"),
            "ocrLang": arguments.get("ocrLang"),
            "ocrMode": arguments.get("ocrMode"),
            "tables": arguments.get("tables"),
            "tableMode": arguments.get("tableMode"),
            "pipeline": arguments.get("pipeline"),
            "vlmModel": arguments.get("vlmModel"),
            "asrModel": arguments.get("asrModel"),
            "pageRange": arguments.get("pageRange"),
            "imageExportMode": arguments.get("imageExportMode"),
            "enrichCode": arguments.get("enrichCode"),
            "enrichFormula": arguments.get("enrichFormula"),
            "enrichPictureClasses": arguments.get("enrichPictureClasses"),
            "enrichPictureDescription": arguments.get("enrichPictureDescription"),
            "enrichChartExtraction": arguments.get("enrichChartExtraction"),
            "pdfPassword": arguments.get("pdfPassword"),
        }
        options = {key: value for key, value in options.items() if value is not None}
        return tool_result(docling_runtime.convert(str(arguments.get("source") or ""), options))
    if name == "docling_ocr":
        return tool_result(
            docling_runtime.convert(
                str(arguments.get("source") or ""),
                {
                    "to": arguments.get("to") or ["md", "text"],
                    "output": arguments.get("output"),
                    "ocr": True,
                    "forceOcr": True,
                    "ocrMode": "full_page",
                    "ocrLang": arguments.get("ocrLang"),
                    "ocrEngine": arguments.get("ocrEngine"),
                },
            )
        )
    if name == "docling_extract_tables":
        return tool_result(
            docling_runtime.convert(
                str(arguments.get("source") or ""),
                {
                    "to": ["md", "json"],
                    "output": arguments.get("output"),
                    "tables": True,
                    "tableMode": "accurate",
                    "pageRange": arguments.get("pageRange"),
                },
            )
        )
    if name == "docling_enrich":
        return tool_result(
            docling_runtime.convert(
                str(arguments.get("source") or ""),
                {
                    "to": ["md", "json"],
                    "output": arguments.get("output"),
                    "enrichCode": arguments.get("code", True),
                    "enrichFormula": arguments.get("formula", True),
                    "enrichPictureClasses": arguments.get("pictureClasses", True),
                    "enrichPictureDescription": arguments.get("pictureDescription", True),
                    "enrichChartExtraction": arguments.get("charts", True),
                },
            )
        )
    if name == "docling_transcribe":
        return tool_result(
            docling_runtime.convert(
                str(arguments.get("source") or ""),
                {
                    "to": ["md", "vtt"],
                    "output": arguments.get("output"),
                    "pipeline": "asr",
                    "asrModel": arguments.get("asrModel") or "whisper_turbo",
                },
            )
        )
    if name == "docling_models_download":
        models = arguments.get("models") if isinstance(arguments.get("models"), list) else None
        return tool_result(docling_runtime.download_models(models, all_models=bool(arguments.get("all"))))
    raise KeyError(name)


def main() -> None:
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            message = json.loads(line)
        except json.JSONDecodeError:
            continue
        method = message.get("method")
        request_id = message.get("id")
        if method == "initialize":
            send(
                request_id,
                {
                    "protocolVersion": "2025-06-18",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "bob-work-docling", "version": docling_runtime.DOCLING_VERSION},
                },
            )
            continue
        if method == "notifications/initialized":
            continue
        if method == "tools/list":
            send(request_id, {"tools": TOOLS})
            continue
        if method == "tools/call":
            params = message.get("params") or {}
            name = params.get("name")
            arguments = params.get("arguments") or {}
            try:
                send(request_id, handle_call(str(name), arguments if isinstance(arguments, dict) else {}))
            except KeyError:
                send_error(request_id, f"Unknown tool: {name}")
            except Exception as error:  # noqa: BLE001
                send_error(request_id, str(error))
            continue
        if request_id is not None:
            send_error(request_id, f"Unsupported method: {method}")


if __name__ == "__main__":
    main()
