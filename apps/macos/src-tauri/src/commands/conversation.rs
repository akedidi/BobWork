// ============================================================
// Bob Work - Conversation Commands
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::models::conversation::{
    AddMessageInput, Conversation, CreateConversationInput, Message,
};
use crate::services::bob::BobService;
use crate::services::conversation::ConversationService;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_conversations(
    project_id: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<Conversation>, AppError> {
    let service = ConversationService::new();
    let _ = service.purge_promptless(&db);
    service.get_all(&db, project_id.as_deref())
}

#[tauri::command]
pub async fn get_conversation(
    id: String,
    db: State<'_, Database>,
) -> Result<Option<Conversation>, AppError> {
    ConversationService::new().get_by_id(&db, &id)
}

#[tauri::command]
pub async fn create_conversation(
    input: CreateConversationInput,
    db: State<'_, Database>,
) -> Result<Conversation, AppError> {
    // Do not emit conversation-updated yet — drafts without a user prompt
    // must stay out of the sidebar until the first message is persisted.
    ConversationService::new().create(&db, input)
}

#[tauri::command]
pub async fn update_conversation(
    id: String,
    title: Option<String>,
    pinned: Option<bool>,
    archived: Option<bool>,
    project_id: Option<String>,
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    let service = ConversationService::new();
    if let Some(t) = title {
        service.update_title(&db, &id, &t)?;
    }
    if let Some(value) = pinned {
        service.set_pinned(&db, &id, value)?;
    }
    if let Some(value) = archived {
        service.set_archived(&db, &id, value)?;
    }
    if let Some(value) = project_id {
        let pid = if value.is_empty() {
            None
        } else {
            Some(value.as_str())
        };
        service.set_project_id(&db, &id, pid)?;
    }
    let _ = app_handle.emit("conversation-updated", &id);
    Ok(())
}

#[tauri::command]
pub async fn delete_conversation(
    id: String,
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    ConversationService::new().delete(&db, &id)?;
    let _ = app_handle.emit("conversation-updated", &id);
    Ok(())
}

#[tauri::command]
pub async fn get_messages(
    conversation_id: String,
    db: State<'_, Database>,
) -> Result<Vec<Message>, AppError> {
    ConversationService::new().get_messages(&db, &conversation_id)
}

#[tauri::command]
pub async fn add_message(
    input: AddMessageInput,
    db: State<'_, Database>,
) -> Result<Message, AppError> {
    ConversationService::new().add_message(&db, input)
}

#[tauri::command]
pub async fn truncate_messages_from(
    conversation_id: String,
    message_id: String,
    db: State<'_, Database>,
) -> Result<usize, AppError> {
    ConversationService::new().truncate_messages_from(&db, &conversation_id, &message_id)
}

#[tauri::command]
pub async fn rewind_conversation_from_message(
    conversation_id: String,
    message_id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
    app_handle: tauri::AppHandle,
) -> Result<crate::services::conversation::RewindConversationResult, AppError> {
    use tauri::Emitter;
    let result = ConversationService::new().rewind_conversation_from_message(
        &db,
        &bob_service,
        &conversation_id,
        &message_id,
    )?;
    let _ = app_handle.emit("conversation-messages-changed", &conversation_id);
    if result.title_reset {
        let _ = app_handle.emit("conversation-updated", &conversation_id);
    }
    Ok(result)
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConversationTransferSummary {
    pub conversations: usize,
    pub messages: usize,
    pub skipped: usize,
    pub detected_format: String,
}

#[tauri::command]
pub async fn export_conversations(
    path: String,
    format: Option<String>,
    db: State<'_, Database>,
) -> Result<ConversationTransferSummary, AppError> {
    let export_format = format.unwrap_or_else(|| "bob-work-export-v1".into());
    let service = ConversationService::new();
    let conversations = service.get_all(&db, None)?;
    let mut message_count = 0usize;
    let mut records = Vec::with_capacity(conversations.len());

    for conversation in &conversations {
        let messages = service.get_messages(&db, &conversation.id)?;
        message_count += messages.len();
        records.push((conversation.clone(), messages));
    }

    let (document, detected_format) = match export_format.as_str() {
        "chatgpt" => (build_chatgpt_export(&records), "chatgpt"),
        "claude-cowork" => (build_claude_export(&records), "claude-cowork"),
        "bob-work-export-v1" => (build_bob_work_export(&records), "bob-work-export-v1"),
        other => {
            return Err(AppError::ValidationFailed(format!(
                "Format d’export inconnu : {other}. Utilisez chatgpt, claude-cowork ou bob-work-export-v1."
            )));
        }
    };

    let data = serde_json::to_vec_pretty(&document)?;
    std::fs::write(path, data)?;
    Ok(ConversationTransferSummary {
        conversations: conversations.len(),
        messages: message_count,
        skipped: 0,
        detected_format: detected_format.into(),
    })
}

fn build_bob_work_export(records: &[(Conversation, Vec<Message>)]) -> Value {
    let exported = records
        .iter()
        .map(|(conversation, messages)| {
            serde_json::json!({ "conversation": conversation, "messages": messages })
        })
        .collect::<Vec<_>>();
    serde_json::json!({
        "format": "bob-work-export-v1",
        "exportedAt": chrono::Utc::now().to_rfc3339(),
        "conversations": exported,
    })
}

fn build_chatgpt_export(records: &[(Conversation, Vec<Message>)]) -> Value {
    Value::Array(
        records
            .iter()
            .map(|(conversation, messages)| export_chatgpt_conversation(conversation, messages))
            .collect(),
    )
}

fn build_claude_export(records: &[(Conversation, Vec<Message>)]) -> Value {
    serde_json::json!({
        "conversations": records
            .iter()
            .map(|(conversation, messages)| export_claude_conversation(conversation, messages))
            .collect::<Vec<_>>(),
    })
}

fn export_chatgpt_conversation(conversation: &Conversation, messages: &[Message]) -> Value {
    let mut mapping = serde_json::Map::new();
    let mut previous_id: Option<String> = None;
    let mut first_time = None::<f64>;
    let mut last_time = None::<f64>;
    let mut current_node = None::<String>;

    for (index, message) in messages.iter().enumerate() {
        if message.author == "system" {
            continue;
        }
        let create_time = message_timestamp(message, index);
        first_time.get_or_insert(create_time);
        last_time = Some(create_time);
        current_node = Some(message.id.clone());

        let role = export_chatgpt_role(&message.author);
        let node = serde_json::json!({
            "id": message.id,
            "message": {
                "id": message.id,
                "author": { "role": role, "metadata": {} },
                "create_time": create_time,
                "update_time": null,
                "content": {
                    "content_type": "text",
                    "parts": [message.content]
                },
                "status": "finished_successfully",
                "end_turn": true,
                "weight": 1.0,
                "metadata": {},
                "recipient": "all"
            },
            "parent": previous_id,
            "children": []
        });
        mapping.insert(message.id.clone(), node);
        if let Some(parent_id) = previous_id.as_ref() {
            if let Some(parent) = mapping.get_mut(parent_id) {
                if let Some(children) = parent.get_mut("children").and_then(Value::as_array_mut) {
                    children.push(Value::String(message.id.clone()));
                }
            }
        }
        previous_id = Some(message.id.clone());
    }

    serde_json::json!({
        "title": conversation.title,
        "create_time": first_time,
        "update_time": last_time,
        "mapping": mapping,
        "moderation_results": [],
        "current_node": current_node,
        "conversation_id": conversation.id,
        "is_archived": conversation.archived,
    })
}

fn export_claude_conversation(conversation: &Conversation, messages: &[Message]) -> Value {
    let chat_messages = messages
        .iter()
        .enumerate()
        .filter(|(_, message)| message.author != "system")
        .map(|(index, message)| {
            let mut payload = serde_json::json!({
                "uuid": message.id,
                "text": message.content,
                "sender": export_claude_sender(&message.author),
                "created_at": message.created_at,
                "updated_at": message.created_at,
            });
            if let Some(attachments) = export_claude_attachments(&message.attachments) {
                payload["attachments"] = attachments;
            }
            let _ = index;
            payload
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "uuid": conversation.id,
        "name": conversation.title,
        "created_at": conversation.date,
        "updated_at": conversation.date,
        "chat_messages": chat_messages,
    })
}

fn export_chatgpt_role(author: &str) -> &str {
    match author {
        "user" => "user",
        "system" => "system",
        _ => "assistant",
    }
}

fn export_claude_sender(author: &str) -> &str {
    match author {
        "user" => "human",
        "system" => "system",
        _ => "assistant",
    }
}

fn export_claude_attachments(attachments: &Value) -> Option<Value> {
    let items = attachments.as_array()?;
    if items.is_empty() {
        return None;
    }
    let exported = items
        .iter()
        .filter_map(|item| {
            if let Some(path) = item.as_str() {
                let file_name = std::path::Path::new(path)
                    .file_name()
                    .and_then(|value| value.to_str())
                    .unwrap_or(path);
                return Some(serde_json::json!({ "file_name": file_name, "file_path": path }));
            }
            if item.get("file_name").is_some() {
                return Some(item.clone());
            }
            None
        })
        .collect::<Vec<_>>();
    if exported.is_empty() {
        None
    } else {
        Some(Value::Array(exported))
    }
}

fn message_timestamp(message: &Message, index: usize) -> f64 {
    chrono::DateTime::parse_from_rfc3339(&message.created_at)
        .map(|value| value.timestamp() as f64)
        .unwrap_or(index as f64)
}

#[tauri::command]
pub async fn import_conversations(
    path: String,
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<ConversationTransferSummary, AppError> {
    let metadata = std::fs::metadata(&path)?;
    if metadata.len() > 250 * 1024 * 1024 {
        return Err(AppError::ValidationFailed(
            "Le fichier d’import dépasse 250 Mo.".into(),
        ));
    }
    let root: Value = serde_json::from_slice(&std::fs::read(path)?)?;
    let (format, records) = normalized_conversations(&root)?;
    let service = ConversationService::new();
    let mut conversations = 0usize;
    let mut messages = 0usize;
    let mut skipped = 0usize;
    for record in records {
        if record.messages.is_empty() {
            skipped += 1;
            continue;
        }
        let conversation = service.create(
            &db,
            CreateConversationInput {
                project_id: None,
                title: record.title,
                conversation_type: Some("chat".into()),
                business_mode: Some("imported".into()),
                bob_mode: None,
            },
        )?;
        conversations += 1;
        for message in record.messages {
            if message.content.trim().is_empty() {
                skipped += 1;
                continue;
            }
            service.add_message(
                &db,
                AddMessageInput {
                    conversation_id: conversation.id.clone(),
                    author: message.author,
                    content: message.content,
                    attachments: message.attachments,
                    sources: None,
                },
            )?;
            messages += 1;
        }
    }
    let summary = ConversationTransferSummary {
        conversations,
        messages,
        skipped,
        detected_format: format,
    };
    let _ = app_handle.emit("conversation-updated", "import");
    Ok(summary)
}

struct ImportedConversation {
    title: String,
    messages: Vec<ImportedMessage>,
}
struct ImportedMessage {
    author: String,
    content: String,
    attachments: Option<Value>,
}

fn normalized_conversations(root: &Value) -> Result<(String, Vec<ImportedConversation>), AppError> {
    if root.get("format").and_then(Value::as_str) == Some("bob-work-export-v1") {
        let items = root
            .get("conversations")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        return Ok((
            "bob-work-export-v1".into(),
            items.into_iter().filter_map(parse_bob_work).collect(),
        ));
    }
    let items = root.as_array().cloned().or_else(|| root.get("conversations").and_then(Value::as_array).cloned())
        .or_else(|| root.get("chats").and_then(Value::as_array).cloned())
        .ok_or_else(|| AppError::ValidationFailed("Format JSON non reconnu. Sélectionnez un export conversations.json de ChatGPT, Claude/Cowork ou Bob Work.".into()))?;
    let is_chatgpt = items.iter().any(|item| item.get("mapping").is_some());
    let is_claude = items.iter().any(|item| item.get("chat_messages").is_some());
    let format = if is_chatgpt {
        "chatgpt"
    } else if is_claude {
        "claude-cowork"
    } else {
        "generic"
    };
    let records = items
        .into_iter()
        .filter_map(|item| {
            if item.get("mapping").is_some() {
                parse_chatgpt(item)
            } else if item.get("chat_messages").is_some() {
                parse_claude(item)
            } else {
                parse_generic(item)
            }
        })
        .collect();
    Ok((format.into(), records))
}

fn parse_bob_work(item: Value) -> Option<ImportedConversation> {
    let conversation = item.get("conversation")?;
    let title = conversation
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Conversation importée")
        .to_string();
    let messages = item
        .get("messages")
        .and_then(Value::as_array)?
        .iter()
        .filter_map(|message| {
            Some(ImportedMessage {
                author: normalize_author(
                    message
                        .get("author")
                        .and_then(Value::as_str)
                        .unwrap_or("assistant"),
                ),
                content: value_to_text(message.get("content")?),
                attachments: message.get("attachments").cloned(),
            })
        })
        .collect();
    Some(ImportedConversation { title, messages })
}

fn parse_chatgpt(item: Value) -> Option<ImportedConversation> {
    let title = item
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Conversation ChatGPT")
        .to_string();
    let mapping = item.get("mapping")?.as_object()?;
    let mut messages: Vec<(f64, ImportedMessage)> = mapping
        .values()
        .filter_map(|node| {
            let message = node.get("message")?;
            let author = normalize_author(
                message
                    .pointer("/author/role")
                    .and_then(Value::as_str)
                    .unwrap_or("assistant"),
            );
            if author == "system" {
                return None;
            }
            let content = message
                .pointer("/content/parts")
                .and_then(Value::as_array)
                .map(|parts| {
                    parts
                        .iter()
                        .map(value_to_text)
                        .filter(|v| !v.is_empty())
                        .collect::<Vec<_>>()
                        .join("\n")
                })
                .or_else(|| message.pointer("/content/text").map(value_to_text))
                .unwrap_or_default();
            let time = message
                .get("create_time")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            Some((
                time,
                ImportedMessage {
                    author,
                    content,
                    attachments: None,
                },
            ))
        })
        .collect();
    messages.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
    Some(ImportedConversation {
        title,
        messages: messages.into_iter().map(|(_, message)| message).collect(),
    })
}

fn parse_claude(item: Value) -> Option<ImportedConversation> {
    let title = item
        .get("name")
        .or_else(|| item.get("title"))
        .and_then(Value::as_str)
        .unwrap_or("Conversation Claude")
        .to_string();
    let messages = item
        .get("chat_messages")?
        .as_array()?
        .iter()
        .filter_map(|message| {
            let content = message
                .get("text")
                .or_else(|| message.get("content"))
                .map(value_to_text)?;
            Some(ImportedMessage {
                author: normalize_author(
                    message
                        .get("sender")
                        .or_else(|| message.get("role"))
                        .and_then(Value::as_str)
                        .unwrap_or("assistant"),
                ),
                content,
                attachments: message
                    .get("attachments")
                    .or_else(|| message.get("files"))
                    .cloned(),
            })
        })
        .collect();
    Some(ImportedConversation { title, messages })
}

fn parse_generic(item: Value) -> Option<ImportedConversation> {
    let title = item
        .get("title")
        .or_else(|| item.get("name"))
        .and_then(Value::as_str)
        .unwrap_or("Conversation importée")
        .to_string();
    let messages = item
        .get("messages")?
        .as_array()?
        .iter()
        .filter_map(|message| {
            let content = message
                .get("content")
                .or_else(|| message.get("text"))
                .map(value_to_text)?;
            Some(ImportedMessage {
                author: normalize_author(
                    message
                        .get("role")
                        .or_else(|| message.get("author"))
                        .or_else(|| message.get("sender"))
                        .and_then(Value::as_str)
                        .unwrap_or("assistant"),
                ),
                content,
                attachments: message.get("attachments").cloned(),
            })
        })
        .collect();
    Some(ImportedConversation { title, messages })
}

fn normalize_author(value: &str) -> String {
    match value.to_lowercase().as_str() {
        "user" | "human" => "user".into(),
        "system" => "system".into(),
        _ => "assistant".into(),
    }
}

fn value_to_text(value: &Value) -> String {
    match value {
        Value::String(text) => text.clone(),
        Value::Array(items) => items
            .iter()
            .map(value_to_text)
            .filter(|v| !v.is_empty())
            .collect::<Vec<_>>()
            .join("\n"),
        Value::Object(map) => map
            .get("text")
            .or_else(|| map.get("content"))
            .map(value_to_text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

#[cfg(test)]
mod import_tests {
    use super::{build_chatgpt_export, build_claude_export, normalized_conversations};
    use crate::models::conversation::{Conversation, Message};

    #[test]
    fn normalizes_chatgpt_export_in_chronological_order() {
        let input = serde_json::json!([{
            "title": "Conversation ChatGPT test",
            "mapping": {
                "assistant": { "message": { "author": { "role": "assistant" }, "create_time": 2.0, "content": { "parts": ["Réponse"] } } },
                "user": { "message": { "author": { "role": "user" }, "create_time": 1.0, "content": { "parts": ["Question"] } } },
                "system": { "message": { "author": { "role": "system" }, "create_time": 0.0, "content": { "parts": ["Interne"] } } }
            }
        }]);

        let (format, conversations) = normalized_conversations(&input).unwrap();
        assert_eq!(format, "chatgpt");
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].title, "Conversation ChatGPT test");
        assert_eq!(conversations[0].messages.len(), 2);
        assert_eq!(conversations[0].messages[0].author, "user");
        assert_eq!(conversations[0].messages[0].content, "Question");
        assert_eq!(conversations[0].messages[1].content, "Réponse");
    }

    #[test]
    fn normalizes_claude_cowork_export_and_keeps_attachments() {
        let input = serde_json::json!({ "conversations": [{
            "name": "Conversation Claude test",
            "chat_messages": [
                { "sender": "human", "text": "Analyse ce fichier", "attachments": [{ "file_name": "rapport.pdf" }] },
                { "sender": "assistant", "text": "Analyse terminée" }
            ]
        }] });

        let (format, conversations) = normalized_conversations(&input).unwrap();
        assert_eq!(format, "claude-cowork");
        assert_eq!(conversations.len(), 1);
        assert_eq!(conversations[0].messages[0].author, "user");
        assert_eq!(
            conversations[0].messages[0]
                .attachments
                .as_ref()
                .and_then(|value| value.pointer("/0/file_name"))
                .and_then(serde_json::Value::as_str),
            Some("rapport.pdf")
        );
    }

    #[test]
    fn rejects_an_unknown_import_document() {
        let error = normalized_conversations(&serde_json::json!({ "unexpected": true }))
            .err()
            .expect("un format inconnu doit être refusé");
        assert!(error.to_string().contains("Format JSON non reconnu"));
    }

    #[test]
    fn exports_and_reimports_chatgpt_format() {
        let conversation = Conversation {
            id: "conv-1".into(),
            project_id: None,
            title: "Export ChatGPT".into(),
            conversation_type: "chat".into(),
            business_mode: None,
            bob_mode: None,
            date: "2026-08-09T10:00:00Z".into(),
            pinned: false,
            local_only: true,
            summary: None,
            bob_context_state: serde_json::json!({}),
            archived: false,
        };
        let messages = vec![
            Message {
                id: "msg-1".into(),
                conversation_id: "conv-1".into(),
                author: "user".into(),
                content: "Question".into(),
                attachments: serde_json::json!([]),
                sources: serde_json::json!([]),
                citations: serde_json::json!([]),
                tools_used: serde_json::json!([]),
                send_state: "sent".into(),
                errors: serde_json::json!([]),
                associated_artifacts: serde_json::json!([]),
                associated_approvals: serde_json::json!([]),
                created_at: "2026-08-09T10:00:01Z".into(),
            },
            Message {
                id: "msg-2".into(),
                conversation_id: "conv-1".into(),
                author: "assistant".into(),
                content: "Réponse".into(),
                attachments: serde_json::json!([]),
                sources: serde_json::json!([]),
                citations: serde_json::json!([]),
                tools_used: serde_json::json!([]),
                send_state: "done".into(),
                errors: serde_json::json!([]),
                associated_artifacts: serde_json::json!([]),
                associated_approvals: serde_json::json!([]),
                created_at: "2026-08-09T10:00:02Z".into(),
            },
        ];
        let exported = build_chatgpt_export(&[(conversation, messages)]);
        let (format, conversations) = normalized_conversations(&exported).unwrap();
        assert_eq!(format, "chatgpt");
        assert_eq!(conversations[0].title, "Export ChatGPT");
        assert_eq!(conversations[0].messages.len(), 2);
        assert_eq!(conversations[0].messages[0].content, "Question");
        assert_eq!(conversations[0].messages[1].content, "Réponse");
    }

    #[test]
    fn exports_and_reimports_claude_format_with_attachments() {
        let conversation = Conversation {
            id: "conv-2".into(),
            project_id: None,
            title: "Export Claude".into(),
            conversation_type: "chat".into(),
            business_mode: None,
            bob_mode: None,
            date: "2026-08-09T11:00:00Z".into(),
            pinned: false,
            local_only: true,
            summary: None,
            bob_context_state: serde_json::json!({}),
            archived: false,
        };
        let messages = vec![Message {
            id: "msg-3".into(),
            conversation_id: "conv-2".into(),
            author: "user".into(),
            content: "Analyse ce fichier".into(),
            attachments: serde_json::json!(["/tmp/rapport.pdf"]),
            sources: serde_json::json!([]),
            citations: serde_json::json!([]),
            tools_used: serde_json::json!([]),
            send_state: "sent".into(),
            errors: serde_json::json!([]),
            associated_artifacts: serde_json::json!([]),
            associated_approvals: serde_json::json!([]),
            created_at: "2026-08-09T11:00:01Z".into(),
        }];
        let exported = build_claude_export(&[(conversation, messages)]);
        let (format, conversations) = normalized_conversations(&exported).unwrap();
        assert_eq!(format, "claude-cowork");
        assert_eq!(conversations[0].messages[0].author, "user");
        assert_eq!(
            conversations[0].messages[0]
                .attachments
                .as_ref()
                .and_then(|value| value.pointer("/0/file_name"))
                .and_then(serde_json::Value::as_str),
            Some("rapport.pdf")
        );
    }
}
