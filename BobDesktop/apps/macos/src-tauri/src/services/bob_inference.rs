//! Direct IBM Bob inference HTTP (OpenAI-compatible chat completions).
//! Used for lightweight jobs such as conversation titles — avoids spawning `bob run`.

use crate::error::{AppError, AppResult};
use crate::services::bob_usage::{gateway_auth_headers, resolve_gateway_auth_public, GatewayAuthKind};
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;

const DEFAULT_MODEL: &str = "premium";
const TITLE_TIMEOUT: Duration = Duration::from_secs(12);

/// One-shot chat completion. Returns the assistant text content.
pub async fn chat_completion_text(system: &str, user: &str) -> AppResult<String> {
    let (gateway, auth) = resolve_gateway_auth_public()?.ok_or_else(|| {
        AppError::BobAuthFailed(
            "Aucune authentification Bob (clé API ou session SSO) pour l’inférence directe."
                .into(),
        )
    })?;
    let url = format!(
        "{}/inference/v1/chat/completions",
        gateway.trim_end_matches('/')
    );
    let body = json!({
        "model": DEFAULT_MODEL,
        "temperature": 0.2,
        "max_tokens": 64,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": user }
        ]
    });

    let client = Client::builder()
        .timeout(TITLE_TIMEOUT)
        .build()
        .map_err(|error| AppError::BobExecutionFailed(error.to_string()))?;

    let mut request = client.post(&url).headers(gateway_auth_headers(&auth)?);
    // General API keys need team context; SSO / inference keys usually do not.
    if matches!(auth, GatewayAuthKind::ApiKey(_)) {
        if let Some(team_id) = crate::services::bob_usage::preferred_team_id() {
            request = request.header("x-team-id", team_id);
        }
    }

    let response = request.json(&body).send().await.map_err(|error| {
        AppError::BobExecutionFailed(format!("Inférence Bob inaccessible : {error}"))
    })?;
    let status = response.status();
    let raw: Value = response.json().await.map_err(|error| {
        AppError::BobExecutionFailed(format!("Réponse d’inférence invalide : {error}"))
    })?;
    if !status.is_success() {
        let detail = raw
            .get("error")
            .and_then(|value| value.get("message").or_else(|| value.get("detail")))
            .and_then(Value::as_str)
            .unwrap_or_else(|| status.as_str());
        return Err(AppError::BobExecutionFailed(format!(
            "Inférence Bob refusée (HTTP {status}): {detail}"
        )));
    }

    let content = raw
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::BobExecutionFailed("Réponse d’inférence vide pour le titre.".into())
        })?;
    Ok(content.to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn module_compiles() {
        assert!(!super::DEFAULT_MODEL.is_empty());
    }
}
