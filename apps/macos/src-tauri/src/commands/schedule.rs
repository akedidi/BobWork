// ============================================================
// Bob Work - Scheduler Commands
// ============================================================

use crate::db::Database;
use crate::error::AppError;
use crate::services::bob::BobService;
use crate::services::scheduler::{CreateScheduleInput, Schedule, ScheduleRun, SchedulerService};
use tauri::{AppHandle, Runtime, State};

#[tauri::command]
pub async fn get_schedules(db: State<'_, Database>) -> Result<Vec<Schedule>, AppError> {
    SchedulerService::new().get_all(&db)
}

#[tauri::command]
pub async fn create_schedule(
    input: CreateScheduleInput,
    db: State<'_, Database>,
) -> Result<Schedule, AppError> {
    SchedulerService::new().create(&db, input)
}

#[tauri::command]
pub async fn update_schedule_state(
    id: String,
    state: String,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    SchedulerService::new().update_state(&db, &id, &state)
}

#[tauri::command]
pub async fn delete_schedule(id: String, db: State<'_, Database>) -> Result<(), AppError> {
    SchedulerService::new().delete(&db, &id)
}

#[tauri::command]
pub async fn get_schedule_logs(id: String, db: State<'_, Database>) -> Result<String, AppError> {
    let runs = SchedulerService::new().get_runs(&db, &id)?;
    if runs.is_empty() {
        return Ok("Aucune exécution pour cette planification.".into());
    }
    Ok(runs
        .into_iter()
        .map(|run| {
            format!(
                "[{}] {}\n{}{}",
                run.scheduled_for,
                run.state,
                run.summary.unwrap_or_default(),
                run.error
                    .map(|value| format!("\nErreur: {}", value))
                    .unwrap_or_default(),
            )
        })
        .collect::<Vec<_>>()
        .join("\n\n"))
}

#[tauri::command]
pub async fn get_schedule_runs(
    id: String,
    db: State<'_, Database>,
) -> Result<Vec<ScheduleRun>, AppError> {
    SchedulerService::new().get_runs(&db, &id)
}

#[tauri::command]
pub async fn run_schedule_now<R: Runtime>(
    id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
    app_handle: AppHandle<R>,
) -> Result<String, AppError> {
    SchedulerService::new().run_now(&db, &bob_service, &app_handle, &id)
}
