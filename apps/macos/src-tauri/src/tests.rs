// ============================================================
// Bob Work – Rust Unit Tests
// Run with: cargo test
// ============================================================

#[cfg(test)]
mod tests {
    mod database_tests {
        use crate::db::Database;

        #[test]
        fn migrated_integrations_schema_has_no_keychain_column() {
            let db = Database::new_in_memory().expect("database");
            db.run_migrations().expect("migrations");
            let conn = db.conn.lock().unwrap();
            let mut statement = conn.prepare("PRAGMA table_info(integrations)").unwrap();
            let columns = statement
                .query_map([], |row| row.get::<_, String>(1))
                .unwrap()
                .filter_map(Result::ok)
                .collect::<Vec<_>>();

            assert!(!columns.iter().any(|column| column.contains("keychain")));
        }
    }

    // ── Scheduler ────────────────────────────────────────────────

    mod scheduler_tests {
        use crate::db::Database;
        use crate::services::scheduler::{CreateScheduleInput, SchedulerService};
        use chrono::Timelike;

        fn temp_db() -> Database {
            // Use an in-memory SQLite for tests
            let db = Database::new_in_memory().expect("in-memory db");
            db.run_migrations().expect("migrations");
            db
        }

        #[test]
        fn test_create_and_get_schedule() {
            let db = temp_db();
            let svc = SchedulerService::new();

            let input = CreateScheduleInput {
                name: "Test Daily".to_string(),
                instructions: "Run daily report".to_string(),
                project_id: None,
                plugin_or_mode: None,
                cron_or_event: "every day".to_string(),
                run_at: None,
                timezone: Some("UTC".to_string()),
                offline_behavior: Some("skip".to_string()),
                overlap_policy: Some("queue".to_string()),
            };

            let created = svc.create(&db, input).expect("create schedule");
            assert_eq!(created.name, "Test Daily");
            assert_eq!(created.state, "active");
            assert!(created.next_run.is_some(), "next_run should be computed");

            let all = svc.get_all(&db).expect("get all");
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].id, created.id);
        }

        #[test]
        fn test_update_schedule_state() {
            let db = temp_db();
            let svc = SchedulerService::new();

            let input = CreateScheduleInput {
                name: "Weekly".to_string(),
                instructions: "Weekly summary".to_string(),
                project_id: None,
                plugin_or_mode: None,
                cron_or_event: "every week".to_string(),
                run_at: None,
                timezone: None,
                offline_behavior: None,
                overlap_policy: None,
            };
            let s = svc.create(&db, input).expect("create");
            assert_eq!(s.state, "active");

            svc.update_state(&db, &s.id, "paused").expect("update");
            let all = svc.get_all(&db).expect("get");
            assert_eq!(all[0].state, "paused");
        }

        #[test]
        fn test_delete_schedule() {
            let db = temp_db();
            let svc = SchedulerService::new();

            let input = CreateScheduleInput {
                name: "ToDelete".to_string(),
                instructions: "test".to_string(),
                project_id: None,
                plugin_or_mode: None,
                cron_or_event: "hourly".to_string(),
                run_at: None,
                timezone: None,
                offline_behavior: None,
                overlap_policy: None,
            };
            let s = svc.create(&db, input).expect("create");
            svc.delete(&db, &s.id).expect("delete");
            let all = svc.get_all(&db).expect("get");
            assert!(all.is_empty());
        }

        #[test]
        fn test_compute_next_run_daily() {
            // create a schedule with "every day" and verify next_run is ~24h from now
            let db = temp_db();
            let svc = SchedulerService::new();

            let input = CreateScheduleInput {
                name: "Daily".to_string(),
                instructions: "daily".to_string(),
                project_id: None,
                plugin_or_mode: None,
                cron_or_event: "every day".to_string(),
                run_at: None,
                timezone: None,
                offline_behavior: None,
                overlap_policy: None,
            };
            let s = svc.create(&db, input).expect("create");
            let next = s.next_run.expect("next_run must be set");
            let dt = chrono::DateTime::parse_from_rfc3339(&next).expect("valid RFC3339");
            let diff = dt.signed_duration_since(chrono::Utc::now()).num_hours();
            assert!(
                diff >= 23 && diff <= 25,
                "daily should be ~24h from now, got {}h",
                diff
            );
        }

        #[test]
        fn test_compute_next_run_in_minutes() {
            let db = temp_db();
            let svc = SchedulerService::new();

            let input = CreateScheduleInput {
                name: "soon".to_string(),
                instructions: "test".to_string(),
                project_id: None,
                plugin_or_mode: None,
                cron_or_event: "in 5 minutes".to_string(),
                run_at: None,
                timezone: None,
                offline_behavior: None,
                overlap_policy: None,
            };
            let s = svc.create(&db, input).expect("create");
            let next = s.next_run.expect("next_run");
            let dt = chrono::DateTime::parse_from_rfc3339(&next).expect("valid RFC3339");
            let diff = dt.signed_duration_since(chrono::Utc::now()).num_minutes();
            assert!(
                diff >= 4 && diff <= 6,
                "should be ~5 min from now, got {}min",
                diff
            );
        }

        #[test]
        fn test_compute_next_run_daily_at_time() {
            let db = temp_db();
            let svc = SchedulerService::new();

            let input = CreateScheduleInput {
                name: "Morning".to_string(),
                instructions: "daily".to_string(),
                project_id: None,
                plugin_or_mode: None,
                cron_or_event: "every day".to_string(),
                run_at: Some("09:00".to_string()),
                timezone: Some("UTC".to_string()),
                offline_behavior: None,
                overlap_policy: None,
            };
            let s = svc.create(&db, input).expect("create");
            let next = s.next_run.expect("next_run");
            let dt = chrono::DateTime::parse_from_rfc3339(&next).expect("valid RFC3339");
            assert_eq!(dt.hour(), 9);
            assert_eq!(dt.minute(), 0);
            assert!(dt > chrono::Utc::now());
        }

        #[test]
        fn test_create_schedule_with_project() {
            let db = temp_db();
            let svc = SchedulerService::new();
            let project_id = uuid::Uuid::new_v4().to_string();
            db.conn.lock().unwrap().execute(
                "INSERT INTO projects (id,name,description,objective,local_path,allowed_integrations,custom_instructions,created_at,updated_at)
                 VALUES (?1,'Demo','','','/tmp/demo','[]','',datetime('now'),datetime('now'))",
                rusqlite::params![project_id],
            ).expect("insert project");

            let input = CreateScheduleInput {
                name: "Project task".to_string(),
                instructions: "Run in project".to_string(),
                project_id: Some(project_id.clone()),
                plugin_or_mode: None,
                cron_or_event: "every day".to_string(),
                run_at: Some("10:30".to_string()),
                timezone: Some("UTC".to_string()),
                offline_behavior: None,
                overlap_policy: None,
            };
            let created = svc.create(&db, input).expect("create");
            assert_eq!(created.project_id.as_deref(), Some(project_id.as_str()));
            assert_eq!(created.run_at.as_deref(), Some("10:30"));
        }
    }

    // ── Plugin Validation ────────────────────────────────────────

    mod plugin_tests {
        use crate::services::plugin::PluginService;

        #[test]
        fn test_validate_missing_required_fields() {
            let svc = PluginService::new();
            let manifest = serde_json::json!({});
            let result = svc.validate(&manifest);
            assert!(!result.valid);
            assert!(result.errors.iter().any(|e| e.contains("name")));
            assert!(result.errors.iter().any(|e| e.contains("version")));
        }

        #[test]
        fn test_validate_valid_manifest() {
            let svc = PluginService::new();
            let manifest = serde_json::json!({
                "name": "test-plugin",
                "version": "1.0.0",
                "description": "A test plugin"
            });
            let result = svc.validate(&manifest);
            assert!(result.valid);
            assert!(result.errors.is_empty());
            assert_eq!(result.risk_level, "low");
        }

        #[test]
        fn test_validate_high_risk_permissions() {
            let svc = PluginService::new();
            let manifest = serde_json::json!({
                "name": "risky",
                "version": "1.0.0",
                "permissions": [{"type": "command.execute"}]
            });
            let result = svc.validate(&manifest);
            assert!(result.valid); // valid but high risk
            assert_eq!(result.risk_level, "high");
            assert!(!result.dangerous_patterns.is_empty());
        }

        #[test]
        fn test_validate_network_medium_risk() {
            let svc = PluginService::new();
            let manifest = serde_json::json!({
                "name": "net-plugin",
                "version": "1.0.0",
                "permissions": [{"type": "network.request"}]
            });
            let result = svc.validate(&manifest);
            assert!(result.valid);
            assert_eq!(result.risk_level, "medium");
        }

        #[test]
        fn test_validate_executable_category() {
            let svc = PluginService::new();
            let manifest = serde_json::json!({
                "name": "exec-plugin",
                "version": "1.0.0",
                "category": "executable"
            });
            let result = svc.validate(&manifest);
            assert!(!result.warnings.is_empty(), "should warn about executable");
        }
    }

    // ── Secret Redaction ─────────────────────────────────────────

    mod redaction_tests {
        use crate::security::secret_redaction::{mask_secret, redact_secrets};

        #[test]
        fn test_redact_api_key() {
            let text = "api_key=super-secret-key-123456789";
            let redacted = redact_secrets(text);
            assert!(!redacted.contains("super-secret-key-123456789"));
            assert!(redacted.contains("REDACTED"));
        }

        #[test]
        fn test_redact_token() {
            let text = "token: mySecretToken12345";
            let redacted = redact_secrets(text);
            assert!(!redacted.contains("mySecretToken12345"));
        }

        #[test]
        fn test_safe_text_unchanged() {
            let text = "Hello, this is a normal log message without secrets";
            let redacted = redact_secrets(text);
            assert_eq!(redacted, text);
        }

        #[test]
        fn test_redact_quoted_json_token() {
            let text = r#"{"token":"mySecretToken12345"}"#;
            let redacted = redact_secrets(text);
            assert!(!redacted.contains("mySecretToken12345"));
        }

        #[test]
        fn test_mask_shows_last_chars() {
            let secret = "abc123XYZ987";
            let masked = mask_secret(secret, 4);
            assert!(masked.ends_with("Z987"));
            assert!(masked.starts_with("****-"));
        }
    }

    // ── Path Validation ──────────────────────────────────────────

    mod path_validation_tests {
        use crate::security::path_validation::validate_path;

        #[test]
        fn test_valid_path_within_root() {
            let tmp = std::env::temp_dir();
            // Canonicalize the root so symlinks (e.g. /var -> /private/var on macOS) are resolved
            let canonical_tmp = tmp.canonicalize().unwrap_or(tmp.clone());
            let path = tmp.join("test_file.txt");
            // Write so it can be canonicalized
            std::fs::write(&path, "test").unwrap();
            let result = validate_path(&path, &[canonical_tmp]);
            let _ = std::fs::remove_file(&path);
            assert!(
                result.is_ok(),
                "valid path within root should pass: {:?}",
                result
            );
        }

        #[test]
        fn test_path_outside_allowed_root_rejected() {
            let tmp = std::env::temp_dir();
            let allowed_root = tmp.join("allowed_subdir");
            std::fs::create_dir_all(&allowed_root).unwrap();
            let outside = tmp.join("outside_file.txt");
            std::fs::write(&outside, "test").unwrap();

            let result = validate_path(&outside, &[allowed_root.clone()]);
            let _ = std::fs::remove_file(&outside);
            let _ = std::fs::remove_dir_all(&allowed_root);
            assert!(
                result.is_err(),
                "path outside allowed root should be rejected"
            );
        }

        #[test]
        fn test_no_restrictions_allows_any() {
            let tmp = std::env::temp_dir();
            let path = tmp.join("unrestricted.txt");
            std::fs::write(&path, "test").unwrap();
            let result = validate_path(&path, &[]);
            let _ = std::fs::remove_file(&path);
            assert!(result.is_ok(), "no root restriction should allow any path");
        }
    }

    // ── Artifact Generator ───────────────────────────────────────

    mod artifact_gen_tests {
        use crate::db::Database;
        use crate::services::artifact_generator::{ArtifactGeneratorService, CreateArtifactInput};

        fn temp_db() -> Database {
            let db = Database::new_in_memory().expect("in-memory db");
            db.run_migrations().expect("migrations");
            db
        }

        #[test]
        fn test_generate_text_artifact() {
            let db = temp_db();
            let tmp_dir = std::env::temp_dir().join("bobwork_test_artifacts");
            std::fs::create_dir_all(&tmp_dir).unwrap();

            let input = CreateArtifactInput {
                artifact_type: "text".to_string(),
                title: "Test Doc".to_string(),
                content: "Hello World".to_string(),
                conversation_id: None,
            };

            let svc = ArtifactGeneratorService::new();
            let result = svc.generate(&db, input, &tmp_dir);

            // Clean up regardless
            let _ = std::fs::remove_dir_all(&tmp_dir);

            assert!(
                result.is_ok(),
                "should generate text artifact: {:?}",
                result
            );
            let art = result.unwrap();
            assert_eq!(art.title, "Test Doc");
            assert_eq!(art.artifact_type, "text");
        }

        #[test]
        fn test_generate_markdown_artifact() {
            let db = temp_db();
            let tmp_dir = std::env::temp_dir().join("bobwork_test_md_artifacts");
            std::fs::create_dir_all(&tmp_dir).unwrap();

            let input = CreateArtifactInput {
                artifact_type: "markdown".to_string(),
                title: "Report".to_string(),
                content: "## Section\n- Item 1\n- Item 2".to_string(),
                conversation_id: None,
            };

            let svc = ArtifactGeneratorService::new();
            let result = svc.generate(&db, input, &tmp_dir);
            let _ = std::fs::remove_dir_all(&tmp_dir);

            assert!(result.is_ok());
            let art = result.unwrap();
            assert_eq!(art.artifact_type, "markdown");
            assert_eq!(art.validation_status, "valid");
        }

        #[test]
        fn test_generate_docx_produces_zip() {
            let db = temp_db();
            let tmp_dir = std::env::temp_dir().join("bobwork_test_docx");
            std::fs::create_dir_all(&tmp_dir).unwrap();

            let input = CreateArtifactInput {
                artifact_type: "docx".to_string(),
                title: "Document Test".to_string(),
                content: "Line 1\nLine 2\nLine 3".to_string(),
                conversation_id: None,
            };

            let svc = ArtifactGeneratorService::new();
            let result = svc.generate(&db, input, &tmp_dir);
            assert!(
                result.is_ok(),
                "docx generation should succeed: {:?}",
                result
            );
            let art = result.unwrap();
            assert_eq!(art.artifact_type, "docx");
            assert_eq!(art.validation_status, "valid");
            let path = std::path::PathBuf::from(&art.file_path);
            assert!(path.exists(), "docx file should exist at {:?}", path);
            let bytes = std::fs::read(&path).unwrap();
            // PK\x03\x04 is the ZIP magic number
            assert!(
                bytes.starts_with(b"PK\x03\x04"),
                "DOCX should be a valid ZIP"
            );
            let mut archive =
                zip::ZipArchive::new(std::io::Cursor::new(bytes)).expect("open docx as zip");
            assert!(
                archive.len() >= 3,
                "docx package should contain several parts"
            );
            assert!(
                archive.by_name("word/document.xml").is_ok(),
                "docx must contain word/document.xml"
            );
            let _ = std::fs::remove_dir_all(&tmp_dir);
        }

        /// Writes a real DOCX into Bob Work app data so the Artefacts UI can show it.
        /// Run: `LIVE_ARTIFACT_TEST=1 cargo test live_generate_docx_into_app_data -- --ignored --nocapture`
        #[test]
        #[ignore]
        fn live_generate_docx_into_app_data() {
            if std::env::var_os("LIVE_ARTIFACT_TEST").is_none() {
                return;
            }
            let data_dir = dirs::data_dir()
                .expect("data dir")
                .join("com.bobwork.desktop");
            let db_path = data_dir.join("database.sqlite");
            let artifacts_dir = data_dir.join("artifacts");
            assert!(db_path.exists(), "Bob Work DB missing at {:?}", db_path);
            std::fs::create_dir_all(&artifacts_dir).unwrap();

            let db = Database::new(&db_path).expect("open db");
            let input = CreateArtifactInput {
                artifact_type: "docx".to_string(),
                title: "Test Artefact Doc".to_string(),
                content: "## Intro\nDocument de test généré automatiquement.\n- Point A\n- Point B"
                    .to_string(),
                conversation_id: None,
            };
            let art = ArtifactGeneratorService::new()
                .generate(&db, input, &artifacts_dir)
                .expect("live generate");
            println!(
                "LIVE_ARTIFACT id={} path={} size={:?}",
                art.id, art.file_path, art.size
            );
            assert!(std::path::Path::new(&art.file_path).exists());
        }
    }

    // ── Conversation Service ─────────────────────────────────────

    mod conversation_tests {
        use crate::db::Database;
        use crate::models::conversation::AddMessageInput;
        use crate::services::conversation::ConversationService;

        fn temp_db() -> Database {
            let db = Database::new_in_memory().expect("in-memory db");
            db.run_migrations().expect("migrations");
            db
        }

        #[test]
        fn test_create_and_get_conversation() {
            let db = temp_db();
            let svc = ConversationService::new();

            let input = crate::models::conversation::CreateConversationInput {
                project_id: None,
                title: "Test Conv".to_string(),
                conversation_type: Some("chat".to_string()),
                business_mode: None,
                bob_mode: None,
            };
            let conv = svc.create(&db, input).expect("create");
            assert_eq!(conv.title, "Test Conv");
            assert_eq!(conv.conversation_type, "chat");

            // Drafts without a user prompt stay out of the conversation list.
            let empty = svc.get_all(&db, None).expect("get_all");
            assert!(empty.is_empty());

            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: conv.id.clone(),
                    author: "user".to_string(),
                    content: "Premier prompt".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("prompt");

            let all = svc.get_all(&db, None).expect("get_all");
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].id, conv.id);
        }

        #[test]
        fn test_add_and_get_messages() {
            let db = temp_db();
            let svc = ConversationService::new();

            let conv = svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: None,
                        title: "MsgTest".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create");

            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: conv.id.clone(),
                    author: "user".to_string(),
                    content: "Hello Bob".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("add user msg");

            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: conv.id.clone(),
                    author: "assistant".to_string(),
                    content: "Hello! How can I help?".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("add assistant msg");

            let msgs = svc.get_messages(&db, &conv.id).expect("get_messages");
            assert_eq!(msgs.len(), 2);
            assert_eq!(msgs[0].author, "user");
            assert_eq!(msgs[1].author, "assistant");
            assert_eq!(msgs[0].content, "Hello Bob");
        }

        #[test]
        fn test_rewind_conversation_from_message_cancels_tasks() {
            use crate::services::bob::BobService;
            use std::path::PathBuf;

            let db = temp_db();
            let conv_svc = ConversationService::new();
            let task_svc = crate::services::task::TaskService::new();
            let bob = BobService::new(&PathBuf::from("/tmp/bob-work-test"));

            let conv = conv_svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: None,
                        title: "RewindTest".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create");

            let first = conv_svc
                .add_message(
                    &db,
                    AddMessageInput {
                        conversation_id: conv.id.clone(),
                        author: "user".to_string(),
                        content: "First".to_string(),
                        attachments: None,
                        sources: None,
                    },
                )
                .expect("first user");
            conv_svc
                .add_message(
                    &db,
                    AddMessageInput {
                        conversation_id: conv.id.clone(),
                        author: "assistant".to_string(),
                        content: "Reply one".to_string(),
                        attachments: None,
                        sources: None,
                    },
                )
                .expect("first assistant");

            let task = task_svc
                .create(
                    &db,
                    crate::models::task::CreateTaskInput {
                        objective: "Follow up".to_string(),
                        project_id: None,
                        conversation_id: Some(conv.id.clone()),
                        mode: Some("agent".to_string()),
                        permission_policy: Some("always_ask".to_string()),
                        budget: None,
                        max_time: None,
                        schedule_id: None,
                    },
                )
                .expect("create task");
            task_svc
                .update_state(&db, &task.id, "running")
                .expect("running task");

            let result = conv_svc
                .rewind_conversation_from_message(&db, &bob, &conv.id, &first.id)
                .expect("rewind");
            assert_eq!(result.deleted_messages, 2);
            assert_eq!(result.cancelled_tasks, 1);
            assert!(result.title_reset);

            let remaining = conv_svc.get_messages(&db, &conv.id).expect("get_messages");
            assert!(remaining.is_empty());

            let updated_task = task_svc
                .get_by_id(&db, &task.id)
                .expect("get task")
                .expect("task");
            assert_eq!(updated_task.state, "cancelled");
            assert!(!updated_task.resumable);
        }

        #[test]
        fn test_truncate_messages_from_user_message() {
            let db = temp_db();
            let svc = ConversationService::new();

            let conv = svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: None,
                        title: "TruncateTest".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create");

            let first = svc
                .add_message(
                    &db,
                    AddMessageInput {
                        conversation_id: conv.id.clone(),
                        author: "user".to_string(),
                        content: "First".to_string(),
                        attachments: None,
                        sources: None,
                    },
                )
                .expect("first user");
            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: conv.id.clone(),
                    author: "assistant".to_string(),
                    content: "Reply one".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("first assistant");
            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: conv.id.clone(),
                    author: "user".to_string(),
                    content: "Second".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("second user");
            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: conv.id.clone(),
                    author: "assistant".to_string(),
                    content: "Reply two".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("second assistant");

            let deleted = svc
                .truncate_messages_from(&db, &conv.id, &first.id)
                .expect("truncate");
            assert_eq!(deleted, 4);

            let remaining = svc.get_messages(&db, &conv.id).expect("get_messages");
            assert!(remaining.is_empty());

            let err = svc
                .truncate_messages_from(&db, &conv.id, &first.id)
                .err()
                .expect("missing message");
            assert!(err.to_string().contains("introuvable"));
        }

        #[test]
        fn test_filter_by_project() {
            let db = temp_db();
            let p_svc = crate::services::project::ProjectService::new();
            p_svc
                .create(
                    &db,
                    crate::models::project::CreateProjectInput {
                        name: "Test Proj".to_string(),
                        description: None,
                        objective: None,
                        ..Default::default()
                    },
                )
                .unwrap();

            // To ensure the project ID is deterministic, we'll get it from the db
            let projs = p_svc.get_all(&db).unwrap();
            let proj_id = projs[0].id.clone();

            let svc = ConversationService::new();

            let proj_conv = svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: Some(proj_id.clone()),
                        title: "Proj Conv".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create");
            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: proj_conv.id.clone(),
                    author: "user".to_string(),
                    content: "Prompt projet".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("prompt");

            let global_conv = svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: None,
                        title: "Global Conv".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create");
            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: global_conv.id.clone(),
                    author: "user".to_string(),
                    content: "Prompt global".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("prompt");

            // Promptless draft must never appear in the list.
            svc.create(
                &db,
                crate::models::conversation::CreateConversationInput {
                    project_id: None,
                    title: "Nouvelle conversation".to_string(),
                    conversation_type: None,
                    business_mode: None,
                    bob_mode: None,
                },
            )
            .expect("empty draft");

            let proj_convs = svc.get_all(&db, Some(&proj_id)).expect("filtered");
            assert_eq!(proj_convs.len(), 1);
            assert_eq!(proj_convs[0].title, "Proj Conv");

            let all_convs = svc.get_all(&db, None).expect("all");
            assert_eq!(all_convs.len(), 2);
        }

        #[test]
        fn test_purge_promptless_conversations() {
            let db = temp_db();
            let svc = ConversationService::new();

            let stale = svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: None,
                        title: "Nouvelle conversation".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create stale");
            {
                let conn = db.conn.lock().unwrap();
                conn.execute(
                    "UPDATE conversations SET date = ?1 WHERE id = ?2",
                    rusqlite::params!["2020-01-01T00:00:00Z", stale.id],
                )
                .expect("backdate");
            }

            let kept = svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: None,
                        title: "Avec prompt".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create kept");
            svc.add_message(
                &db,
                AddMessageInput {
                    conversation_id: kept.id.clone(),
                    author: "user".to_string(),
                    content: "Bonjour".to_string(),
                    attachments: None,
                    sources: None,
                },
            )
            .expect("prompt");

            let purged = svc.purge_promptless(&db).expect("purge");
            assert_eq!(purged, 1);
            assert!(svc.get_by_id(&db, &stale.id).unwrap().is_none());
            assert!(svc.get_by_id(&db, &kept.id).unwrap().is_some());
            assert_eq!(svc.get_all(&db, None).unwrap().len(), 1);
        }

        #[test]
        fn test_delete_conversation() {
            let db = temp_db();
            let svc = ConversationService::new();

            let conv = svc
                .create(
                    &db,
                    crate::models::conversation::CreateConversationInput {
                        project_id: None,
                        title: "ToDelete".to_string(),
                        conversation_type: None,
                        business_mode: None,
                        bob_mode: None,
                    },
                )
                .expect("create");

            svc.delete(&db, &conv.id).expect("delete");
            let all = svc.get_all(&db, None).expect("get_all");
            assert!(all.is_empty());
        }
    }

    // ── Project Service ──────────────────────────────────────────

    mod project_tests {
        use crate::db::Database;
        use crate::models::project::{CreateProjectInput, UpdateProjectInput};
        use crate::services::project::ProjectService;

        fn temp_db() -> Database {
            let db = Database::new_in_memory().expect("in-memory db");
            db.run_migrations().expect("migrations");
            db
        }

        #[test]
        fn test_create_and_get_project() {
            let db = temp_db();
            let svc = ProjectService::new();

            let input = CreateProjectInput {
                name: "Test Project".to_string(),
                description: Some("A test project".to_string()),
                objective: None,
                color: None,
                local_path: None,
                custom_instructions: None,
                default_mode: Some("general_work".to_string()),
                language: Some("fr".to_string()),
                template: None,
            };
            let proj = svc.create(&db, input).expect("create");
            assert_eq!(proj.name, "Test Project");
            assert_eq!(proj.language, "fr");
            assert!(!proj.archived);

            let all = svc.get_all(&db).expect("get_all");
            assert_eq!(all.len(), 1);
        }

        #[test]
        fn test_update_project() {
            let db = temp_db();
            let svc = ProjectService::new();

            let proj = svc
                .create(
                    &db,
                    CreateProjectInput {
                        name: "Original".to_string(),
                        description: None,
                        objective: None,
                        color: None,
                        local_path: None,
                        custom_instructions: None,
                        default_mode: None,
                        language: None,
                        template: None,
                    },
                )
                .expect("create");

            let updated = svc
                .update(
                    &db,
                    &proj.id,
                    UpdateProjectInput {
                        name: Some("Updated".to_string()),
                        description: Some("New desc".to_string()),
                        objective: Some("New objective".to_string()),
                        language: Some("en".to_string()),
                        memory_enabled: Some(false),
                        default_mode: Some("plan".to_string()),
                        allowed_files: Some(vec!["/tmp/project".to_string()]),
                        allowed_plugins: Some(vec!["plugin-local".to_string()]),
                        allowed_integrations: Some(vec!["github".to_string()]),
                        ..Default::default()
                    },
                )
                .expect("update");

            assert_eq!(updated.name, "Updated");
            assert_eq!(updated.description.as_deref(), Some("New desc"));
            assert_eq!(updated.objective.as_deref(), Some("New objective"));
            assert_eq!(updated.language, "en");
            assert!(!updated.memory_enabled);
            assert_eq!(updated.default_mode.as_deref(), Some("plan"));
            assert_eq!(updated.allowed_files, vec!["/tmp/project"]);
            assert_eq!(updated.allowed_plugins, vec!["plugin-local"]);
            assert_eq!(updated.allowed_integrations, vec!["github"]);
        }

        #[test]
        fn test_archive_project() {
            let db = temp_db();
            let svc = ProjectService::new();

            let proj = svc
                .create(
                    &db,
                    CreateProjectInput {
                        name: "ToArchive".to_string(),
                        description: None,
                        objective: None,
                        color: None,
                        local_path: None,
                        custom_instructions: None,
                        default_mode: None,
                        language: None,
                        template: None,
                    },
                )
                .expect("create");

            svc.archive(&db, &proj.id, true).expect("archive");
            let all = svc.get_all(&db).expect("get_all"); // get_all only returns non-archived
            assert!(
                all.is_empty(),
                "archived projects should not appear in get_all"
            );
        }

        #[test]
        fn test_delete_project() {
            let db = temp_db();
            let svc = ProjectService::new();

            let proj = svc
                .create(
                    &db,
                    CreateProjectInput {
                        name: "ToDelete".to_string(),
                        description: None,
                        objective: None,
                        color: None,
                        local_path: None,
                        custom_instructions: None,
                        default_mode: None,
                        language: None,
                        template: None,
                    },
                )
                .expect("create");

            svc.delete(&db, &proj.id).expect("delete");
            let all = svc.get_all(&db).expect("get_all");
            assert!(all.is_empty());
        }
    }

    // ── Settings Service ─────────────────────────────────────────

    mod settings_tests {
        use crate::db::Database;
        use crate::services::settings::SettingsService;

        fn temp_db() -> Database {
            let db = Database::new_in_memory().expect("in-memory db");
            db.run_migrations().expect("migrations");
            db
        }

        #[test]
        fn test_get_default_settings() {
            let db = temp_db();
            let svc = SettingsService::new();
            let settings = svc.get(&db).expect("get settings");
            // Should return sensible defaults even with empty DB
            assert_eq!(settings.language, "auto");
            assert_eq!(settings.theme, "system");
            assert_eq!(settings.permission_policy, "ask_for_important");
            assert!(settings.font_size >= 12 && settings.font_size <= 20);
        }

        #[test]
        fn test_update_and_get_settings() {
            let db = temp_db();
            let svc = SettingsService::new();

            let mut settings = svc.get(&db).expect("get");
            settings.theme = "dark".to_string();
            settings.language = "en".to_string();
            settings.font_size = 16;
            settings.reduced_motion = true;

            svc.update_all(&db, &settings).expect("update");

            let loaded = svc.get(&db).expect("get after update");
            assert_eq!(loaded.theme, "dark");
            assert_eq!(loaded.language, "en");
            assert_eq!(loaded.font_size, 16);
            assert!(loaded.reduced_motion);
        }

        #[test]
        fn test_update_individual_key() {
            let db = temp_db();
            let svc = SettingsService::new();

            svc.update_key(&db, "theme", "\"light\"")
                .expect("update key");
            let loaded = svc.get(&db).expect("get");
            assert_eq!(loaded.theme, "light");
        }
    }

    // ── Audit Service ────────────────────────────────────────────

    mod audit_tests {
        use crate::db::Database;
        use crate::services::audit::AuditService;

        fn temp_db() -> Database {
            let db = Database::new_in_memory().expect("in-memory db");
            db.run_migrations().expect("migrations");
            db
        }

        #[test]
        fn test_log_event() {
            let db = temp_db();
            let svc = AuditService::new();
            svc.log(
                &db,
                "test.event",
                Some("test"),
                Some("id1"),
                serde_json::json!({"key": "value"}),
            )
            .expect("log event");

            let recent = svc.get_recent(&db, 10).expect("get recent");
            assert_eq!(recent.len(), 1);
            let event = &recent[0];
            assert_eq!(event["type"], "test.event");
        }

        #[test]
        fn test_bob_event_helper() {
            let db = temp_db();
            let svc = AuditService::new();
            svc.bob_event(&db, "bob.session_started", "sess_1", "conv_1")
                .expect("bob event");

            let recent = svc.get_recent(&db, 10).expect("get recent");
            assert_eq!(recent.len(), 1);
            assert_eq!(recent[0]["type"], "bob.session_started");
        }

        #[test]
        fn test_approval_event_helper() {
            let db = temp_db();
            let svc = AuditService::new();
            svc.approval_event(&db, "approval_1", "approved", "high")
                .expect("approval event");

            let recent = svc.get_recent(&db, 10).expect("get recent");
            assert_eq!(recent.len(), 1);
            assert_eq!(recent[0]["type"], "approval.resolved");
        }

        #[test]
        fn test_multiple_events_ordered() {
            let db = temp_db();
            let svc = AuditService::new();

            for i in 0..5 {
                svc.log(
                    &db,
                    &format!("event.{}", i),
                    None,
                    None,
                    serde_json::json!({}),
                )
                .expect("log");
            }
            let recent = svc.get_recent(&db, 3).expect("get recent");
            assert_eq!(recent.len(), 3); // limit respected
        }
    }

    mod task_pinning_tests {
        use crate::db::Database;
        use crate::models::task::CreateTaskInput;
        use crate::services::task::TaskService;

        #[test]
        fn task_pin_is_persisted_and_returned() {
            let db = Database::new_in_memory().expect("in-memory db");
            db.run_migrations().expect("migrations");
            let service = TaskService::new();
            let task = service
                .create(
                    &db,
                    CreateTaskInput {
                        objective: "Préparer le rapport".to_string(),
                        project_id: None,
                        conversation_id: None,
                        mode: Some("agent".to_string()),
                        permission_policy: None,
                        budget: None,
                        max_time: None,
                        schedule_id: None,
                    },
                )
                .expect("create task");

            assert!(!task.pinned);
            service.set_pinned(&db, &task.id, true).expect("pin task");
            let persisted = service
                .get_by_id(&db, &task.id)
                .expect("load task")
                .expect("task exists");
            assert!(persisted.pinned);
        }
    }
}
