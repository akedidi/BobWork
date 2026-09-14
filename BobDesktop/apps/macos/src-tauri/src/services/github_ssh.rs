// ============================================================
// Bob Work - GitHub SSH authentication probe
// ============================================================

use crate::error::{AppError, AppResult};
use std::process::{Command, Stdio};

pub struct GitHubSshAuth {
    pub username: String,
    pub gh_token: String,
}

/// Verifies SSH access to github.com and resolves a GitHub API token via the
/// GitHub CLI (`gh auth token`). SSH keys alone cannot drive the REST MCP tools.
pub fn probe_github_ssh_auth() -> AppResult<GitHubSshAuth> {
    let output = Command::new("ssh")
        .args([
            "-T",
            "-o",
            "BatchMode=yes",
            "-o",
            "StrictHostKeyChecking=accept-new",
            "git@github.com",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .map_err(|error| {
            AppError::ValidationFailed(format!(
                "OpenSSH indisponible ou commande ssh introuvable : {error}"
            ))
        })?;

    let combined = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let username = parse_github_ssh_username(&combined).ok_or_else(|| {
        AppError::ValidationFailed(
            "Authentification SSH GitHub impossible. Vérifiez votre clé SSH (~/.ssh) et l’accès à github.com.".into(),
        )
    })?;

    let gh_token = Command::new("gh")
        .args(["auth", "token"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .ok()
        .filter(|result| result.status.success())
        .and_then(|result| String::from_utf8(result.stdout).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            AppError::ValidationFailed(
                "GitHub CLI (gh) est requis en mode SSH pour alimenter les outils API. Installez gh puis exécutez `gh auth login` (protocole SSH).".into(),
            )
        })?;

    Ok(GitHubSshAuth {
        username,
        gh_token,
    })
}

fn parse_github_ssh_username(message: &str) -> Option<String> {
    for line in message.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed.strip_prefix("Hi ") {
            if let Some(username) = rest.split(['!', ' ']).next() {
                let username = username.trim();
                if !username.is_empty() {
                    return Some(username.to_string());
                }
            }
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::parse_github_ssh_username;

    #[test]
    fn parses_github_ssh_welcome_message() {
        let message = "Hi octocat! You've successfully authenticated, but GitHub does not provide shell access.";
        assert_eq!(
            parse_github_ssh_username(message).as_deref(),
            Some("octocat")
        );
    }
}
