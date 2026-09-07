#!/usr/bin/env python3
"""Locate, bootstrap and invoke the pinned Docling CLI for Bob Work."""

from __future__ import annotations

import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any

DOCLING_VERSION = "2.123.0"
PLUGIN_SLUG = "bob-work-docling"
CONVERT_TIMEOUT = 900
INSTALL_TIMEOUT = 600
MODELS_TIMEOUT = 1800

OUTPUT_FORMATS = (
    "md",
    "json",
    "yaml",
    "html",
    "html_split_page",
    "text",
    "doctags",
    "vtt",
    "doclang",
    "dclx",
    "chunks",
)
PIPELINES = ("legacy", "standard", "vlm", "asr")
TABLE_MODES = ("fast", "accurate")
IMAGE_EXPORT_MODES = ("placeholder", "embedded", "referenced")
OCR_ENGINES = ("auto", "easyocr", "rapidocr", "tesseract", "tesserocr", "ocrmac")
OCR_MODES = ("full_page", "layout_regions", "pdf_aware_layout_regions", "default")


def bob_home() -> Path:
    override = os.environ.get("BOB_HOME", "").strip()
    if override:
        return Path(override).expanduser()
    return Path.home() / ".bob"


def runtime_root() -> Path:
    return bob_home() / "runtimes" / "docling" / DOCLING_VERSION


def models_dir() -> Path:
    return bob_home() / "runtimes" / "docling" / "models"


def install_spec() -> str:
    if sys.platform == "darwin" and platform.machine().lower() in {"x86_64", "i386", "i686"}:
        return f"docling[mac_intel]=={DOCLING_VERSION}"
    return f"docling=={DOCLING_VERSION}"


def _which(name: str) -> str | None:
    path = shutil.which(name)
    return path if path else None


def _is_executable(path: Path) -> bool:
    return path.is_file() and os.access(path, os.X_OK)


