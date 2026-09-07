//! Trusted Design IR adapter. The Designer plugin persists its canonical JSON
//! and derives a self-contained HTML preview from data-only, validated nodes.

use crate::error::{AppError, AppResult};
use serde_json::Value;
use std::collections::HashSet;
use std::io::{Cursor, Read, Write};

pub fn validate_design_ir(value: &Value) -> AppResult<()> {
    let root = value
        .as_object()
        .ok_or_else(|| AppError::ValidationFailed("Design IR must be an object".into()))?;
    if root.get("version").and_then(Value::as_str) != Some("1.0") {
        return Err(AppError::ValidationFailed(
            "Unsupported Design IR version".into(),
        ));
    }
    let pages = root
        .get("document")
        .and_then(Value::as_object)
        .and_then(|document| document.get("pages"))
        .and_then(Value::as_array)
        .ok_or_else(|| AppError::ValidationFailed("Design IR requires document.pages".into()))?;
    let mut ids = HashSet::new();
    for page in pages {
        validate_node(page, &mut ids)?;
    }
    Ok(())
}

fn validate_node(value: &Value, ids: &mut HashSet<String>) -> AppResult<()> {
    let node = value
        .as_object()
        .ok_or_else(|| AppError::ValidationFailed("Design node must be an object".into()))?;
    let id = node
        .get("id")
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
        .ok_or_else(|| AppError::ValidationFailed("Every design node requires an id".into()))?;
    if !ids.insert(id.to_string()) {
        return Err(AppError::ValidationFailed(format!(
            "Duplicate design node id: {id}"
        )));
    }
    let kind = node
        .get("type")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::ValidationFailed("Every design node requires a type".into()))?;
    if !matches!(
        kind,
        "Document"
            | "Page"
            | "Frame"
            | "Section"
            | "Group"
            | "Component"
            | "ComponentInstance"
            | "Text"
            | "Image"
            | "Icon"
            | "Vector"
            | "Rectangle"
            | "Ellipse"
            | "Line"
            | "Button"
            | "Input"
            | "Textarea"
            | "Select"
            | "Checkbox"
            | "Radio"
            | "Switch"
            | "Tabs"
            | "Navigation"
            | "Menu"
            | "Card"
            | "Table"
            | "List"
            | "Modal"
            | "Drawer"
            | "Tooltip"
            | "Badge"
            | "Avatar"
            | "Breadcrumb"
            | "Pagination"
            | "Chart"
            | "Video"
            | "Custom"
    ) {
        return Err(AppError::ValidationFailed(format!(
            "Unsupported design node type: {kind}"
        )));
    }
    if let Some(children) = node.get("children") {
        for child in children.as_array().ok_or_else(|| {
            AppError::ValidationFailed("Design node children must be an array".into())
        })? {
            validate_node(child, ids)?;
        }
    }
    Ok(())
}

pub fn render_html(value: &Value) -> AppResult<String> {
    validate_design_ir(value)?;
    let title = value
        .pointer("/metadata/title")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/document/name").and_then(Value::as_str))
        .unwrap_or("Bob Work design");
    let pages = value
        .pointer("/document/pages")
        .and_then(Value::as_array)
        .unwrap();
    let mut body = String::new();
    for page in pages {
        body.push_str(&render_node(page));
    }
    Ok(format!("<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; style-src 'unsafe-inline'; img-src data:; script-src 'none'\"><title>{}</title><style>body{{margin:0;padding:16px;background:#f7f8fb;color:#161616;font:14px -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}}*{{box-sizing:border-box}}button,input,textarea{{font:inherit}}[data-design-node]{{position:relative}}button{{cursor:pointer}}@media(max-width:600px){{body{{padding:10px}}}}</style></head><body>{}</body></html>", escape(title), body))
}

