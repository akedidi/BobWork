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

            let file_path = if let Ok(ref art) = result {
                Some(std::path::PathBuf::from(&art.file_path))
            } else {
                None
            };

            let _ = std::fs::remove_dir_all(&tmp_dir);
            assert!(
                result.is_ok(),
                "docx generation should succeed: {:?}",
                result
            );

            // Verify it was a ZIP by checking magic bytes
            if let Some(path) = file_path {
                if path.exists() {
                    let bytes = std::fs::read(&path).unwrap();
                    // PK\x03\x04 is the ZIP magic number
                    assert!(
                        bytes.starts_with(b"PK\x03\x04"),
                        "DOCX should be a valid ZIP"
                    );
                }
            }
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

            svc.create(
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
            svc.create(
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

            let proj_convs = svc.get_all(&db, Some(&proj_id)).expect("filtered");
            assert_eq!(proj_convs.len(), 1);
            assert_eq!(proj_convs[0].title, "Proj Conv");

            let all_convs = svc.get_all(&db, None).expect("all");
            assert_eq!(all_convs.len(), 2);
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
