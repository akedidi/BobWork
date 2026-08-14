//! Standalone PPTX → HTML slide preview (no PowerPoint / AppleScript).
//! Parses the Open XML zip and renders positioned text + images.

use crate::error::{AppError, AppResult};
use regex::Regex;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const EMU_PER_INCH: f64 = 914_400.0;
const DEFAULT_CX: f64 = 12_192_000.0; // 13.333" 16:9
const DEFAULT_CY: f64 = 6_858_000.0; // 7.5"

pub struct PptxPreviewService;

impl PptxPreviewService {
    pub fn new() -> Self {
        Self
    }

    /// Render each slide to `output_dir/slide-NNN.html`. Returns sorted HTML paths.
    pub fn render_to_html(&self, pptx: &Path, output_dir: &Path) -> AppResult<Vec<PathBuf>> {
        std::fs::create_dir_all(output_dir)?;
        let marker = output_dir.join(".bob-pptx-preview-ready");
        let existing = collect_slide_html(output_dir);
        if marker.is_file() && !existing.is_empty() {
            return Ok(existing);
        }

        let file = std::fs::File::open(pptx).map_err(|e| AppError::Io(e.to_string()))?;
        let mut archive = zip::ZipArchive::new(file)
            .map_err(|e| AppError::Plugin(format!("PPTX invalide : {e}")))?;

        let (slide_cx, slide_cy) = read_slide_size(&mut archive);
        let media_dir = output_dir.join("media");
        std::fs::create_dir_all(&media_dir)?;
        extract_media(&mut archive, &media_dir)?;

        let mut slide_names = list_slide_names(&mut archive);
        slide_names.sort_by(|a, b| slide_index(a).cmp(&slide_index(b)));
        if slide_names.is_empty() {
            return Err(AppError::Plugin(
                "Aucune slide trouvée dans le PPTX.".into(),
            ));
        }

        let mut html_paths = Vec::new();
        for (index, slide_name) in slide_names.iter().enumerate() {
            let xml = read_zip_string(&mut archive, slide_name)?;
            let rels_name = slide_rels_path(slide_name);
            let rels = read_zip_string(&mut archive, &rels_name).unwrap_or_default();
            let rel_map = parse_relationships(&rels);
            let html = render_slide_html(
                &xml,
                &rel_map,
                slide_cx,
                slide_cy,
                index + 1,
                slide_names.len(),
            );
            let out = output_dir.join(format!("slide-{:03}.html", index + 1));
            let mut file = std::fs::File::create(&out)?;
            file.write_all(html.as_bytes())?;
            html_paths.push(out);
        }

        let _ = std::fs::write(marker, format!("{}\n", html_paths.len()));
        Ok(html_paths)
    }
}

fn collect_slide_html(output_dir: &Path) -> Vec<PathBuf> {
    let mut paths = std::fs::read_dir(output_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| {
            p.file_name()
                .and_then(|n| n.to_str())
                .is_some_and(|n| n.starts_with("slide-") && n.ends_with(".html"))
        })
        .collect::<Vec<_>>();
    paths.sort();
    paths
}

fn list_slide_names(archive: &mut zip::ZipArchive<std::fs::File>) -> Vec<String> {
    let mut names = Vec::new();
    for i in 0..archive.len() {
        let Ok(entry) = archive.by_index(i) else {
            continue;
        };
        let name = entry.name().replace('\\', "/");
        if name.starts_with("ppt/slides/slide") && name.ends_with(".xml") && !name.contains("_rels")
        {
            names.push(name);
        }
    }
    names
}

fn slide_index(name: &str) -> u32 {
    Regex::new(r"slide(\d+)\.xml")
        .ok()
        .and_then(|re| {
            re.captures(name)
                .and_then(|c| c.get(1))
                .and_then(|m| m.as_str().parse().ok())
        })
        .unwrap_or(0)
}

fn slide_rels_path(slide_name: &str) -> String {
    // ppt/slides/slide1.xml → ppt/slides/_rels/slide1.xml.rels
    let file = Path::new(slide_name)
        .file_name()
        .and_then(|v| v.to_str())
        .unwrap_or("slide1.xml");
    format!("ppt/slides/_rels/{file}.rels")
}

fn read_zip_string(archive: &mut zip::ZipArchive<std::fs::File>, name: &str) -> AppResult<String> {
    let mut entry = archive
        .by_name(name)
        .map_err(|_| AppError::NotFound(format!("Entrée manquante : {name}")))?;
    let mut buf = String::new();
    entry
        .read_to_string(&mut buf)
        .map_err(|e| AppError::Io(e.to_string()))?;
    Ok(buf)
}

