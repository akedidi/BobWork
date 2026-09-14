use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Command;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrcaCliStatus {
    pub installed: bool,
    pub path: Option<String>,
    pub supports_skills_get: bool,
    pub message: String,
}

pub struct OrcaCliService;

impl OrcaCliService {
    pub fn new() -> Self {
        Self
    }

    pub fn status(&self) -> OrcaCliStatus {
        let candidates = Self::candidate_paths();
        for path in candidates {
            if !path.is_file() || Self::is_gui_app_executable(&path) {
                continue;
            }
            let path_str = path.to_string_lossy().to_string();
            if Self::looks_like_gnome_orca(&path_str) {
                continue;
            }
            match Self::probe_orca_cli(&path_str) {
                ProbeResult::Ok { supports_skills_get } => {
                    return OrcaCliStatus {
                        installed: true,
                        path: Some(path_str),
                        supports_skills_get,
                        message: if supports_skills_get {
                            "Orca CLI detected. Use @skill:orca-cli or @skill:orchestration.".into()
                        } else {
                            "Orca CLI detected (older build). Update Orca for `skills get` guides.".into()
                        },
                    };
                }
                ProbeResult::Rejected => continue,
            }
        }

        OrcaCliStatus {
            installed: false,
            path: None,
            supports_skills_get: false,
            message: "Orca CLI not found. Install Orca to use @skill:orca-cli and @skill:orchestration.".into(),
        }
    }

    fn candidate_paths() -> Vec<PathBuf> {
        let mut paths = Vec::new();
        if let Ok(path) = which_orca_on_path() {
            Self::push_unique(&mut paths, PathBuf::from(path));
        }
        if let Some(home) = dirs::home_dir() {
            Self::push_unique(&mut paths, home.join(".orca/bin/orca"));
            Self::push_unique(&mut paths, home.join(".local/bin/orca"));
        }
        Self::push_unique(&mut paths, PathBuf::from("/opt/homebrew/bin/orca"));
        Self::push_unique(&mut paths, PathBuf::from("/usr/local/bin/orca"));
        #[cfg(target_os = "macos")]
        {
            Self::push_unique(
                &mut paths,
                PathBuf::from("/Applications/Orca.app/Contents/Resources/bin/orca"),
            );
            Self::push_unique(
                &mut paths,
                PathBuf::from("/Applications/Codex.app/Contents/Resources/bin/orca"),
            );
        }
        paths
    }

    fn push_unique(paths: &mut Vec<PathBuf>, path: PathBuf) {
        if !paths.contains(&path) {
            paths.push(path);
        }
    }

    fn is_gui_app_executable(path: &Path) -> bool {
        let raw = path.to_string_lossy().replace('\\', "/");
        if is_app_bundle_gui_path(&raw) {
            return true;
        }
        path.canonicalize()
            .ok()
            .is_some_and(|resolved| is_app_bundle_gui_path(&resolved.to_string_lossy().replace('\\', "/")))
    }

    fn looks_like_gnome_orca(path: &str) -> bool {
        std::env::consts::OS == "linux"
            && (path == "/usr/bin/orca" || path.ends_with("/bin/orca"))
    }

    /// Probe with `--help` only. `orca status` talks to the running app and
    /// executing `*.app/Contents/MacOS/orca` launches the GUI.
    fn probe_orca_cli(path: &str) -> ProbeResult {
        let output = Command::new(path).args(["--help"]).output().ok();
        let Some(output) = output else {
            return ProbeResult::Rejected;
        };
        let stdout = String::from_utf8_lossy(&output.stdout);
        let stderr = String::from_utf8_lossy(&output.stderr);
        let combined = format!("{stdout}{stderr}");
        let combined_lower = combined.to_ascii_lowercase();
        if combined_lower.contains("screen reader") || combined_lower.contains("speech") {
            return ProbeResult::Rejected;
        }
        if !looks_like_orca_cli_help(&combined_lower) {
            return ProbeResult::Rejected;
        }
        ProbeResult::Ok {
            supports_skills_get: help_supports_skills_get(&combined_lower),
        }
    }
}

fn is_app_bundle_gui_path(path: &str) -> bool {
    path.contains(".app/Contents/MacOS/")
}

fn looks_like_orca_cli_help(help: &str) -> bool {
    (help.contains("worktree") || help.contains("skills") || help.contains("orca"))
        && !help.contains("screen reader")
}

fn help_supports_skills_get(help: &str) -> bool {
    help.contains("skills get") || help.contains("skills")
}

enum ProbeResult {
    Ok { supports_skills_get: bool },
    Rejected,
}

fn which_orca_on_path() -> Result<String, ()> {
    let output = Command::new("sh")
        .arg("-lc")
        .arg("command -v orca")
        .output()
        .map_err(|_| ())?;
    if !output.status.success() {
        return Err(());
    }
    let path = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if path.is_empty() {
        Err(())
    } else {
        Ok(path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_returns_structured_message_when_missing() {
        let status = OrcaCliService::new().status();
        assert!(!status.message.is_empty());
    }

    #[test]
    fn skips_macos_app_bundle_gui_executables() {
        assert!(is_app_bundle_gui_path("/Applications/Orca.app/Contents/MacOS/orca"));
        assert!(is_app_bundle_gui_path("/Applications/Orca.app/Contents/MacOS/Orca"));
        assert!(is_app_bundle_gui_path("/Applications/Codex.app/Contents/MacOS/orca"));
        assert!(!is_app_bundle_gui_path(
            "/Applications/Orca.app/Contents/Resources/bin/orca"
        ));
        assert!(!is_app_bundle_gui_path("/opt/homebrew/bin/orca"));
        assert!(OrcaCliService::is_gui_app_executable(Path::new(
            "/Applications/Orca.app/Contents/MacOS/orca"
        )));
    }

    #[test]
    fn candidate_paths_never_include_app_macos_executables() {
        for path in OrcaCliService::candidate_paths() {
            assert!(
                !is_app_bundle_gui_path(&path.to_string_lossy().replace('\\', "/")),
                "GUI executable should not be probed: {}",
                path.display()
            );
        }
    }

    #[test]
    fn help_text_detects_cli_and_skills() {
        let help = "usage: orca <command>\n  skills get   Print a version-matched skill guide\n  worktree ps";
        assert!(looks_like_orca_cli_help(&help.to_ascii_lowercase()));
        assert!(help_supports_skills_get(&help.to_ascii_lowercase()));
        assert!(!looks_like_orca_cli_help("gnome orca screen reader"));
    }
}
