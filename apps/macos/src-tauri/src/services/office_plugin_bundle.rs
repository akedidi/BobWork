use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const OFFICE_MCP_SCRIPT: &str = include_str!("../../resources/office/office_mcp.py");
const CTO_MARKET_LIB: &str = include_str!("../../resources/finance/cto_market.py");
const CTO_MCP_SERVER: &str = include_str!("../../resources/finance/mcp/server.py");
const CTO_CLI_SCRIPT: &str = include_str!("../../resources/finance/scripts/screen_cto.py");
const IBM_PURSUIT_LIB: &str = include_str!("../../resources/consulting/ibm_pursuit.py");
const IBM_PURSUIT_MCP_SERVER: &str = include_str!("../../resources/consulting/mcp/server.py");
const IBM_PURSUIT_CLI_SCRIPT: &str =
    include_str!("../../resources/consulting/scripts/brief_pursuit.py");

pub struct OfficePluginBundle;

impl OfficePluginBundle {
    pub fn is_office_bundle(manifest: &Value) -> bool {
        Self::mcp_script_for(manifest).is_some()
            || Self::is_cto_bundle(manifest)
            || Self::is_ibm_pursuit_bundle(manifest)
    }

    fn is_cto_bundle(manifest: &Value) -> bool {
        Self::mcp_env_contains(manifest, "BOB_CTO_INVEST")
    }

    fn is_ibm_pursuit_bundle(manifest: &Value) -> bool {
        Self::mcp_env_contains(manifest, "BOB_IBM_PURSUIT")
    }

    fn is_python_work_bundle(manifest: &Value) -> bool {
        Self::is_cto_bundle(manifest) || Self::is_ibm_pursuit_bundle(manifest)
    }

    fn mcp_env_contains(manifest: &Value, key: &str) -> bool {
        let Some(servers) = manifest.get("mcpServers").and_then(Value::as_object) else {
            return false;
        };
        servers.values().any(|server| {
            server
                .get("env")
                .and_then(Value::as_object)
                .is_some_and(|env| env.contains_key(key))
        })
    }

