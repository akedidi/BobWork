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

        // Clean up file if it exists
        if let Some(artifact) = artifact {
            let path = std::path::Path::new(&artifact.file_path);
            if path.exists() {
                std::fs::remove_file(path).ok();
            }
        }

        Ok(())
    }
}
