use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};

const OFFICE_MCP_SCRIPT: &str = include_str!("../../resources/office/office_mcp.py");
const CTO_MARKET_LIB: &str = include_str!("../../resources/finance/cto_market.py");
const CTO_MCP_SERVER: &str = include_str!("../../resources/finance/mcp/server.py");
const CTO_CLI_SCRIPT: &str = include_str!("../../resources/finance/scripts/screen_cto.py");
const IBM_PURSUIT_LIB: &str = include_str!("../../resources/consulting/ibm_pursuit.py");
const IBM_PURSUIT_MCP_SERVER: &str = include_str!("../../resources/consulting/mcp/server.py");
const IBM_PURSUIT_CLI_SCRIPT: &str =
    include_str!("../../resources/consulting/scripts/brief_pursuit.py");
const CLOUD_ARCHITECT_BUNDLE: &[u8] =
    include_bytes!("../../resources/cloud-architect/cloud-architect.zip");
const IBM_AGENTIC_PROFESSIONS_BUNDLE: &[u8] =
    include_bytes!("../../resources/ibm-agentic-professions/ibm-agentic-professions.zip");
const DOCLING_RUNTIME: &str = include_str!("../../resources/docling/docling_runtime.py");
const DOCLING_CLI_SCRIPT: &str = include_str!("../../resources/docling/scripts/docling_cli.py");
const DOCLING_BIN_SHIM: &str = include_str!("../../resources/docling/bin/docling");
const DOCLING_MCP_SERVER: &str = include_str!("../../resources/docling/mcp/server.py");

pub struct OfficePluginBundle;

impl OfficePluginBundle {
    pub fn is_office_bundle(manifest: &Value) -> bool {
        Self::mcp_script_for(manifest).is_some()
            || Self::is_cto_bundle(manifest)
            || Self::is_ibm_pursuit_bundle(manifest)
            || Self::is_cloud_architect_bundle(manifest)
            || Self::is_ibm_agentic_profession_bundle(manifest)
            || Self::is_docling_bundle(manifest)
    }

    fn is_cto_bundle(manifest: &Value) -> bool {
        Self::mcp_env_contains(manifest, "BOB_CTO_INVEST")
    }

    fn is_ibm_pursuit_bundle(manifest: &Value) -> bool {
        Self::mcp_env_contains(manifest, "BOB_IBM_PURSUIT")
    }

    fn is_cloud_architect_bundle(manifest: &Value) -> bool {
        manifest.get("slug").and_then(Value::as_str) == Some("cloud-architect")
            && manifest.get("builtin").and_then(Value::as_bool) == Some(true)
    }

    fn is_ibm_agentic_profession_bundle(manifest: &Value) -> bool {
        manifest
            .get("slug")
            .and_then(Value::as_str)
            .is_some_and(|slug| slug.starts_with("ibm-agentic-"))
            && manifest.get("builtin").and_then(Value::as_bool) == Some(true)
    }

    fn is_docling_bundle(manifest: &Value) -> bool {
        matches!(
            manifest.get("slug").and_then(Value::as_str),
            Some("bob-work-docling") | Some("docling")
        ) && manifest.get("builtin").and_then(Value::as_bool) == Some(true)
    }