/// A documented Sketch package containing separate layers for every Design IR
/// node. It is intentionally an interchange adapter, not a reverse-engineered
/// Figma format; import fidelity depends on the receiving Sketch-compatible app.
pub fn render_sketch(value: &Value) -> AppResult<Vec<u8>> {
    validate_design_ir(value)?;
    let title = value
        .pointer("/metadata/title")
        .and_then(Value::as_str)
        .or_else(|| value.pointer("/document/name").and_then(Value::as_str))
        .unwrap_or("Bob Work design");
    let layers = value
        .pointer("/document/pages")
        .and_then(Value::as_array)
        .unwrap()
        .iter()
        .map(sketch_layer)
        .collect::<Vec<_>>();
    let page = serde_json::json!({"_class":"MSImmutablePage","do_objectID":"bobwork-page-1","name":title,"layers":layers});
    let document = serde_json::json!({"_class":"document","do_objectID":"bobwork-document-1","assets":{"_class":"assetCollection","colors":[],"colorAssets":[],"gradients":[],"images":[]},"layerStyles":{"_class":"sharedStyleContainer","objects":[]},"layerTextStyles":{"_class":"sharedTextStyleContainer","objects":[]},"pages":[{"_class":"MSJSONFileReference","_ref_class":"MSImmutablePage","_ref":"pages/bobwork-page-1"}],"foreignSymbols":[],"foreignLayerStyles":[],"foreignTextStyles":[]});
    let mut bytes = Vec::new();
    let mut zip = zip::ZipWriter::new(Cursor::new(&mut bytes));
    let options = zip::write::SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);
    for (name, content) in [
        ("document.json", document),
        ("pages/bobwork-page-1.json", page),
        (
            "meta.json",
            serde_json::json!({"version":132,"appVersion":"Bob Work Designer 2.0"}),
        ),
        ("user.json", serde_json::json!({})),
        ("workspace.json", serde_json::json!({})),
    ] {
        zip.start_file(name, options)
            .map_err(|e| AppError::Serialization(e.to_string()))?;
        zip.write_all(
            serde_json::to_string_pretty(&content)
                .map_err(|e| AppError::Serialization(e.to_string()))?
                .as_bytes(),
        )?;
    }
    zip.finish()
        .map_err(|e| AppError::Serialization(e.to_string()))?;
    Ok(bytes)
}

fn sketch_layer(value: &Value) -> Value {
    let node = value.as_object().expect("validated design node");
    let id = node.get("id").and_then(Value::as_str).unwrap_or("node");
    let name = node
        .get("name")
        .and_then(Value::as_str)
        .or_else(|| node.get("text").and_then(Value::as_str))
        .unwrap_or(id);
    let children = node
        .get("children")
        .and_then(Value::as_array)
        .map(|nodes| nodes.iter().map(sketch_layer).collect::<Vec<_>>())
        .unwrap_or_default();
    let kind = node.get("type").and_then(Value::as_str).unwrap_or("Group");
    if kind == "Text" {
        return serde_json::json!({"_class":"MSImmutableTextLayer","do_objectID":id,"name":name,"attributedString":{"_class":"attributedString","string":node.get("text").and_then(Value::as_str).unwrap_or(""),"attributes":[]},"frame":{"_class":"rect","x":0,"y":0,"width":200,"height":28}});
    }
    serde_json::json!({"_class":"MSImmutableGroup","do_objectID":id,"name":name,"layers":children,"frame":{"_class":"rect","x":0,"y":0,"width":375,"height":100},"hasClickThrough":false})
}

fn render_node(value: &Value) -> String {
    let node = value.as_object().expect("validated design node");
    let kind = node.get("type").and_then(Value::as_str).unwrap_or("Group");
    let tag = match kind {
        "Button" => "button",
        "Navigation" => "nav",
        "Section" => "section",
        "Table" => "table",
        "Input" => "input",
        "Textarea" => "textarea",
        "Image" => "img",
        _ => "div",
    };
    let id = node.get("id").and_then(Value::as_str).unwrap_or("");
    let text = node
        .get("text")
        .and_then(Value::as_str)
        .or_else(|| node.get("name").and_then(Value::as_str))
        .unwrap_or("");
    let style = style(node.get("style"), node.get("layout"));
    let children = node
        .get("children")
        .and_then(Value::as_array)
        .map(|items| items.iter().map(render_node).collect::<String>())
        .unwrap_or_default();
    let role = node
        .get("role")
        .and_then(Value::as_str)
        .map(|value| format!(" role=\"{}\"", escape(value)))
        .unwrap_or_default();
    let accessible_name = node
        .get("accessibleName")
        .and_then(Value::as_str)
        .or_else(|| node.get("name").and_then(Value::as_str));
    let accessible_name = accessible_name
        .map(|value| format!(" aria-label=\"{}\"", escape(value)))
        .unwrap_or_default();
    if tag == "input" {
        return format!(
            "<input data-design-node=\"{}\" style=\"{}\" value=\"{}\" readonly>",
            escape(id),
            style,
            escape(text)
        );
    }
    if tag == "textarea" {
        return format!(
            "<textarea data-design-node=\"{}\" style=\"{}\" readonly>{}</textarea>",
            escape(id),
            style,
            escape(text)
        );
    }
    if tag == "img" {
        return format!(
            "<img data-design-node=\"{}\" data-design-type=\"{}\" style=\"{}\"{}{} alt=\"{}\">",
            escape(id),
            escape(kind),
            style,
            role,
            accessible_name,
            escape(text)
        );
    }
    format!(
        "<{tag} data-design-node=\"{}\" data-design-type=\"{}\" style=\"{}\"{}{}>{}{}</{tag}>",
        escape(id),
        escape(kind),
        style,
        role,
        accessible_name,
        escape(text),
        children
    )
}

