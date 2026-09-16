// ============================================================
// Bob Work - Conversation Service
// ============================================================

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::conversation::{
    AddMessageInput, Conversation, CreateConversationInput, Message,
};
use crate::services::bob::BobService;
use crate::services::task::TaskService;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::path::Path;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindConversationResult {
    pub deleted_messages: usize,
    pub cancelled_tasks: usize,
    pub title_reset: bool,
}

pub struct ConversationService;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConversationContextState {
    pub summary: String,
    pub compacted_message_count: usize,
    pub compacted_through_id: Option<String>,
    pub updated_at: Option<String>,
    pub version: u32,
    #[serde(default)]
    pub last_context_tokens: Option<u64>,
    #[serde(default)]
    pub last_context_window: Option<u64>,
    #[serde(default)]
    pub last_condensed_at: Option<String>,
}

impl ConversationService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_all(&self, db: &Database, project_id: Option<&str>) -> AppResult<Vec<Conversation>> {
        let conn = db.conn.lock().unwrap();
        // Only list conversations that already have a user prompt — empty drafts
        // stay out of the sidebar until the first message is sent.
        let mut stmt = conn.prepare(
            "SELECT c.id, c.project_id, c.title, c.type, c.business_mode, c.bob_mode,
             c.date, c.pinned, c.local_only, c.summary, c.bob_context_state, c.archived,
             c.plan_activities
             FROM conversations c
             WHERE c.archived = 0
               AND EXISTS (
                 SELECT 1 FROM messages m
                 WHERE m.conversation_id = c.id AND m.author = 'user'
               )
             ORDER BY c.date DESC
             LIMIT 1000",
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

    pub fn get_archived(
        &self,
        db: &Database,
        project_id: Option<&str>,
    ) -> AppResult<Vec<Conversation>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.project_id, c.title, c.type, c.business_mode, c.bob_mode,
             c.date, c.pinned, c.local_only, c.summary, c.bob_context_state, c.archived,
             c.plan_activities
             FROM conversations c
             WHERE c.archived = 1
               AND (?1 IS NULL OR c.project_id = ?1)
               AND EXISTS (
                 SELECT 1 FROM messages m
                 WHERE m.conversation_id = c.id AND m.author = 'user'
               )
             ORDER BY c.date DESC
             LIMIT 1000",
        )?;
        let conversations = stmt
            .query_map(params![project_id], |row| Self::row_to_conversation(row))?
            .filter_map(Result::ok)
            .collect();
        Ok(conversations)
    }

    /// Delete conversations that never received a user prompt (stale drafts).
    /// Skips very recent rows so an in-flight first send is not removed.
    pub fn purge_promptless(&self, db: &Database) -> AppResult<usize> {
        let cutoff = (Utc::now() - chrono::Duration::seconds(45)).to_rfc3339();
        let conn = db.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM conversations
             WHERE date < ?1
               AND NOT EXISTS (
                 SELECT 1 FROM messages m
                 WHERE m.conversation_id = conversations.id AND m.author = 'user'
               )",
            params![cutoff],
        )?;
        Ok(deleted)
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<Conversation>> {
        let conn = db.conn.lock().unwrap();
        let result = conn.query_row(
            "SELECT id, project_id, title, type, business_mode, bob_mode,
             date, pinned, local_only, summary, bob_context_state, archived, plan_activities
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

    pub fn context_state(
        &self,
        db: &Database,
        conversation_id: &str,
    ) -> AppResult<ConversationContextState> {
        let conversation = self
            .get_by_id(db, conversation_id)?
            .ok_or_else(|| AppError::NotFound("Conversation introuvable".into()))?;
        Ok(serde_json::from_value(conversation.bob_context_state).unwrap_or_default())
    }

    /// Persist one bounded current summary. There is deliberately no revision
    /// table: replacing the previous value keeps SQLite growth constant.
    pub fn save_context_summary(
        &self,
        db: &Database,
        conversation_id: &str,
        summary: &str,
        compacted_messages: &[Message],
        previous_version: u32,
    ) -> AppResult<()> {
        let summary = summary.trim().chars().take(6_000).collect::<String>();
        let previous = self.context_state(db, conversation_id).unwrap_or_default();
        let now = Utc::now().to_rfc3339();
        let state = ConversationContextState {
            summary: summary.clone(),
            compacted_message_count: compacted_messages.len(),
            compacted_through_id: compacted_messages.last().map(|message| message.id.clone()),
            updated_at: Some(now.clone()),
            version: previous_version.saturating_add(1),
            last_context_tokens: previous.last_context_tokens,
            last_context_window: previous.last_context_window,
            last_condensed_at: Some(now),
        };
        let changed = db.connection().execute(
            "UPDATE conversations SET summary=?1,bob_context_state=?2 WHERE id=?3",
            params![summary, serde_json::to_string(&state)?, conversation_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".into()));
        }
        Ok(())
    }

    pub fn mark_context_condensed(&self, db: &Database, conversation_id: &str) -> AppResult<()> {
        let mut state = self.context_state(db, conversation_id).unwrap_or_default();
        let now = Utc::now().to_rfc3339();
        state.last_condensed_at = Some(now.clone());
        state.updated_at = Some(now);
        let changed = db.connection().execute(
            "UPDATE conversations SET bob_context_state=?1 WHERE id=?2",
            params![serde_json::to_string(&state)?, conversation_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".into()));
        }
        Ok(())
    }

    pub fn save_context_usage(
        &self,
        db: &Database,
        conversation_id: &str,
        tokens: u64,
        window: u64,
    ) -> AppResult<()> {
        let mut state = self.context_state(db, conversation_id).unwrap_or_default();
        state.last_context_tokens = Some(tokens);
        state.last_context_window = Some(window);
        state.updated_at = Some(Utc::now().to_rfc3339());
        let changed = db.connection().execute(
            "UPDATE conversations SET bob_context_state=?1 WHERE id=?2",
            params![serde_json::to_string(&state)?, conversation_id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".into()));
        }
        Ok(())
    }

    /// Persist the current public execution-plan trace on the conversation.
    /// A complete snapshot replaces the previous plan; progress and terminal
    /// events extend that snapshot so the UI can derive the latest statuses.
    pub fn save_plan_activity(
        &self,
        db: &Database,
        conversation_id: &str,
        event_type: &str,
        title: Option<&str>,
        content: Option<&str>,
        tool_name: Option<&str>,
        payload: &serde_json::Value,
    ) -> AppResult<bool> {
        let is_snapshot =
            tool_name.is_some_and(is_plan_tool) && payload_contains_plan_steps(payload, 0);
        let normalized_content = content.unwrap_or_default().to_ascii_lowercase();
        let is_progress = normalized_content.contains("todo list updated")
            || normalized_content.contains("to do list updated");
        let is_terminal = matches!(event_type, "run_finished" | "session_completed");
        if !is_snapshot && !is_progress && !is_terminal {
            return Ok(false);
        }

        let conn = db.connection();
        let current: String = conn
            .query_row(
                "SELECT plan_activities FROM conversations WHERE id=?1",
                params![conversation_id],
                |row| row.get(0),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound("Conversation introuvable".into())
                }
                other => AppError::Database(other.to_string()),
            })?;
        let mut activities = if is_snapshot {
            Vec::new()
        } else {
            serde_json::from_str::<Vec<serde_json::Value>>(&current).unwrap_or_default()
        };
        // A terminal event without a preceding plan is ordinary task activity.
        if is_terminal && activities.is_empty() {
            return Ok(false);
        }
        activities.push(serde_json::json!({
            "name": tool_name.or(title).unwrap_or(event_type),
            "eventType": event_type,
            "title": title,
            "content": content,
            "toolName": tool_name,
            "payload": payload,
            "createdAt": Utc::now().to_rfc3339(),
        }));
        conn.execute(
            "UPDATE conversations SET plan_activities=?1 WHERE id=?2",
            params![serde_json::to_string(&activities)?, conversation_id],
        )?;
        Ok(true)
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
            .unwrap_or_else(|| "agent".to_string());
        let bob_mode = input
            .bob_mode
            .clone()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "agent".to_string());
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
                bob_mode,
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
            business_mode: Some(bmode),
            bob_mode: Some(bob_mode),
            date: now,
            pinned: false,
            local_only: true,
            summary: None,
            bob_context_state: serde_json::Value::Object(serde_json::Map::new()),
            archived: false,
            plan_activities: serde_json::Value::Array(vec![]),
        })
    }

    pub fn update_title(&self, db: &Database, id: &str, title: &str) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        conn.execute(
            "UPDATE conversations SET title = ?1, date = ?2 WHERE id = ?3",
            params![title, now, id],
        )?;
        Ok(())
    }

    pub fn set_pinned(&self, db: &Database, id: &str, pinned: bool) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE conversations SET pinned = ?1, date = ?2 WHERE id = ?3",
            params![pinned, now, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".to_string()));
        }
        Ok(())
    }

    pub fn set_archived(&self, db: &Database, id: &str, archived: bool) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE conversations SET archived = ?1, date = ?2 WHERE id = ?3",
            params![archived, now, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".to_string()));
        }
        Ok(())
    }

    pub fn set_project_id(
        &self,
        db: &Database,
        id: &str,
        project_id: Option<&str>,
    ) -> AppResult<()> {
        let conn = db.conn.lock().unwrap();
        let now = Utc::now().to_rfc3339();
        let changed = conn.execute(
            "UPDATE conversations SET project_id = ?1, date = ?2 WHERE id = ?3",
            params![project_id, now, id],
        )?;
        if changed == 0 {
            return Err(AppError::NotFound("Conversation introuvable".to_string()));
        }
        Ok(())
    }

    pub fn set_mode(&self, db: &Database, id: &str, mode: &str) -> AppResult<()> {
        let mode = mode.trim();
        if mode.is_empty() {
            return Err(AppError::ValidationFailed(
                "Le mode de conversation ne peut pas être vide.".into(),
            ));
        }
        let changed = db.conn.lock().unwrap().execute(
            "UPDATE conversations SET business_mode = ?1, bob_mode = ?1 WHERE id = ?2",
            params![mode, id],
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
             associated_artifacts, associated_approvals, file_changes, created_at
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
                    file_changes: serde_json::from_str(
                        &row.get::<_, String>(12)
                            .unwrap_or_else(|_| "[]".to_string()),
                    )
                    .unwrap_or_default(),
                    created_at: row.get(13)?,
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
        // `date` is the public last-modified timestamp used by desktop and
        // mobile. Every persisted message, including Bob's reply, is activity.
        conn.execute(
            "UPDATE conversations SET date = ?1 WHERE id = ?2",
            params![now, input.conversation_id],
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
            file_changes: serde_json::Value::Array(vec![]),
            created_at: now,
        })
    }

    pub fn set_message_file_changes(
        &self,
        db: &Database,
        message_id: &str,
        file_changes: &serde_json::Value,
    ) -> AppResult<()> {
        db.connection().execute(
            "UPDATE messages SET file_changes = ?1 WHERE id = ?2",
            params![file_changes.to_string(), message_id],
        )?;
        Ok(())
    }

    /// Persist the explicit execution trace alongside Bob's reply. The
    /// `tools_used` column already belongs to the public message contract and
    /// is preferable to keeping this information only in the transient Tauri
    /// event stream: the conversation can then render the same activity after
    /// a reload without exposing private model reasoning.
    pub fn set_message_tools_used(
        &self,
        db: &Database,
        message_id: &str,
        tools_used: &serde_json::Value,
    ) -> AppResult<()> {
        db.connection().execute(
            "UPDATE messages SET tools_used = ?1 WHERE id = ?2",
            params![tools_used.to_string(), message_id],
        )?;
        Ok(())
    }

    /// Delete a user message and every message after it, cancel in-flight work,
    /// and reset conversation context (branch rewind).
    pub fn rewind_conversation_from_message(
        &self,
        db: &Database,
        bob: &BobService,
        conversation_id: &str,
        message_id: &str,
    ) -> AppResult<RewindConversationResult> {
        let conn = db.conn.lock().unwrap();
        let (author, created_at): (String, String) = conn
            .query_row(
                "SELECT author, created_at FROM messages WHERE id = ?1 AND conversation_id = ?2",
                params![message_id, conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound("Message introuvable".into())
                }
                _ => AppError::Database(error.to_string()),
            })?;

        if author != "user" {
            return Err(AppError::ValidationFailed(
                "Seuls les messages utilisateur peuvent être modifiés.".into(),
            ));
        }

        let earlier_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1 AND created_at < ?2",
            params![conversation_id, created_at],
            |row| row.get(0),
        )?;
        drop(conn);

        let cancelled_tasks =
            TaskService::new().cancel_active_for_conversation(db, conversation_id, bob)?;
        TaskService::new().clear_resumable_for_conversation(db, conversation_id)?;

        let conn = db.conn.lock().unwrap();
        let deleted = conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1 AND created_at >= ?2",
            params![conversation_id, created_at],
        )?;
        let modified_at = Utc::now().to_rfc3339();

        let title_reset = earlier_count == 0;
        if title_reset {
            conn.execute(
                "UPDATE conversations SET title = 'Nouvelle conversation', bob_context_state = '{}', summary = NULL, plan_activities = '[]', date = ?1 WHERE id = ?2",
                params![modified_at, conversation_id],
            )?;
        } else {
            conn.execute(
                "UPDATE conversations SET bob_context_state = '{}', summary = NULL, plan_activities = '[]', date = ?1 WHERE id = ?2",
                params![modified_at, conversation_id],
            )?;
        }

        Ok(RewindConversationResult {
            deleted_messages: deleted,
            cancelled_tasks,
            title_reset,
        })
    }

    /// Backward-compatible helper used in tests.
    pub fn truncate_messages_from(
        &self,
        db: &Database,
        conversation_id: &str,
        message_id: &str,
    ) -> AppResult<usize> {
        let conn = db.conn.lock().unwrap();
        let (author, created_at): (String, String) = conn
            .query_row(
                "SELECT author, created_at FROM messages WHERE id = ?1 AND conversation_id = ?2",
                params![message_id, conversation_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|error| match error {
                rusqlite::Error::QueryReturnedNoRows => {
                    AppError::NotFound("Message introuvable".into())
                }
                _ => AppError::Database(error.to_string()),
            })?;

        if author != "user" {
            return Err(AppError::ValidationFailed(
                "Seuls les messages utilisateur peuvent être modifiés.".into(),
            ));
        }

        let deleted = conn.execute(
            "DELETE FROM messages WHERE conversation_id = ?1 AND created_at >= ?2",
            params![conversation_id, created_at],
        )?;
        conn.execute(
            "UPDATE conversations SET plan_activities = '[]', date = ?1 WHERE id = ?2",
            params![Utc::now().to_rfc3339(), conversation_id],
        )?;
        Ok(deleted)
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
            plan_activities: serde_json::from_str(
                &row.get::<_, String>(12)
                    .unwrap_or_else(|_| "[]".to_string()),
            )
            .unwrap_or(serde_json::Value::Array(vec![])),
        })
    }

    /// Retrieve short excerpts from other conversations in the same project.
    /// Standalone conversations are always isolated. Opt-in via settings
    /// (`cross_conversation_context`).
    pub fn related_context_snippets(
        &self,
        db: &Database,
        query: &str,
        current_conversation_id: &str,
        project_id: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<RelatedContextSnippet>> {
        let Some(project_id) = project_id else {
            // Standalone conversations never borrow messages from one another.
            return Ok(vec![]);
        };
        let terms: Vec<String> = query
            .split_whitespace()
            .map(|term| {
                term.chars()
                    .filter(|c| c.is_alphanumeric() || *c == '-' || *c == '_')
                    .collect::<String>()
            })
            .filter(|term| term.len() >= 2)
            .take(8)
            .map(|term| format!("\"{}\"*", term.replace('"', "")))
            .collect();
        if terms.is_empty() || limit == 0 {
            return Ok(vec![]);
        }
        let expression = terms.join(" OR ");
        let limit = limit.clamp(1, 8) as i64;
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT c.id, c.title,
                    snippet(search_index, 4, '', '', ' … ', 28),
                    bm25(search_index)
             FROM search_index
             JOIN conversations c ON c.id = search_index.entity_id
             WHERE search_index MATCH ?1
               AND search_index.entity_type = 'message'
               AND c.id != ?2
               AND COALESCE(c.archived, 0) = 0
               AND search_index.project_id = ?3
             ORDER BY bm25(search_index)
             LIMIT ?4",
        )?;
        let rows = stmt.query_map(
            params![expression, current_conversation_id, project_id, limit * 3],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2).unwrap_or_default(),
                    row.get::<_, f64>(3).unwrap_or(0.0),
                ))
            },
        )?;

        let mut seen = std::collections::HashSet::new();
        let mut snippets = Vec::new();
        for row in rows.filter_map(Result::ok) {
            let (conversation_id, title, excerpt, _score) = row;
            let excerpt = excerpt.split_whitespace().collect::<Vec<_>>().join(" ");
            if excerpt.trim().is_empty() {
                continue;
            }
            if !seen.insert(conversation_id.clone()) {
                continue;
            }
            snippets.push(RelatedContextSnippet {
                conversation_id,
                conversation_title: title,
                excerpt: excerpt.chars().take(280).collect(),
            });
            if snippets.len() >= limit as usize {
                break;
            }
        }
        Ok(snippets)
    }

    pub fn import_from_backup(
        &self,
        db: &Database,
        backup_path: &Path,
    ) -> AppResult<(usize, usize, usize)> {
        let backup = Database::open_readonly_backup(backup_path)?;
        let main = db.connection();
        main.execute("BEGIN IMMEDIATE", [])?;
        let import_result = self.import_from_backup_connection(&main, &backup);
        match import_result {
            Ok(summary) => {
                main.execute("COMMIT", [])?;
                Ok(summary)
            }
            Err(error) => {
                let _ = main.execute("ROLLBACK", []);
                Err(error)
            }
        }
    }

    fn import_from_backup_connection(
        &self,
        main: &rusqlite::Connection,
        backup: &rusqlite::Connection,
    ) -> AppResult<(usize, usize, usize)> {
        let existing_conversation_ids: HashSet<String> = main
            .prepare("SELECT id FROM conversations")?
            .query_map([], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();
        let existing_project_ids: HashSet<String> = main
            .prepare("SELECT id FROM projects")?
            .query_map([], |row| row.get(0))?
            .filter_map(Result::ok)
            .collect();

        let archived_column = table_has_column(backup, "conversations", "archived");
        let plan_column = table_has_column(backup, "conversations", "plan_activities");
        let file_changes_column = table_has_column(backup, "messages", "file_changes");

        let conversation_query = format!(
            "SELECT id, project_id, title, type, business_mode, bob_mode, date, pinned, local_only, summary, bob_context_state{}
             FROM conversations",
            if archived_column && plan_column {
                ", archived, plan_activities"
            } else if archived_column {
                ", archived, '[]' AS plan_activities"
            } else if plan_column {
                ", 0 AS archived, plan_activities"
            } else {
                ", 0 AS archived, '[]' AS plan_activities"
            }
        );

        let mut conversations_imported = 0usize;
        let mut messages_imported = 0usize;
        let mut skipped = 0usize;

        let mut conversation_stmt = backup.prepare(&conversation_query)?;
        let backup_conversations = conversation_stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, bool>(7).unwrap_or(false),
                    row.get::<_, bool>(8).unwrap_or(true),
                    row.get::<_, Option<String>>(9)?,
                    row.get::<_, String>(10).unwrap_or_else(|_| "{}".to_string()),
                    row.get::<_, bool>(11).unwrap_or(false),
                    row.get::<_, String>(12).unwrap_or_else(|_| "[]".to_string()),
                ))
            })?
            .filter_map(Result::ok)
            .collect::<Vec<_>>();

        for (
            id,
            project_id,
            title,
            conversation_type,
            business_mode,
            bob_mode,
            date,
            pinned,
            local_only,
            summary,
            bob_context_state,
            archived,
            plan_activities,
        ) in backup_conversations
        {
            if existing_conversation_ids.contains(&id) {
                skipped += 1;
                continue;
            }
            let has_user_message: bool = backup.query_row(
                "SELECT EXISTS(
                    SELECT 1 FROM messages
                    WHERE conversation_id = ?1 AND author = 'user'
                 )",
                params![id],
                |row| row.get(0),
            )?;
            if !has_user_message {
                skipped += 1;
                continue;
            }

            let project_id = project_id.filter(|value| existing_project_ids.contains(value));
            main.execute(
                "INSERT INTO conversations (
                    id, project_id, title, type, business_mode, bob_mode, date,
                    pinned, local_only, summary, bob_context_state, archived, plan_activities
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)",
                params![
                    id,
                    project_id,
                    title,
                    conversation_type,
                    business_mode,
                    bob_mode,
                    date,
                    pinned,
                    local_only,
                    summary,
                    bob_context_state,
                    archived,
                    plan_activities,
                ],
            )?;
            conversations_imported += 1;

            let message_query = if file_changes_column {
                "SELECT id, conversation_id, author, content, attachments, sources, citations,
                        tools_used, send_state, errors, associated_artifacts, associated_approvals,
                        file_changes, created_at
                 FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC"
            } else {
                "SELECT id, conversation_id, author, content, attachments, sources, citations,
                        tools_used, send_state, errors, associated_artifacts, associated_approvals,
                        '[]' AS file_changes, created_at
                 FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC"
            };
            let mut message_stmt = backup.prepare(message_query)?;
            let backup_messages = message_stmt
                .query_map(params![id], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                        row.get::<_, String>(4).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(5).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(6).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(7).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(8).unwrap_or_else(|_| "sent".to_string()),
                        row.get::<_, String>(9).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(10).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(11).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(12).unwrap_or_else(|_| "[]".to_string()),
                        row.get::<_, String>(13)?,
                    ))
                })?
                .filter_map(Result::ok)
                .collect::<Vec<_>>();

            for (
                message_id,
                conversation_id,
                author,
                content,
                attachments,
                sources,
                citations,
                tools_used,
                send_state,
                errors,
                associated_artifacts,
                associated_approvals,
                file_changes,
                created_at,
            ) in backup_messages
            {
                main.execute(
                    "INSERT INTO messages (
                        id, conversation_id, author, content, attachments, sources, citations,
                        tools_used, send_state, errors, associated_artifacts, associated_approvals,
                        file_changes, created_at
                     ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                    params![
                        message_id,
                        conversation_id,
                        author,
                        content,
                        attachments,
                        sources,
                        citations,
                        tools_used,
                        send_state,
                        errors,
                        associated_artifacts,
                        associated_approvals,
                        file_changes,
                        created_at,
                    ],
                )?;
                messages_imported += 1;
            }
        }

        Ok((conversations_imported, messages_imported, skipped))
    }
}

