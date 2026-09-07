// ============================================================
// Bob Work - Encrypted Local Secret Vault
// Persistent secrets without macOS Keychain prompts.
// ============================================================

use crate::error::{AppError, AppResult};
use aes_gcm::{
    aead::{Aead, KeyInit, OsRng},
    Aes256Gcm, Nonce,
};
use rand::RngCore;
#[cfg(test)]
use std::cell::RefCell;
use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
#[cfg(unix)]
use std::os::unix::fs::OpenOptionsExt;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tracing::info;

const VAULT_KEY_FILE: &str = ".vault.key";
const VAULT_FILE: &str = "secrets.vault";
const NONCE_LEN: usize = 12;

static DATA_DIR: Mutex<Option<PathBuf>> = Mutex::new(None);

#[cfg(test)]
thread_local! {
    static TEST_DATA_DIR: RefCell<Option<PathBuf>> = const { RefCell::new(None) };
}

pub struct SecretVaultService;

/// Backward-compatible alias while callers migrate naming.
pub type KeychainService = SecretVaultService;

pub fn init_secret_vault(data_dir: &Path) {
    #[cfg(test)]
    {
        TEST_DATA_DIR.with(|dir| *dir.borrow_mut() = Some(data_dir.to_path_buf()));
    }
    #[cfg(not(test))]
    {
        let mut guard = DATA_DIR.lock().unwrap_or_else(|error| error.into_inner());
        if guard.is_none() {
            *guard = Some(data_dir.to_path_buf());
        }
    }
    if let Err(error) = SecretVaultService::migrate_legacy_sources() {
        tracing::warn!("Unable to migrate legacy secret storage: {}", error);
    }
}

impl SecretVaultService {
    pub fn new() -> Self {
        Self
    }

    fn data_dir() -> AppResult<PathBuf> {
        #[cfg(test)]
        {
            if let Some(path) = TEST_DATA_DIR.with(|dir| dir.borrow().clone()) {
                return Ok(path);
            }
        }

        DATA_DIR
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clone()
            .ok_or_else(|| AppError::Security("Secret vault is not initialized".into()))
    }

    fn key_path() -> AppResult<PathBuf> {
        Ok(Self::data_dir()?.join(VAULT_KEY_FILE))
    }

    fn vault_path() -> AppResult<PathBuf> {
        Ok(Self::data_dir()?.join(VAULT_FILE))
    }

    fn legacy_home_plaintext_path() -> Option<PathBuf> {
        dirs::home_dir().map(|home| home.join(".bobwork_secrets.json"))
    }

    fn load_or_create_key() -> AppResult<[u8; 32]> {
        let path = Self::key_path()?;
        if path.exists() {
            let mut bytes = vec![];
            File::open(&path)
                .and_then(|mut file| file.read_to_end(&mut bytes))
                .map_err(|error| {
                    AppError::Io(format!("Impossible de lire la clé du coffre : {}", error))
                })?;
            if bytes.len() == 32 {
                let mut key = [0_u8; 32];
                key.copy_from_slice(&bytes);
                return Ok(key);
            }
            return Err(AppError::Security(
                "La clé locale du coffre est invalide.".into(),
            ));
        }

        std::fs::create_dir_all(Self::data_dir()?).map_err(|error| {
            AppError::Io(format!(
                "Impossible de préparer le dossier de secrets : {}",
                error
            ))
        })?;

        let mut key = [0_u8; 32];
        OsRng.fill_bytes(&mut key);

        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);

