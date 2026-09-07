//! Typed local Qiskit operations. Remote IBM Quantum actions deliberately do
//! not live here until credential handling and consequential-action approval
//! have a complete, tested workflow.

use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::quantum::{QuantumCircuitSpec, QuantumSimulationRequest, QuantumValidation};
use crate::services::artifact_generator::{ArtifactGeneratorService, CreateArtifactInput};
use crate::services::plugin::PluginService;
use crate::services::qiskit::QiskitService;
use crate::services::runtime_manager::RuntimeManager;
use serde_json::Value;
use tauri::{Manager, State};

const QISKIT_PLUGIN_ID: &str = "builtin-ibm-qiskit";

fn qiskit_manifest(db: &Database) -> AppResult<Value> {
    let plugin = PluginService::new()
        .get_by_id(db, QISKIT_PLUGIN_ID)?
        .ok_or_else(|| AppError::NotFound("Qiskit Built-in is unavailable".into()))?;
    if plugin.install_state != "installed" {
        return Err(AppError::PermissionDenied(
            "Qiskit Built-in is disabled".into(),
        ));
    }
    Ok(plugin.manifest)
}

#[tauri::command]
pub fn validate_quantum_circuit(circuit: QuantumCircuitSpec) -> QuantumValidation {
    crate::models::quantum::validate_circuit(&circuit)
}

#[tauri::command]
pub async fn analyze_quantum_circuit(
    circuit: QuantumCircuitSpec,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> AppResult<Value> {
    QiskitService::new()
        .analyze(&db, &runtime_manager, &qiskit_manifest(&db)?, circuit)
        .await
}

#[tauri::command]
pub async fn transpile_quantum_circuit(
    circuit: QuantumCircuitSpec,
    optimization_level: u8,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> AppResult<Value> {
    QiskitService::new()
        .transpile(
            &db,
            &runtime_manager,
            &qiskit_manifest(&db)?,
            circuit,
            optimization_level,
        )
        .await
}

#[tauri::command]
pub async fn simulate_quantum_circuit(
    request: QuantumSimulationRequest,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> AppResult<Value> {
    QiskitService::new()
        .simulate(&db, &runtime_manager, &qiskit_manifest(&db)?, request)
        .await
}

#[tauri::command]
pub async fn simulate_quantum_circuit_with_visualization(
    request: QuantumSimulationRequest,
    conversation_id: Option<String>,
    app_handle: tauri::AppHandle,
    db: State<'_, Database>,
    runtime_manager: State<'_, RuntimeManager>,
) -> AppResult<Value> {
    let circuit = request.circuit.clone();
    let result = QiskitService::new()
        .simulate(&db, &runtime_manager, &qiskit_manifest(&db)?, request)
        .await?;
    let artifacts_dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|_| AppError::Io("Cannot get app data dir".into()))?
        .join("artifacts");
    let artifact = ArtifactGeneratorService::new().generate(
        &db,
        CreateArtifactInput {
            artifact_type: "html".into(),
            title: format!("{} — interactive 2D/3D", circuit.name),
            content: crate::services::qiskit::render_interactive_circuit_html(&circuit, &result),
            conversation_id,
        },
        &artifacts_dir,
    )?;
    Ok(serde_json::json!({"simulation":result,"artifact":artifact}))
}
