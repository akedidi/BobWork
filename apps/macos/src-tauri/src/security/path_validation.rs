#![allow(dead_code)]
use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Validate that a path is within allowed roots and is safe
pub fn validate_path(path: &Path, allowed_roots: &[PathBuf]) -> AppResult<PathBuf> {
    // Resolve to absolute path
    let canonical = if path.exists() {
        path.canonicalize()
            .map_err(|e| AppError::Security(format!("Cannot resolve path: {}", e)))?
    } else {
        // For new files, check parent directory
        let parent = path.parent().unwrap_or(path);
        if parent.exists() {
            let canonical_parent = parent
                .canonicalize()
                .map_err(|e| AppError::Security(format!("Cannot resolve parent path: {}", e)))?;
            canonical_parent.join(path.file_name().unwrap_or_default())
        } else {
            return Err(AppError::Security(
                "Parent directory does not exist".to_string(),
            ));
        }
    };

    // Check for path traversal components
    let path_str = canonical.to_string_lossy();
    if path_str.contains("..") {
        return Err(AppError::Security("Path traversal detected".to_string()));
    }

    // Check if within allowed roots
    if !allowed_roots.is_empty() {
        let allowed = allowed_roots.iter().any(|root| canonical.starts_with(root));

        if !allowed {
            return Err(AppError::Security(format!(
                "Path is outside allowed directories: {}",
                canonical.display()
            )));
        }
    }

    // Check for sensitive file patterns
    if is_sensitive_file(&canonical) {
        return Err(AppError::Security(format!(
            "Access to sensitive file denied: {}",
            canonical.file_name().unwrap_or_default().to_string_lossy()
        )));
    }

    Ok(canonical)
}

/// Check if a file is considered sensitive
pub fn is_sensitive_file(path: &Path) -> bool {
    let path_str = path.to_string_lossy().to_lowercase();

    let sensitive_patterns = [
        "/.ssh/",
        "/.gnupg/",
        "/.aws/credentials",
        "/.config/gcloud",
        "id_rsa",
        "id_ed25519",
        "id_ecdsa",
        ".pem",
        ".key",
        ".p12",
        ".pfx",
        ".keystore",
        "keychain",
        ".env.local",
        ".env.production",
        ".env.secret",
    ];

    sensitive_patterns
        .iter()
        .any(|pattern| path_str.contains(pattern))
}

/// Validate that a symlink target is within allowed roots
pub fn validate_symlink(path: &Path, allowed_roots: &[PathBuf]) -> AppResult<()> {
    if path.is_symlink() {
        let target = std::fs::read_link(path)
            .map_err(|e| AppError::Security(format!("Cannot read symlink: {}", e)))?;

        let resolved = if target.is_absolute() {
            target.clone()
        } else {
            let parent = path.parent().unwrap_or(path);
            parent.join(&target)
        };

        if resolved.exists() {
            let canonical = resolved
                .canonicalize()
                .map_err(|e| AppError::Security(e.to_string()))?;

            if !allowed_roots.is_empty() {
                let allowed = allowed_roots.iter().any(|root| canonical.starts_with(root));
                if !allowed {
                    return Err(AppError::Security(
                        "Symlink points outside allowed directories".to_string(),
                    ));
                }
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sensitive_file_detection() {
        assert!(is_sensitive_file(Path::new("/home/user/.ssh/id_rsa")));
        assert!(is_sensitive_file(Path::new("/home/user/.aws/credentials")));
        assert!(is_sensitive_file(Path::new("/home/user/cert.pem")));
        assert!(!is_sensitive_file(Path::new("/home/user/document.pdf")));
        assert!(!is_sensitive_file(Path::new("/home/user/data.csv")));
    }
}