fn table_has_column(connection: &rusqlite::Connection, table: &str, column: &str) -> bool {
    connection
        .prepare(&format!("SELECT COUNT(*) FROM pragma_table_info('{table}') WHERE name = ?1"))
        .and_then(|mut statement| {
            statement.query_row(params![column], |row| row.get::<_, i64>(0))
        })
        .map(|count| count > 0)
        .unwrap_or(false)
}

fn is_plan_tool(name: &str) -> bool {
    let normalized = name.to_ascii_lowercase();
    [
        "update_todo_list",
        "todo_write",
        "update_plan",
        "write_plan",
        "set_plan",
    ]
    .iter()
    .any(|tool| normalized.ends_with(tool))
}

fn payload_contains_plan_steps(value: &serde_json::Value, depth: usize) -> bool {
    if depth > 6 {
        return false;
    }
    let Some(object) = value.as_object() else {
        return false;
    };
    for key in ["todos", "steps", "items", "tasks"] {
        match object.get(key) {
            Some(serde_json::Value::Array(items)) if items.len() >= 2 => return true,
            Some(serde_json::Value::String(items))
                if items.lines().filter(|line| !line.trim().is_empty()).count() >= 2 =>
            {
                return true;
            }
            _ => {}
        }
    }
    object
        .values()
        .any(|nested| payload_contains_plan_steps(nested, depth + 1))
}


