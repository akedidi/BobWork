// ============================================================
// Bob Work - Artifact Generator Service
// Generates PPTX, DOCX, XLSX, PDF via python-pptx subprocess
// and stores artifacts with file validation
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::artifact::Artifact;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateArtifactInput {
    pub artifact_type: String,
    pub title: String,
    pub content: String, // Markdown or structured JSON content
    pub conversation_id: Option<String>,
}

pub struct ArtifactGeneratorService;

impl ArtifactGeneratorService {
    pub fn new() -> Self {
        Self
    }

    /// Generate an artifact from content and type, save to disk and DB
    pub fn generate(
        &self,
        db: &Database,
        input: CreateArtifactInput,
        artifacts_dir: &PathBuf,
    ) -> AppResult<Artifact> {
        std::fs::create_dir_all(artifacts_dir)?;

        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let (file_path, validation_status, validation_notes) = match input.artifact_type.as_str() {
            "pptx" => self.generate_pptx(&id, &input.title, &input.content, artifacts_dir)?,
            "docx" => self.generate_docx(&id, &input.title, &input.content, artifacts_dir)?,
            "xlsx" => self.generate_xlsx(&id, &input.title, &input.content, artifacts_dir)?,
            "pdf" => self.generate_pdf(&id, &input.title, &input.content, artifacts_dir)?,
            "markdown" | "text" | "html" => {
                self.generate_text(&id, &input.artifact_type, &input.content, artifacts_dir)?
            }
            _ => {
                let path = artifacts_dir.join(format!("{}.txt", id));
                std::fs::write(&path, &input.content)?;
                (path, "valid".to_string(), None)
            }
        };

        let size = std::fs::metadata(&file_path).map(|m| m.len() as i64).ok();
        let file_path_str = file_path.to_string_lossy().to_string();

        // Persist to DB
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO artifacts (id, type, title, file_path, version,
             validation_status, validation_notes, exported, created_at, size)
             VALUES (?1,?2,?3,?4,1,?5,?6,0,?7,?8)",
            params![
                id,
                input.artifact_type,
                input.title,
                file_path_str,
                validation_status,
                validation_notes,
                now,
                size,
            ],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        info!("Generated artifact {} at {:?}", id, file_path);

        Ok(Artifact {
            id,
            artifact_type: input.artifact_type,
            title: input.title,
            file_path: file_path_str,
            version: 1,
            preview_path: None,
            origin: input.conversation_id,
            sources: serde_json::Value::Array(vec![]),
            validation_status,
            validation_notes,
            exported: false,
            created_at: now,
            size,
        })
    }

    // ── PPTX via python-pptx ──────────────────────────────────

    fn generate_pptx(
        &self,
        id: &str,
        title: &str,
        content: &str,
        dir: &PathBuf,
    ) -> AppResult<(PathBuf, String, Option<String>)> {
        let path = dir.join(format!("{}.pptx", id));

        // Parse slide structure from markdown headings
        let slides = parse_slides_from_markdown(content);
        let slides_json = serde_json::to_string(&slides).unwrap_or_else(|_| "[]".to_string());

        let python_script = format!(
            r#"
import sys, json
from pptx import Presentation
from pptx.util import Inches, Pt
from pptx.dml.color import RGBColor

slides_data = json.loads('''{slides_json}''')
title_str = '''{title}'''
output_path = r'''{output_path}'''

prs = Presentation()
prs.slide_width = Inches(13.33)
prs.slide_height = Inches(7.5)

# Title slide
title_layout = prs.slide_layouts[0]
slide = prs.slides.add_slide(title_layout)
slide.shapes.title.text = title_str
if len(slide.placeholders) > 1:
    slide.placeholders[1].text = "Généré par Bob Work"

# Content slides
content_layout = prs.slide_layouts[1]
for s in slides_data:
    slide = prs.slides.add_slide(content_layout)
    slide.shapes.title.text = s.get('title', '')
    body = slide.placeholders[1] if len(slide.placeholders) > 1 else None
    if body:
        tf = body.text_frame
        tf.word_wrap = True
        for i, bullet in enumerate(s.get('bullets', [])):
            if i == 0:
                tf.paragraphs[0].text = bullet
            else:
                p = tf.add_paragraph()
                p.text = bullet

prs.save(output_path)
print("OK:" + output_path)
"#,
            slides_json = slides_json.replace("'", "\\'"),
            title = title.replace("'", "\\'"),
            output_path = path.to_string_lossy(),
        );

        let result = std::process::Command::new("python3")
            .arg("-c")
            .arg(&python_script)
            .output();

        match result {
            Ok(o) if o.status.success() => {
                let notes = if path.exists() {
                    None
                } else {
                    Some("File not created".to_string())
                };
                let status = if path.exists() { "valid" } else { "invalid" }.to_string();
                Ok((path, status, notes))
            }
            Ok(o) => {
                let stderr = String::from_utf8_lossy(&o.stderr).to_string();
                error!("python-pptx error: {}", stderr);
                // Fallback: create empty pptx
                let fallback_script = format!(
                    "from pptx import Presentation; p=Presentation(); p.save(r'{}')",
                    path.to_string_lossy()
                );
                let _ = std::process::Command::new("python3")
                    .arg("-c")
                    .arg(&fallback_script)
                    .output();
                Ok((
                    path,
                    "warning".to_string(),
                    Some(format!(
                        "python-pptx warning: {}",
                        stderr.lines().next().unwrap_or("")
                    )),
                ))
            }
            Err(e) => Err(AppError::Io(format!("python3 not available: {}", e))),
        }
    }