fn style(style: Option<&Value>, layout: Option<&Value>) -> String {
    let style = style.and_then(Value::as_object);
    let layout = layout.and_then(Value::as_object);
    let mut out = Vec::new();
    let mode = layout
        .and_then(|value| value.get("mode"))
        .and_then(Value::as_str);
    match mode {
        Some("HORIZONTAL") => out.push("display:flex;flex-direction:row".into()),
        Some("VERTICAL") => out.push("display:flex;flex-direction:column".into()),
        Some("GRID") => out.push("display:grid".into()),
        _ => {}
    }

    if mode == Some("GRID") {
        if let Some(columns) = layout
            .and_then(|value| value.get("columns"))
            .and_then(Value::as_u64)
        {
            out.push(format!(
                "grid-template-columns:repeat({columns},minmax(0,1fr))"
            ));
        }
    }
    for (key, css) in [("width", "width"), ("height", "height")] {
        if let Some(value) = layout.and_then(|layout| layout.get(key)) {
            if let Some(value) = dimension(value) {
                out.push(format!("{css}:{value}"));
            }
        }
    }
    for (key, css) in [
        ("minWidth", "min-width"),
        ("maxWidth", "max-width"),
        ("minHeight", "min-height"),
        ("maxHeight", "max-height"),
        ("gap", "gap"),
    ] {
        if let Some(value) = layout
            .and_then(|layout| layout.get(key))
            .and_then(css_value)
        {
            out.push(format!("{css}:{value}"));
        }
    }
    if let Some(value) = layout
        .and_then(|layout| layout.get("aspectRatio"))
        .and_then(css_scalar)
    {
        out.push(format!("aspect-ratio:{value}"));
    }
    if let Some(value) = layout
        .and_then(|layout| layout.get("padding"))
        .and_then(css_padding)
    {
        out.push(format!("padding:{value}"));
    }
    if let Some(value) = layout
        .and_then(|layout| layout.get("align"))
        .and_then(Value::as_str)
        .and_then(flex_alignment)
    {
        out.push(format!("align-items:{value}"));
    }
    if let Some(value) = layout
        .and_then(|layout| layout.get("justify"))
        .and_then(Value::as_str)
        .and_then(flex_justify)
    {
        out.push(format!("justify-content:{value}"));
    }
    if layout
        .and_then(|layout| layout.get("wrap"))
        .and_then(Value::as_bool)
        == Some(true)
    {
        out.push("flex-wrap:wrap".into());
    }
    for (key, css) in [
        ("background", "background"),
        ("backgroundColor", "background"),
        ("color", "color"),
        ("border", "border"),
        ("radius", "border-radius"),
        ("borderRadius", "border-radius"),
        ("shadow", "box-shadow"),
        ("boxShadow", "box-shadow"),
        ("fontSize", "font-size"),
        ("lineHeight", "line-height"),
        ("textAlign", "text-align"),
        ("overflow", "overflow"),
    ] {
        if let Some(value) = style.and_then(|style| style.get(key)).and_then(css_value) {
            out.push(format!("{css}:{value}"));
        }
    }
    for (key, css) in [("fontWeight", "font-weight"), ("opacity", "opacity")] {
        if let Some(value) = style.and_then(|style| style.get(key)).and_then(css_scalar) {
            out.push(format!("{css}:{value}"));
        }
    }
    out.join(";")
}

fn css_value(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => Some(format!("{}px", number.as_f64()?)),
        Value::String(value) if !value.contains([';', '{', '}', '<', '>']) => Some(value.clone()),
        _ => None,
    }
}

fn css_scalar(value: &Value) -> Option<String> {
    match value {
        Value::Number(number) => Some(number.to_string()),
        Value::String(value) if !value.contains([';', '{', '}', '<', '>']) => Some(value.clone()),
        _ => None,
    }
}

fn dimension(value: &Value) -> Option<String> {
    match value.as_str() {
        Some("fill") => Some("100%".into()),
        Some("hug") => Some("fit-content".into()),
        _ => css_value(value),
    }
}

fn css_padding(value: &Value) -> Option<String> {
    if let Some(value) = css_value(value) {
        return Some(value);
    }
    let values = value.as_array()?;
    let values = values.iter().map(css_value).collect::<Option<Vec<_>>>()?;
    (!values.is_empty() && values.len() <= 4).then(|| values.join(" "))
}

fn flex_alignment(value: &str) -> Option<&'static str> {
    match value {
        "start" => Some("flex-start"),
        "end" => Some("flex-end"),
        "center" => Some("center"),
        "stretch" => Some("stretch"),
        "baseline" => Some("baseline"),
        _ => None,
    }
}

