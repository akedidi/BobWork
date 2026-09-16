#!/usr/bin/env python3
"""Export Bob Work Design IR JSON to a Sketch interchange package (.sketch).

The package is a ZIP with document.json / pages/*.json — the same adapter Bob Work
uses for Designer artifacts. Import fidelity depends on the Sketch-compatible app.
"""

from __future__ import annotations

import argparse
import json
import sys
import zipfile
from pathlib import Path
from typing import Any


SUPPORTED = {
    "Document",
    "Page",
    "Frame",
    "Section",
    "Group",
    "Component",
    "ComponentInstance",
    "Text",
    "Image",
    "Icon",
    "Vector",
    "Rectangle",
    "Ellipse",
    "Line",
    "Button",
    "Input",
    "Textarea",
    "Select",
    "Checkbox",
    "Radio",
    "Switch",
    "Tabs",
    "Navigation",
    "Menu",
    "Card",
    "Table",
    "List",
    "Modal",
    "Drawer",
    "Tooltip",
    "Badge",
    "Avatar",
    "Breadcrumb",
    "Pagination",
    "Chart",
    "Video",
    "Custom",
}

TYPE_ALIASES = {
    "document": "Document",
    "page": "Page",
    "frame": "Frame",
    "section": "Section",
    "group": "Group",
    "component": "ComponentInstance",
    "componentinstance": "ComponentInstance",
    "text": "Text",
    "heading": "Text",
    "paragraph": "Text",
    "label": "Text",
    "image": "Image",
    "icon": "Icon",
    "vector": "Vector",
    "rectangle": "Rectangle",
    "ellipse": "Ellipse",
    "line": "Line",
    "button": "Button",
    "input": "Input",
    "textarea": "Textarea",
    "select": "Select",
    "checkbox": "Checkbox",
    "radio": "Radio",
    "switch": "Switch",
    "tabs": "Tabs",
    "navigation": "Navigation",
    "nav": "Navigation",
    "menu": "Menu",
    "card": "Card",
    "table": "Table",
    "list": "List",
    "modal": "Modal",
    "drawer": "Drawer",
    "tooltip": "Tooltip",
    "badge": "Badge",
    "avatar": "Avatar",
    "breadcrumb": "Breadcrumb",
    "pagination": "Pagination",
    "chart": "Chart",
    "video": "Video",
    "custom": "Custom",
    "content": "Group",
}


def fail(message: str) -> None:
    print(f"export_sketch: {message}", file=sys.stderr)
    raise SystemExit(1)


def canonicalize_type(raw: Any) -> str:
    if not isinstance(raw, str) or not raw.strip():
        return "Group"
    key = raw.strip()
    if key in SUPPORTED:
        return key
    return TYPE_ALIASES.get(key.lower().replace(" ", "").replace("_", ""), "Custom")


def node_text(node: dict[str, Any]) -> str:
    for key in ("text", "heading", "body", "eyebrow", "label", "alt", "name"):
        value = node.get(key)
        if isinstance(value, str) and value.strip():
            return value
    return ""