    // ── DOCX via simple XML ───────────────────────────────────

    fn generate_docx(
        &self,
        id: &str,
        title: &str,
        content: &str,
        dir: &PathBuf,
    ) -> AppResult<(PathBuf, String, Option<String>)> {
        let path = dir.join(format!("{}.docx", id));

        // Build minimal DOCX (ZIP with Word XML)
        let docx_bytes = build_minimal_docx(title, content);
        std::fs::write(&path, docx_bytes)?;

        Ok((path, "valid".to_string(), None))
    }

    // ── XLSX via simple CSV-in-ZIP ────────────────────────────

    fn generate_xlsx(
        &self,
        id: &str,
        title: &str,
        content: &str,
        dir: &PathBuf,
    ) -> AppResult<(PathBuf, String, Option<String>)> {
        let path = dir.join(format!("{}.xlsx", id));

        // Build minimal XLSX
        let xlsx_bytes = build_minimal_xlsx(title, content);
        std::fs::write(&path, xlsx_bytes)?;

        Ok((path, "valid".to_string(), None))
    }

    // ── PDF via markdown → HTML → PDF (python) ────────────────

    fn generate_pdf(
        &self,
        id: &str,
        title: &str,
        content: &str,
        dir: &PathBuf,
    ) -> AppResult<(PathBuf, String, Option<String>)> {
        let path = dir.join(format!("{}.pdf", id));

        // Try weasyprint or pdfkit
        let html = markdown_to_html(title, content);
        let html_path = dir.join(format!("{}.html", id));
        std::fs::write(&html_path, &html)?;

        let pdf_result = std::process::Command::new("python3")
            .arg("-c")
            .arg(format!(
                "import weasyprint; weasyprint.HTML(filename=r'{}').write_pdf(r'{}')",
                html_path.to_string_lossy(),
                path.to_string_lossy()
            ))
            .output();

        let _ = std::fs::remove_file(&html_path);

        if pdf_result.map(|o| o.status.success()).unwrap_or(false) && path.exists() {
            Ok((path, "valid".to_string(), None))
        } else {
            // Fallback: deliver as HTML renamed to .pdf (opens in browser)
            std::fs::write(&path, html)?;
            Ok((
                path,
                "warning".to_string(),
                Some("PDF généré au format HTML (weasyprint non disponible)".to_string()),
            ))
        }
    }

    // ── Plain text / markdown ─────────────────────────────────

    fn generate_text(
        &self,
        id: &str,
        ext: &str,
        content: &str,
        dir: &PathBuf,
    ) -> AppResult<(PathBuf, String, Option<String>)> {
        let path = dir.join(format!("{}.{}", id, ext));
        std::fs::write(&path, content)?;
        Ok((path, "valid".to_string(), None))
    }
}

// ── Helpers ───────────────────────────────────────────────────

#[derive(Serialize)]
struct Slide {
    title: String,
    bullets: Vec<String>,
}

fn parse_slides_from_markdown(content: &str) -> Vec<Slide> {
    let mut slides: Vec<Slide> = Vec::new();
    let mut current_title = String::new();
    let mut current_bullets: Vec<String> = Vec::new();

    for line in content.lines() {
        if line.starts_with("## ") || line.starts_with("# ") {
            if !current_title.is_empty() {
                slides.push(Slide {
                    title: current_title.clone(),
                    bullets: current_bullets.clone(),
                });
                current_bullets.clear();
            }
            current_title = line.trim_start_matches('#').trim().to_string();
        } else if line.starts_with("- ") || line.starts_with("* ") {
            current_bullets.push(
                line.trim_start_matches('-')
                    .trim_start_matches('*')
                    .trim()
                    .to_string(),
            );
        } else if !line.trim().is_empty() && !line.starts_with("```") {
            current_bullets.push(line.trim().to_string());
        }
    }

    if !current_title.is_empty() {
        slides.push(Slide {
            title: current_title,
            bullets: current_bullets,
        });
    }

    if slides.is_empty() {
        // Create a single slide from the whole content
        slides.push(Slide {
            title: "Contenu".to_string(),
            bullets: content
                .lines()
                .filter(|l| !l.trim().is_empty())
                .take(10)
                .map(|l| l.trim().to_string())
                .collect(),
        });
    }

    slides
}

