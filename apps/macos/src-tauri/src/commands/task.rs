use crate::db::Database;
use crate::error::AppError;
use crate::models::task::{CreateTaskInput, Task, TaskDetail};
use crate::services::bob::BobService;
use crate::services::task::TaskService;
use tauri::{AppHandle, Emitter, State};

#[tauri::command]
pub async fn get_tasks(
    project_id: Option<String>,
    db: State<'_, Database>,
) -> Result<Vec<Task>, AppError> {
    TaskService::new().get_all(&db, project_id.as_deref())
}

#[tauri::command]
pub async fn get_task(id: String, db: State<'_, Database>) -> Result<Option<Task>, AppError> {
    TaskService::new().get_by_id(&db, &id)
}

#[tauri::command]
pub async fn get_task_detail(
    id: String,
    db: State<'_, Database>,
) -> Result<Option<TaskDetail>, AppError> {
    TaskService::new().get_detail(&db, &id)
}

#[tauri::command]
pub async fn create_task(
    input: CreateTaskInput,
    db: State<'_, Database>,
) -> Result<Task, AppError> {
    TaskService::new().create(&db, input)
}

#[tauri::command]
pub async fn update_task_state(
    id: String,
    state: String,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    TaskService::new().update_state(&db, &id, &state)
}

#[tauri::command]
pub async fn update_task_pinned(
    id: String,
    pinned: bool,
    app_handle: AppHandle,
    db: State<'_, Database>,
) -> Result<(), AppError> {
    TaskService::new().set_pinned(&db, &id, pinned)?;
    let _ = app_handle.emit("task-updated", &id);
    Ok(())
}

#[tauri::command]
pub async fn cancel_task(
    id: String,
    db: State<'_, Database>,
    bob_service: State<'_, BobService>,
) -> Result<(), AppError> {
    if let Some(task) = TaskService::new().get_by_id(&db, &id)? {
        if let Some(session_id) = task.bob_process_id {
            let _ = bob_service.cancel_session(&session_id);
        }
    }
    TaskService::new().cancel(&db, &id)
}