    fn mcp_script_for(manifest: &Value) -> Option<&'static str> {
        if Self::is_python_work_bundle(manifest) {
            return None;
        }
        let servers = manifest.get("mcpServers")?.as_object()?;
        if servers.is_empty() {
            return None;
        }
        for server in servers.values() {
            let Some(env) = server.get("env").and_then(Value::as_object) else {
                continue;
            };
            if env.contains_key("BOB_OFFICE_KIND") {
                return Some(OFFICE_MCP_SCRIPT);
            }
        }
        // Legacy office builtins: specializedMode + mcpServers without env markers.
        if manifest
            .get("specializedMode")
            .and_then(Value::as_object)
            .is_some()
        {
            return Some(OFFICE_MCP_SCRIPT);
        }
        None
    }

    pub fn write_bundle(
        skill_dir: &Path,
        plugin_id: &str,
        manifest: &Value,
        overwrite_embedded: bool,
    ) -> AppResult<()> {
        if Self::is_cto_bundle(manifest) {
            return Self::write_cto_python_bundle(
                skill_dir,
                plugin_id,
                manifest,
                overwrite_embedded,
            );
        }
        if Self::is_ibm_pursuit_bundle(manifest) {
            return Self::write_ibm_pursuit_python_bundle(
                skill_dir,
                plugin_id,
                manifest,
                overwrite_embedded,
            );
        }

        let Some(script) = Self::mcp_script_for(manifest) else {
            return Ok(());
        };

        let mcp_dir = skill_dir.join("mcp");
        std::fs::create_dir_all(&mcp_dir).map_err(|error| {
            AppError::Plugin(format!("Failed to create office MCP directory: {}", error))
        })?;

        let mcp_path = mcp_dir.join("server.py");
        Self::write_executable(&mcp_path, script, overwrite_embedded)?;

        let plugin_json = Self::manifest_to_plugin_json(plugin_id, manifest);
        std::fs::write(
            skill_dir.join(".bob-work-plugin.json"),
            serde_json::to_string_pretty(&plugin_json).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to serialize office plugin manifest: {}",
                    error
                ))
            })?,
        )
        .map_err(|error| {
            AppError::Plugin(format!("Failed to write .bob-work-plugin.json: {}", error))
        })?;

        Ok(())
    }

    fn write_cto_python_bundle(
        skill_dir: &Path,
        plugin_id: &str,
        manifest: &Value,
        overwrite_embedded: bool,
    ) -> AppResult<()> {
        std::fs::create_dir_all(skill_dir.join("mcp")).map_err(|error| {
            AppError::Plugin(format!("Failed to create CTO MCP directory: {}", error))
        })?;
        std::fs::create_dir_all(skill_dir.join("scripts")).map_err(|error| {
            AppError::Plugin(format!("Failed to create CTO scripts directory: {}", error))
        })?;

        Self::write_executable(
            &skill_dir.join("cto_market.py"),
            CTO_MARKET_LIB,
            overwrite_embedded,
        )?;
        Self::write_executable(
            &skill_dir.join("mcp/server.py"),
            CTO_MCP_SERVER,
            overwrite_embedded,
        )?;
        Self::write_executable(
            &skill_dir.join("scripts/screen_cto.py"),
            CTO_CLI_SCRIPT,
            overwrite_embedded,
        )?;

        let plugin_json = Self::manifest_to_plugin_json(plugin_id, manifest);
        std::fs::write(
            skill_dir.join(".bob-work-plugin.json"),
            serde_json::to_string_pretty(&plugin_json).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to serialize CTO plugin manifest: {}",
                    error
                ))
            })?,
        )
        .map_err(|error| {
            AppError::Plugin(format!("Failed to write .bob-work-plugin.json: {}", error))
        })?;

        // Keep the deploy marker so agentic sync does not re-import this builtin
        // as agentic-<slug>.
        let _ = std::fs::write(skill_dir.join(".bob-work-plugin-id"), plugin_id);

        Ok(())
    }

    fn write_ibm_pursuit_python_bundle(
        skill_dir: &Path,
        plugin_id: &str,
        manifest: &Value,
        overwrite_embedded: bool,
    ) -> AppResult<()> {
        std::fs::create_dir_all(skill_dir.join("mcp")).map_err(|error| {
            AppError::Plugin(format!(
                "Failed to create IBM Pursuit MCP directory: {}",
                error
            ))
        })?;
        std::fs::create_dir_all(skill_dir.join("scripts")).map_err(|error| {
            AppError::Plugin(format!(
                "Failed to create IBM Pursuit scripts directory: {}",
                error
            ))
        })?;

        Self::write_executable(
            &skill_dir.join("ibm_pursuit.py"),
            IBM_PURSUIT_LIB,
            overwrite_embedded,
        )?;
        Self::write_executable(
            &skill_dir.join("mcp/server.py"),
            IBM_PURSUIT_MCP_SERVER,
            overwrite_embedded,
        )?;
        Self::write_executable(
            &skill_dir.join("scripts/brief_pursuit.py"),
            IBM_PURSUIT_CLI_SCRIPT,
            overwrite_embedded,
        )?;

        let plugin_json = Self::manifest_to_plugin_json(plugin_id, manifest);
        std::fs::write(
            skill_dir.join(".bob-work-plugin.json"),
            serde_json::to_string_pretty(&plugin_json).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to serialize IBM Pursuit plugin manifest: {}",
                    error
                ))
            })?,
        )
        .map_err(|error| {
            AppError::Plugin(format!("Failed to write .bob-work-plugin.json: {}", error))
        })?;
        let _ = std::fs::write(skill_dir.join(".bob-work-plugin-id"), plugin_id);
        Ok(())
    }

    fn write_executable(path: &Path, contents: &str, overwrite: bool) -> AppResult<()> {
        if path.exists() && !overwrite {
            return Ok(());
        }
        std::fs::write(path, contents).map_err(|error| {
            AppError::Plugin(format!("Failed to write {}: {}", path.display(), error))
        })?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(path) {
                let mut permissions = metadata.permissions();
                permissions.set_mode(0o755);
                let _ = std::fs::set_permissions(path, permissions);
            }
        }
        Ok(())
    }

    fn manifest_to_plugin_json(plugin_id: &str, manifest: &Value) -> Value {
        let slug = manifest
            .get("slug")
            .and_then(Value::as_str)
            .unwrap_or(plugin_id);
        let default_category = if Self::is_python_work_bundle(manifest) {
            "executable"
        } else {
            "recipe"
        };
        let default_runtime = if Self::is_python_work_bundle(manifest) {
            json!({"python": ">=3.9", "cli": true, "mcp": true})
        } else {
            json!({"python": ">=3.9", "mcp": true})
        };
        json!({
            "schemaVersion": 1,
            "name": manifest.get("name").cloned().unwrap_or_else(|| json!(plugin_id)),
            "slug": slug,
            "version": manifest.get("version").cloned().unwrap_or_else(|| json!("1.1.0")),
            "description": manifest.get("description").cloned().unwrap_or(Value::Null),
            "category": manifest.get("category").cloned().unwrap_or_else(|| json!(default_category)),
            "builtin": manifest.get("builtin").cloned().unwrap_or_else(|| {
                json!(plugin_id.starts_with("builtin-"))
            }),
            "permissions": manifest.get("permissions").cloned().unwrap_or_else(|| json!([])),
            "outputFormats": manifest.get("outputFormats").cloned().unwrap_or(Value::Null),
            "fileExtensions": manifest.get("fileExtensions").cloned().unwrap_or(Value::Null),
            "specializedMode": manifest.get("specializedMode").cloned().unwrap_or(Value::Null),
            "runtime": manifest.get("runtime").cloned().unwrap_or(default_runtime),
            "entrypoints": manifest.get("entrypoints").cloned().unwrap_or_else(|| {
                if Self::is_cto_bundle(manifest) {
                    json!([
                        {"name": "screen", "runtime": "python3", "path": "scripts/screen_cto.py"},
                        {"name": "mcp", "runtime": "python3", "path": "mcp/server.py"}
                    ])
                } else if Self::is_ibm_pursuit_bundle(manifest) {
                    json!([
                        {"name": "brief", "runtime": "python3", "path": "scripts/brief_pursuit.py"},
                        {"name": "mcp", "runtime": "python3", "path": "mcp/server.py"}
                    ])
                } else {
                    Value::Null
                }
            }),
            "mcpServers": manifest.get("mcpServers").cloned().unwrap_or_else(|| json!({})),
            "connectorStrategy": manifest.get("connectorStrategy").cloned().unwrap_or(Value::Null),
            "resources": manifest.get("resources").cloned().unwrap_or(Value::Null),
            "integrations": manifest
                .get("integrations")
                .cloned()
                .filter(|value| !value.is_null())
                .unwrap_or_else(|| json!([])),
            "releaseNotes": manifest.get("releaseNotes").cloned().unwrap_or(Value::Null),
        })
    }

    pub fn skill_dir_for_manifest(manifest: &Value) -> AppResult<PathBuf> {
        let slug = manifest
            .get("slug")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Plugin("Office plugin manifest is missing slug".into()))?;
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home.join(".bob").join("skills").join(slug))
    }
}

