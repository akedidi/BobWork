use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

const OFFICE_MCP_SCRIPT: &str = include_str!("../../resources/office/office_mcp.py");

pub struct OfficePluginBundle;

impl OfficePluginBundle {
    pub fn is_office_bundle(manifest: &Value) -> bool {
        manifest
            .get("mcpServers")
            .and_then(Value::as_object)
            .is_some_and(|servers| !servers.is_empty())
            && manifest
                .get("specializedMode")
                .and_then(Value::as_object)
                .is_some()
    }

    pub fn write_bundle(skill_dir: &Path, plugin_id: &str, manifest: &Value) -> AppResult<()> {
        if !Self::is_office_bundle(manifest) {
            return Ok(());
        }

        let mcp_dir = skill_dir.join("mcp");
        std::fs::create_dir_all(&mcp_dir).map_err(|error| {
            AppError::Plugin(format!("Failed to create office MCP directory: {}", error))
        })?;

        let mcp_path = mcp_dir.join("server.py");
        std::fs::write(&mcp_path, OFFICE_MCP_SCRIPT).map_err(|error| {
            AppError::Plugin(format!("Failed to write office MCP script: {}", error))
        })?;

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if let Ok(metadata) = std::fs::metadata(&mcp_path) {
                let mut permissions = metadata.permissions();
                permissions.set_mode(0o755);
                let _ = std::fs::set_permissions(&mcp_path, permissions);
            }
        }

        let plugin_json = Self::manifest_to_plugin_json(plugin_id, manifest);
        std::fs::write(
            skill_dir.join(".bob-work-plugin.json"),
            serde_json::to_string_pretty(&plugin_json).map_err(|error| {
                AppError::Plugin(format!("Failed to serialize office plugin manifest: {}", error))
            })?,
        )
        .map_err(|error| {
            AppError::Plugin(format!("Failed to write .bob-work-plugin.json: {}", error))
        })?;

        Ok(())
    }

    fn manifest_to_plugin_json(plugin_id: &str, manifest: &Value) -> Value {
        let slug = manifest
            .get("slug")
            .and_then(Value::as_str)
            .unwrap_or(plugin_id);
        json!({
            "schemaVersion": 1,
            "name": manifest.get("name").cloned().unwrap_or_else(|| json!(plugin_id)),
            "slug": slug,
            "version": manifest.get("version").cloned().unwrap_or_else(|| json!("1.1.0")),
            "description": manifest.get("description").cloned().unwrap_or(Value::Null),
            "category": manifest.get("category").cloned().unwrap_or_else(|| json!("recipe")),
            "builtin": manifest.get("builtin").cloned().unwrap_or_else(|| json!(true)),
            "permissions": manifest.get("permissions").cloned().unwrap_or_else(|| json!([])),
            "outputFormats": manifest.get("outputFormats").cloned().unwrap_or(Value::Null),
            "fileExtensions": manifest.get("fileExtensions").cloned().unwrap_or(Value::Null),
            "specializedMode": manifest.get("specializedMode").cloned().unwrap_or(Value::Null),
            "runtime": manifest.get("runtime").cloned().unwrap_or_else(|| json!({"python": ">=3.9", "mcp": true})),
            "mcpServers": manifest.get("mcpServers").cloned().unwrap_or_else(|| json!({})),
            "integrations": manifest.get("integrations").cloned().unwrap_or(Value::Null),
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
        let temp = std::env::temp_dir().join(format!(
            "bob-work-office-bundle-{}",
            uuid::Uuid::new_v4()
        ));
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
        OfficePluginBundle::write_bundle(&temp, "builtin-word", &manifest).expect("bundle");
        assert!(temp.join("mcp/server.py").is_file());
        assert!(temp.join(".bob-work-plugin.json").is_file());
        let _ = fs::remove_dir_all(temp);
    }
}
