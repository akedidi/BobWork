use crate::error::{AppError, AppResult};
use std::path::{Path, PathBuf};

/// Validate that a path is safe (no traversal into sensitive areas) and, when
/// `allowed_roots` is non-empty, that it stays inside one of those roots.
pub fn validate_path(path: &Path, allowed_roots: &[PathBuf]) -> AppResult<PathBuf> {
    let canonical = resolve_canonical(path)?;

    // Defense in depth: reject any remaining `..` in the display form.
    let path_str = canonical.to_string_lossy();
    if path_str.split('/').any(|segment| segment == "..") {
        return Err(AppError::Security("Path traversal detected".to_string()));
    }

    if !allowed_roots.is_empty() {
        let roots = canonicalize_roots(allowed_roots)?;
        let allowed = roots.iter().any(|root| canonical.starts_with(root));
        if !allowed {
            return Err(AppError::Security(format!(
                "Path is outside allowed directories: {}",
                canonical.display()
            )));
        }
    }

    if is_sensitive_file(&canonical) {
        return Err(AppError::Security(format!(
            "Access to sensitive file denied: {}",
            canonical.file_name().unwrap_or_default().to_string_lossy()
        )));
    }

    Ok(canonical)
}

/// Resolve an existing path (or its parent for not-yet-created files) to a
/// canonical absolute path.
pub fn resolve_canonical(path: &Path) -> AppResult<PathBuf> {
    if path.exists() {
        return path
            .canonicalize()
            .map_err(|e| AppError::Security(format!("Cannot resolve path: {}", e)));
    }
    let parent = path.parent().unwrap_or(path);
    if !parent.exists() {
        return Err(AppError::Security(
            "Parent directory does not exist".to_string(),
        ));
    }
    let canonical_parent = parent
        .canonicalize()
        .map_err(|e| AppError::Security(format!("Cannot resolve parent path: {}", e)))?;
    Ok(canonical_parent.join(path.file_name().unwrap_or_default()))
}

fn canonicalize_roots(roots: &[PathBuf]) -> AppResult<Vec<PathBuf>> {
    roots
        .iter()
        .map(|root| {
            if root.exists() {
                root.canonicalize()
                    .map_err(|e| AppError::Security(format!("Cannot resolve allowed root: {}", e)))
            } else {
                Ok(root.clone())
            }
        })
        .collect()
}

/// Check if a file/directory is considered sensitive and must not be exposed to Bob.
pub fn is_sensitive_file(path: &Path) -> bool {
    let path_str = path.to_string_lossy().to_lowercase();

    let sensitive_patterns = [
        "/.ssh/",
        "/.ssh",
        "/.gnupg/",
        "/.gnupg",
        "/.aws/credentials",
        "/.config/gcloud",
        "/library/keychains/",
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
        "secrets.vault",
        ".vault.key",
    ];

    sensitive_patterns
        .iter()
        .any(|pattern| path_str.contains(pattern))
}

/// Validate that a symlink target (if any) stays within allowed roots.
pub fn validate_symlink(path: &Path, allowed_roots: &[PathBuf]) -> AppResult<()> {
    let meta = std::fs::symlink_metadata(path)
        .map_err(|e| AppError::Security(format!("Cannot inspect path metadata: {}", e)))?;
    if !meta.file_type().is_symlink() {
        return Ok(());
    }

    let target = std::fs::read_link(path)
        .map_err(|e| AppError::Security(format!("Cannot read symlink: {}", e)))?;
    let resolved = if target.is_absolute() {
        target
    } else {
        path.parent().unwrap_or(path).join(target)
    };

    // Resolve through the symlink and enforce the same root / sensitivity rules.
    let _ = validate_path(&resolved, allowed_roots)?;
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
        assert!(is_sensitive_file(Path::new(
            "/Users/x/Library/Keychains/login.keychain-db"
        )));
        assert!(!is_sensitive_file(Path::new("/home/user/document.pdf")));
        assert!(!is_sensitive_file(Path::new("/home/user/data.csv")));
    }

    #[test]
    fn rejects_path_outside_allowed_root() {
        let tmp = std::env::temp_dir();
        let allowed = tmp.join(format!("allowed-{}", uuid::Uuid::new_v4()));
        let outside = tmp.join(format!("outside-{}.txt", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::write(&outside, "x").unwrap();
        let result = validate_path(&outside, &[allowed.clone()]);
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&allowed);
        assert!(result.is_err());
    }
}