#[cfg(test)]
mod tests {
    use super::OfficePluginBundle;
    use serde_json::json;
    use std::fs;

    #[test]
    fn writes_office_mcp_bundle_for_specialized_plugins() {
        let temp =
            std::env::temp_dir().join(format!("bob-work-office-bundle-{}", uuid::Uuid::new_v4()));
        let manifest = json!({
            "name": "Microsoft Word",
            "slug": "bob-work-microsoft-word-test",
            "version": "1.1.0",
            "description": "Word",
            "category": "recipe",
            "permissions": [{"type":"file.read"},{"type":"file.write"},{"type":"mcp.connect"},{"type":"command.execute"}],
            "specializedMode": {"label": "Mode Word"},
            "mcpServers": {
                "office-tools": {
                    "displayName": "Outils Word locaux",
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "env": {"BOB_OFFICE_KIND": "word"},
                    "tools": ["inspect_docx"]
                }
            }
        });
        OfficePluginBundle::write_bundle(&temp, "builtin-word", &manifest, true).expect("bundle");
        assert!(temp.join("mcp/server.py").is_file());
        assert!(temp.join(".bob-work-plugin.json").is_file());
        let script = fs::read_to_string(temp.join("mcp/server.py")).expect("script");
        assert!(script.contains("inspect_docx") || script.contains("OFFICE_KIND"));
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn writes_cto_python_plugin_bundle_with_cli_and_mcp() {
        let temp =
            std::env::temp_dir().join(format!("bob-work-cto-bundle-{}", uuid::Uuid::new_v4()));
        let manifest = json!({
            "name": "CTO Investissements",
            "slug": "bob-work-cto-invest-test",
            "version": "1.1.0",
            "category": "executable",
            "builtin": false,
            "runtime": {"python": ">=3.9", "cli": true, "mcp": true},
            "entrypoints": [
                {"name": "screen", "runtime": "python3", "path": "scripts/screen_cto.py"},
                {"name": "mcp", "runtime": "python3", "path": "mcp/server.py"}
            ],
            "mcpServers": {
                "cto-market": {
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "env": {"BOB_CTO_INVEST": "1"},
                    "tools": ["cto_market_snapshot", "cto_screen_ideas"]
                }
            }
        });
        OfficePluginBundle::write_bundle(&temp, "bob-work-cto-invest", &manifest, true)
            .expect("bundle");
        assert!(temp.join("cto_market.py").is_file());
        assert!(temp.join("scripts/screen_cto.py").is_file());
        assert!(temp.join("mcp/server.py").is_file());
        assert_eq!(
            fs::read_to_string(temp.join(".bob-work-plugin-id")).expect("plugin id"),
            "bob-work-cto-invest"
        );
        let script = fs::read_to_string(temp.join("mcp/server.py")).expect("script");
        assert!(script.contains("cto_screen_ideas"));
        assert!(script.contains("import cto_market"));
        let plugin_json: serde_json::Value =
            serde_json::from_str(&fs::read_to_string(temp.join(".bob-work-plugin.json")).unwrap())
                .unwrap();
        assert_eq!(plugin_json["category"], "executable");
        assert!(plugin_json["entrypoints"].as_array().unwrap().len() >= 2);

        fs::write(temp.join("cto_market.py"), "# keep-custom\n").expect("custom");
        OfficePluginBundle::write_bundle(&temp, "bob-work-cto-invest", &manifest, false)
            .expect("preserve");
        assert_eq!(
            fs::read_to_string(temp.join("cto_market.py")).expect("read"),
            "# keep-custom\n"
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn writes_ibm_pursuit_python_plugin_bundle_with_cli_and_mcp() {
        let temp = std::env::temp_dir().join(format!(
            "bob-work-ibm-pursuit-bundle-{}",
            uuid::Uuid::new_v4()
        ));
        let manifest = json!({
            "name": "Brief Mission IBM",
            "slug": "bob-work-ibm-pursuit-test",
            "version": "1.0.0",
            "category": "executable",
            "builtin": false,
            "mcpServers": {
                "ibm-pursuit": {
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "env": {"BOB_IBM_PURSUIT": "1"},
                    "tools": ["ibm_connector_status", "ibm_client_snapshot", "ibm_screen_plays"]
                }
            }
        });
        OfficePluginBundle::write_bundle(&temp, "bob-work-ibm-pursuit", &manifest, true)
            .expect("bundle");
        assert!(temp.join("ibm_pursuit.py").is_file());
        assert!(temp.join("scripts/brief_pursuit.py").is_file());
        assert!(temp.join("mcp/server.py").is_file());
        let script = fs::read_to_string(temp.join("mcp/server.py")).expect("script");
        assert!(script.contains("ibm_screen_plays"));
        assert!(script.contains("import ibm_pursuit"));
        assert!(!script.to_lowercase().contains("slack.com"));
        let _ = fs::remove_dir_all(temp);
    }
}
