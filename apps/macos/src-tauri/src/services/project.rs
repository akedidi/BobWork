// ============================================================
// Bob Work - Project Service
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::project::{CreateProjectInput, Project, UpdateProjectInput};
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

pub struct ProjectService;

impl ProjectService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_all(&self, db: &Database) -> AppResult<Vec<Project>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, name, description, objective, color, image_url, local_path,
             custom_instructions, language, memory_enabled, allowed_files,
             allowed_plugins, allowed_integrations, default_mode,
             created_at, updated_at, archived
             FROM projects
             WHERE archived = 0
             ORDER BY updated_at DESC",
        )?;

        let projects = stmt
            .query_map([], |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    objective: row.get(3)?,
                    color: row.get(4)?,
                    image_url: row.get(5)?,
                    local_path: row.get(6)?,
                    custom_instructions: row.get(7)?,
                    language: row.get::<_, String>(8).unwrap_or("fr".to_string()),
                    memory_enabled: row.get::<_, bool>(9).unwrap_or(true),
                    allowed_files: serde_json::from_str(
                        &row.get::<_, String>(10).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    allowed_plugins: serde_json::from_str(
                        &row.get::<_, String>(11).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    allowed_integrations: serde_json::from_str(
                        &row.get::<_, String>(12).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    default_mode: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                    archived: row.get::<_, bool>(16).unwrap_or(false),
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(projects)
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<Project>> {
        let conn = db.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, name, description, objective, color, image_url, local_path,
             custom_instructions, language, memory_enabled, allowed_files,
             allowed_plugins, allowed_integrations, default_mode,
             created_at, updated_at, archived
             FROM projects WHERE id = ?1",
            params![id],
            |row| {
                Ok(Project {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    description: row.get(2)?,
                    objective: row.get(3)?,
                    color: row.get(4)?,
                    image_url: row.get(5)?,
                    local_path: row.get(6)?,
                    custom_instructions: row.get(7)?,
                    language: row.get::<_, String>(8).unwrap_or("fr".to_string()),
                    memory_enabled: row.get::<_, bool>(9).unwrap_or(true),
                    allowed_files: serde_json::from_str(
                        &row.get::<_, String>(10).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    allowed_plugins: serde_json::from_str(
                        &row.get::<_, String>(11).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    allowed_integrations: serde_json::from_str(
                        &row.get::<_, String>(12).unwrap_or("[]".to_string()),
                    )
                    .unwrap_or_default(),
                    default_mode: row.get(13)?,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                    archived: row.get::<_, bool>(16).unwrap_or(false),
                })
            },
        );

        match result {
            Ok(project) => Ok(Some(project)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create(&self, db: &Database, input: CreateProjectInput) -> AppResult<Project> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let color = input.color.unwrap_or_else(|| {
            // Generate a random project color from a palette
            let colors = [
                "#6366f1", "#0891b2", "#059669", "#d97706", "#dc2626", "#7c3aed", "#db2777",
            ];
            colors[Uuid::new_v4().as_u128() as usize % colors.len()].to_string()
        });
        let language = input.language.unwrap_or_else(|| "fr".to_string());
        let default_mode = input
            .default_mode
            .unwrap_or_else(|| "general_work".to_string());

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO projects (id, name, description, objective, color, local_path,
             custom_instructions, language, memory_enabled, default_mode, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)",
            params![
                id,
                input.name,
                input.description,
                input.objective,
                color,
                input.local_path,
                input.custom_instructions,
                language,
                true,
                default_mode,
                now,
                now,
            ],
        )?;

        Ok(Project {
            id,
            name: input.name,
            description: input.description,
            objective: input.objective,
            color: Some(color),
            image_url: None,
            local_path: input.local_path,
            custom_instructions: input.custom_instructions,
            language,
            memory_enabled: true,
            allowed_files: vec![],
            allowed_plugins: vec![],
            allowed_integrations: vec![],
            default_mode: Some(default_mode),
            created_at: now.clone(),
            updated_at: now,
            archived: false,
        })
    }

    pub fn update(&self, db: &Database, id: &str, input: UpdateProjectInput) -> AppResult<Project> {
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
            params![now, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound(format!("Project {} not found", id)));
        }

        if let Some(name) = &input.name {
            conn.execute(
                "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![name, now, id],
            )?;
        }
        if let Some(desc) = &input.description {
            conn.execute(
                "UPDATE projects SET description = ?1, updated_at = ?2 WHERE id = ?3",
                params![desc, now, id],
            )?;
        }
        if let Some(objective) = &input.objective {
            conn.execute(
                "UPDATE projects SET objective = ?1, updated_at = ?2 WHERE id = ?3",
                params![objective, now, id],
            )?;
        }
        if let Some(color) = &input.color {
            conn.execute(
                "UPDATE projects SET color = ?1, updated_at = ?2 WHERE id = ?3",
                params![color, now, id],
            )?;
        }
        if let Some(ci) = &input.custom_instructions {
            conn.execute(
                "UPDATE projects SET custom_instructions = ?1, updated_at = ?2 WHERE id = ?3",
                params![ci, now, id],
            )?;
        }
        if let Some(mem) = input.memory_enabled {
            conn.execute(
                "UPDATE projects SET memory_enabled = ?1, updated_at = ?2 WHERE id = ?3",
                params![mem, now, id],
            )?;
        }
        if let Some(mode) = &input.default_mode {
            conn.execute(
                "UPDATE projects SET default_mode = ?1, updated_at = ?2 WHERE id = ?3",
                params![mode, now, id],
            )?;
        }
        if let Some(path) = &input.local_path {
            conn.execute(
                "UPDATE projects SET local_path = ?1, updated_at = ?2 WHERE id = ?3",
                params![path, now, id],
            )?;
        }
        if let Some(language) = &input.language {
            conn.execute(
                "UPDATE projects SET language = ?1, updated_at = ?2 WHERE id = ?3",
                params![language, now, id],
            )?;
        }
        if let Some(values) = &input.allowed_files {
            conn.execute(
                "UPDATE projects SET allowed_files = ?1, updated_at = ?2 WHERE id = ?3",
                params![serde_json::to_string(values)?, now, id],
            )?;
        }
        if let Some(values) = &input.allowed_plugins {
            conn.execute(
                "UPDATE projects SET allowed_plugins = ?1, updated_at = ?2 WHERE id = ?3",
                params![serde_json::to_string(values)?, now, id],
            )?;
        }
        if let Some(values) = &input.allowed_integrations {
            conn.execute(
                "UPDATE projects SET allowed_integrations = ?1, updated_at = ?2 WHERE id = ?3",
                params![serde_json::to_string(values)?, now, id],
            )?;
        }

        drop(conn);
        self.get_by_id(db, id)?
            .ok_or_else(|| AppError::NotFound(format!("Project {} not found", id)))
    }

    pub fn delete(&self, db: &Database, id: &str) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        conn.execute("DELETE FROM projects WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn archive(&self, db: &Database, id: &str, archived: bool) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE projects SET archived = ?1, updated_at = ?2 WHERE id = ?3",
            params![archived, now, id],
        )?;
        Ok(())
    }
}