fn read_slide_size(archive: &mut zip::ZipArchive<std::fs::File>) -> (f64, f64) {
    let Ok(xml) = read_zip_string(archive, "ppt/presentation.xml") else {
        return (DEFAULT_CX, DEFAULT_CY);
    };
    let cx = attr_f64(&xml, "sldSz", "cx").unwrap_or(DEFAULT_CX);
    let cy = attr_f64(&xml, "sldSz", "cy").unwrap_or(DEFAULT_CY);
    (cx, cy)
}

fn extract_media(archive: &mut zip::ZipArchive<std::fs::File>, media_dir: &Path) -> AppResult<()> {
    let names: Vec<String> = (0..archive.len())
        .filter_map(|i| {
            archive
                .by_index(i)
                .ok()
                .map(|e| e.name().replace('\\', "/"))
        })
        .filter(|n| n.starts_with("ppt/media/"))
        .collect();
    for name in names {
        let mut entry = match archive.by_name(&name) {
            Ok(e) => e,
            Err(_) => continue,
        };
        let file_name = Path::new(&name)
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("bin");
        let dest = media_dir.join(file_name);
        if dest.exists() {
            continue;
        }
        let mut out = std::fs::File::create(&dest)?;
        std::io::copy(&mut entry, &mut out)?;
    }
    Ok(())
}

