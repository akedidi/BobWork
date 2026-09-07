use tauri::command;
use serde::{Serialize, Deserialize};

#[derive(Serialize, Deserialize)]
pub struct PSNProfile {
    pub account_id: String,
    pub avatar_url: String,
    pub username: String,
}

#[command]
pub async fn login_psn(app_handle: tauri::AppHandle) -> Result<PSNProfile, String> {
    // 1. Ouvre une Webview cachée sur https://my.playstation.com/
    // 2. Intercepte le cookie `npsso`
    // 3. Effectue l'échange de Token OAuth2 vers l'API d'authentification Sony
    
    // Stub de réussite
    Ok(PSNProfile {
        account_id: "7823904581".to_string(),
        username: "AsobiPlayer_Native".to_string(),
        avatar_url: "https://via.placeholder.com/150".to_string(),
    })
}
