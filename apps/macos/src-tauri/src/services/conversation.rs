// ============================================================
// Bob Work - Conversation Service
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::conversation::{
    AddMessageInput, Conversation, CreateConversationInput, Message,
};
use chrono::Utc;
use rusqlite::params;
use uuid::Uuid;

pub struct ConversationService;

impl ConversationService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_all(&self, db: &Database, project_id: Option<&str>) -> AppResult<Vec<Conversation>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, project_id, title, type, business_mode, bob_mode,
             date, pinned, local_only, summary, bob_context_state, archived
             FROM conversations WHERE archived = 0 ORDER BY pinned DESC, date DESC LIMIT 50",
        )?;

        let all_convs: Vec<Conversation> = stmt
            .query_map([], |row| Self::row_to_conversation(row))?
            .filter_map(|r| r.ok())
            .collect();

        if let Some(pid) = project_id {
            Ok(all_convs
                .into_iter()
                .filter(|c| c.project_id.as_deref() == Some(pid))
                .collect())
        } else {
            Ok(all_convs)
        }
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<Conversation>> {
        let conn = db.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, project_id, title, type, business_mode, bob_mode,
             date, pinned, local_only, summary, bob_context_state, archived
             FROM conversations WHERE id = ?1",
            params![id],
            |row| Self::row_to_conversation(row),
        );

        match result {
            Ok(c) => Ok(Some(c)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(AppError::Database(e.to_string())),
        }
    }

    pub fn create(&self, db: &Database, input: CreateConversationInput) -> AppResult<Conversation> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let conv_type = input
            .conversation_type
            .clone()
            .unwrap_or_else(|| "chat".to_string());
        let bmode = input
            .business_mode
            .clone()
            .unwrap_or_else(|| "general_work".to_string());
        let title = if input.title.is_empty() {
            "Nouvelle conversation".to_string()
        } else {
            input.title.clone()
        };

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO conversations (id, project_id, title, type, business_mode, bob_mode, date, pinned, local_only, archived)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, 1, 0)",
            params![
                id,
                input.project_id,
                title,
                conv_type,
                bmode,
                input.bob_mode,
                now,
            ],
        )?;

        Ok(Conversation {
            id,
            project_id: input.project_id,
            title: if input.title.is_empty() {
                "Nouvelle conversation".to_string()
            } else {
                input.title
            },
            conversation_type: input
                .conversation_type
                .unwrap_or_else(|| "chat".to_string()),
            business_mode: Some(
                input
                    .business_mode
                    .unwrap_or_else(|| "general_work".to_string()),
            ),
            bob_mode: input.bob_mode,
            date: now,
            pinned: false,
            local_only: true,
            summary: None,
            bob_context_state: serde_json::Value::Object(serde_json::Map::new()),
            archived: false,
        })
    }

    pub fn update_title(&self, db: &Database, id: &str, title: &str) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "UPDATE conversations SET title = ?1 WHERE id = ?2",
            params![title, id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, db: &Database, id: &str, pinned: bool) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE conversations SET pinned = ?1 WHERE id = ?2",
            params![pinned, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".to_string()));
        }
        Ok(())
    }

    pub fn set_archived(&self, db: &Database, id: &str, archived: bool) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE conversations SET archived = ?1 WHERE id = ?2",
            params![archived, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".to_string()));
        }
        Ok(())
    }

    pub fn set_project_id(&self, db: &Database, id: &str, project_id: Option<&str>) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let changed = conn.execute(
            "UPDATE conversations SET project_id = ?1 WHERE id = ?2",
            params![project_id, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".to_string()));
        }
        Ok(())
    }

    pub fn delete(&self, db: &Database, id: &str) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        conn.execute("DELETE FROM conversations WHERE id = ?1", params![id])?;
        Ok(())
    }

    pub fn get_messages(&self, db: &Database, conversation_id: &str) -> AppResult<Vec<Message>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, conversation_id, author, content, attachments, sources,
             citations, tools_used, send_state, errors,
             associated_artifacts, associated_approvals, created_at
             FROM messages
             WHERE conversation_id = ?1
             ORDER BY created_at ASC",
        )?;

        let messages: Vec<Message> = stmt
            .query_map(params![conversation_id], |row| {
                Ok(Message {
                    id: row.get(0)?,
                    conversation_id: row.get(1)?,
                    author: row.get(2)?,
                    content: row.get(3)?,
                    attachments: serde_json::from_str(
                        &row.get::<_, String>(4).unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    sources: serde_json::from_str(
                        &row.get::<_, String>(5).unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    citations: serde_json::from_str(
                        &row.get::<_, String>(6).unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    tools_used: serde_json::from_str(
                        &row.get::<_, String>(7).unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    send_state: row.get(8)?,
                    errors: serde_json::from_str(
                        &row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    associated_artifacts: serde_json::from_str(
                        &row.get::<_, String>(10)
                            .unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    associated_approvals: serde_json::from_str(
                        &row.get::<_, String>(11)
                            .unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    created_at: row.get(12)?,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(messages)
    }

    pub fn add_message(&self, db: &Database, input: AddMessageInput) -> AppResult<Message> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let attachments = input
            .attachments
            .unwrap_or(serde_json::Value::Array(vec![]));
        let sources = input.sources.unwrap_or(serde_json::Value::Array(vec![]));

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO messages (id, conversation_id, author, content, attachments, sources, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                id,
                input.conversation_id,
                input.author,
                input.content,
                attachments.to_string(),
                sources.to_string(),
                now,
            ],
        )?;

        Ok(Message {
            id,
            conversation_id: input.conversation_id,
            author: input.author,
            content: input.content,
            attachments,
            sources,
            citations: serde_json::Value::Array(vec![]),
            tools_used: serde_json::Value::Array(vec![]),
            send_state: "sent".to_string(),
            errors: serde_json::Value::Array(vec![]),
            associated_artifacts: serde_json::Value::Array(vec![]),
            associated_approvals: serde_json::Value::Array(vec![]),
            created_at: now,
        })
    }

    fn row_to_conversation(row: &rusqlite::Row) -> rusqlite::Result<Conversation> {
        Ok(Conversation {
            id: row.get(0)?,
            project_id: row.get(1)?,
            title: row.get(2)?,
            conversation_type: row.get(3)?,
            business_mode: row.get(4)?,
            bob_mode: row.get(5)?,
            date: row.get(6)?,
            pinned: row.get::<_, bool>(7).unwrap_or(false),
            local_only: row.get::<_, bool>(8).unwrap_or(true),
            summary: row.get(9)?,
            bob_context_state: serde_json::from_str(
                &row.get::<_, String>(10)
                    .unwrap_or_else(|_| "{}".to_string()),
            )
            .unwrap_or(serde_json::Value::Object(serde_json::Map::new())),
            archived: row.get::<_, bool>(11).unwrap_or(false),
        })
    }
}
