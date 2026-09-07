use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::runtime::RuntimeStatus;
use crate::services::codegraph_mcp::{CODEGRAPH_RUNTIME_ID, CODEGRAPH_RUNTIME_VERSION};
use crate::services::project::ProjectService;
use crate::services::runtime_manager::RuntimeManager;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationChoice {
    pub id: String,
    pub label: String,
    pub description: Option<String>,
    pub value: String,
    pub action: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ConversationInteraction {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub question: String,
    pub detail: Option<String>,
    pub runtime_id: Option<String>,
    pub project_id: Option<String>,
    pub choices: Vec<ConversationChoice>,
}

#[tauri::command]
pub async fn get_codegraph_suggestion(
    message: String,
    project_id: Option<String>,
    db: State<'_, Database>,
    manager: State<'_, RuntimeManager>,
) -> AppResult<Option<ConversationInteraction>> {
    let Some(project_id) = project_id.filter(|value| !value.trim().is_empty()) else {
        return Ok(None);
    };
    let Some(project) = ProjectService::new().get_by_id(&db, &project_id)? else {
        return Ok(None);
    };
    if project.local_path.as_deref().map_or(true, str::is_empty) || !codegraph_would_help(&message)
    {
        return Ok(None);
    }
    let runtime = manager
        .get(&db, CODEGRAPH_RUNTIME_ID)?
        .ok_or_else(|| AppError::NotFound("CodeGraph Runtime".into()))?;
    if runtime.status == RuntimeStatus::Installed
        && runtime.installed_version.as_deref() == Some(CODEGRAPH_RUNTIME_VERSION)
    {
        return Ok(None);
    }
    let plan = manager.installation_plan(&db, CODEGRAPH_RUNTIME_ID)?;
    let size = plan
        .estimated_size_bytes
        .map(format_bytes)
        .unwrap_or_else(|| "taille inconnue".into());
    let copy = suggestion_copy(&project.language);
    Ok(Some(ConversationInteraction {
        id: format!("codegraph-runtime-{project_id}"),
        kind: "runtime_suggestion".into(),
        title: copy.title.into(),
        question: copy.question.into(),
        detail: Some(format!(
            "{} {} · {} · {} {}",
            copy.detail, plan.version, size, copy.source, plan.source
        )),
        runtime_id: Some(CODEGRAPH_RUNTIME_ID.into()),
        project_id: Some(project_id),
        choices: vec![
            ConversationChoice {
                id: "install".into(),
                label: copy.install.into(),
                description: Some(copy.install_description.into()),
                value: copy.install_value.into(),
                action: Some("install_runtime".into()),
            },
            ConversationChoice {
                id: "continue".into(),
                label: copy.continue_without.into(),
                description: Some(copy.continue_description.into()),
                value: copy.continue_value.into(),
                action: Some("continue".into()),
            },
            ConversationChoice {
                id: "dismiss_project".into(),
                label: copy.dismiss.into(),
                description: Some(copy.dismiss_description.into()),
                value: copy.dismiss_value.into(),
                action: Some("dismiss_project".into()),
            },
        ],
    }))
}

struct SuggestionCopy {
    title: &'static str,
    question: &'static str,
    detail: &'static str,
    source: &'static str,
    install: &'static str,
    install_description: &'static str,
    install_value: &'static str,
    continue_without: &'static str,
    continue_description: &'static str,
    continue_value: &'static str,
    dismiss: &'static str,
    dismiss_description: &'static str,
    dismiss_value: &'static str,
}

fn suggestion_copy(language: &str) -> SuggestionCopy {
    match language {
        "en" => SuggestionCopy {
            title: "CodeGraph can help with this task",
            question: "Install the CodeGraph runtime and index this project?",
            detail: "Hybrid search, symbols, callers/callees and impact analysis for Python, JavaScript, TypeScript, Go, Java and Rust. Version",
            source: "source",
            install: "Install and continue",
            install_description: "Installs the managed runtime, then lets Bob index the project.",
            install_value: "Install CodeGraph and continue the original request.",
            continue_without: "Continue without CodeGraph",
            continue_description: "Bob will use the standard file tools.",
            continue_value: "Continue without CodeGraph using the standard file tools.",
            dismiss: "Don't suggest here again",
            dismiss_description: "Disables this suggestion for this project only.",
            dismiss_value: "Continue without CodeGraph and do not suggest it again for this project.",
        },
        "es" => SuggestionCopy {
            title: "CodeGraph puede ayudar con esta tarea",
            question: "¿Instalar el runtime CodeGraph e indexar este proyecto?",
            detail: "Búsqueda híbrida, símbolos, callers/callees y análisis de impacto para Python, JavaScript, TypeScript, Go, Java y Rust. Versión",
            source: "fuente",
            install: "Instalar y continuar",
            install_description: "Instala el runtime gestionado y permite que Bob indexe el proyecto.",
            install_value: "Instala CodeGraph y continúa con la solicitud inicial.",
            continue_without: "Continuar sin CodeGraph",
            continue_description: "Bob utilizará las herramientas de archivos habituales.",
            continue_value: "Continúa sin CodeGraph usando las herramientas de archivos habituales.",
            dismiss: "No volver a sugerir aquí",
            dismiss_description: "Desactiva esta sugerencia solo para este proyecto.",
            dismiss_value: "Continúa sin CodeGraph y no vuelvas a sugerirlo para este proyecto.",
        },
        _ => SuggestionCopy {
            title: "CodeGraph peut aider pour cette tâche",
            question: "Voulez-vous installer le runtime CodeGraph et indexer ce projet ?",
            detail: "Recherche hybride, symboles, callers/callees et analyse d’impact pour Python, JavaScript, TypeScript, Go, Java et Rust. Version",
            source: "source",
            install: "Installer et continuer",
            install_description: "Installe le runtime géré, puis laisse Bob indexer le projet.",
            install_value: "Installer CodeGraph et poursuivre la demande initiale.",
            continue_without: "Continuer sans CodeGraph",
            continue_description: "Bob utilisera les outils de fichiers habituels.",
            continue_value: "Poursuis sans CodeGraph et utilise les outils de fichiers habituels.",
            dismiss: "Ne plus proposer ici",
            dismiss_description: "Désactive cette suggestion pour ce projet uniquement.",
            dismiss_value: "Poursuis sans CodeGraph et ne le repropose plus pour ce projet.",
        },
    }
}

pub fn codegraph_would_help(message: &str) -> bool {
    let normalized = message.to_lowercase();
    [
        "codegraph",
        "code graph",
        "graphe de code",
        "recherche sémantique",
        "semantic search",
        "callers",
        "callees",
        "appelants",
        "appelé par",
        "impact analysis",
        "analyse d’impact",
        "analyse d'impact",
        "find usages",
        "trouver les usages",
        "dépendances du code",
        "dependances du code",
        "qui appelle",
        "architecture du code",
        "architecture de la base",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn format_bytes(bytes: u64) -> String {
    if bytes >= 1024 * 1024 * 1024 {
        format!("{:.1} Go", bytes as f64 / (1024_f64.powi(3)))
    } else if bytes >= 1024 * 1024 {
        format!("{:.0} Mo", bytes as f64 / (1024_f64.powi(2)))
    } else {
        format!("{} Ko", bytes / 1024)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_cross_cutting_code_tasks_trigger_the_suggestion() {
        assert!(codegraph_would_help("Trouve tous les callers de saveUser"));
        assert!(codegraph_would_help(
            "Fais une analyse d'impact de ce changement"
        ));
        assert!(codegraph_would_help("@plugin:codegraph indexe le dépôt"));
        assert!(!codegraph_would_help("Lis le fichier README.md"));
        assert!(!codegraph_would_help("Corrige cette faute dans app.ts"));
    }
}
