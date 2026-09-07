use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const CODEGRAPH_MCP_NAME: &str = "bob-work-codegraph";
pub const CODEGRAPH_RUNTIME_ID: &str = "external.codegraph";
pub const CODEGRAPH_RUNTIME_VERSION: &str = "tree-sitter-language-pack-1.16.1";
const CODEGRAPH_MCP_SCRIPT: &str = include_str!("../../resources/codegraph/codegraph_mcp.py");

pub struct CodeGraphMcpService;

impl CodeGraphMcpService {
    pub fn bundle_dir() -> AppResult<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home.join(".bob").join("resources").join("codegraph"))
    }

    pub fn runtime_root() -> AppResult<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home
            .join(".bob")
            .join("runtimes")
            .join("external")
            .join("codegraph")
            .join(CODEGRAPH_RUNTIME_VERSION))
    }

    pub fn ensure_bundle() -> AppResult<PathBuf> {
        let bundle = Self::bundle_dir()?;
        std::fs::create_dir_all(&bundle)?;
        let target = bundle.join("server.py");
        // Atomic replacement prevents Bob Shell from observing a partial MCP
        // server during an application update.
        let candidate = bundle.join(".server.py.next");
        std::fs::write(&candidate, CODEGRAPH_MCP_SCRIPT)?;
        std::fs::rename(candidate, &target)?;
        Ok(bundle)
    }

    pub fn mcp_config(bundle: &Path, runtime_root: &Path) -> Value {
        json!({
            "command": "python3",
            "args": ["server.py"],
            "cwd": bundle.to_string_lossy(),
            "env": {
                "BOB_CODEGRAPH_RUNTIME_ROOT": runtime_root.to_string_lossy(),
                "PYTHONPATH": runtime_root.join("python").to_string_lossy(),
                "PYTHONNOUSERSITE": "1"
            }
        })
    }

    pub fn sync(&self, bob_path: &str) -> AppResult<()> {
        let bundle = Self::ensure_bundle()?;
        let runtime = Self::runtime_root()?;
        let config = Self::mcp_config(&bundle, &runtime);
        run_bob(
            bob_path,
            &[
                "mcp",
                "add-json",
                "--scope",
                "global",
                CODEGRAPH_MCP_NAME,
                &config.to_string(),
            ],
        )?;
        run_bob(
            bob_path,
            &["mcp", "enable", CODEGRAPH_MCP_NAME, "--scope", "global"],
        )
    }
}

fn run_bob(bob_path: &str, args: &[&str]) -> AppResult<()> {
    let output = Command::new(bob_path)
        .args(args)
        .output()
        .map_err(|error| AppError::BobExecutionFailed(error.to_string()))?;
    if output.status.success() {
        return Ok(());
    }
    let message = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::BobExecutionFailed(if message.is_empty() {
        format!("Bob MCP command failed with status {}", output.status)
    } else {
        message
    }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_exposes_complete_codegraph_toolset() {
        for tool in [
            "codegraph_status",
            "codegraph_index",
            "codegraph_search",
            "codegraph_symbol",
            "codegraph_callers",
            "codegraph_callees",
            "codegraph_impact",
            "codegraph_delete_index",
        ] {
            assert!(CODEGRAPH_MCP_SCRIPT.contains(tool), "missing {tool}");
        }
        assert!(CODEGRAPH_MCP_SCRIPT.contains("tree_sitter_language_pack"));
        assert!(CODEGRAPH_MCP_SCRIPT.contains("semanticScore"));
    }

    #[test]
    fn config_points_at_managed_runtime_without_host_site_packages() {
        let config =
            CodeGraphMcpService::mcp_config(Path::new("/tmp/codegraph"), Path::new("/tmp/runtime"));
        assert_eq!(config["command"], "python3");
        assert_eq!(config["env"]["BOB_CODEGRAPH_RUNTIME_ROOT"], "/tmp/runtime");
        assert_eq!(config["env"]["PYTHONPATH"], "/tmp/runtime/python");
        assert_eq!(config["env"]["PYTHONNOUSERSITE"], "1");
    }
}