fn markdown_to_html(title: &str, content: &str) -> String {
    let body = content
        .lines()
        .map(|line| {
            if line.starts_with("# ") {
                format!("<h1>{}</h1>", &line[2..])
            } else if line.starts_with("## ") {
                format!("<h2>{}</h2>", &line[3..])
            } else if line.starts_with("- ") {
                format!("<li>{}</li>", &line[2..])
            } else if line.trim().is_empty() {
                "<br>".to_string()
            } else {
                format!("<p>{}</p>", line)
            }
        })
        .collect::<Vec<_>>()
        .join("\n");

    format!(
        r#"<!DOCTYPE html><html><head><meta charset="utf-8">
<title>{title}</title>
<style>body{{font-family:system-ui,sans-serif;max-width:800px;margin:40px auto;padding:0 20px;line-height:1.6}}
h1,h2{{color:#1f2328}}code{{background:#f5f5f4;padding:2px 6px;border-radius:4px}}</style>
</head><body><h1>{title}</h1>{body}</body></html>"#,
        title = title,
        body = body
    )
}

/// Build a minimal valid DOCX (ZIP containing Word XML)
fn build_minimal_docx(title: &str, content: &str) -> Vec<u8> {
    use std::io::Write;

    // We'll build the XML directly and create a proper ZIP
    let content_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:wpc="http://schemas.microsoft.com/office/word/2010/wordprocessingCanvas"
  xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>{}</w:t></w:r></w:p>
{}
<w:sectPr/>
</w:body></w:document>"#,
        xml_escape(title),
        content
            .lines()
            .map(|line| {
                if line.trim().is_empty() {
                    String::new()
                } else {
                    format!(
                        "<w:p><w:r><w:t xml:space=\"preserve\">{}</w:t></w:r></w:p>",
                        xml_escape(line)
                    )
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    );

    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"#;

    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"#;

    let word_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>
"#;

    // Build ZIP in memory
    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options: zip::write::FileOptions<()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("[Content_Types].xml", options).unwrap();
        zip.write_all(content_types.as_bytes()).unwrap();

        zip.start_file("_rels/.rels", options).unwrap();
        zip.write_all(rels.as_bytes()).unwrap();

        zip.start_file("word/_rels/document.xml.rels", options)
            .unwrap();
        zip.write_all(word_rels.as_bytes()).unwrap();

        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(content_xml.as_bytes()).unwrap();

        zip.finish().unwrap();
    }
    buf
}

/// Build a minimal valid XLSX
fn build_minimal_xlsx(title: &str, content: &str) -> Vec<u8> {
    use std::io::Write;

    let rows: Vec<Vec<String>> = std::iter::once(vec![title.to_string()])
        .chain(
            content
                .lines()
                .filter(|l| !l.trim().is_empty())
                .map(|line| {
                    line.split('\t')
                        .map(|cell| cell.trim().to_string())
                        .collect()
                }),
        )
        .collect();

    let row_xml: String = rows
        .iter()
        .enumerate()
        .map(|(ri, row)| {
            let cells: String = row
                .iter()
                .enumerate()
                .map(|(ci, cell)| {
                    let col_letter = (b'A' + ci as u8) as char;
                    format!(
                        r#"<c r="{}{}" t="inlineStr"><is><t>{}</t></is></c>"#,
                        col_letter,
                        ri + 1,
                        xml_escape(cell)
                    )
                })
                .collect();
            format!("<row r=\"{}\">{}</row>", ri + 1, cells)
        })
        .collect();

    let sheet_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>{}</sheetData>
</worksheet>"#,
        row_xml
    );

    let workbook_xml = format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
  xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="{}" sheetId="1" r:id="rId1"/></sheets>
</workbook>"#,
        xml_escape(title)
    );

    let content_types = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>"#;

    let rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"#;

    let wb_rels = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>"#;

    let mut buf = Vec::new();
    {
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(&mut buf));
        let options: zip::write::FileOptions<()> =
            zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);

        zip.start_file("[Content_Types].xml", options).unwrap();
        zip.write_all(content_types.as_bytes()).unwrap();
        zip.start_file("_rels/.rels", options).unwrap();
        zip.write_all(rels.as_bytes()).unwrap();
        zip.start_file("xl/workbook.xml", options).unwrap();
        zip.write_all(workbook_xml.as_bytes()).unwrap();
        zip.start_file("xl/_rels/workbook.xml.rels", options)
            .unwrap();
        zip.write_all(wb_rels.as_bytes()).unwrap();
        zip.start_file("xl/worksheets/sheet1.xml", options).unwrap();
        zip.write_all(sheet_xml.as_bytes()).unwrap();
        zip.finish().unwrap();
    }
    buf
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
}
