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
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RewindConversationResult {
    pub deleted_messages: usize,
    pub cancelled_tasks: usize,
    pub title_reset: bool,
}

pub struct ConversationService;

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
             c.date, c.pinned, c.local_only, c.summary, c.bob_context_state, c.archived
             FROM conversations c
             WHERE c.archived = 0
               AND EXISTS (
                 SELECT 1 FROM messages m
                 WHERE m.conversation_id = c.id AND m.author = 'user'
               )
             ORDER BY c.pinned DESC, c.date DESC
             LIMIT 50",
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

    pub fn set_project_id(
        &self,
        db: &Database,
        id: &str,
        project_id: Option<&str>,
    ) -> AppResult<()> {
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

    /// Delete a user message and every message after it, cancel in-flight work,
    /// and reset conversation context (ChatGPT-style branch rewind).
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

        let title_reset = earlier_count == 0;
        if title_reset {
            conn.execute(
                "UPDATE conversations SET title = 'Nouvelle conversation', bob_context_state = '{}', summary = NULL WHERE id = ?1",
                params![conversation_id],
            )?;
        } else {
            conn.execute(
                "UPDATE conversations SET bob_context_state = '{}', summary = NULL WHERE id = ?1",
                params![conversation_id],
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
        })
    }

    /// Retrieve short excerpts from *other* conversations that may help Bob answer.
    /// Prefer same-project messages when `project_id` is set; never includes the
    /// current conversation. Opt-in via settings (`cross_conversation_context`).
    pub fn related_context_snippets(
        &self,
        db: &Database,
        query: &str,
        current_conversation_id: &str,
        project_id: Option<&str>,
        limit: usize,
    ) -> AppResult<Vec<RelatedContextSnippet>> {
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
               AND (?3 IS NULL OR search_index.project_id = ?3 OR (search_index.project_id IS NULL AND ?3 IS NULL))
             ORDER BY bm25(search_index)
             LIMIT ?4",
        )?;
        // When scoped to a project, require matching project_id.
        // When not in a project, allow any conversation (personal + project).
        let project_filter: Option<&str> = project_id;
        let rows = stmt.query_map(
            params![
                expression,
                current_conversation_id,
                project_filter,
                limit * 3
            ],
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
}
