// ============================================================
// Bob Work - Artifact Service
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::artifact::Artifact;
use rusqlite::params;

pub struct ArtifactService;

impl ArtifactService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_all(&self, db: &Database, _project_id: Option<&str>) -> AppResult<Vec<Artifact>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, type, title, file_path, version, preview_path,
             origin, sources, validation_status, validation_notes, exported, created_at, size
             FROM artifacts ORDER BY created_at DESC LIMIT 100",
        )?;

        let artifacts = stmt
            .query_map([], |row| {
                Ok(Artifact {
                    id: row.get(0)?,
                    artifact_type: row.get(1)?,
                    title: row.get(2)?,
                    file_path: row.get(3)?,
                    version: row.get::<_, i64>(4).unwrap_or(1),
                    preview_path: row.get(5)?,
                    origin: row.get(6)?,
                    sources: serde_json::from_str(
                        &row.get::<_, String>(7).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    validation_status: row.get(8)?,
                    validation_notes: row.get(9)?,
                    exported: row.get::<_, bool>(10).unwrap_or(false),
                    created_at: row.get(11)?,
                    size: row.get(12)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(artifacts)
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<Artifact>> {
        let conn = db.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, type, title, file_path, version, preview_path,
             origin, sources, validation_status, validation_notes, exported, created_at, size
             FROM artifacts WHERE id = ?1",
            params![id],
            |row| {
                Ok(Artifact {
                    id: row.get(0)?,
                    artifact_type: row.get(1)?,
                    title: row.get(2)?,
                    file_path: row.get(3)?,
                    version: row.get::<_, i64>(4).unwrap_or(1),
                    preview_path: row.get(5)?,
                    origin: row.get(6)?,
                    sources: serde_json::from_str(
                        &row.get::<_, String>(7).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    validation_status: row.get(8)?,
                    validation_notes: row.get(9)?,
                    exported: row.get::<_, bool>(10).unwrap_or(false),
                    created_at: row.get(11)?,
                    size: row.get(12)?,
                })
            },
        );
        match result {
            Ok(a) => Ok(Some(a)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn delete(&self, db: &Database, id: &str) -> AppResult<()> {
        // Get file path first
        let artifact = self.get_by_id(db, id)?;

        let conn = db.conn.lock().unwrap();
        conn.execute("DELETE FROM artifacts WHERE id = ?1", params![id])?;

        // Only delete files Bob Work owns under its artifacts folder — never
        // wipe user Desktop/Documents paths registered from Bob Shell output.
        if let Some(artifact) = artifact {
            let path = std::path::Path::new(&artifact.file_path);
            let is_external = artifact
                .origin
                .as_deref()
                .is_some_and(|origin| origin.starts_with("bob-shell") || origin == "external");
            if path.exists() && !is_external {
                let _ = std::fs::remove_file(path);
            }
        }

        Ok(())
    }

    /// Register an existing file produced by Bob Shell (Desktop, workspace, …)
    /// as a gallery artifact. Dedupes by absolute path.
    pub fn register_external(
        &self,
        db: &Database,
        file_path: &str,
        conversation_id: Option<&str>,
    ) -> AppResult<Option<Artifact>> {
        let path = std::path::Path::new(file_path);
        let canonical = match path.canonicalize() {
            Ok(value) => value,
            Err(_) => return Ok(None),
        };
        if !canonical.is_file() {
            return Ok(None);
        }
        let path_str = canonical.to_string_lossy().to_string();
        if let Some(existing) = self.find_by_path(db, &path_str)? {
            return Ok(Some(existing));
        }

        let ext = canonical
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("file")
            .to_ascii_lowercase();
        let artifact_type = match ext.as_str() {
            "ppt" => "pptx".into(),
            "doc" => "docx".into(),
            "xls" => "xlsx".into(),
            other => other.to_string(),
        };
        let title = canonical
            .file_stem()
            .and_then(|value| value.to_str())
            .unwrap_or("Artefact")
            .replace('_', " ");
        let size = std::fs::metadata(&canonical)
            .ok()
            .map(|meta| meta.len() as i64);
        let id = uuid::Uuid::new_v4().to_string();
        let now = chrono::Utc::now().to_rfc3339();
        let origin = conversation_id
            .map(|value| format!("bob-shell:{value}"))
            .unwrap_or_else(|| "bob-shell".into());

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO artifacts (id, type, title, file_path, version, origin,
             validation_status, exported, created_at, size)
             VALUES (?1,?2,?3,?4,1,?5,'valid',0,?6,?7)",
            params![id, artifact_type, title, path_str, origin, now, size,],
        )
        .map_err(|e| AppError::Database(e.to_string()))?;

        Ok(Some(Artifact {
            id,
            artifact_type,
            title,
            file_path: path_str,
            version: 1,
            preview_path: None,
            origin: Some(origin),
            sources: serde_json::json!([]),
            validation_status: "valid".into(),
            validation_notes: None,
            exported: false,
            created_at: now,
            size,
        }))
    }

    fn find_by_path(&self, db: &Database, file_path: &str) -> AppResult<Option<Artifact>> {
        let conn = db.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, type, title, file_path, version, preview_path,
             origin, sources, validation_status, validation_notes, exported, created_at, size
             FROM artifacts WHERE file_path = ?1 LIMIT 1",
            params![file_path],
            |row| {
                Ok(Artifact {
                    id: row.get(0)?,
                    artifact_type: row.get(1)?,
                    title: row.get(2)?,
                    file_path: row.get(3)?,
                    version: row.get::<_, i64>(4).unwrap_or(1),
                    preview_path: row.get(5)?,
                    origin: row.get(6)?,
                    sources: serde_json::from_str(
                        &row.get::<_, String>(7).unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    validation_status: row.get(8)?,
                    validation_notes: row.get(9)?,
                    exported: row.get::<_, bool>(10).unwrap_or(false),
                    created_at: row.get(11)?,
                    size: row.get(12)?,
                })
            },
        );
        match result {
            Ok(artifact) => Ok(Some(artifact)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(AppError::Database(error.to_string())),
        }
    }
}