def normalize_node(node: Any, fallback_id: str) -> dict[str, Any] | None:
    if not isinstance(node, dict):
        return None
    node_id = node.get("id")
    if not isinstance(node_id, str) or not node_id.strip():
        node_id = fallback_id
    kind = canonicalize_type(node.get("type"))
    children: list[dict[str, Any]] = []

    raw_children = node.get("children")
    if isinstance(raw_children, list):
        for index, child in enumerate(raw_children):
            normalized = normalize_node(child, f"{node_id}-child-{index}")
            if normalized:
                children.append(normalized)

    raw_nodes = node.get("nodes")
    if isinstance(raw_nodes, list):
        for index, child in enumerate(raw_nodes):
            normalized = normalize_node(child, f"{node_id}-node-{index}")
            if normalized:
                children.append(normalized)

    raw_sections = node.get("sections")
    if isinstance(raw_sections, list):
        for index, child in enumerate(raw_sections):
            if isinstance(child, dict) and "type" not in child:
                child = {**child, "type": "Section"}
            normalized = normalize_node(child, f"{node_id}-section-{index}")
            if normalized:
                children.append(normalized)

    items = node.get("items")
    if isinstance(items, list):
        for index, item in enumerate(items):
            if isinstance(item, str):
                children.append(
                    {
                        "id": f"{node_id}-item-{index}",
                        "type": "Text",
                        "name": item,
                        "text": item,
                    }
                )
            else:
                normalized = normalize_node(item, f"{node_id}-item-{index}")
                if normalized:
                    children.append(normalized)

    actions = node.get("actions")
    if isinstance(actions, list):
        for index, action in enumerate(actions):
            if isinstance(action, str):
                children.append(
                    {
                        "id": f"{node_id}-action-{index}",
                        "type": "Button",
                        "name": action,
                        "text": action,
                    }
                )

    # Flatten content-style bags into text children when no nested nodes exist.
    if kind == "Group" and not children:
        for key in ("eyebrow", "heading", "body"):
            value = node.get(key)
            if isinstance(value, str) and value.strip():
                children.append(
                    {
                        "id": f"{node_id}-{key}",
                        "type": "Text",
                        "name": key,
                        "text": value,
                    }
                )

    layout = node.get("layout")
    layout_obj: dict[str, Any] = {}
    if isinstance(layout, dict):
        layout_obj = dict(layout)
    elif isinstance(layout, str):
        layout_obj["mode"] = layout.upper()
    for key in ("width", "height", "gap", "padding"):
        if key in node and key not in layout_obj:
            layout_obj[key] = node[key]
    artboard = node.get("artboard")
    if isinstance(artboard, dict):
        for key in ("width", "height"):
            if key in artboard and key not in layout_obj:
                layout_obj[key] = artboard[key]

    out: dict[str, Any] = {
        "id": node_id,
        "type": kind,
        "name": str(node.get("name") or node_text(node) or node_id),
    }
    text = node_text(node)
    if text:
        out["text"] = text
    if layout_obj:
        out["layout"] = layout_obj
    if children:
        out["children"] = children
    return out


def normalize_design_ir(document: dict[str, Any]) -> dict[str, Any]:
    """Accept canonical Design IR or a loose designer draft and return canonical form."""
    version = document.get("version")
    if version not in (None, "1.0", 1, 1.0):
        fail(f'Unsupported Design IR version (expected "1.0", got {version!r})')

    nested = document.get("document")
    pages = None
    title = None
    if isinstance(nested, dict):
        pages = nested.get("pages")
        title = nested.get("name")
    if not isinstance(pages, list) or not pages:
        pages = document.get("pages")
    if not isinstance(pages, list) or not pages:
        fail("Design IR requires document.pages (or top-level pages)")

    metadata = document.get("metadata") if isinstance(document.get("metadata"), dict) else {}
    title = (
        metadata.get("title")
        or title
        or document.get("name")
        or document.get("title")
        or "Bob Work design"
    )

    normalized_pages: list[dict[str, Any]] = []
    for index, page in enumerate(pages):
        if not isinstance(page, dict):
            continue
        page_copy = dict(page)
        if "type" not in page_copy:
            page_copy["type"] = "Page"
        normalized = normalize_node(page_copy, f"page-{index + 1}")
        if normalized:
            normalized["type"] = "Page"
            normalized_pages.append(normalized)
    if not normalized_pages:
        fail("Design IR pages could not be normalized")

    tokens = document.get("tokens") if isinstance(document.get("tokens"), dict) else {}
    components = (
        document.get("components") if isinstance(document.get("components"), dict) else {}
    )
    assets = document.get("assets") if isinstance(document.get("assets"), dict) else {}

    return {
        "version": "1.0",
        "document": {"name": str(title), "pages": normalized_pages},
        "tokens": tokens,
        "components": components,
        "assets": assets,
        "metadata": {"title": str(title), **{k: v for k, v in metadata.items() if k != "title"}},
    }


def validate(node: Any, ids: set[str]) -> None:
    if not isinstance(node, dict):
        fail("Design node must be an object")
    node_id = node.get("id")
    if not isinstance(node_id, str) or not node_id.strip():
        fail("Every design node requires an id")
    if node_id in ids:
        fail(f"Duplicate design node id: {node_id}")
    ids.add(node_id)
    kind = node.get("type")
    if kind not in SUPPORTED:
        fail(f"Unsupported design node type: {kind}")
    children = node.get("children")
    if children is None:
        return
    if not isinstance(children, list):
        fail("Design node children must be an array")
    for child in children:
        validate(child, ids)


