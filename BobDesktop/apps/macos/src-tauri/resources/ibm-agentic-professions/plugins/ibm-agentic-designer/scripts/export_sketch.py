#!/usr/bin/env python3
"""Export Bob Work Design IR JSON to a Sketch interchange package (.sketch).

The package is a ZIP with document.json / pages/*.json — the same adapter Bob Work
uses for Designer artifacts. Import fidelity depends on the Sketch-compatible app.
"""

from __future__ import annotations

import argparse
import json
import math
import re
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
            else:
                normalized = normalize_node(action, f"{node_id}-action-{index}")
                if normalized:
                    if normalized["type"] in {"Group", "Custom"}:
                        normalized["type"] = "Button"
                    children.append(normalized)

    # Flatten content-style bags into text children when no nested nodes exist.
    if kind not in {"Text", "Button", "Input", "Textarea", "Select"} and not children:
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
    style = node.get("style")
    if isinstance(style, dict):
        out["style"] = dict(style)
    token_refs = node.get("tokenRefs")
    if isinstance(token_refs, dict):
        out["tokenRefs"] = dict(token_refs)
    for key in ("role", "accessibleName", "componentId"):
        if isinstance(node.get(key), str):
            out[key] = node[key]
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


def number(value: Any, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return parsed if math.isfinite(parsed) else fallback


def padding_values(value: Any) -> tuple[float, float, float, float]:
    if isinstance(value, (int, float)):
        side = max(0.0, float(value))
        return side, side, side, side
    if isinstance(value, list):
        values = [max(0.0, number(item, 0)) for item in value]
        if len(values) == 2:
            return values[0], values[1], values[0], values[1]
        if len(values) == 4:
            return values[0], values[1], values[2], values[3]
    return 0.0, 0.0, 0.0, 0.0


def color(value: Any, fallback: str = "#000000") -> dict[str, Any]:
    raw = str(value or fallback).strip().lower()
    named = {"white": "#ffffff", "black": "#000000", "transparent": "#00000000"}
    raw = named.get(raw, raw)
    red = green = blue = 0.0
    alpha = 1.0
    match = re.fullmatch(r"#([0-9a-f]{3,8})", raw)
    if match:
        digits = match.group(1)
        if len(digits) in (3, 4):
            digits = "".join(char * 2 for char in digits)
        if len(digits) in (6, 8):
            red, green, blue = (int(digits[index:index + 2], 16) / 255 for index in (0, 2, 4))
            if len(digits) == 8:
                alpha = int(digits[6:8], 16) / 255
    else:
        match = re.fullmatch(
            r"rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)",
            raw,
        )
        if match:
            red, green, blue = (min(255.0, number(match.group(index), 0)) / 255 for index in (1, 2, 3))
            alpha = min(1.0, max(0.0, number(match.group(4), 1)))
    return {
        "_class": "color",
        "alpha": alpha,
        "blue": blue,
        "colorSpace": 0,
        "green": green,
        "red": red,
    }


def resolve_token(value: Any, tokens: dict[str, Any]) -> Any:
    if not isinstance(value, str):
        return value
    key = value.strip()
    for wrapper in (("{", "}"), ("$", "")):
        if key.startswith(wrapper[0]) and (not wrapper[1] or key.endswith(wrapper[1])):
            candidate = key[len(wrapper[0]):len(key) - len(wrapper[1]) if wrapper[1] else None]
            token = tokens.get(candidate)
            if isinstance(token, dict) and "value" in token:
                return token["value"]
    return value


def resolved_style(node: dict[str, Any], tokens: dict[str, Any]) -> dict[str, Any]:
    source = node.get("style") if isinstance(node.get("style"), dict) else {}
    result = {key: resolve_token(value, tokens) for key, value in source.items()}
    refs = node.get("tokenRefs") if isinstance(node.get("tokenRefs"), dict) else {}
    for property_name, token_name in refs.items():
        token = tokens.get(str(token_name))
        if isinstance(token, dict) and "value" in token:
            result[property_name] = token["value"]
    return result


def frame(x: float, y: float, width: float, height: float) -> dict[str, Any]:
    return {
        "_class": "rect",
        "x": round(x, 3),
        "y": round(y, 3),
        "width": round(max(0.0, width), 3),
        "height": round(max(0.0, height), 3),
    }


def measure(node: dict[str, Any], available_width: float | None = None, available_height: float | None = None) -> tuple[float, float]:
    layout = node.get("layout") if isinstance(node.get("layout"), dict) else {}
    kind = str(node.get("type") or "Group")
    width_value = layout.get("width")
    height_value = layout.get("height")
    if kind == "Page":
        default_width, default_height = 390.0, 844.0
    elif kind == "Text":
        font_size = number((node.get("style") or {}).get("fontSize") if isinstance(node.get("style"), dict) else None, 16)
        text = str(node.get("text") or "")
        default_width = min(max(40.0, len(text) * font_size * 0.56), available_width or 280.0)
        default_height = number((node.get("style") or {}).get("lineHeight") if isinstance(node.get("style"), dict) else None, font_size * 1.35)
    elif kind in {"Button", "Input", "Select"}:
        default_width, default_height = 180.0, 44.0
    elif kind == "Textarea":
        default_width, default_height = 280.0, 120.0
    elif kind in {"Icon", "Avatar"}:
        default_width, default_height = 40.0, 40.0
    else:
        default_width, default_height = available_width or 375.0, 100.0

    width = available_width if width_value == "fill" and available_width is not None else number(width_value, default_width)
    height = available_height if height_value == "fill" and available_height is not None else number(height_value, default_height)
    children = [child for child in node.get("children", []) if isinstance(child, dict)]
    if children and (width_value in (None, "hug") or height_value in (None, "hug")) and kind != "Page":
        top, right, bottom, left = padding_values(layout.get("padding"))
        gap = max(0.0, number(layout.get("gap"), 0))
        child_sizes = [measure(child, max(0.0, width - left - right)) for child in children]
        mode = str(layout.get("mode") or "VERTICAL").upper()
        if mode == "HORIZONTAL":
            content_width = sum(size[0] for size in child_sizes) + gap * max(0, len(child_sizes) - 1)
            content_height = max((size[1] for size in child_sizes), default=0)
        elif mode == "GRID":
            columns = max(1, int(number(layout.get("columns"), 2)))
            rows = math.ceil(len(child_sizes) / columns)
            content_width = max((size[0] for size in child_sizes), default=0) * columns + gap * (columns - 1)
            content_height = max((size[1] for size in child_sizes), default=0) * rows + gap * max(0, rows - 1)
        else:
            content_width = max((size[0] for size in child_sizes), default=0)
            content_height = sum(size[1] for size in child_sizes) + gap * max(0, len(child_sizes) - 1)
        if width_value in (None, "hug"):
            width = max(default_width if width_value is None else 0, content_width + left + right)
        if height_value in (None, "hug"):
            height = max(default_height if height_value is None else 0, content_height + top + bottom)
    return max(1.0, width), max(1.0, height)


def child_frames(node: dict[str, Any], width: float, height: float) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    children = [child for child in node.get("children", []) if isinstance(child, dict)]
    if not children:
        return []
    layout = node.get("layout") if isinstance(node.get("layout"), dict) else {}
    mode = str(layout.get("mode") or "VERTICAL").upper()
    top, right, bottom, left = padding_values(layout.get("padding"))
    gap = max(0.0, number(layout.get("gap"), 0))
    inner_width = max(1.0, width - left - right)
    inner_height = max(1.0, height - top - bottom)
    sizes = [measure(child, inner_width, inner_height) for child in children]
    result: list[tuple[dict[str, Any], dict[str, Any]]] = []

    if mode == "HORIZONTAL":
        cursor = left
        for child, (child_width, child_height) in zip(children, sizes):
            align = layout.get("align")
            child_y = top if align in (None, "start", "stretch") else top + (inner_height - child_height) / (2 if align == "center" else 1)
            result.append((child, frame(cursor, child_y, child_width, child_height)))
            cursor += child_width + gap
    elif mode == "GRID":
        columns = max(1, int(number(layout.get("columns"), 2)))
        column_width = max(1.0, (inner_width - gap * (columns - 1)) / columns)
        row_heights: list[float] = []
        for row_start in range(0, len(children), columns):
            row_heights.append(max(size[1] for size in sizes[row_start:row_start + columns]))
        for index, (child, (_, child_height)) in enumerate(zip(children, sizes)):
            column_index, row_index = index % columns, index // columns
            child_x = left + column_index * (column_width + gap)
            child_y = top + sum(row_heights[:row_index]) + row_index * gap
            result.append((child, frame(child_x, child_y, column_width, child_height)))
    elif mode == "FREE":
        for child, (child_width, child_height) in zip(children, sizes):
            child_layout = child.get("layout") if isinstance(child.get("layout"), dict) else {}
            result.append((child, frame(number(child_layout.get("x"), left), number(child_layout.get("y"), top), child_width, child_height)))
    else:
        cursor = top
        for child, (child_width, child_height) in zip(children, sizes):
            align = layout.get("align")
            child_x = left if align in (None, "start", "stretch") else left + (inner_width - child_width) / (2 if align == "center" else 1)
            result.append((child, frame(child_x, cursor, child_width, child_height)))
            cursor += child_height + gap
    return result


def sketch_style(style: dict[str, Any]) -> dict[str, Any]:
    background = style.get("background", style.get("backgroundColor"))
    fills = []
    if background is not None:
        fills.append({"_class": "fill", "isEnabled": True, "fillType": 0, "color": color(background)})
    border_color = style.get("borderColor")
    border_width = number(style.get("borderWidth"), 1)
    border = style.get("border")
    if isinstance(border, str):
        match = re.search(r"([\d.]+)px(?:\s+\w+)?\s+(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)|\w+)", border)
        if match:
            border_width = number(match.group(1), 1)
            border_color = match.group(2)
    borders = []
    if border_color is not None:
        borders.append({"_class": "border", "isEnabled": True, "fillType": 0, "position": 1, "thickness": border_width, "color": color(border_color)})
    return {
        "_class": "style",
        "endDecorationType": 0,
        "miterLimit": 10,
        "startDecorationType": 0,
        "fills": fills,
        "borders": borders,
        "shadows": [],
        "innerShadows": [],
        "contextSettings": {"_class": "graphicsContextSettings", "blendMode": 0, "opacity": min(1.0, max(0.0, number(style.get("opacity"), 1)))},
    }


def shape_layer(node_id: str, name: str, layer_frame: dict[str, Any], style: dict[str, Any], kind: str = "Rectangle") -> dict[str, Any]:
    width, height = layer_frame["width"], layer_frame["height"]
    radius = max(0.0, number(style.get("radius", style.get("borderRadius")), 0))
    shape_class = "MSImmutableOvalShape" if kind == "Ellipse" else "MSImmutableRectangleShape"
    shape: dict[str, Any] = {
        "_class": shape_class,
        "do_objectID": f"{node_id}-path",
        "name": f"{name} path",
        "frame": frame(0, 0, width, height),
    }
    if shape_class == "MSImmutableRectangleShape":
        shape["cornerRadiusString"] = str(radius)
        shape["fixedRadius"] = radius
    return {
        "_class": "MSImmutableShapeGroup",
        "do_objectID": node_id,
        "name": name,
        "frame": layer_frame,
        "layers": [shape],
        "style": sketch_style(style),
        "hasClickThrough": False,
    }


def text_layer(node: dict[str, Any], layer_frame: dict[str, Any], tokens: dict[str, Any], *, identifier: str | None = None) -> dict[str, Any]:
    node_id = identifier or str(node.get("id") or "text")
    name = str(node.get("name") or node.get("text") or node_id)
    text = str(node.get("text") or "")
    style = resolved_style(node, tokens)
    font_size = max(1.0, number(style.get("fontSize"), 16))
    font_name = str(style.get("fontFamily") or "Inter")
    font_weight = number(style.get("fontWeight"), 400)
    if font_weight >= 700 and "bold" not in font_name.lower():
        font_name += "-Bold"
    attributes = {
        "MSAttributedStringFontAttribute": {
            "_class": "fontDescriptor",
            "attributes": {"name": font_name, "size": font_size},
        },
        "MSAttributedStringColorAttribute": color(style.get("color", "#161616")),
        "paragraphStyle": {
            "_class": "paragraphStyle",
            "alignment": {"center": 2, "right": 1}.get(str(style.get("textAlign")), 0),
            "maximumLineHeight": number(style.get("lineHeight"), font_size * 1.35),
            "minimumLineHeight": number(style.get("lineHeight"), font_size * 1.35),
        },
    }
    return {
        "_class": "MSImmutableTextLayer",
        "do_objectID": node_id,
        "name": name,
        "attributedString": {
            "_class": "attributedString",
            "string": text,
            "attributes": [{"_class": "stringAttribute", "location": 0, "length": len(text), "attributes": attributes}],
        },
        "frame": layer_frame,
        "style": sketch_style({"opacity": style.get("opacity", 1)}),
        "textBehaviour": 1,
    }


def sketch_layer(node: dict[str, Any], layer_frame: dict[str, Any], tokens: dict[str, Any]) -> dict[str, Any]:
    node_id = str(node.get("id") or "node")
    name = str(node.get("name") or node.get("text") or node_id)
    kind = str(node.get("type") or "Group")
    style = resolved_style(node, tokens)
    if kind == "Text":
        return text_layer(node, layer_frame, tokens)
    if kind in {"Rectangle", "Ellipse", "Line", "Vector"}:
        return shape_layer(node_id, name, layer_frame, style, kind)

    width, height = layer_frame["width"], layer_frame["height"]
    layers: list[dict[str, Any]] = []
    if style.get("background", style.get("backgroundColor")) is not None or style.get("border") is not None or style.get("borderColor") is not None:
        layers.append(shape_layer(f"{node_id}-background", f"{name} background", frame(0, 0, width, height), style))
    if kind == "Button" and not node.get("children"):
        label_node = {**node, "type": "Text", "style": {**style, "textAlign": "center"}}
        font_size = number(style.get("fontSize"), 16)
        label_height = number(style.get("lineHeight"), font_size * 1.35)
        layers.append(text_layer(label_node, frame(12, max(0, (height - label_height) / 2), max(1, width - 24), label_height), tokens, identifier=f"{node_id}-label"))
    elif node.get("text") and not node.get("children"):
        label_node = {**node, "type": "Text"}
        inset = 12 if kind in {"Input", "Textarea", "Select", "Badge"} else 0
        layers.append(text_layer(label_node, frame(inset, inset, max(1, width - inset * 2), max(1, height - inset * 2)), tokens, identifier=f"{node_id}-content"))
    else:
        for child, child_frame in child_frames(node, width, height):
            layers.append(sketch_layer(child, child_frame, tokens))
    return {
        "_class": "MSImmutableGroup",
        "do_objectID": node_id,
        "name": name,
        "layers": layers,
        "frame": layer_frame,
        "hasClickThrough": False,
    }


def artboard_layer(page: dict[str, Any], x: float, tokens: dict[str, Any]) -> dict[str, Any]:
    width, height = measure(page)
    page_id = str(page.get("id") or "artboard")
    name = str(page.get("name") or page_id)
    style = resolved_style(page, tokens)
    background = style.get("background", style.get("backgroundColor", "#ffffff"))
    layers = [sketch_layer(child, child_frame, tokens) for child, child_frame in child_frames(page, width, height)]
    return {
        "_class": "MSImmutableArtboardGroup",
        "do_objectID": page_id,
        "name": name,
        "frame": frame(x, 0, width, height),
        "layers": layers,
        "backgroundColor": color(background, "#ffffff"),
        "hasBackgroundColor": True,
        "includeBackgroundColorInExport": True,
        "resizesContent": False,
    }


def build_package(document: dict[str, Any]) -> dict[str, Any]:
    canonical = normalize_design_ir(document)
    pages = canonical["document"]["pages"]
    ids: set[str] = set()
    for page in pages:
        validate(page, ids)
    title = canonical["metadata"]["title"]
    tokens = canonical.get("tokens") if isinstance(canonical.get("tokens"), dict) else {}
    layers = []
    canvas_x = 0.0
    for page in pages:
        if not isinstance(page, dict):
            continue
        artboard = artboard_layer(page, canvas_x, tokens)
        layers.append(artboard)
        canvas_x += artboard["frame"]["width"] + 80
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


def validate_sketch_layers(layers: list[dict[str, Any]], expected_artboards: int) -> None:
    artboards = [layer for layer in layers if layer.get("_class") == "MSImmutableArtboardGroup"]
    if len(artboards) != expected_artboards:
        fail(f"Sketch export expected {expected_artboards} artboards, produced {len(artboards)}")
    positions = {(layer.get("frame") or {}).get("x") for layer in artboards}
    if len(artboards) > 1 and len(positions) != len(artboards):
        fail("Sketch artboards overlap; each screen requires a distinct canvas position")

    def visit(layer: dict[str, Any]) -> None:
        layer_frame = layer.get("frame")
        if not isinstance(layer_frame, dict):
            fail(f"Sketch layer {layer.get('name', layer.get('do_objectID'))!r} has no frame")
        if number(layer_frame.get("width"), 0) <= 0 or number(layer_frame.get("height"), 0) <= 0:
            fail(f"Sketch layer {layer.get('name', layer.get('do_objectID'))!r} has an empty frame")
        if layer.get("_class") == "MSImmutableTextLayer":
            attributed = layer.get("attributedString")
            if not isinstance(attributed, dict) or not isinstance(attributed.get("attributes"), list) or not attributed["attributes"]:
                fail(f"Sketch text layer {layer.get('name')!r} has no typography attributes")
        for child in layer.get("layers", []):
            if isinstance(child, dict):
                visit(child)

    for artboard in artboards:
        visit(artboard)


def write_sketch(ir_path: Path, out_path: Path) -> None:
    try:
        document = json.loads(ir_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        fail(f"invalid JSON in {ir_path}: {error}")
    if not isinstance(document, dict):
        fail("Design IR root must be an object")
    package = build_package(document)
    normalized = normalize_design_ir(document)
    validate_sketch_layers(package["page"]["layers"], len(normalized["document"]["pages"]))
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
    if out_path.read_bytes()[:2] != b"PK":
        fail(f"generated file is not a ZIP-compatible Sketch package: {out_path}")
    with zipfile.ZipFile(out_path) as archive:
        required = {"document.json", "pages/bobwork-page-1.json", "meta.json"}
        missing = required.difference(archive.namelist())
        if missing:
            fail(f"generated Sketch package is incomplete: missing {', '.join(sorted(missing))}")
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