    fn is_python_work_bundle(manifest: &Value) -> bool {
        Self::is_cto_bundle(manifest)
            || Self::is_ibm_pursuit_bundle(manifest)
            || Self::is_docling_bundle(manifest)
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
        if Self::is_cloud_architect_bundle(manifest) {
            return Self::write_cloud_architect_bundle(
                skill_dir,
                plugin_id,
                manifest,
                overwrite_embedded,
            );
        }
        if Self::is_ibm_agentic_profession_bundle(manifest) {
            return Self::write_ibm_agentic_profession_bundle(
                skill_dir,
                plugin_id,
                manifest,
                overwrite_embedded,
            );
        }
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
        if Self::is_docling_bundle(manifest) {
            return Self::write_docling_bundle(skill_dir, plugin_id, manifest, overwrite_embedded);
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

    fn write_cloud_architect_bundle(
        skill_dir: &Path,
        plugin_id: &str,
        manifest: &Value,
        overwrite_embedded: bool,
    ) -> AppResult<()> {
        let cursor = Cursor::new(CLOUD_ARCHITECT_BUNDLE);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|error| {
            AppError::Plugin(format!("Failed to open Cloud Architect bundle: {}", error))
        })?;

        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| {
                AppError::Plugin(format!("Failed to read Cloud Architect bundle: {}", error))
            })?;
            let Some(relative_path) = entry.enclosed_name() else {
                return Err(AppError::Plugin(
                    "Cloud Architect bundle contains an unsafe path".into(),
                ));
            };
            let output_path = skill_dir.join(relative_path);
            if entry.is_dir() {
                std::fs::create_dir_all(&output_path)?;
                continue;
            }
            if output_path.exists() && !overwrite_embedded {
                continue;
            }
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to unpack Cloud Architect bundle: {}",
                    error
                ))
            })?;
            let mut output = std::fs::File::create(&output_path)?;
            output.write_all(&bytes)?;
            #[cfg(unix)]
            if let Some(mode) = entry.unix_mode() {
                use std::os::unix::fs::PermissionsExt;
                let _ =
                    std::fs::set_permissions(&output_path, std::fs::Permissions::from_mode(mode));
            }
        }

        std::fs::write(
            skill_dir.join(".bob-work-plugin.json"),
            serde_json::to_string_pretty(manifest).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to serialize Cloud Architect manifest: {}",
                    error
                ))
            })?,
        )?;
        std::fs::write(skill_dir.join(".bob-work-plugin-id"), plugin_id)?;
        Self::link_shared_diagram_runtime(skill_dir)?;
        Ok(())
    }

    fn link_shared_diagram_runtime(skill_dir: &Path) -> AppResult<()> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        let shared_vendor = home
            .join(".bob")
            .join("runtimes")
            .join("shared")
            .join("diagram")
            .join("2.0.0")
            .join("vendor");
        let plugin_vendor = skill_dir.join("vendor");
        if let Ok(metadata) = std::fs::symlink_metadata(&plugin_vendor) {
            if metadata.file_type().is_symlink() || metadata.is_file() {
                std::fs::remove_file(&plugin_vendor)?;
            } else if metadata.is_dir() {
                // Runtime Architecture V1 stored about 69 MB of generic
                // rendering engines privately in every Cloud Architect copy.
                std::fs::remove_dir_all(&plugin_vendor)?;
            }
        }
        if let Some(parent) = shared_vendor.parent() {
            std::fs::create_dir_all(parent)?;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&shared_vendor, &plugin_vendor)?;
        #[cfg(not(unix))]
        std::fs::create_dir_all(&plugin_vendor)?;
        Ok(())
    }

    fn write_ibm_agentic_profession_bundle(
        skill_dir: &Path,
        plugin_id: &str,
        manifest: &Value,
        overwrite_embedded: bool,
    ) -> AppResult<()> {
        let slug = manifest
            .get("slug")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                AppError::Plugin("Agentic profession manifest is missing slug".into())
            })?;
        let cursor = Cursor::new(IBM_AGENTIC_PROFESSIONS_BUNDLE);
        let mut archive = zip::ZipArchive::new(cursor).map_err(|error| {
            AppError::Plugin(format!(
                "Failed to open IBM agentic professions bundle: {}",
                error
            ))
        })?;
        let prefix = Path::new(slug);

        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to read IBM agentic professions bundle: {}",
                    error
                ))
            })?;
            let Some(archive_path) = entry.enclosed_name() else {
                return Err(AppError::Plugin(
                    "IBM agentic professions bundle contains an unsafe path".into(),
                ));
            };
            let Ok(relative_path) = archive_path.strip_prefix(prefix) else {
                continue;
            };
            if relative_path.as_os_str().is_empty() {
                continue;
            }
            // PluginDeployService generates the root file from manifest.instructions
            // and preserves its enabled/disabled state. The archive supplies the
            // detailed sub-skills and references around that canonical root.
            if relative_path == Path::new("SKILL.md") {
                continue;
            }
            let output_path = skill_dir.join(relative_path);
            if entry.is_dir() {
                std::fs::create_dir_all(&output_path)?;
                continue;
            }
            if output_path.exists() && !overwrite_embedded {
                continue;
            }
            if let Some(parent) = output_path.parent() {
                std::fs::create_dir_all(parent)?;
            }
            let mut bytes = Vec::new();
            entry.read_to_end(&mut bytes).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to unpack IBM agentic profession {}: {}",
                    slug, error
                ))
            })?;
            let mut output = std::fs::File::create(&output_path)?;
            output.write_all(&bytes)?;
        }

        std::fs::write(
            skill_dir.join(".bob-work-plugin.json"),
            serde_json::to_string_pretty(manifest).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to serialize IBM agentic profession manifest: {}",
                    error
                ))
            })?,
        )?;
        std::fs::write(skill_dir.join(".bob-work-plugin-id"), plugin_id)?;
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

    fn write_docling_bundle(
        skill_dir: &Path,
        plugin_id: &str,
        manifest: &Value,
        overwrite_embedded: bool,
    ) -> AppResult<()> {
        for dir in ["mcp", "scripts", "bin"] {
            std::fs::create_dir_all(skill_dir.join(dir)).map_err(|error| {
                AppError::Plugin(format!("Failed to create Docling {dir} directory: {error}"))
            })?;
        }
        Self::write_executable(
            &skill_dir.join("docling_runtime.py"),
            DOCLING_RUNTIME,
            overwrite_embedded,
        )?;
        Self::write_executable(
            &skill_dir.join("mcp/server.py"),
            DOCLING_MCP_SERVER,
            overwrite_embedded,
        )?;
        Self::write_executable(
            &skill_dir.join("scripts/docling_cli.py"),
            DOCLING_CLI_SCRIPT,
            overwrite_embedded,
        )?;
        Self::write_executable(
            &skill_dir.join("bin/docling"),
            DOCLING_BIN_SHIM,
            overwrite_embedded,
        )?;

        let plugin_json = Self::manifest_to_plugin_json(plugin_id, manifest);
        std::fs::write(
            skill_dir.join(".bob-work-plugin.json"),
            serde_json::to_string_pretty(&plugin_json).map_err(|error| {
                AppError::Plugin(format!(
                    "Failed to serialize Docling plugin manifest: {error}"
                ))
            })?,
        )
        .map_err(|error| {
            AppError::Plugin(format!("Failed to write .bob-work-plugin.json: {error}"))
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
                } else if Self::is_docling_bundle(manifest) {
                    json!([
                        {"name": "docling", "runtime": "python3", "path": "scripts/docling_cli.py"},
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
    fn writes_built_in_cloud_architect_bundle_with_d2() {
        let temp = std::env::temp_dir().join(format!(
            "bob-work-cloud-architect-bundle-{}",
            uuid::Uuid::new_v4()
        ));
        let manifest: serde_json::Value = serde_json::from_str(include_str!(
            "../../resources/cloud-architect/manifest.json"
        ))
        .expect("manifest");

        OfficePluginBundle::write_bundle(&temp, "builtin-cloud-architect", &manifest, true)
            .expect("bundle");

        assert!(temp
            .join("skills/senior-cloud-architect/SKILL.md")
            .is_file());
        assert!(temp.join("scripts/d2_runtime.py").is_file());
        let d2 = temp.join("vendor/d2/v0.7.1/bin/d2");
        assert!(d2.is_file());
        assert!(fs::metadata(&d2).expect("D2 metadata").len() > 1_000_000);
        assert_eq!(
            fs::read_to_string(temp.join(".bob-work-plugin-id")).expect("plugin id"),
            "builtin-cloud-architect"
        );
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn writes_built_in_docling_cli_and_mcp_bundle() {
        let temp =
            std::env::temp_dir().join(format!("bob-work-docling-bundle-{}", uuid::Uuid::new_v4()));
        let manifest = json!({
            "name": "Docling",
            "slug": "bob-work-docling",
            "version": "1.0.0",
            "builtin": true,
            "category": "executable",
            "permissions": [
                {"type":"file.read"},
                {"type":"file.write"},
                {"type":"mcp.connect"},
                {"type":"command.execute"},
                {"type":"network.request"}
            ],
            "mcpServers": {
                "docling": {
                    "displayName": "Docling",
                    "command": "python3",
                    "args": ["mcp/server.py"]
                }
            }
        });
        OfficePluginBundle::write_bundle(&temp, "builtin-docling", &manifest, true)
            .expect("bundle");
        assert!(temp.join("docling_runtime.py").is_file());
        assert!(temp.join("scripts/docling_cli.py").is_file());
        assert!(temp.join("bin/docling").is_file());
        assert!(temp.join("mcp/server.py").is_file());
        let runtime = fs::read_to_string(temp.join("docling_runtime.py")).expect("runtime");
        assert!(runtime.contains("DOCLING_VERSION"));
        let mcp = fs::read_to_string(temp.join("mcp/server.py")).expect("mcp");
        assert!(mcp.contains("docling_convert"));
        assert_eq!(
            fs::read_to_string(temp.join(".bob-work-plugin-id")).expect("plugin id"),
            "builtin-docling"
        );
        let self_test = std::process::Command::new("python3")
            .arg(temp.join("scripts/docling_cli.py"))
            .arg("--self-test")
            .output()
            .expect("python3");
        assert!(
            self_test.status.success(),
            "{}",
            String::from_utf8_lossy(&self_test.stderr)
        );
        let mut mcp_proc = std::process::Command::new("python3")
            .arg(temp.join("mcp/server.py"))
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .expect("mcp");
        {
            use std::io::Write;
            let mut stdin = mcp_proc.stdin.take().expect("stdin");
            writeln!(
                stdin,
                r#"{{"jsonrpc":"2.0","id":1,"method":"initialize","params":{{}}}}"#
            )
            .unwrap();
            writeln!(stdin, r#"{{"jsonrpc":"2.0","id":2,"method":"tools/list"}}"#).unwrap();
        }
        let mcp_out = mcp_proc.wait_with_output().expect("mcp wait");
        let stdout = String::from_utf8_lossy(&mcp_out.stdout);
        assert!(stdout.contains("docling_convert"), "{stdout}");
        assert!(stdout.contains("docling_ocr"), "{stdout}");
        let _ = fs::remove_dir_all(temp);
    }

    #[test]
    fn writes_all_built_in_ibm_agentic_professions_with_specialized_skills() {
        let cases = [
            (
                "builtin-ibm-agentic-designer",
                include_str!(
                    "../../resources/ibm-agentic-professions/plugins/ibm-agentic-designer/manifest.json"
                ),
                "skills/accessibility-audit/SKILL.md",
                10,
            ),
            (
                "builtin-ibm-agentic-consultant",
                include_str!(
                    "../../resources/ibm-agentic-professions/plugins/ibm-agentic-consultant/manifest.json"
                ),
                "skills/red-team-review/SKILL.md",
                10,
            ),
            (
                "builtin-ibm-agentic-rfp",
                include_str!(
                    "../../resources/ibm-agentic-professions/plugins/ibm-agentic-rfp/manifest.json"
                ),
                "skills/compliance-matrix/SKILL.md",
                8,
            ),
            (
                "builtin-ibm-agentic-product-manager",
                include_str!(
                    "../../resources/ibm-agentic-professions/plugins/ibm-agentic-product-manager/manifest.json"
                ),
                "skills/rice/SKILL.md",
                11,
            ),
            (
                "builtin-ibm-agentic-delivery-manager",
                include_str!(
                    "../../resources/ibm-agentic-professions/plugins/ibm-agentic-delivery-manager/manifest.json"
                ),
                "skills/raid/SKILL.md",
                10,
            ),
            (
                "builtin-ibm-agentic-change-manager",
                include_str!(
                    "../../resources/ibm-agentic-professions/plugins/ibm-agentic-change-manager/manifest.json"
                ),
                "skills/adkar/SKILL.md",
                10,
            ),
            (
                "builtin-ibm-agentic-solution-architect",
                include_str!(
                    "../../resources/ibm-agentic-professions/plugins/ibm-agentic-solution-architect/manifest.json"
                ),
                "skills/c4/SKILL.md",
                14,
            ),
        ];

        for (plugin_id, raw_manifest, expected_skill, expected_count) in cases {
            let temp = std::env::temp_dir().join(format!(
                "bob-work-agentic-profession-bundle-{}",
                uuid::Uuid::new_v4()
            ));
            let manifest: serde_json::Value = serde_json::from_str(raw_manifest).expect("manifest");

            OfficePluginBundle::write_bundle(&temp, plugin_id, &manifest, true).expect("bundle");

            assert!(temp.join(expected_skill).is_file(), "{plugin_id}");
            assert!(temp.join("references/sources.md").is_file(), "{plugin_id}");
            assert!(
                temp.join(".codex-plugin/plugin.json").is_file(),
                "{plugin_id}"
            );
            assert_eq!(
                fs::read_to_string(temp.join(".bob-work-plugin-id")).expect("plugin id"),
                plugin_id
            );
            let deployed_manifest: serde_json::Value = serde_json::from_str(
                &fs::read_to_string(temp.join(".bob-work-plugin.json")).expect("manifest"),
            )
            .expect("valid JSON");
            assert_eq!(deployed_manifest["builtin"], true);
            assert_eq!(
                deployed_manifest["skills"].as_array().map(Vec::len),
                Some(expected_count),
                "{plugin_id}"
            );
            let _ = fs::remove_dir_all(temp);
        }
    }

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
