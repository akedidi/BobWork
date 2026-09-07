use crate::db::Database;
use crate::error::{AppError, AppResult};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRuntimeMetadata {
    pub artifact_id: String,
    pub artifact_kind: String,
    pub owner_plugin_id: Option<String>,
    pub producer_runtime_id: Option<String>,
    pub project_id: Option<String>,
    pub conversation_id: Option<String>,
    pub workspace_reference: Option<String>,
    pub metadata: serde_json::Value,
    pub preview_state: String,
    pub updated_at: String,
}

/// Shared lifecycle façade over Bob Work's existing artifact persistence.
/// It deliberately does not create a second artifact catalogue.
pub struct ArtifactRuntime;

impl ArtifactRuntime {
    pub fn new() -> Self {
        Self
    }

    pub fn attach(&self, db: &Database, metadata: &ArtifactRuntimeMetadata) -> AppResult<()> {
        let exists: bool = db.connection().query_row(
            "SELECT EXISTS(SELECT 1 FROM artifacts WHERE id=?1)",
            params![metadata.artifact_id],
            |row| row.get(0),
        )?;
        if !exists {
            return Err(AppError::NotFound(format!(
                "Artifact {}",
                metadata.artifact_id
            )));
        }
        db.connection().execute(
            "INSERT INTO artifact_runtime_metadata(
                artifact_id,artifact_kind,owner_plugin_id,producer_runtime_id,project_id,
                conversation_id,workspace_reference,metadata,preview_state,updated_at,deleted_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL)
             ON CONFLICT(artifact_id) DO UPDATE SET
                artifact_kind=excluded.artifact_kind,owner_plugin_id=excluded.owner_plugin_id,
                producer_runtime_id=excluded.producer_runtime_id,project_id=excluded.project_id,
                conversation_id=excluded.conversation_id,
                workspace_reference=excluded.workspace_reference,metadata=excluded.metadata,
                preview_state=excluded.preview_state,updated_at=excluded.updated_at,deleted_at=NULL",
            params![
                metadata.artifact_id,
                metadata.artifact_kind,
                metadata.owner_plugin_id,
                metadata.producer_runtime_id,
                metadata.project_id,
                metadata.conversation_id,
                metadata.workspace_reference,
                metadata.metadata.to_string(),
                metadata.preview_state,
                metadata.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn get(
        &self,
        db: &Database,
        artifact_id: &str,
    ) -> AppResult<Option<ArtifactRuntimeMetadata>> {
        let result = db.connection().query_row(
            "SELECT artifact_id,artifact_kind,owner_plugin_id,producer_runtime_id,project_id,
                    conversation_id,workspace_reference,metadata,preview_state,updated_at
             FROM artifact_runtime_metadata WHERE artifact_id=?1 AND deleted_at IS NULL",
            params![artifact_id],
            |row| {
                let raw: String = row.get(7)?;
                Ok(ArtifactRuntimeMetadata {
                    artifact_id: row.get(0)?,
                    artifact_kind: row.get(1)?,
                    owner_plugin_id: row.get(2)?,
                    producer_runtime_id: row.get(3)?,
                    project_id: row.get(4)?,
                    conversation_id: row.get(5)?,
                    workspace_reference: row.get(6)?,
                    metadata: serde_json::from_str(&raw).unwrap_or_default(),
                    preview_state: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            },
        );
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn detach_runtime(&self, db: &Database, runtime_id: &str) -> AppResult<usize> {
        // Persistent artifacts remain. Only the historical producer handle is
        // detached when an optional runtime is removed.
        Ok(db.connection().execute(
            "UPDATE artifact_runtime_metadata SET producer_runtime_id=NULL,updated_at=?1
             WHERE producer_runtime_id=?2",
            params![Utc::now().to_rfc3339(), runtime_id],
        )?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::runtime::RuntimeStatus;
    use crate::services::runtime_manager::RuntimeManager;

    #[test]
    fn removing_external_runtime_preserves_persistent_artifact() {
        let root = tempfile::tempdir().unwrap();
        let db = Database::new_in_memory().unwrap();
        db.run_migrations().unwrap();
        let manager = RuntimeManager::with_roots(
            root.path().join("runtimes"),
            root.path().join("cache"),
            root.path().join("artifacts"),
        );
        manager.seed_registry(&db).unwrap();
        let runtime_path = root.path().join("runtimes/external/qiskit/test");
        std::fs::create_dir_all(&runtime_path).unwrap();
        std::fs::write(runtime_path.join("runtime.json"), b"{}").unwrap();
        db.connection()
            .execute(
                "UPDATE runtime_registry SET status='installed',install_path=?1
                 WHERE runtime_id='external.qiskit'",
                params![runtime_path.to_string_lossy()],
            )
            .unwrap();
        db.connection()
            .execute(
                "INSERT INTO artifacts(id,type,title,file_path,created_at)
                 VALUES ('quantum-result','data','Quantum result','/tmp/result.json','now')",
                [],
            )
            .unwrap();
        let runtime = ArtifactRuntime::new();
        runtime
            .attach(
                &db,
                &ArtifactRuntimeMetadata {
                    artifact_id: "quantum-result".into(),
                    artifact_kind: "quantum-result".into(),
                    owner_plugin_id: None,
                    producer_runtime_id: Some("external.qiskit".into()),
                    project_id: None,
                    conversation_id: None,
                    workspace_reference: None,
                    metadata: serde_json::json!({"shots":1024}),
                    preview_state: "ready".into(),
                    updated_at: "now".into(),
                },
            )
            .unwrap();

        manager.remove_runtime(&db, "external.qiskit").unwrap();

        let exists: bool = db
            .connection()
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM artifacts WHERE id='quantum-result')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(exists);
        let metadata = runtime.get(&db, "quantum-result").unwrap().unwrap();
        assert_eq!(metadata.producer_runtime_id, None);
        assert_eq!(
            manager.get(&db, "external.qiskit").unwrap().unwrap().status,
            RuntimeStatus::NotInstalled
        );
    }
}
