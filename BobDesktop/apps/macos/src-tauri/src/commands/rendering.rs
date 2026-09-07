use crate::db::Database;
use crate::error::AppResult;
use crate::models::rendering::{
    renderer_capabilities, route_diagram, route_visualization, DiagramRenderer, DiagramSpec,
    RendererCapability, VisualizationRenderer, VisualizationSpec,
};
use crate::services::runtime_manager::RuntimeManager;
use tauri::State;

/// Shared Rendering API: callers submit semantic IR and receive a deterministic
/// renderer selection. Resolving the capability is what lazily materializes the
/// local Diagram Runtime; no renderer path or executable is returned.
#[tauri::command]
pub async fn route_diagram_spec(
    spec: DiagramSpec,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> AppResult<DiagramRenderer> {
    runtime_manager.resolve_platform_capability(&db, "bob-work.shared-rendering-api", "diagram")?;
    route_diagram(&spec)
}

#[tauri::command]
pub async fn route_visualization_spec(
    spec: VisualizationSpec,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> AppResult<VisualizationRenderer> {
    runtime_manager.resolve_platform_capability(
        &db,
        "bob-work.shared-rendering-api",
        "visualization",
    )?;
    route_visualization(&spec)
}

#[tauri::command]
pub fn get_renderer_capabilities() -> Vec<RendererCapability> {
    renderer_capabilities()
}