        let mut file = options.open(&path).map_err(|error| {
            AppError::Io(format!("Impossible de créer la clé du coffre : {}", error))
        })?;
        file.write_all(&key).map_err(|error| {
            AppError::Io(format!("Impossible d’écrire la clé du coffre : {}", error))
        })?;
        Ok(key)
    }

    fn cipher() -> AppResult<Aes256Gcm> {
        Ok(
            Aes256Gcm::new_from_slice(&Self::load_or_create_key()?).map_err(|error| {
                AppError::Security(format!(
                    "Impossible d’initialiser le coffre chiffré : {}",
                    error
                ))
            })?,
        )
    }

    fn read_secrets() -> AppResult<HashMap<String, String>> {
        let path = Self::vault_path()?;
        if !path.exists() {
            return Ok(HashMap::new());
        }

        let mut blob = vec![];
        File::open(&path)
            .and_then(|mut file| file.read_to_end(&mut blob))
            .map_err(|error| {
                AppError::Io(format!("Impossible de lire le coffre chiffré : {}", error))
            })?;

        if blob.len() <= NONCE_LEN {
            return Err(AppError::Security("Le coffre chiffré est corrompu.".into()));
        }

        let (nonce_bytes, ciphertext) = blob.split_at(NONCE_LEN);
        let nonce = Nonce::from_slice(nonce_bytes);
        let plaintext = Self::cipher()?
            .decrypt(nonce, ciphertext)
            .map_err(|_| AppError::Security("Impossible de déchiffrer le coffre local.".into()))?;

        serde_json::from_slice(&plaintext).map_err(|error| {
            AppError::Serialization(format!("Contenu du coffre local invalide : {}", error))
        })
    }

    fn write_secrets(map: &HashMap<String, String>) -> AppResult<()> {
        std::fs::create_dir_all(Self::data_dir()?).map_err(|error| {
            AppError::Io(format!(
                "Impossible de préparer le dossier de secrets : {}",
                error
            ))
        })?;

        let plaintext = serde_json::to_vec(map).map_err(|error| {
            AppError::Serialization(format!(
                "Impossible de sérialiser le coffre local : {}",
                error
            ))
        })?;

        let mut nonce_bytes = [0_u8; NONCE_LEN];
        OsRng.fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = Self::cipher()?
            .encrypt(nonce, plaintext.as_ref())
            .map_err(|error| {
                AppError::Security(format!("Impossible de chiffrer le coffre : {}", error))
            })?;

        let mut blob = Vec::with_capacity(NONCE_LEN + ciphertext.len());
        blob.extend_from_slice(&nonce_bytes);
        blob.extend_from_slice(&ciphertext);

        let path = Self::vault_path()?;
        let mut options = OpenOptions::new();
        options.write(true).create(true).truncate(true);
        #[cfg(unix)]
        options.mode(0o600);

        let mut file = options.open(&path).map_err(|error| {
            AppError::Io(format!(
                "Impossible de sauvegarder le coffre chiffré : {}",
                error
            ))
        })?;
        file.write_all(&blob).map_err(|error| {
            AppError::Io(format!("Erreur d’écriture du coffre chiffré : {}", error))
        })?;
        Ok(())
    }

    fn import_plaintext_map(map: HashMap<String, String>) -> AppResult<()> {
        if map.is_empty() {
            return Ok(());
        }
        let mut secrets = Self::read_secrets().unwrap_or_default();
        secrets.extend(map);
        Self::write_secrets(&secrets)
    }

    pub fn migrate_legacy_sources() -> AppResult<()> {
        if let Some(path) = Self::legacy_home_plaintext_path() {
            if path.exists() {
                let content = std::fs::read_to_string(&path).map_err(|error| {
                    AppError::Io(format!(
                        "Impossible de lire l’ancien fichier de secrets : {}",
                        error
                    ))
                })?;
                if let Ok(map) = serde_json::from_str::<HashMap<String, String>>(&content) {
                    Self::import_plaintext_map(map)?;
                    info!("Migrated legacy plaintext secrets from home directory");
                }
                let _ = std::fs::remove_file(path);
            }
        }

        let legacy_vault = Self::data_dir()?.join("bob-api-vault.json");
        if legacy_vault.exists() {
            let _ = std::fs::remove_file(legacy_vault);
            info!("Removed unsupported legacy bob-api-vault.json file");
        }

        Ok(())
    }

    pub fn set(&self, account: &str, secret: &str) -> AppResult<()> {
        let mut map = Self::read_secrets()?;
        map.insert(account.to_string(), secret.to_string());
        Self::write_secrets(&map)?;
        info!(
            "Stored secret for account '{}' in encrypted local vault",
            account
        );
        Ok(())
    }

    pub fn get(&self, account: &str) -> AppResult<Option<String>> {
        let map = Self::read_secrets()?;
        Ok(map.get(account).cloned())
    }

    pub fn delete(&self, account: &str) -> AppResult<()> {
        let mut map = Self::read_secrets()?;
        if map.remove(account).is_some() {
            if map.is_empty() {
                if let Ok(path) = Self::vault_path() {
                    let _ = std::fs::remove_file(path);
                }
            } else {
                Self::write_secrets(&map)?;
            }
            info!(
                "Deleted secret for account '{}' from encrypted local vault",
                account
            );
        }
        Ok(())
    }

    pub fn exists(&self, account: &str) -> bool {
        self.get(account)
            .ok()
            .flatten()
            .is_some_and(|value| !value.trim().is_empty())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_vault() -> PathBuf {
        std::env::temp_dir().join(format!("bob-work-vault-test-{}", uuid::Uuid::new_v4()))
    }

    #[test]
    fn stores_secrets_in_encrypted_vault_without_plaintext_on_disk() {
        let root = temp_vault();
        init_secret_vault(&root);
        let vault = SecretVaultService::new();

        vault.set("ibm_api_key", "secret-value").unwrap();
        assert!(vault.exists("ibm_api_key"));
        assert_eq!(
            vault.get("ibm_api_key").unwrap().as_deref(),
            Some("secret-value")
        );

        let vault_bytes = std::fs::read(root.join(VAULT_FILE)).unwrap();
        assert!(!String::from_utf8_lossy(&vault_bytes).contains("secret-value"));

        vault.delete("ibm_api_key").unwrap();
        assert!(!vault.exists("ibm_api_key"));
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn migrates_legacy_plaintext_map_into_vault() {
        let root = temp_vault();
        init_secret_vault(&root);
        SecretVaultService::import_plaintext_map(HashMap::from([(
            "integration_github".to_string(),
            "legacy-token".to_string(),
        )]))
        .unwrap();

        let vault = SecretVaultService::new();
        assert_eq!(
            vault.get("integration_github").unwrap().as_deref(),
            Some("legacy-token")
        );
        let _ = std::fs::remove_dir_all(root);
    }
}