fn flex_justify(value: &str) -> Option<&'static str> {
    match value {
        "start" => Some("flex-start"),
        "end" => Some("flex-end"),
        "between" => Some("space-between"),
        "center" => Some("center"),
        "around" => Some("around"),
        "evenly" => Some("evenly"),
        _ => None,
    }
}

fn escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn luxury_merchant_design_generates_inline_preview_and_decomposed_sketch() {
        let value: Value = serde_json::json!({"version":"1.0","document":{"name":"Maison Éclat — boutique de luxe","pages":[{"id":"luxury-home","type":"Page","layout":{"mode":"VERTICAL","gap":24},"children":[{"id":"luxury-header","type":"Navigation","name":"Navigation Maison Éclat","children":[{"id":"brand","type":"Text","text":"MAISON ÉCLAT"},{"id":"bag","type":"Button","text":"Panier"}]},{"id":"hero","type":"Section","children":[{"id":"hero-title","type":"Text","text":"L’art de l’exception"},{"id":"discover","type":"Button","text":"Découvrir la collection"}]},{"id":"featured-products","type":"Section","name":"Pièces signature"}]}]},"tokens":{"color.action.primary":{"value":"#17110b"}},"components":{},"assets":{},"metadata":{"title":"Maison Éclat"}});
        let html = render_html(&value).unwrap();
        assert!(html.contains("data-design-node=\"discover\""));
        assert!(html.contains("Content-Security-Policy"));
        let bytes = render_sketch(&value).unwrap();
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert!(archive.by_name("document.json").is_ok());
        let mut page = String::new();
        archive
            .by_name("pages/bobwork-page-1.json")
            .unwrap()
            .read_to_string(&mut page)
            .unwrap();
        assert!(page.contains("luxury-header"));
        assert!(page.contains("hero-title"));
        assert!(page.contains("discover"));
    }
}

#[cfg(test)]
mod responsive_tests {
    use super::*;

    #[test]
    fn designer_preview_and_sketch_keep_a_luxury_store_layout_structured() {
        let design: Value = serde_json::json!({
            "version": "1.0",
            "document": {
                "name": "Maison Éclat",
                "pages": [{
                    "id": "luxury-home", "type": "Page",
                    "layout": {"mode": "VERTICAL", "width": "fill", "padding": [32, 40], "gap": 32},
                    "children": [
                        {"id": "header", "type": "Navigation", "layout": {"mode": "HORIZONTAL", "width": "fill", "justify": "between", "align": "center"}, "children": [
                            {"id": "wordmark", "type": "Text", "text": "MAISON ÉCLAT"},
                            {"id": "bag", "type": "Button", "text": "Panier", "accessibleName": "Ouvrir le panier"}
                        ]},
                        {"id": "hero", "type": "Section", "layout": {"mode": "VERTICAL", "padding": 48, "gap": 18}, "style": {"background": "#17110b", "color": "#fff", "borderRadius": "18px"}, "children": [
                            {"id": "hero-title", "type": "Text", "text": "L’art de l’exception"},
                            {"id": "discover", "type": "Button", "text": "Découvrir la collection"}
                        ]},
                        {"id": "signature-pieces", "type": "Section", "layout": {"mode": "GRID", "columns": 3, "gap": 16}, "children": [
                            {"id": "piece-1", "type": "Card", "name": "Sac Éclat"},
                            {"id": "piece-2", "type": "Card", "name": "Montre Éclat"},
                            {"id": "piece-3", "type": "Card", "name": "Parfum Éclat"}
                        ]}
                    ]
                }]
            },
            "tokens": {"color.action.primary": {"value": "#17110b"}},
            "components": {}, "assets": {}, "metadata": {"title": "Maison Éclat — boutique de luxe"}
        });

        let html = render_html(&design).expect("valid inline Designer preview");
        assert!(html.contains("data-design-node=\"signature-pieces\""));
        assert!(html.contains("grid-template-columns:repeat(3,minmax(0,1fr))"));
        assert!(html.contains("padding:32px 40px"));
        assert!(html.contains("aria-label=\"Ouvrir le panier\""));
        assert!(!html.contains("<script"));

        let sketch = render_sketch(&design).expect("structured Sketch export");
        assert!(
            sketch.starts_with(b"PK"),
            "a .sketch export must be a ZIP package"
        );
        let mut archive = zip::ZipArchive::new(Cursor::new(sketch)).expect("read Sketch package");
        let mut page = String::new();
        archive
            .by_name("pages/bobwork-page-1.json")
            .expect("Sketch page")
            .read_to_string(&mut page)
            .unwrap();
        for node_id in [
            "luxury-home",
            "header",
            "hero",
            "discover",
            "signature-pieces",
            "piece-1",
            "piece-2",
            "piece-3",
        ] {
            assert!(
                page.contains(node_id),
                "Sketch export flattened or lost {node_id}"
            );
        }
    }
}