#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RelatedContextSnippet {
    pub conversation_id: String,
    pub conversation_title: String,
    pub excerpt: String,
}

impl RelatedContextSnippet {
    pub fn format_block(snippets: &[Self]) -> Option<String> {
        if snippets.is_empty() {
            return None;
        }
        let body = snippets
            .iter()
            .map(|snippet| {
                format!(
                    "- « {} » : {}",
                    snippet.conversation_title.trim(),
                    snippet.excerpt.trim()
                )
            })
            .collect::<Vec<_>>()
            .join("\n");
        Some(format!(
            "Contexte lié (autres conversations, extrait local — à utiliser seulement s’il aide vraiment) :\n{body}"
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::conversation::{AddMessageInput, CreateConversationInput};
    use crate::models::project::CreateProjectInput;
    use crate::services::project::ProjectService;

    #[test]
    fn format_block_is_none_when_empty() {
        assert!(RelatedContextSnippet::format_block(&[]).is_none());
    }

    #[test]
    fn conversation_mode_is_owned_by_each_conversation_and_survives_reopen() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let path = temporary.path().join("conversation-mode.sqlite");
        let first_id;
        let second_id;
        {
            let db = Database::new(&path).expect("db");
            db.run_migrations().expect("migrations");
            let service = ConversationService::new();
            let first = service
                .create(
                    &db,
                    CreateConversationInput {
                        project_id: None,
                        title: "Présentation IBM".into(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("first conversation");
            let second = service
                .create(
                    &db,
                    CreateConversationInput {
                        project_id: None,
                        title: "Agent".into(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("second conversation");
            first_id = first.id;
            second_id = second.id;
            service
                .set_mode(&db, &first_id, "ibm-ppt-designer")
                .expect("persist mode");
        }

        let reopened = Database::new(&path).expect("reopen db");
        reopened.run_migrations().expect("reopen migrations");
        let service = ConversationService::new();
        assert_eq!(
            service
                .get_by_id(&reopened, &first_id)
                .unwrap()
                .unwrap()
                .bob_mode
                .as_deref(),
            Some("ibm-ppt-designer")
        );
        assert_eq!(
            service
                .get_by_id(&reopened, &second_id)
                .unwrap()
                .unwrap()
                .bob_mode
                .as_deref(),
            Some("agent")
        );
    }

    #[test]
    fn standalone_conversation_never_receives_sibling_context() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        let snippets = ConversationService::new()
            .related_context_snippets(&db, "même recherche", "current", None, 4)
            .expect("context lookup");
        assert!(snippets.is_empty());
    }

    #[test]
    fn archived_conversations_have_a_dedicated_restorable_listing() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        let service = ConversationService::new();
        let conversation = service
            .create(
                &db,
                CreateConversationInput {
                    project_id: None,
                    title: "Conversation archivée".into(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("conversation");
        service
            .add_message(
                &db,
                AddMessageInput {
                    conversation_id: conversation.id.clone(),
                    author: "user".into(),
                    content: "À conserver".into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("message");

        service
            .set_archived(&db, &conversation.id, true)
            .expect("archive");
        assert!(service.get_all(&db, None).unwrap().is_empty());
        assert_eq!(
            service.get_archived(&db, None).unwrap()[0].id,
            conversation.id
        );

        service
            .set_archived(&db, &conversation.id, false)
            .expect("restore");
        assert!(service.get_archived(&db, None).unwrap().is_empty());
        assert_eq!(service.get_all(&db, None).unwrap()[0].id, conversation.id);
    }

    #[test]
    fn explicit_activity_is_persisted_with_the_assistant_message() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        let service = ConversationService::new();
        let conversation = service
            .create(
                &db,
                CreateConversationInput {
                    project_id: None,
                    title: "Activité persistante".into(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("conversation");
        let message = service
            .add_message(
                &db,
                AddMessageInput {
                    conversation_id: conversation.id.clone(),
                    author: "assistant".into(),
                    content: "Réponse terminée".into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("message");
        let activity = serde_json::json!([{
            "eventType": "tool_finished",
            "title": "Fichier lu : rapport.md",
            "toolName": "read_file",
            "payload": { "path": "rapport.md" },
            "createdAt": "2026-09-05T10:02:00Z"
        }]);

        service
            .set_message_tools_used(&db, &message.id, &activity)
            .expect("persist activity");

        let messages = service
            .get_messages(&db, &conversation.id)
            .expect("messages");
        assert_eq!(messages[0].tools_used, activity);
    }

    #[test]
    fn conversation_plan_is_replaced_updated_and_survives_database_reopen() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let database_path = temporary.path().join("conversation-plan.sqlite");
        let conversation_id;
        {
            let db = Database::new(&database_path).expect("db");
            db.run_migrations().expect("migrations");
            let service = ConversationService::new();
            let conversation = service
                .create(
                    &db,
                    CreateConversationInput {
                        project_id: None,
                        title: "Plan persistant".into(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("conversation");
            conversation_id = conversation.id;
            service
                .save_plan_activity(
                    &db,
                    &conversation_id,
                    "tool_started",
                    Some("Updating plan"),
                    None,
                    Some("update_todo_list"),
                    &serde_json::json!({ "parameters": { "todos": [
                        { "content": "Analyser", "status": "completed" },
                        { "content": "Implémenter", "status": "in_progress" }
                    ] } }),
                )
                .expect("initial plan");
            service
                .save_plan_activity(
                    &db,
                    &conversation_id,
                    "tool_finished",
                    None,
                    Some("To do list updated: 2 items total. Next to do item inprogress: Implémenter"),
                    None,
                    &serde_json::json!({}),
                )
                .expect("progress update");
            service
                .save_plan_activity(
                    &db,
                    &conversation_id,
                    "session_completed",
                    Some("Tâche terminée"),
                    None,
                    None,
                    &serde_json::json!({ "status": "success" }),
                )
                .expect("terminal update");
            assert_eq!(
                service
                    .get_by_id(&db, &conversation_id)
                    .expect("read plan")
                    .expect("conversation")
                    .plan_activities
                    .as_array()
                    .map(Vec::len),
                Some(3),
            );
        }

        let reopened = Database::new(&database_path).expect("reopened db");
        reopened.run_migrations().expect("reopened migrations");
        let restored = ConversationService::new()
            .get_by_id(&reopened, &conversation_id)
            .expect("restore plan")
            .expect("conversation");
        assert_eq!(restored.plan_activities.as_array().map(Vec::len), Some(3));
        assert_eq!(
            restored
                .plan_activities
                .pointer("/0/toolName")
                .and_then(serde_json::Value::as_str),
            Some("update_todo_list"),
        );

        ConversationService::new()
            .save_plan_activity(
                &reopened,
                &conversation_id,
                "tool_started",
                None,
                None,
                Some("update_plan"),
                &serde_json::json!({ "steps": ["Nouvelle étape 1", "Nouvelle étape 2"] }),
            )
            .expect("replace plan");
        let replaced = ConversationService::new()
            .get_by_id(&reopened, &conversation_id)
            .expect("read replaced plan")
            .expect("conversation");
        assert_eq!(replaced.plan_activities.as_array().map(Vec::len), Some(1));
    }

    #[test]
    fn current_context_summary_is_bounded_and_replaces_previous_value() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        let service = ConversationService::new();
        let conversation = service
            .create(
                &db,
                CreateConversationInput {
                    project_id: None,
                    title: "Longue conversation".into(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("conversation");
        let first = service
            .add_message(
                &db,
                AddMessageInput {
                    conversation_id: conversation.id.clone(),
                    author: "user".into(),
                    content: "Décision initiale".into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("message");
        service
            .save_context_summary(
                &db,
                &conversation.id,
                &"a".repeat(7_000),
                std::slice::from_ref(&first),
                0,
            )
            .expect("first summary");
        let first_state = service.context_state(&db, &conversation.id).expect("state");
        assert_eq!(first_state.summary.chars().count(), 6_000);
        assert_eq!(first_state.version, 1);

        service
            .save_context_summary(
                &db,
                &conversation.id,
                "Résumé remplacé",
                std::slice::from_ref(&first),
                first_state.version,
            )
            .expect("replacement");
        let state = service.context_state(&db, &conversation.id).expect("state");
        assert_eq!(state.summary, "Résumé remplacé");
        assert_eq!(state.version, 2);
        let stored: String = db
            .connection()
            .query_row(
                "SELECT summary FROM conversations WHERE id=?1",
                params![conversation.id],
                |row| row.get(0),
            )
            .expect("stored summary");
        assert_eq!(stored, "Résumé remplacé");
    }

    #[test]
    fn related_context_excludes_current_conversation_and_prefers_project() {
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        let projects = ProjectService::new();
        let conversations = ConversationService::new();
        let project = projects
            .create(
                &db,
                CreateProjectInput {
                    name: "Alpha".into(),
                    description: None,
                    objective: None,
                    color: None,
                    local_path: None,
                    custom_instructions: None,
                    language: None,
                    default_mode: None,
                    template: None,
                },
            )
            .expect("project");

        let current = conversations
            .create(
                &db,
                CreateConversationInput {
                    project_id: Some(project.id.clone()),
                    title: "Chat courant".into(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("current");
        let sibling = conversations
            .create(
                &db,
                CreateConversationInput {
                    project_id: Some(project.id.clone()),
                    title: "Brief CTO précédent".into(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("sibling");
        let other_project_chat = conversations
            .create(
                &db,
                CreateConversationInput {
                    project_id: None,
                    title: "Hors projet".into(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("other");

        conversations
            .add_message(
                &db,
                AddMessageInput {
                    conversation_id: current.id.clone(),
                    author: "user".into(),
                    content: "Parle-moi du screening CTO actions françaises".into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("current msg");
        conversations
            .add_message(
                &db,
                AddMessageInput {
                    conversation_id: sibling.id.clone(),
                    author: "assistant".into(),
                    content:
                        "Le screening CTO avait retenu AIR.PA et BN.PA pour un brief informatif."
                            .into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("sibling msg");
        conversations
            .add_message(
                &db,
                AddMessageInput {
                    conversation_id: other_project_chat.id.clone(),
                    author: "assistant".into(),
                    content: "Le screening CTO hors projet ne doit pas polluer.".into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("other msg");

        let snippets = conversations
            .related_context_snippets(
                &db,
                "screening CTO actions",
                &current.id,
                Some(&project.id),
                4,
            )
            .expect("search");
        assert!(!snippets.is_empty());
        assert!(snippets.iter().all(|s| s.conversation_id != current.id));
        assert!(snippets.iter().any(|s| s.conversation_id == sibling.id));
        assert!(snippets
            .iter()
            .all(|s| s.conversation_id != other_project_chat.id));
        let block = RelatedContextSnippet::format_block(&snippets).expect("block");
        assert!(block.contains("Contexte lié"));
        assert!(block.contains("Brief CTO"));
    }

    #[test]
    fn import_from_backup_merges_missing_conversations() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let backup_path = temporary.path().join("bob-work-automatic-20260910T172120Z.sqlite");
        let backup_db = Database::new(&backup_path).expect("backup database");
        backup_db.run_migrations().expect("backup migrations");
        let conversations = ConversationService::new();
        let imported = conversations
            .create(
                &backup_db,
                CreateConversationInput {
                    project_id: None,
                    title: "Conversation sauvegardée".into(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("backup conversation");
        conversations
            .add_message(
                &backup_db,
                AddMessageInput {
                    conversation_id: imported.id.clone(),
                    author: "user".into(),
                    content: "Bonjour depuis la sauvegarde".into(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("backup message");
        drop(backup_db);

        let live_path = temporary.path().join("live.sqlite");
        let live_db = Database::new(&live_path).expect("live database");
        live_db.run_migrations().expect("live migrations");
        let (conversations_imported, messages_imported, skipped) = conversations
            .import_from_backup(&live_db, &backup_path)
            .expect("import backup");
        assert_eq!(conversations_imported, 1);
        assert_eq!(messages_imported, 1);
        assert_eq!(skipped, 0);

        let restored = conversations
            .get_by_id(&live_db, &imported.id)
            .expect("read imported conversation")
            .expect("imported conversation");
        assert_eq!(restored.title, "Conversation sauvegardée");
        let messages = conversations
            .get_messages(&live_db, &imported.id)
            .expect("imported messages");
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0].content, "Bonjour depuis la sauvegarde");

        let (_, _, skipped_again) = conversations
            .import_from_backup(&live_db, &backup_path)
            .expect("re-import backup");
        assert_eq!(skipped_again, 1);
    }

    #[test]
    fn smoke_import_from_local_backup_file_if_present() {
        let Some(home) = dirs::home_dir() else {
            return;
        };
        let backup_dir = home.join("Library/Application Support/com.bobwork.desktop/backups");
        let Some(backup_path) = std::fs::read_dir(&backup_dir)
            .ok()
            .and_then(|entries| {
                entries
                    .filter_map(Result::ok)
                    .map(|entry| entry.path())
                    .find(|path| {
                        path.extension().and_then(|value| value.to_str()) == Some("sqlite")
                    })
            })
        else {
            return;
        };

        let temporary = tempfile::tempdir().expect("temporary directory");
        let live_path = temporary.path().join("live.sqlite");
        let live_db = Database::new(&live_path).expect("live database");
        live_db.run_migrations().expect("live migrations");

        let (conversations, messages, skipped) = ConversationService::new()
            .import_from_backup(&live_db, &backup_path)
            .unwrap_or_else(|error| {
                panic!(
                    "import_from_backup failed for {}: {error}",
                    backup_path.display()
                )
            });

        assert!(conversations > 0, "expected conversations to import");
        assert!(messages > 0, "expected messages to import");
        assert_eq!(skipped, 0, "fresh database should not skip rows");

        let (_, _, skipped_again) = ConversationService::new()
            .import_from_backup(&live_db, &backup_path)
            .expect("re-import backup");
        assert_eq!(
            skipped_again, conversations,
            "second import should skip already-present conversations"
        );
    }
}