def frame_of(node: dict[str, Any], default_w: float = 375, default_h: float = 100) -> dict[str, Any]:
    layout = node.get("layout") if isinstance(node.get("layout"), dict) else {}
    width = layout.get("width", default_w)
    height = layout.get("height", default_h)
    if width in ("fill", "hug", None):
        width = default_w
    if height in ("fill", "hug", None):
        height = default_h
    try:
        width = float(width)
    except (TypeError, ValueError):
        width = default_w
    try:
        height = float(height)
    except (TypeError, ValueError):
        height = default_h
    return {"_class": "rect", "x": 0, "y": 0, "width": width, "height": height}


def sketch_layer(node: dict[str, Any]) -> dict[str, Any]:
    node_id = str(node.get("id") or "node")
    name = str(node.get("name") or node.get("text") or node_id)
    kind = str(node.get("type") or "Group")
    children = [
        sketch_layer(child)
        for child in (node.get("children") or [])
        if isinstance(child, dict)
    ]
    if kind == "Text":
        return {
            "_class": "MSImmutableTextLayer",
            "do_objectID": node_id,
            "name": name,
            "attributedString": {
                "_class": "attributedString",
                "string": str(node.get("text") or ""),
                "attributes": [],
            },
            "frame": frame_of(node, 200, 28),
        }
    if kind == "Button":
        return {
            "_class": "MSImmutableGroup",
            "do_objectID": node_id,
            "name": name,
            "layers": [
                {
                    "_class": "MSImmutableTextLayer",
                    "do_objectID": f"{node_id}-label",
                    "name": f"{name} label",
                    "attributedString": {
                        "_class": "attributedString",
                        "string": str(node.get("text") or name),
                        "attributes": [],
                    },
                    "frame": frame_of(node, 160, 24),
                }
            ],
            "frame": frame_of(node, 180, 44),
            "hasClickThrough": False,
        }
    return {
        "_class": "MSImmutableGroup",
        "do_objectID": node_id,
        "name": name,
        "layers": children,
        "frame": frame_of(node),
        "hasClickThrough": False,
    }


def build_package(document: dict[str, Any]) -> dict[str, Any]:
    canonical = normalize_design_ir(document)
    pages = canonical["document"]["pages"]
    ids: set[str] = set()
    for page in pages:
        validate(page, ids)
    title = canonical["metadata"]["title"]
    layers = [sketch_layer(page) for page in pages if isinstance(page, dict)]
    return {
        "title": str(title),
        "page": {
            "_class": "MSImmutablePage",
            "do_objectID": "bobwork-page-1",
            "name": str(title),
            "layers": layers,
        },
        "document": {
            "_class": "document",
            "do_objectID": "bobwork-document-1",
            "assets": {
                "_class": "assetCollection",
                "colors": [],
                "colorAssets": [],
                "gradients": [],
                "images": [],
            },
            "layerStyles": {"_class": "sharedStyleContainer", "objects": []},
            "layerTextStyles": {"_class": "sharedTextStyleContainer", "objects": []},
            "pages": [
                {
                    "_class": "MSJSONFileReference",
                    "_ref_class": "MSImmutablePage",
                    "_ref": "pages/bobwork-page-1",
                }
            ],
            "foreignSymbols": [],
            "foreignLayerStyles": [],
            "foreignTextStyles": [],
        },
    }


def write_sketch(ir_path: Path, out_path: Path) -> None:
    try:
        document = json.loads(ir_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"invalid JSON in {ir_path}: {error}")
    if not isinstance(document, dict):
        fail("Design IR root must be an object")
    package = build_package(document)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(out_path, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "document.json",
            json.dumps(package["document"], indent=2, ensure_ascii=False),
        )
        archive.writestr(
            "pages/bobwork-page-1.json",
            json.dumps(package["page"], indent=2, ensure_ascii=False),
        )
        archive.writestr(
            "meta.json",
            json.dumps(
                {"version": 132, "appVersion": "Bob Work Designer 2.0"},
                indent=2,
            ),
        )
        archive.writestr("user.json", "{}")
        archive.writestr("workspace.json", "{}")
    print(out_path.resolve())


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("design_ir", type=Path, help="Path to Design IR JSON (version 1.0)")
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        help="Output .sketch path (default: <input>.sketch)",
    )
    args = parser.parse_args()
    if not args.design_ir.is_file():
        fail(f"Design IR not found: {args.design_ir}")
    output = args.output or args.design_ir.with_suffix(".sketch")
    if output.suffix.lower() != ".sketch":
        output = output.with_suffix(".sketch")
    write_sketch(args.design_ir, output)


if __name__ == "__main__":
    main()
