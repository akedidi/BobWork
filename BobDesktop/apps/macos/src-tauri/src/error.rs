// ============================================================
// Bob Work - Error Types
// ============================================================

use serde::{Deserialize, Serialize};
use thiserror::Error;

#[derive(Debug, Error, Serialize, Deserialize, Clone)]
pub enum AppError {
    #[error("Database error: {0}")]
    Database(String),

    #[error("Bob not found: {0}")]
    BobNotFound(String),

    #[error("Bob authentication failed: {0}")]
    BobAuthFailed(String),

    #[error("Bob execution failed: {0}")]
    BobExecutionFailed(String),

    #[error("Not found: {0}")]
    NotFound(String),

    #[error("Permission denied: {0}")]
    PermissionDenied(String),

    #[error("Validation failed: {0}")]
    ValidationFailed(String),

    #[error("Security error: {0}")]
    Security(String),

    #[error("IO error: {0}")]
    Io(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Plugin error: {0}")]
    Plugin(String),

    #[error("Unknown error: {0}")]
    Unknown(String),
}

impl From<rusqlite::Error> for AppError {
    fn from(e: rusqlite::Error) -> Self {
        AppError::Database(e.to_string())
    }
}

impl From<std::io::Error> for AppError {
    fn from(e: std::io::Error) -> Self {
        AppError::Io(e.to_string())
    }
}

impl From<serde_json::Error> for AppError {
    fn from(e: serde_json::Error) -> Self {
        AppError::Serialization(e.to_string())
    }
}

impl From<anyhow::Error> for AppError {
    fn from(e: anyhow::Error) -> Self {
        AppError::Unknown(e.to_string())
    }
}

pub type AppResult<T> = Result<T, AppError>;
