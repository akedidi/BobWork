use crate::db::Database;
use crate::error::AppError;
use crate::models::memory::{CreateMemoryInput, PersistentMemory};
use crate::services::memory::MemoryService;
use tauri::State;

#[tauri::command]
pub async fn get_memories(db: State<'_, Database>) -> Result<Vec<PersistentMemory>, AppError> {
    MemoryService::new().list(&db)
}

#[tauri::command]
pub async fn create_memory(
    input: CreateMemoryInput,
    db: State<'_, Database>,
) -> Result<PersistentMemory, AppError> {
    MemoryService::new().create(&db, input)
}

#[tauri::command]
pub async fn forget_memory(id: String, db: State<'_, Database>) -> Result<(), AppError> {
    MemoryService::new().forget(&db, &id)
}