def _probe_version(binary: str) -> str | None:
    try:
        result = subprocess.run(
            [binary, "--version"],
            capture_output=True,
            text=True,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    text = (result.stdout or result.stderr or "").strip()
    return text.splitlines()[0] if text else None


def uses_convert_subcommand(binary: str) -> bool:
    """Docling < 2.92 takes `docling <file>`; current CLIs use `docling convert <file>`."""
    try:
        result = subprocess.run(
            [binary, "--help"],
            capture_output=True,
            text=True,
            timeout=25,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return True
    text = f"{result.stdout}\n{result.stderr}"
    lowered = text.lower()
    if "docling convert" in lowered or "command [args]" in lowered:
        return True
    if "[options] source" in lowered or "input_sources" in lowered:
        return False
    return True


def adapt_cli_argv(binary: str, argv: list[str]) -> list[str]:
    if argv and argv[0] == "convert" and not uses_convert_subcommand(binary):
        return argv[1:]
    return argv


def resolve_docling() -> dict[str, Any]:
    env_bin = os.environ.get("DOCLING_BIN", "").strip()
    candidates: list[tuple[str, str]] = []
    if env_bin:
        candidates.append((env_bin, "env"))
    runtime_bin = runtime_root() / "bin" / "docling"
    if _is_executable(runtime_bin):
        candidates.append((str(runtime_bin), "bob-runtime"))
    path_bin = _which("docling")
    if path_bin:
        candidates.append((path_bin, "path"))

    for binary, origin in candidates:
        version = _probe_version(binary)
        if version is None and origin == "path":
            continue
        if version is None and origin != "path":
            version = f"docling {DOCLING_VERSION}"
        return {
            "ok": True,
            "binary": binary,
            "origin": origin,
            "version": version,
            "runtimeRoot": str(runtime_root()),
            "modelsDir": str(models_dir()),
            "pinned": DOCLING_VERSION,
        }
    return {
        "ok": False,
        "binary": None,
        "origin": None,
        "version": None,
        "runtimeRoot": str(runtime_root()),
        "modelsDir": str(models_dir()),
        "pinned": DOCLING_VERSION,
        "message": (
            "CLI Docling absente. Bob Work l’installe dans "
            f"{runtime_root()} (Python ≥ 3.10, Docling {DOCLING_VERSION})."
        ),
    }


def _run(command: list[str], timeout: int, cwd: Path | None = None) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        command,
        cwd=str(cwd) if cwd else None,
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )


def ensure_runtime(force: bool = False) -> dict[str, Any]:
    status = resolve_docling()
    if status.get("ok") and not force and status.get("origin") in {"env", "bob-runtime"}:
        return {**status, "installed": False}
    if status.get("ok") and not force and status.get("origin") == "path":
        return {**status, "installed": False}

    root = runtime_root()
    root.mkdir(parents=True, exist_ok=True)
    python = root / "bin" / "python3"
    uv = _which("uv")
    logs: list[str] = []

    if not python.is_file() or force:
        if uv:
            cmd = [uv, "venv", str(root), "--python", "3.12"]
            result = _run(cmd, INSTALL_TIMEOUT)
            logs.append((result.stderr or result.stdout or "").strip())
            if result.returncode != 0:
                result = _run([uv, "venv", str(root)], INSTALL_TIMEOUT)
                logs.append((result.stderr or result.stdout or "").strip())
        if not python.is_file():
            host = sys.executable or "python3"
            result = _run([host, "-m", "venv", str(root)], INSTALL_TIMEOUT)
            logs.append((result.stderr or result.stdout or "").strip())
            if result.returncode != 0:
                return {
                    "ok": False,
                    "installed": False,
                    "message": "Impossible de créer le venv Docling (Python 3.10+ requis).",
                    "log": "\n".join(item for item in logs if item)[-4000:],
                    "pinned": DOCLING_VERSION,
                    "runtimeRoot": str(root),
                }

    spec = install_spec()
    if uv and python.is_file():
        install_cmd = [uv, "pip", "install", "--python", str(python), spec]
    else:
        install_cmd = [str(python), "-m", "pip", "install", "--upgrade", spec]
    result = _run(install_cmd, INSTALL_TIMEOUT)
    logs.append((result.stderr or result.stdout or "").strip())
    if result.returncode != 0:
        return {
            "ok": False,
            "installed": False,
            "message": f"Échec de l’installation de {spec}. Vérifiez le réseau et Python 3.10+.",
            "log": "\n".join(item for item in logs if item)[-4000:],
            "pinned": DOCLING_VERSION,
            "runtimeRoot": str(root),
        }

    status = resolve_docling()
    status["installed"] = True
    if not status.get("ok"):
        status["message"] = "Docling a été installé mais le binaire `docling` est introuvable dans le venv."
        status["log"] = "\n".join(item for item in logs if item)[-2000:]
    return status


def _as_bool(value: Any, default: bool = False) -> bool:
    if value is None:
        return default
    if isinstance(value, bool):
        return value
    if isinstance(value, (int, float)):
        return bool(value)
    text = str(value).strip().lower()
    if text in {"1", "true", "yes", "on"}:
        return True
    if text in {"0", "false", "no", "off"}:
        return False
    return default


def _as_list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    text = str(value).strip()
    if not text:
        return []
    return [part.strip() for part in text.replace(";", ",").split(",") if part.strip()]


def build_convert_args(source: str, options: dict[str, Any] | None = None) -> list[str]:
    options = options or {}
    args = ["convert", source]
    for fmt in _as_list(options.get("to") or options.get("formats") or "md"):
        if fmt in {"markdown", "md"}:
            fmt = "md"
        if fmt not in OUTPUT_FORMATS:
            raise ValueError(f"Format de sortie non supporté: {fmt}")
        args.extend(["--to", fmt])
    for fmt in _as_list(options.get("from") or options.get("input_formats") or []):
        args.extend(["--from", fmt])

    output = str(options.get("output") or "").strip()
    if output:
        args.extend(["--output", output])

    pipeline = str(options.get("pipeline") or "").strip()
    if pipeline:
        if pipeline not in PIPELINES:
            raise ValueError(f"Pipeline inconnue: {pipeline}")
        args.extend(["--pipeline", pipeline])

    if "ocr" in options:
        args.append("--ocr" if _as_bool(options.get("ocr"), True) else "--no-ocr")
    if _as_bool(options.get("force_ocr") or options.get("forceOcr")):
        args.append("--force-ocr")
    ocr_engine = str(options.get("ocr_engine") or options.get("ocrEngine") or "").strip()
    if ocr_engine:
        args.extend(["--ocr-engine", ocr_engine])
    ocr_lang = str(options.get("ocr_lang") or options.get("ocrLang") or "").strip()
    if ocr_lang:
        args.extend(["--ocr-lang", ocr_lang])
    ocr_mode = str(options.get("ocr_mode") or options.get("ocrMode") or "").strip()
    if ocr_mode:
        args.extend(["--ocr-mode", ocr_mode])

    if "tables" in options:
        args.append("--tables" if _as_bool(options.get("tables"), True) else "--no-tables")
    table_mode = str(options.get("table_mode") or options.get("tableMode") or "").strip()
    if table_mode:
        if table_mode not in TABLE_MODES:
            raise ValueError(f"Mode tableau inconnu: {table_mode}")
        args.extend(["--table-mode", table_mode])

    image_mode = str(options.get("image_export_mode") or options.get("imageExportMode") or "").strip()
    if image_mode:
        if image_mode not in IMAGE_EXPORT_MODES:
            raise ValueError(f"Mode image inconnu: {image_mode}")
        args.extend(["--image-export-mode", image_mode])

    page_range = str(options.get("page_range") or options.get("pageRange") or "").strip()
    if page_range:
        args.extend(["--page-range", page_range])
    vlm_model = str(options.get("vlm_model") or options.get("vlmModel") or "").strip()
    if vlm_model:
        args.extend(["--vlm-model", vlm_model])
    asr_model = str(options.get("asr_model") or options.get("asrModel") or "").strip()
    if asr_model:
        args.extend(["--asr-model", asr_model])
    password = str(options.get("pdf_password") or options.get("pdfPassword") or "").strip()
    if password:
        args.extend(["--pdf-password", password])

    if _as_bool(options.get("enrich_code") or options.get("enrichCode")):
        args.append("--enrich-code")
    if _as_bool(options.get("enrich_formula") or options.get("enrichFormula")):
        args.append("--enrich-formula")
    if _as_bool(options.get("enrich_picture_classes") or options.get("enrichPictureClasses")):
        args.append("--enrich-picture-classes")
    if _as_bool(options.get("enrich_picture_description") or options.get("enrichPictureDescription")):
        args.append("--enrich-picture-description")
    if _as_bool(options.get("enrich_chart_extraction") or options.get("enrichChartExtraction")):
        args.append("--enrich-chart-extraction")

    artifacts = str(options.get("artifacts_path") or options.get("artifactsPath") or models_dir()).strip()
    if artifacts:
        Path(artifacts).mkdir(parents=True, exist_ok=True)
        args.extend(["--artifacts-path", artifacts])
    return args


def _list_outputs(directory: Path, before: set[str]) -> list[str]:
    if not directory.is_dir():
        return []
    created: list[str] = []
    for path in sorted(directory.rglob("*")):
        if path.is_file() and str(path) not in before:
            created.append(str(path))
    return created


def run_docling(argv: list[str], timeout: int = CONVERT_TIMEOUT, cwd: str | None = None) -> dict[str, Any]:
    status = resolve_docling()
    if not status.get("ok"):
        status = ensure_runtime()
    if not status.get("ok") or not status.get("binary"):
        return {
            "ok": False,
            "message": status.get("message") or "CLI Docling indisponible.",
            "status": status,
        }
    binary = str(status["binary"])
    command = [binary, *adapt_cli_argv(binary, argv)]
    workdir = Path(cwd).expanduser() if cwd else Path.cwd()
    output_dir = workdir
    if "--output" in argv:
        try:
            output_dir = Path(argv[argv.index("--output") + 1]).expanduser()
        except (ValueError, IndexError):
            output_dir = workdir
    output_dir.mkdir(parents=True, exist_ok=True)
    before = {str(path) for path in output_dir.rglob("*") if path.is_file()} if output_dir.is_dir() else set()
    try:
        result = subprocess.run(
            command,
            cwd=str(workdir),
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {
            "ok": False,
            "command": _redact(command),
            "message": f"Docling a dépassé {timeout}s.",
            "status": status,
        }
    outputs = _list_outputs(output_dir, before)
    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()
    return {
        "ok": result.returncode == 0,
        "exitCode": result.returncode,
        "command": _redact(command),
        "stdout": stdout[-8000:],
        "stderr": stderr[-4000:],
        "outputs": outputs,
        "outputDir": str(output_dir),
        "status": {k: v for k, v in status.items() if k != "log"},
        "message": "Conversion Docling terminée." if result.returncode == 0 else (stderr or stdout or "Docling a échoué."),
    }


def convert(source: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
    source = str(source or "").strip().strip("'\"")
    if not source:
        raise ValueError("source est requis (fichier local, dossier ou URL)")
    path = Path(source).expanduser()
    if "://" not in source and not path.exists():
        raise ValueError(f"Fichier introuvable: {path}")
    options = dict(options or {})
    if not options.get("output") and path.exists() and path.is_file():
        options["output"] = str(path.parent)
    args = build_convert_args(str(path if path.exists() else source), options)
    return run_docling(args, timeout=int(options.get("timeout") or CONVERT_TIMEOUT))


def _models_command(binary: str, models: list[str] | None, all_models: bool) -> list[str]:
    suffix = ["models", "download"]
    if all_models:
        suffix.append("--all")
    elif models:
        suffix.extend(models)
    suffix.extend(["-o", str(models_dir())])
    tools = Path(binary).parent / "docling-tools"
    if _is_executable(tools):
        return [str(tools), *suffix]
    python = Path(binary).parent / "python3"
    if python.is_file():
        return [str(python), "-m", "docling.cli.tools", *suffix]
    return [binary, "tools", *suffix]


def download_models(models: list[str] | None = None, all_models: bool = False) -> dict[str, Any]:
    status = resolve_docling()
    if not status.get("ok"):
        status = ensure_runtime()
    if not status.get("ok") or not status.get("binary"):
        return {**status, "ok": False, "message": status.get("message") or "CLI Docling indisponible."}
    models_dir().mkdir(parents=True, exist_ok=True)
    command = _models_command(str(status["binary"]), models, all_models)
    try:
        result = subprocess.run(
            command,
            capture_output=True,
            text=True,
            timeout=MODELS_TIMEOUT,
            check=False,
        )
    except subprocess.TimeoutExpired:
        return {"ok": False, "message": "Téléchargement des modèles Docling trop long.", "command": command}
    ok = result.returncode == 0
    return {
        "ok": ok,
        "command": command,
        "stdout": (result.stdout or "")[-4000:],
        "stderr": (result.stderr or "")[-4000:],
        "modelsDir": str(models_dir()),
        "message": "Modèles Docling téléchargés." if ok else ((result.stderr or result.stdout or "échec").strip()),
    }


def _redact(command: list[str]) -> list[str]:
    redacted: list[str] = []
    skip = False
    for part in command:
        if skip:
            skip = False
            redacted.append("***")
            continue
        if part in {"--pdf-password", "--headers", "--html-image-headers"}:
            redacted.append(part)
            skip = True
            continue
        redacted.append(part)
    return redacted


def capabilities() -> dict[str, Any]:
    return {
        "plugin": PLUGIN_SLUG,
        "cli": f"docling=={DOCLING_VERSION}",
        "inputs": [
            "pdf", "docx", "pptx", "xlsx", "html", "md", "image", "audio", "latex", "csv",
        ],
        "outputs": list(OUTPUT_FORMATS),
        "features": {
            "ocr": True,
            "tables": True,
            "enrichCode": True,
            "enrichFormula": True,
            "enrichPictureClasses": True,
            "enrichPictureDescription": True,
            "enrichChartExtraction": True,
            "vlm": True,
            "asr": True,
        },
        "pipelines": list(PIPELINES),
        "ocrEngines": list(OCR_ENGINES),
        "ocrModes": list(OCR_MODES),
        "modelsDir": str(models_dir()),
        "runtimeRoot": str(runtime_root()),
    }


def status_payload() -> dict[str, Any]:
    resolved = resolve_docling()
    return {**capabilities(), **resolved}


def main(argv: list[str] | None = None) -> int:
    argv = list(sys.argv[1:] if argv is None else argv)
    if not argv or argv[0] in {"-h", "--help", "help"}:
        print(
            "Bob Work Docling CLI\n"
            "  status\n"
            "  ensure [--force]\n"
            "  convert <source> [options docling…]\n"
            "  models download [model…]\n"
            "  --self-test\n"
            "Toute autre commande est transmise à l’exécutable Docling.",
            flush=True,
        )
        return 0
    if argv == ["--self-test"]:
        args = build_convert_args(
            "/tmp/report.pdf",
            {
                "to": ["md", "json"],
                "ocr": True,
                "tables": True,
                "table_mode": "accurate",
                "enrich_code": True,
                "enrich_formula": True,
                "enrich_chart_extraction": True,
                "output": "/tmp/out",
                "artifacts_path": "/tmp/models",
            },
        )
        assert args[:2] == ["convert", "/tmp/report.pdf"]
        assert "--to" in args and "md" in args and "json" in args
        assert "--enrich-code" in args and "--enrich-formula" in args
        assert "--enrich-chart-extraction" in args
        assert "--table-mode" in args
        assert adapt_cli_argv("missing", ["convert", "file.pdf"]) == ["convert", "file.pdf"]
        print("ok", flush=True)
        return 0
    if argv[0] == "status":
        print(json.dumps(status_payload(), ensure_ascii=False, indent=2))
        return 0 if resolve_docling().get("ok") else 2
    if argv[0] == "ensure":
        payload = ensure_runtime(force="--force" in argv)
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return 0 if payload.get("ok") else 1
    if argv[0] == "convert":
        if len(argv) < 2:
            print("usage: convert <source> [--to md] [--output DIR] …", file=sys.stderr)
            return 2
        source = argv[1]
        passthrough = argv[2:]
        if passthrough:
            result = run_docling(["convert", source, *passthrough])
        else:
            result = convert(source, {"to": ["md"]})
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0 if result.get("ok") else 1
    if argv[0] in {"models", "tools"}:
        rest = argv[1:]
        if rest[:1] == ["download"] or rest[:2] == ["models", "download"]:
            models = rest[1:] if rest[:1] == ["download"] else rest[2:]
            all_models = "--all" in models
            models = [item for item in models if item != "--all"]
            result = download_models(models or None, all_models=all_models)
            print(json.dumps(result, ensure_ascii=False, indent=2))
            return 0 if result.get("ok") else 1
        result = run_docling(argv)
        print(result.get("stdout") or result.get("stderr") or result.get("message") or "")
        return 0 if result.get("ok") else 1
    result = run_docling(argv)
    text = result.get("stdout") or ""
    if result.get("stderr"):
        print(result["stderr"], file=sys.stderr)
    if text:
        print(text)
    elif result.get("message"):
        print(result["message"])
    return 0 if result.get("ok") else 1


if __name__ == "__main__":
    sys.exit(main())
