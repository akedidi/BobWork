use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::conversation::{AddMessageInput, CreateConversationInput};
use crate::models::task::CreateTaskInput;
use crate::services::bob::{BobRunOptions, BobService};
use crate::services::conversation::ConversationService;
use crate::services::plugin::PluginService;
use crate::services::plugin_extensions::PluginExtensionService;
use crate::services::plugin_mcp::PluginMcpService;
use crate::services::project::ProjectService;
use crate::services::settings::SettingsService;
use crate::services::task::TaskService;
use chrono::{DateTime, Duration, NaiveTime, TimeZone, Timelike, Utc};
use chrono_tz::Tz;
use cron::Schedule as CronSchedule;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::str::FromStr;
use tauri::Emitter;
use tracing::{error, info};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Schedule {
    pub id: String,
    pub name: String,
    pub instructions: String,
    pub project_id: Option<String>,
    pub plugin_or_mode: Option<String>,
    pub cron_or_event: String,
    /// Local time of day (`HH:MM`) in `timezone` for recurring schedules.
    pub run_at: Option<String>,
    pub timezone: String,
    pub next_run: Option<String>,
    pub last_run: Option<String>,
    pub offline_behavior: String,
    pub overlap_policy: String,
    pub state: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScheduleRun {
    pub id: String,
    pub schedule_id: String,
    pub task_id: Option<String>,
    pub scheduled_for: String,
    pub state: String,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub summary: Option<String>,
    pub error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateScheduleInput {
    pub name: String,
    pub instructions: String,
    pub project_id: Option<String>,
    pub plugin_or_mode: Option<String>,
    pub cron_or_event: String,
    pub run_at: Option<String>,
    pub timezone: Option<String>,
    pub offline_behavior: Option<String>,
    pub overlap_policy: Option<String>,
}

pub struct SchedulerService;

impl SchedulerService {
    pub fn new() -> Self {
        Self
    }

    pub fn get_all(&self, db: &Database) -> AppResult<Vec<Schedule>> {
        let conn = db.connection();
        let mut stmt = conn.prepare(
            "SELECT id,name,instructions,project_id,plugin_or_mode,cron_or_event,run_at,timezone,next_run,last_run,
             offline_behavior,overlap_policy,state,created_at,updated_at FROM schedules ORDER BY created_at DESC"
        )?;
        let rows = stmt
            .query_map([], Self::row_to_schedule)?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<Schedule>> {
        let conn = db.connection();
        let result = conn.query_row(
            "SELECT id,name,instructions,project_id,plugin_or_mode,cron_or_event,run_at,timezone,next_run,last_run,
             offline_behavior,overlap_policy,state,created_at,updated_at FROM schedules WHERE id=?1",
            params![id], Self::row_to_schedule,
        );
        match result {
            Ok(value) => Ok(Some(value)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn get_runs(&self, db: &Database, schedule_id: &str) -> AppResult<Vec<ScheduleRun>> {
        let conn = db.connection();
        let mut stmt = conn.prepare(
            "SELECT id,schedule_id,task_id,scheduled_for,state,started_at,ended_at,summary,error,created_at
             FROM schedule_runs WHERE schedule_id=?1 ORDER BY scheduled_for DESC LIMIT 100"
        )?;
        let rows = stmt
            .query_map(params![schedule_id], |row| {
                Ok(ScheduleRun {
                    id: row.get(0)?,
                    schedule_id: row.get(1)?,
                    task_id: row.get(2)?,
                    scheduled_for: row.get(3)?,
                    state: row.get(4)?,
                    started_at: row.get(5)?,
                    ended_at: row.get(6)?,
                    summary: row.get(7)?,
                    error: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    pub fn create(&self, db: &Database, input: CreateScheduleInput) -> AppResult<Schedule> {
        if input.name.trim().is_empty() || input.instructions.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "Le nom et les instructions sont obligatoires.".into(),
            ));
        }
        let timezone = input
            .timezone
            .clone()
            .unwrap_or_else(|| Self::system_timezone());
        let run_at = input
            .run_at
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(ref value) = run_at {
            Self::parse_run_at(value).ok_or_else(|| {
                AppError::ValidationFailed(
                    "L’heure d’exécution doit être au format HH:MM (ex. 09:00).".into(),
                )
            })?;
        }
        let next_run = Self::compute_next_run(&input.cron_or_event, &timezone, run_at.as_deref())
            .ok_or_else(|| {
            AppError::ValidationFailed("Fréquence ou expression cron invalide.".into())
        })?;
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        let offline_behavior = input
            .offline_behavior
            .clone()
            .unwrap_or_else(|| "run_on_wake".into());
        let overlap_policy = input
            .overlap_policy
            .clone()
            .unwrap_or_else(|| "queue".into());
        db.connection().execute(
            "INSERT INTO schedules (id,name,instructions,project_id,plugin_or_mode,cron_or_event,run_at,timezone,next_run,
             offline_behavior,overlap_policy,state,created_at,updated_at)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,'active',?12,?12)",
            params![id,input.name,input.instructions,input.project_id,input.plugin_or_mode,input.cron_or_event,
                    run_at,timezone,next_run,offline_behavior,overlap_policy,now],
        )?;
        self.get_by_id(db, &id)?
            .ok_or_else(|| AppError::NotFound(id))
    }

    pub fn update(&self, db: &Database, id: &str, input: CreateScheduleInput) -> AppResult<Schedule> {
        if input.name.trim().is_empty() || input.instructions.trim().is_empty() {
            return Err(AppError::ValidationFailed(
                "Le nom et les instructions sont obligatoires.".into(),
            ));
        }
        let timezone = input
            .timezone
            .clone()
            .unwrap_or_else(|| Self::system_timezone());
        let run_at = input
            .run_at
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        if let Some(ref value) = run_at {
            Self::parse_run_at(value).ok_or_else(|| {
                AppError::ValidationFailed(
                    "L’heure d’exécution doit être au format HH:MM (ex. 09:00).".into(),
                )
            })?;
        }
        let next_run = Self::compute_next_run(&input.cron_or_event, &timezone, run_at.as_deref())
            .ok_or_else(|| {
            AppError::ValidationFailed("Fréquence ou expression cron invalide.".into())
        })?;
        let now = Utc::now().to_rfc3339();
        let offline_behavior = input
            .offline_behavior
            .clone()
            .unwrap_or_else(|| "run_on_wake".into());
        let overlap_policy = input
            .overlap_policy
            .clone()
            .unwrap_or_else(|| "queue".into());
        db.connection().execute(
            "UPDATE schedules SET name=?1, instructions=?2, project_id=?3, plugin_or_mode=?4, cron_or_event=?5, run_at=?6, timezone=?7, next_run=?8, offline_behavior=?9, overlap_policy=?10, updated_at=?11 WHERE id=?12",
            params![input.name, input.instructions, input.project_id, input.plugin_or_mode, input.cron_or_event, run_at, timezone, next_run, offline_behavior, overlap_policy, now, id],
        )?;
        self.get_by_id(db, id)?
            .ok_or_else(|| AppError::NotFound(id.to_string()))
    }


    pub fn update_state(&self, db: &Database, id: &str, state: &str) -> AppResult<()> {
        if !matches!(state, "active" | "paused" | "completed") {
            return Err(AppError::ValidationFailed(
                "État de planification invalide.".into(),
            ));
        }
        let now = Utc::now().to_rfc3339();
        db.connection().execute(
            "UPDATE schedules SET state=?1,updated_at=?2 WHERE id=?3",
            params![state, now, id],
        )?;
        Ok(())
    }

    pub fn delete(&self, db: &Database, id: &str) -> AppResult<()> {
        db.conn
            .lock()
            .unwrap()
            .execute("DELETE FROM schedules WHERE id=?1", params![id])?;
        Ok(())
    }

    pub fn tick_schedules<R: tauri::Runtime>(
        &self,
        db: &Database,
        bob: &BobService,
        app: &tauri::AppHandle<R>,
    ) -> AppResult<()> {
        let now = Utc::now();
        let due_ids: Vec<String> = {
            let conn = db.connection();
            let mut stmt = conn.prepare("SELECT id FROM schedules WHERE state='active' AND next_run IS NOT NULL AND next_run<=?1")?;
            let rows = stmt
                .query_map(params![now.to_rfc3339()], |row| row.get(0))?
                .filter_map(Result::ok)
                .collect();
            rows
        };
        for id in due_ids {
            let Some(schedule) = self.get_by_id(db, &id)? else {
                continue;
            };
            let active = self.active_task_sessions(db, &schedule.id)?;
            if !active.is_empty() {
                match schedule.overlap_policy.as_str() {
                    "queue" => {
                        info!("Schedule {} waits for the previous run", id);
                        continue;
                    }
                    "ignore" => {
                        self.record_skipped(
                            db,
                            &schedule,
                            "Occurrence ignorée car une exécution est déjà active",
                        )?;
                        self.advance(db, &schedule)?;
                        let _ = app.emit("schedule-updated", &id);
                        continue;
                    }
                    "cancel_old" => self.cancel_active_runs(db, bob, &schedule.id, active)?,
                    "ask" => {
                        self.update_state(db, &id, "paused")?;
                        let _ = app.emit("schedule-updated", &id);
                        continue;
                    }
                    _ => {}
                }
            }
            let overdue_minutes = schedule
                .next_run
                .as_deref()
                .and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok())
                .map(|value| (now - value.with_timezone(&Utc)).num_minutes())
                .unwrap_or(0);
            if overdue_minutes > 5 && schedule.offline_behavior == "skip" {
                self.advance(db, &schedule)?;
                self.record_skipped(
                    db,
                    &schedule,
                    "Exécution manquée pendant l’arrêt de Bob Work",
                )?;
                continue;
            }
            if overdue_minutes > 5 && schedule.offline_behavior == "ask" {
                self.update_state(db, &id, "paused")?;
                let _ = app.emit("schedule-updated", &id);
                continue;
            }
            if let Err(error) = self.launch(db, bob, app, &schedule) {
                error!("Unable to launch schedule {}: {}", id, error);
            }
            self.advance(db, &schedule)?;
            let _ = app.emit("schedule-updated", &id);
        }
        Ok(())
    }

    pub fn run_now<R: tauri::Runtime>(
        &self,
        db: &Database,
        bob: &BobService,
        app: &tauri::AppHandle<R>,
        id: &str,
    ) -> AppResult<String> {
        let schedule = self
            .get_by_id(db, id)?
            .ok_or_else(|| AppError::NotFound(id.into()))?;
        let task_id = self.launch(db, bob, app, &schedule)?;
        let _ = app.emit("schedule-updated", id);
        Ok(task_id)
    }

    fn launch<R: tauri::Runtime>(
        &self,
        db: &Database,
        bob: &BobService,
        app: &tauri::AppHandle<R>,
        schedule: &Schedule,
    ) -> AppResult<String> {
        let active = self.active_task_sessions(db, &schedule.id)?;
        if !active.is_empty() {
            if schedule.overlap_policy == "cancel_old" {
                self.cancel_active_runs(db, bob, &schedule.id, active)?;
            } else {
                return Err(AppError::ValidationFailed(
                    "Une exécution de cette planification est déjà active.".into(),
                ));
            }
        }

        let detection = bob.detect();
        if !detection.found {
            let error = AppError::BobNotFound("Bob Shell 2 n’est pas installé.".into());
            self.record_failed_launch(db, schedule, &error.to_string())?;
            return Err(error);
        }
        if !detection.authenticated {
            let error = AppError::BobAuthFailed(
                "Aucune clé IBM Bob dans le coffre local. Saisissez-la dans Réglages → IBM Bob Shell avant l’exécution planifiée.".into(),
            );
            self.record_failed_launch(db, schedule, &error.to_string())?;
            return Err(error);
        }
        let scheduled_plugin_id = schedule
            .plugin_or_mode
            .as_deref()
            .and_then(|value| value.strip_prefix("plugin:"));
        let scheduled_plugin = scheduled_plugin_id
            .map(|plugin_id| {
                PluginService::new()
                    .get_by_id(db, plugin_id)?
                    .ok_or_else(|| AppError::NotFound("Le plugin planifié n’existe plus.".into()))
            })
            .transpose()?;
        if let Some(plugin) = scheduled_plugin
            .as_ref()
            .filter(|plugin| plugin.install_state != "installed")
        {
            let error = AppError::PermissionDenied(format!(
                "Le plugin planifié {} est désactivé.",
                plugin.name
            ));
            self.record_failed_launch(db, schedule, &error.to_string())?;
            return Err(error);
        }
        let mode = if scheduled_plugin.is_some() {
            "agent".into()
        } else {
            schedule
                .plugin_or_mode
                .clone()
                .unwrap_or_else(|| "agent".into())
        };
        let conversation = ConversationService::new().create(
            db,
            CreateConversationInput {
                project_id: schedule.project_id.clone(),
                title: "[Planifié]".to_string(),
                conversation_type: Some("work".into()),
                business_mode: Some(mode.clone()),
                bob_mode: Some(mode.clone()),
            },
        )?;
        ConversationService::new().add_message(
            db,
            AddMessageInput {
                conversation_id: conversation.id.clone(),
                author: "user".into(),
                content: schedule.instructions.clone(),
                attachments: None,
                sources: None,
            },
        )?;
        let settings = SettingsService::new().get(db)?;
        let task = TaskService::new().create(
            db,
            CreateTaskInput {
                objective: schedule.instructions.clone(),
                project_id: schedule.project_id.clone(),
                conversation_id: Some(conversation.id.clone()),
                mode: Some(mode.clone()),
                permission_policy: Some(settings.permission_policy.clone()),
                budget: None,
                max_time: None,
                schedule_id: Some(schedule.id.clone()),
            },
        )?;
        let session_id = format!("sched_{}", Uuid::new_v4());
        let task_run = TaskService::new().start_run(db, &task.id, &session_id)?;
        let schedule_run_id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();
        db.connection().execute(
            "INSERT INTO schedule_runs (id,schedule_id,task_id,scheduled_for,state,started_at,created_at)
             VALUES (?1,?2,?3,?4,'running',?4,?4)", params![schedule_run_id,schedule.id,task.id,now]
        )?;

        let project = schedule
            .project_id
            .as_deref()
            .map(|id| ProjectService::new().get_by_id(db, id))
            .transpose()?
            .flatten();
        let mut integration_ids = project
            .as_ref()
            .map(|value| value.allowed_integrations.clone())
            .filter(|values| !values.is_empty())
            .unwrap_or_else(|| vec!["github".into(), "slack".into(), "monday".into()]);
        let mut plugin_hooks = vec![];
        let mut plugin_invocation = None;
        if let Some(plugin) = scheduled_plugin.as_ref() {
            if PluginMcpService::has_servers(&plugin.manifest) {
                let bundle_dir = PluginMcpService::bundle_dir(&plugin.manifest)?;
                let unavailable = PluginMcpService::new()
                    .status(&plugin.id, &plugin.manifest, &bundle_dir)?
                    .into_iter()
                    .filter(|server| server.required && (!server.configured || !server.enabled))
                    .map(|server| server.name)
                    .collect::<Vec<_>>();
                if !unavailable.is_empty() {
                    let error = AppError::PermissionDenied(format!(
                        "Les outils du plugin planifié {} ne sont pas actifs : {}.",
                        plugin.name,
                        unavailable.join(", ")
                    ));
                    self.record_failed_launch(db, schedule, &error.to_string())?;
                    return Err(error);
                }
            }
            let extensions =
                PluginExtensionService::new().status(&plugin.id, &plugin.manifest, db, bob)?;
            let missing = extensions
                .integrations
                .iter()
                .filter(|integration| {
                    integration.required
                        && !matches!(integration.state.as_str(), "connected" | "configured")
                })
                .map(|integration| integration.name.clone())
                .chain(
                    extensions
                        .browser_extensions
                        .iter()
                        .filter(|extension| extension.required && extension.state != "ready")
                        .map(|extension| extension.name.clone()),
                )
                .collect::<Vec<_>>();
            if !missing.is_empty() {
                let error = AppError::PermissionDenied(format!(
                    "Le plugin planifié {} attend une autorisation : {}.",
                    plugin.name,
                    missing.join(", ")
                ));
                self.record_failed_launch(db, schedule, &error.to_string())?;
                return Err(error);
            }
            integration_ids.extend(
                extensions
                    .integrations
                    .iter()
                    .filter(|integration| integration.state == "connected")
                    .map(|integration| integration.provider.clone()),
            );
            plugin_hooks = PluginExtensionService::new().prepare_hooks(&plugin.manifest)?;
            let slug = plugin
                .manifest
                .get("slug")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(&plugin.name);
            plugin_invocation = Some(format!(
                "Utilise le plugin Bob ${} pour cette tâche.",
                slug.to_lowercase()
                    .chars()
                    .map(|character| if character.is_ascii_alphanumeric() {
                        character
                    } else {
                        '-'
                    })
                    .collect::<String>()
                    .trim_matches('-')
            ));
        }
        integration_ids.sort();
        integration_ids.dedup();
        let integrations = integration_context(bob, &integration_ids);
        let prompt = [
            (!settings.global_instructions.trim().is_empty()).then(|| format!("Instructions globales :\n{}", settings.global_instructions.trim())),
            project.as_ref().and_then(|p| p.custom_instructions.as_ref()).filter(|v| !v.trim().is_empty()).map(|v| format!("Instructions du projet :\n{}", v.trim())),
            (!settings.web_enabled || settings.sandbox_mode).then(|| "Politique locale Bob Work : n’utilise aucun accès web ou réseau pour cette tâche.".to_string()),
            settings.sandbox_mode.then(|| "Mode sandbox Bob Work : reste strictement dans le workspace. Pas de contrôle bureau/Chrome ni de chemins hors workspace.".to_string()),
            (!integrations.is_empty()).then(|| format!("Intégrations locales disponibles, sans jamais afficher leurs secrets :\n{}", integrations.join("\n"))),
            plugin_invocation,
            Some("Contrainte d'arrière-plan : Privilégiez les outils de recherche web silencieux (requêtes HTTP, outils internes). N'ouvrez pas l'interface graphique de Chrome ou d'autres applications visuelles, afin de ne pas perturber l'utilisateur, sauf si l'instruction le demande explicitement.".to_string()),
            Some(format!("Tâche planifiée « {} » :\n{}", schedule.name, schedule.instructions)),
        ].into_iter().flatten().collect::<Vec<_>>().join("\n\n");

        let workspace = project.and_then(|p| p.local_path);
        let risk = crate::services::permission_governance::RiskContext {
            computer_use: settings.computer_use_enabled,
            chrome: settings.chrome_control_enabled,
            mcp: settings.mcp_enabled,
            web: settings.web_enabled,
        }
        .with_sandbox(settings.sandbox_mode);
        let resource = workspace.clone().unwrap_or_else(|| "*".into());
        let has_grant = crate::services::permission_governance::has_allow_grant(
            db,
            crate::services::permission_governance::ACTION_SESSION_START,
            &resource,
            Some(task.id.as_str()),
        )?;
        let has_user_grant = crate::services::permission_governance::has_user_allow_grant(
            db,
            crate::services::permission_governance::ACTION_SESSION_START,
            &resource,
            Some(task.id.as_str()),
        )?;
        if crate::services::permission_governance::needs_unattended_preflight(
            &settings.permission_policy,
            &risk,
            has_user_grant,
        ) {
            let message = crate::services::permission_governance::unattended_preflight_message(
                &settings.permission_policy,
            );
            let _ = db.connection().execute(
                "UPDATE schedule_runs SET state='failed',ended_at=?1,error=?2 WHERE id=?3",
                params![Utc::now().to_rfc3339(), message, schedule_run_id],
            );
            let _ = TaskService::new().finish_run(
                db,
                &task.id,
                Some(&task_run.id),
                false,
                "",
                Some(&message),
                None,
            );
            return Err(crate::error::AppError::ValidationFailed(message));
        }
        let trust_workspace = crate::services::permission_governance::should_pass_trust(
            &settings.permission_policy,
            false,
            has_grant,
            settings.sandbox_mode,
        );
        if let Err(error) = bob.start_streaming_session(
            app.clone(),
            session_id,
            conversation.id.clone(),
            mode,
            prompt,
            workspace,
            BobRunOptions {
                task_id: Some(task.id.clone()),
                run_id: Some(task_run.id.clone()),
                max_turns: Some(settings.max_turns),
                max_cost: (settings.max_cost > 0.0).then_some(settings.max_cost),
                mcp_enabled: settings.mcp_enabled,
                subagents_enabled: settings.subagents_enabled,
                attachment_paths: vec![],
                integration_ids,
                plugin_hooks,
                resume_task_id: None,
                trust_workspace,
            },
        ) {
            let _ = db.connection().execute(
                "UPDATE schedule_runs SET state='failed',ended_at=?1,error=?2 WHERE id=?3",
                params![Utc::now().to_rfc3339(), error.to_string(), schedule_run_id],
            );
            let _ = TaskService::new().finish_run(
                db,
                &task.id,
                Some(&task_run.id),
                false,
                "",
                Some(&error.to_string()),
                None,
            );
            return Err(error);
        }
        
        let _ = app.emit("conversation-updated", &conversation.id);
        let _ = app.emit("task-updated", &task.id);

        info!(
            "Scheduled task {} launched as task {}",
            schedule.id, task.id
        );
        Ok(task.id)
    }

    fn advance(&self, db: &Database, schedule: &Schedule) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        let next = Self::compute_next_run(
            &schedule.cron_or_event,
            &schedule.timezone,
            schedule.run_at.as_deref(),
        );
        db.connection().execute(
            "UPDATE schedules SET last_run=?1,next_run=?2,updated_at=?1 WHERE id=?3",
            params![now, next, schedule.id],
        )?;
        Ok(())
    }

    fn record_skipped(&self, db: &Database, schedule: &Schedule, reason: &str) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        db.connection().execute(
            "INSERT INTO schedule_runs (id,schedule_id,scheduled_for,state,ended_at,summary,created_at)
             VALUES (?1,?2,?3,'skipped',?3,?4,?3)", params![Uuid::new_v4().to_string(),schedule.id,now,reason]
        )?;
        Ok(())
    }

    fn record_failed_launch(
        &self,
        db: &Database,
        schedule: &Schedule,
        message: &str,
    ) -> AppResult<()> {
        let now = Utc::now().to_rfc3339();
        db.connection().execute(
            "INSERT INTO schedule_runs (id,schedule_id,scheduled_for,state,ended_at,error,created_at)
             VALUES (?1,?2,?3,'failed',?3,?4,?3)", params![Uuid::new_v4().to_string(),schedule.id,now,message]
        )?;
        Ok(())
    }

    fn active_task_sessions(
        &self,
        db: &Database,
        schedule_id: &str,
    ) -> AppResult<Vec<(String, Option<String>)>> {
        let conn = db.connection();
        let mut stmt = conn.prepare(
            "SELECT t.id,t.bob_process_id FROM schedule_runs sr JOIN tasks t ON t.id=sr.task_id
             WHERE sr.schedule_id=?1 AND sr.state IN ('queued','running') AND t.state IN ('queued','starting','running','awaiting_info','awaiting_approval','paused')"
        )?;
        let rows = stmt
            .query_map(params![schedule_id], |row| Ok((row.get(0)?, row.get(1)?)))?
            .filter_map(Result::ok)
            .collect();
        Ok(rows)
    }

    fn cancel_active_runs(
        &self,
        db: &Database,
        bob: &BobService,
        schedule_id: &str,
        active: Vec<(String, Option<String>)>,
    ) -> AppResult<()> {
        for (task_id, session_id) in active {
            if let Some(session_id) = session_id {
                let _ = bob.cancel_session(&session_id);
            }
            let _ = TaskService::new().cancel(db, &task_id);
        }
        let now = Utc::now().to_rfc3339();
        db.connection().execute(
            "UPDATE schedule_runs SET state='cancelled',ended_at=?1,summary='Annulée par la politique de chevauchement' WHERE schedule_id=?2 AND state IN ('queued','running')",
            params![now,schedule_id],
        )?;
        Ok(())
    }

    fn compute_next_run(expression: &str, timezone: &str, run_at: Option<&str>) -> Option<String> {
        let now = Utc::now();
        let value = expression.trim().to_lowercase();
        let tz = Tz::from_str(timezone).unwrap_or(chrono_tz::UTC);

        if let Some(run_at) = run_at.filter(|value| !value.trim().is_empty()) {
            if let Some(next) = Self::next_run_with_time(&value, &tz, run_at, now) {
                return Some(next.to_rfc3339());
            }
        }

        let relative = if value == "daily" || value.contains("every day") {
            Some(now + Duration::days(1))
        } else if value == "weekly" || value.contains("every week") {
            Some(now + Duration::weeks(1))
        } else if value == "monthly" || value.contains("every month") {
            Some(now + Duration::days(30))
        } else if value == "hourly" || value.contains("every hour") {
            Some(now + Duration::hours(1))
        } else if value.contains("every minute") {
            Some(now + Duration::minutes(1))
        } else if value.starts_with("in ") {
            let parts: Vec<&str> = value.split_whitespace().collect();
            let amount = parts.get(1).and_then(|v| v.parse::<i64>().ok())?;
            match parts.get(2).copied() {
                Some("minute" | "minutes") => Some(now + Duration::minutes(amount)),
                Some("hour" | "hours") => Some(now + Duration::hours(amount)),
                Some("day" | "days") => Some(now + Duration::days(amount)),
                _ => None,
            }
        } else {
            None
        };
        if let Some(next) = relative {
            return Some(next.to_rfc3339());
        }

        let field_count = expression.split_whitespace().count();
        let cron_expression = if field_count == 5 {
            format!("0 {}", expression)
        } else {
            expression.to_string()
        };
        let schedule = CronSchedule::from_str(&cron_expression).ok()?;
        let local_now = tz.from_utc_datetime(&now.naive_utc());
        schedule
            .after(&local_now)
            .next()
            .map(|date| date.with_timezone(&Utc).to_rfc3339())
    }

    fn parse_run_at(value: &str) -> Option<(u32, u32)> {
        let parts: Vec<&str> = value.trim().split(':').collect();
        if parts.len() != 2 {
            return None;
        }
        let hour = parts[0].parse::<u32>().ok()?;
        let minute = parts[1].parse::<u32>().ok()?;
        if hour > 23 || minute > 59 {
            return None;
        }
        Some((hour, minute))
    }

    fn local_at_time(
        tz: &Tz,
        date: chrono::NaiveDate,
        hour: u32,
        minute: u32,
    ) -> Option<DateTime<Utc>> {
        let time = NaiveTime::from_hms_opt(hour, minute, 0)?;
        let naive = date.and_time(time);
        tz.from_local_datetime(&naive)
            .earliest()
            .map(|value| value.with_timezone(&Utc))
    }

    fn next_run_with_time(
        frequency: &str,
        tz: &Tz,
        run_at: &str,
        from: DateTime<Utc>,
    ) -> Option<DateTime<Utc>> {
        let (hour, minute) = Self::parse_run_at(run_at)?;
        let local_from = from.with_timezone(tz);

        if frequency == "hourly" || frequency.contains("every hour") {
            let mut candidate = local_from
                .with_minute(minute)?
                .with_second(0)?
                .with_nanosecond(0)?;
            if candidate <= local_from {
                candidate += Duration::hours(1);
            }
            return Some(candidate.with_timezone(&Utc));
        }

        let step_days = if frequency == "weekly" || frequency.contains("every week") {
            7
        } else if frequency == "monthly" || frequency.contains("every month") {
            30
        } else {
            1
        };

        let mut date = local_from.date_naive();
        for _ in 0..400 {
            if let Some(mut candidate) = Self::local_at_time(tz, date, hour, minute) {
                if candidate > from {
                    return Some(candidate);
                }
            }
            date += Duration::days(step_days);
        }

        None
    }

    fn system_timezone() -> String {
        std::env::var("TZ")
            .ok()
            .filter(|v| Tz::from_str(v).is_ok())
            .unwrap_or_else(|| "UTC".into())
    }

    fn row_to_schedule(row: &rusqlite::Row) -> rusqlite::Result<Schedule> {
        Ok(Schedule {
            id: row.get(0)?,
            name: row.get(1)?,
            instructions: row.get(2)?,
            project_id: row.get(3)?,
            plugin_or_mode: row.get(4)?,
            cron_or_event: row.get(5)?,
            run_at: row.get(6)?,
            timezone: row.get(7)?,
            next_run: row.get(8)?,
            last_run: row.get(9)?,
            offline_behavior: row.get(10)?,
            overlap_policy: row.get(11)?,
            state: row.get(12)?,
            created_at: row.get(13)?,
            updated_at: row.get(14)?,
        })
    }
}

fn integration_context(bob: &BobService, ids: &[String]) -> Vec<String> {
    ids.iter()
        .filter_map(|id| {
            let description = match id.as_str() {
                "github" => "- GitHub via $bob-work-github",
                "slack" => "- Slack via $bob-work-slack",
                "monday" => "- Monday.com via $bob-work-monday",
                _ => return None,
            };
            bob.has_integration_credential(id)
                .then(|| description.to_string())
        })
        .collect()
}