fn parse_relationships(rels_xml: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    let Ok(re) =
        Regex::new(r#"Id="(rId\d+)"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="(rId\d+)""#)
    else {
        return map;
    };
    for caps in re.captures_iter(rels_xml) {
        let (id, target) = if caps.get(1).is_some() {
            (caps.get(1).unwrap().as_str(), caps.get(2).unwrap().as_str())
        } else {
            (caps.get(4).unwrap().as_str(), caps.get(3).unwrap().as_str())
        };
        let normalized = target.trim_start_matches('/').replace('\\', "/");
        let file = if normalized.starts_with("media/") || normalized.contains("/media/") {
            Path::new(&normalized)
                .file_name()
                .and_then(|v| v.to_str())
                .unwrap_or(&normalized)
                .to_string()
        } else if let Some(rest) = normalized.strip_prefix("../media/") {
            rest.to_string()
        } else {
            continue;
        };
        map.insert(id.to_string(), file);
    }
    map
}

fn render_slide_html(
    slide_xml: &str,
    rels: &HashMap<String, String>,
    slide_cx: f64,
    slide_cy: f64,
    index: usize,
    total: usize,
) -> String {
    let bg = detect_background(slide_xml);
    let mut layers = Vec::new();

    // Images first (behind text)
    for (embed_id, media_file) in image_embeds(slide_xml, rels) {
        if let Some((x, y, w, h)) = nearest_box_before(slide_xml, &embed_id) {
            let left = (x / slide_cx) * 100.0;
            let top = (y / slide_cy) * 100.0;
            let width = (w / slide_cx) * 100.0;
            let height = (h / slide_cy) * 100.0;
            layers.push(format!(
                r#"<img class="shape-img" src="media/{media}" alt="" style="left:{left:.2}%;top:{top:.2}%;width:{width:.2}%;height:{height:.2}%;"/>"#,
                media = html_escape(media_file),
            ));
        }
    }

    for block in text_blocks(slide_xml) {
        let left = (block.x / slide_cx) * 100.0;
        let top = (block.y / slide_cy) * 100.0;
        let width = (block.w / slide_cx) * 100.0;
        let height = (block.h / slide_cy).max(2.0) * 100.0;
        let size_pt = (block.font_sz.unwrap_or(1800) as f64 / 100.0).clamp(10.0, 72.0);
        let color = block.color.unwrap_or_else(|| "1a1a1a".into());
        let weight = if block.bold { "700" } else { "500" };
        let align = block.align.as_deref().unwrap_or("left");
        layers.push(format!(
            r#"<div class="shape-text" style="left:{left:.2}%;top:{top:.2}%;width:{width:.2}%;min-height:{height:.2}%;font-size:{size_pt:.1}pt;color:#{color};font-weight:{weight};text-align:{align};">{text}</div>"#,
            text = html_escape(&block.text),
        ));
    }

    let aspect = slide_cx / slide_cy;
    format!(
        r##"<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Slide {index}/{total}</title>
<style>
  html, body {{ margin: 0; height: 100%; background: #1c1c1e; }}
  body {{ display: flex; align-items: center; justify-content: center; }}
  .stage {{
    position: relative;
    width: min(100vw, calc(100vh * {aspect:.4}));
    aspect-ratio: {aspect:.4};
    background: {bg};
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,.35);
  }}
  .shape-text {{
    position: absolute;
    box-sizing: border-box;
    padding: 0.4% 1.2%;
    font-family: "Calibri", "Segoe UI", Helvetica, Arial, sans-serif;
    line-height: 1.25;
    white-space: pre-wrap;
    overflow: hidden;
    word-break: break-word;
  }}
  .shape-img {{
    position: absolute;
    object-fit: contain;
  }}
</style>
</head>
<body>
  <div class="stage">
    {layers}
  </div>
</body>
</html>
"##,
        layers = layers.join("\n    "),
    )
}

struct TextBlock {
    text: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    font_sz: Option<u32>,
    color: Option<String>,
    bold: bool,
    align: Option<String>,
}

fn text_blocks(slide_xml: &str) -> Vec<TextBlock> {
    let mut blocks = Vec::new();
    // Split roughly on sp / pic shape containers
    let parts = split_keep(slide_xml, "<p:sp");
    for part in parts {
        if !part.contains("<a:t") {
            continue;
        }
        let texts = extract_texts(part);
        if texts.is_empty() {
            continue;
        }
        let text = texts.join("\n");
        if text.trim().is_empty() {
            continue;
        }
        let (x, y, w, h) =
            shape_box(part).unwrap_or((0.0, 0.0, DEFAULT_CX * 0.4, DEFAULT_CY * 0.1));
        blocks.push(TextBlock {
            text,
            x,
            y,
            w: w.max(EMU_PER_INCH * 0.5),
            h: h.max(EMU_PER_INCH * 0.25),
            font_sz: first_attr_u32(part, "sz"),
            color: first_srgb(part),
            bold: part.contains(r#"b="1""#) || part.contains("<a:b/>") || part.contains("<a:b "),
            align: text_align(part),
        });
    }
    blocks
}

fn split_keep<'a>(hay: &'a str, sep: &str) -> Vec<&'a str> {
    let mut out = Vec::new();
    let mut rest = hay;
    while let Some(idx) = rest.find(sep) {
        if idx > 0 && out.is_empty() {
            // skip preamble
        }
        let next = rest[idx + sep.len()..]
            .find(sep)
            .map(|i| idx + sep.len() + i)
            .unwrap_or(rest.len());
        out.push(&rest[idx..next]);
        rest = &rest[next..];
        if rest.is_empty() {
            break;
        }
    }
    if out.is_empty() {
        out.push(hay);
    }
    out
}

fn extract_texts(chunk: &str) -> Vec<String> {
    let Ok(re) = Regex::new(r"<a:t[^>]*>([^<]*)</a:t>") else {
        return vec![];
    };
    re.captures_iter(chunk)
        .filter_map(|c| c.get(1).map(|m| decode_xml_text(m.as_str())))
        .filter(|t| !t.is_empty())
        .collect()
}

fn shape_box(chunk: &str) -> Option<(f64, f64, f64, f64)> {
    let x = attr_in_tag(chunk, "a:off", "x")?;
    let y = attr_in_tag(chunk, "a:off", "y")?;
    let cx = attr_in_tag(chunk, "a:ext", "cx")?;
    let cy = attr_in_tag(chunk, "a:ext", "cy")?;
    Some((x, y, cx, cy))
}

fn nearest_box_before(slide_xml: &str, embed_id: &str) -> Option<(f64, f64, f64, f64)> {
    let needle = format!("r:embed=\"{embed_id}\"");
    let pos = slide_xml.find(&needle)?;
    let window_start = pos.saturating_sub(2500);
    let window = &slide_xml[window_start..pos];
    // last off/ext before the embed
    let x = last_attr_in_window(window, "a:off", "x")?;
    let y = last_attr_in_window(window, "a:off", "y")?;
    let cx = last_attr_in_window(window, "a:ext", "cx")?;
    let cy = last_attr_in_window(window, "a:ext", "cy")?;
    Some((x, y, cx, cy))
}

fn image_embeds<'a>(
    slide_xml: &'a str,
    rels: &'a HashMap<String, String>,
) -> Vec<(&'a str, &'a str)> {
    let Ok(re) = Regex::new(r#"r:embed="(rId\d+)""#) else {
        return vec![];
    };
    let mut out = Vec::new();
    for caps in re.captures_iter(slide_xml) {
        let id = caps.get(1).map(|m| m.as_str()).unwrap_or("");
        if let Some(file) = rels.get(id) {
            out.push((id, file.as_str()));
        }
    }
    out
}

fn detect_background(slide_xml: &str) -> String {
    if let Some(start) = slide_xml.find("<p:bg") {
        let section = &slide_xml[start..];
        let end = section
            .find("</p:bg>")
            .map(|i| i + 7)
            .unwrap_or(section.len().min(800));
        if let Some(color) = first_srgb(&section[..end]) {
            return format!("#{color}");
        }
    }
    if let Some(color) = first_srgb(slide_xml) {
        return format!("#{color}");
    }
    "#ffffff".into()
}

fn first_srgb(xml: &str) -> Option<String> {
    let re = srgb_re();
    re.captures(xml)
        .and_then(|c| c.get(1))
        .map(|m| m.as_str().to_ascii_lowercase())
}

fn first_attr_u32(xml: &str, attr: &str) -> Option<u32> {
    let re = Regex::new(&format!(r#"{attr}="(\d+)""#)).ok()?;
    re.captures(xml)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

fn text_align(chunk: &str) -> Option<String> {
    let re = Regex::new(r#"algn="(l|ctr|r|just)""#).ok()?;
    let val = re.captures(chunk)?.get(1)?.as_str();
    Some(
        match val {
            "ctr" => "center",
            "r" => "right",
            "just" => "justify",
            _ => "left",
        }
        .into(),
    )
}

fn attr_f64(xml: &str, tag_hint: &str, attr: &str) -> Option<f64> {
    // Look near tag_hint then attr, or global attr
    if let Some(pos) = xml.find(tag_hint) {
        let window = &xml[pos..xml.len().min(pos + 200)];
        if let Some(v) = attr_value(window, attr) {
            return v.parse().ok();
        }
    }
    attr_value(xml, attr)?.parse().ok()
}

fn attr_in_tag(xml: &str, tag: &str, attr: &str) -> Option<f64> {
    let re = Regex::new(&format!(r#"<{tag}\b[^>]*\b{attr}="(\d+)""#)).ok()?;
    re.captures(xml)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

fn last_attr_in_window(window: &str, tag: &str, attr: &str) -> Option<f64> {
    let re = Regex::new(&format!(r#"<{tag}\b[^>]*\b{attr}="(\d+)""#)).ok()?;
    re.captures_iter(window)
        .last()
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse().ok())
}

fn attr_value<'a>(xml: &'a str, attr: &str) -> Option<&'a str> {
    let re = Regex::new(&format!(r#"{attr}="([^"]+)""#)).ok()?;
    re.captures(xml).and_then(|c| c.get(1)).map(|m| m.as_str())
}

fn srgb_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"srgbClr[^>]*val="([0-9A-Fa-f]{6})""#).expect("regex"))
}

fn decode_xml_text(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn renders_two_slides_from_minimal_pptx() {
        let root = std::env::temp_dir().join(format!("bob-pptx-html-{}", uuid::Uuid::new_v4()));
        let pptx = root.join("deck.pptx");
        let out = root.join("out");
        std::fs::create_dir_all(&root).unwrap();
        {
            let file = std::fs::File::create(&pptx).unwrap();
            let mut zip = zip::ZipWriter::new(file);
            let opt = zip::write::SimpleFileOptions::default()
                .compression_method(zip::CompressionMethod::Stored);
            zip.start_file("ppt/presentation.xml", opt).unwrap();
            zip.write_all(br#"<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldSz cx="12192000" cy="6858000"/></p:presentation>"#).unwrap();
            for i in 1..=2 {
                zip.start_file(format!("ppt/slides/slide{i}.xml"), opt)
                    .unwrap();
                let xml = format!(
                    r#"<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <p:cSld><p:bg><p:bgPr><a:solidFill><a:srgbClr val="0F62FE"/></a:solidFill></p:bgPr></p:bg>
  <p:spTree><p:sp>
    <p:spPr><a:xfrm><a:off x="500000" y="500000"/><a:ext cx="8000000" cy="1200000"/></a:xfrm></p:spPr>
    <p:txBody><a:p><a:r><a:rPr sz="3200" b="1"/><a:t>Titre slide {i}</a:t></a:r></a:p></p:txBody>
  </p:sp></p:spTree></p:cSld></p:sld>"#
                );
                zip.write_all(xml.as_bytes()).unwrap();
            }
            zip.finish().unwrap();
        }
        let paths = PptxPreviewService::new()
            .render_to_html(&pptx, &out)
            .unwrap();
        assert_eq!(paths.len(), 2);
        let html = std::fs::read_to_string(&paths[0]).unwrap();
        assert!(html.contains("Titre slide 1"));
        assert!(
            html.contains("#0f62fe") || html.contains("#0F62FE") || html.contains("background: #0")
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
