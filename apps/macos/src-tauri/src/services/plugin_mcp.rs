use crate::error::{AppError, AppResult};
use crate::models::plugin::PluginMcpStatus;
use crate::services::workspace::WorkspaceService;
use serde_json::{Map, Value};
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Component, Path};
use std::process::Command;

pub struct PluginMcpService;

#[derive(Debug, Clone)]
struct PreparedServer {
    id: String,
    qualified_name: String,
    display_name: String,
    description: Option<String>,
    transport: String,
    tools: Vec<String>,
    required: bool,
    enabled: bool,
    config: Value,
}

impl PluginMcpService {
    pub fn new() -> Self {
        Self
    }

    pub fn has_servers(manifest: &Value) -> bool {
        manifest
            .get("mcpServers")
            .and_then(Value::as_object)
            .is_some_and(|servers| !servers.is_empty())
    }

    pub fn validate_schema(manifest: &Value) -> Vec<String> {
        let Some(value) = manifest.get("mcpServers") else {
            return vec![];
        };
        let Some(servers) = value.as_object() else {
            return vec!["mcpServers must be a JSON object".into()];
        };
        if servers.len() > 16 {
            return vec!["A plugin cannot declare more than 16 MCP servers".into()];
        }

        let permissions = manifest
            .get("permissions")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let has_permission = |permission: &str| {
            permissions
                .iter()
                .any(|value| value.get("type").and_then(Value::as_str) == Some(permission))
        };
        let mut errors = vec![];
        if !servers.is_empty() && !has_permission("mcp.connect") {
            errors.push("MCP plugins must declare the mcp.connect permission".into());
        }

        for (name, value) in servers {
            if !valid_slug(name) {
                errors.push(format!("Invalid MCP server name: {}", name));
                continue;
            }
            let Some(config) = value.as_object() else {
                errors.push(format!("MCP server {} must be a JSON object", name));
                continue;
            };
            let remote = config.get("url").and_then(Value::as_str).is_some();
            if remote {
                let url = config
                    .get("url")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if !safe_remote_url(url) {
                    errors.push(format!(
                        "MCP server {} must use HTTPS (HTTP is allowed only on localhost)",
                        name
                    ));
                }
                if !has_permission("network.request") {
                    errors.push(format!(
                        "Remote MCP server {} requires network.request permission",
                        name
                    ));
                }
            } else {
                let command = config
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if command.trim().is_empty() || contains_control(command) {
                    errors.push(format!("Local MCP server {} needs a safe command", name));
                }
                if !has_permission("command.execute") {
                    errors.push(format!(
                        "Local MCP server {} requires command.execute permission",
                        name
                    ));
                }
            }
            if config.get("headers").is_some() || config.get("env").is_some() {
                errors.extend(validate_no_embedded_secrets(name, config));
            }
        }
        errors.sort();
        errors.dedup();
        errors
    }

    pub fn validate_bundle(
        &self,
        plugin_id: &str,
        manifest: &Value,
        bundle_dir: &Path,
    ) -> AppResult<()> {
        let schema_errors = Self::validate_schema(manifest);
        if !schema_errors.is_empty() {
            return Err(AppError::Plugin(schema_errors.join("; ")));
        }
        self.prepare(plugin_id, manifest, bundle_dir).map(|_| ())
    }

    pub fn sync(
        &self,
        bob_path: &str,
        plugin_id: &str,
        manifest: &Value,
        bundle_dir: &Path,
        plugin_enabled: bool,
    ) -> AppResult<Vec<String>> {
        let servers = self.prepare(plugin_id, manifest, bundle_dir)?;
        let mut installed: Vec<String> = vec![];
        for server in servers {
            // Global scope: Bob Work is a desktop app; workspace scope writes
            // cwd/.bob/mcp.json (ENOENT under the Tauri project dir) and made
            // the Plugins screen hang for seconds on every open.
            if let Err(error) = run_bob(
                bob_path,
                &[
                    "mcp",
                    "add-json",
                    &server.qualified_name,
                    &server.config.to_string(),
                    "--scope",
                    "global",
                ],
            ) {
                for name in installed.iter().rev() {
                    let _ = run_bob(bob_path, &["mcp", "remove", name, "--scope", "global"]);
                }
                return Err(error);
            }
            let enabled = plugin_enabled && server.enabled;
            if let Err(error) = run_bob(
                bob_path,
                &[
                    "mcp",
                    if enabled { "enable" } else { "disable" },
                    &server.qualified_name,
                    "--scope",
                    "global",
                ],
            ) {
                let _ = run_bob(
                    bob_path,
                    &["mcp", "remove", &server.qualified_name, "--scope", "global"],
                );
                for name in installed.iter().rev() {
                    let _ = run_bob(bob_path, &["mcp", "remove", name, "--scope", "global"]);
                }
                return Err(error);
            }
            installed.push(server.qualified_name);
        }
        Ok(installed)
    }

    pub fn set_enabled(
        &self,
        bob_path: &str,
        plugin_id: &str,
        manifest: &Value,
        bundle_dir: &Path,
        enabled: bool,
    ) -> AppResult<()> {
        if enabled {
            self.sync(bob_path, plugin_id, manifest, bundle_dir, true)?;
            return Ok(());
        }
        let configured = configured_names();
        for server in self.prepare(plugin_id, manifest, bundle_dir)? {
            if configured.contains(&server.qualified_name) {
                run_bob(
                    bob_path,
                    &[
                        "mcp",
                        "disable",
                        &server.qualified_name,
                        "--scope",
                        "global",
                    ],
                )?;
            }
        }
        Ok(())
    }

    pub fn remove(
        &self,
        bob_path: &str,
        plugin_id: &str,
        manifest: &Value,
        bundle_dir: &Path,
    ) -> AppResult<()> {
        let configured = configured_names();
        for server in self.prepare(plugin_id, manifest, bundle_dir)? {
            if configured.contains(&server.qualified_name) {
                run_bob(
                    bob_path,
                    &["mcp", "remove", &server.qualified_name, "--scope", "global"],
                )?;
            }
        }
        Ok(())
    }

    pub fn remove_obsolete(
        &self,
        bob_path: &str,
        plugin_id: &str,
        old_manifest: &Value,
        old_bundle_dir: &Path,
        new_manifest: &Value,
        new_bundle_dir: &Path,
    ) -> AppResult<()> {
        let old = self.prepare(plugin_id, old_manifest, old_bundle_dir)?;
        let new_names = self
            .prepare(plugin_id, new_manifest, new_bundle_dir)?
            .into_iter()
            .map(|server| server.qualified_name)
            .collect::<std::collections::HashSet<_>>();
        let configured = configured_names();
        for server in old {
            if !new_names.contains(&server.qualified_name)
                && configured.contains(&server.qualified_name)
            {
                run_bob(
                    bob_path,
                    &["mcp", "remove", &server.qualified_name, "--scope", "global"],
                )?;
            }
        }
        Ok(())
    }

    pub fn status(
        &self,
        plugin_id: &str,
        manifest: &Value,
        bundle_dir: &Path,
    ) -> AppResult<Vec<PluginMcpStatus>> {
        let configured = WorkspaceService::new()
            .list_mcp_servers()
            .into_iter()
            .map(|server| (server.name.clone(), server))
            .collect::<std::collections::HashMap<_, _>>();
        Ok(self
            .prepare(plugin_id, manifest, bundle_dir)?
            .into_iter()
            .map(|server| {
                let current = configured.get(&server.qualified_name);
                PluginMcpStatus {
                    id: server.id,
                    name: server.display_name,
                    description: server.description,
                    transport: server.transport,
                    tools: server.tools,
                    configured: current.is_some(),
                    enabled: current.is_some_and(|value| value.enabled),
                    required: server.required,
                    last_test: None,
                }
            })
            .collect())
    }

    /// Live probe: spawn each stdio MCP, run `initialize` + `tools/list`.
    pub fn test(
        &self,
        plugin_id: &str,
        manifest: &Value,
        bundle_dir: &Path,
    ) -> AppResult<Vec<crate::models::plugin::PluginMcpTestResult>> {
        let servers = self.prepare(plugin_id, manifest, bundle_dir)?;
        Ok(servers
            .into_iter()
            .map(|server| probe_prepared_server(&server))
            .collect())
    }

    pub fn bundle_dir(manifest: &Value) -> AppResult<std::path::PathBuf> {
        if let Some(path) = manifest.get("bundlePath").and_then(Value::as_str) {
            return Ok(std::path::PathBuf::from(path));
        }
        let slug = manifest
            .get("slug")
            .and_then(Value::as_str)
            .ok_or_else(|| AppError::Plugin("MCP plugin is missing its slug".into()))?;
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home.join(".bob").join("skills").join(slug))
    }

    fn prepare(
        &self,
        plugin_id: &str,
        manifest: &Value,
        bundle_dir: &Path,
    ) -> AppResult<Vec<PreparedServer>> {
        let Some(servers) = manifest.get("mcpServers") else {
            return Ok(vec![]);
        };
        let servers = servers
            .as_object()
            .ok_or_else(|| AppError::Plugin("mcpServers must be a JSON object".into()))?;
        let mut prepared = vec![];
        for (id, value) in servers {
            let raw = value
                .as_object()
                .ok_or_else(|| AppError::Plugin(format!("MCP server {} must be an object", id)))?;
            let display_name = raw
                .get("displayName")
                .and_then(Value::as_str)
                .unwrap_or(id)
                .to_string();
            let description = raw
                .get("description")
                .and_then(Value::as_str)
                .map(str::to_string);
            let tools = raw
                .get("tools")
                .and_then(Value::as_array)
                .map(|tools| {
                    tools
                        .iter()
                        .filter_map(|tool| {
                            tool.as_str()
                                .or_else(|| tool.get("name").and_then(Value::as_str))
                                .map(str::to_string)
                        })
                        .collect()
                })
                .unwrap_or_default();
            let required = raw.get("required").and_then(Value::as_bool).unwrap_or(true);
            let enabled = !raw
                .get("disabled")
                .and_then(Value::as_bool)
                .unwrap_or(false);
            let mut config = raw.clone();
            for metadata in ["displayName", "description", "tools", "required"] {
                config.remove(metadata);
            }

            let (transport, config) = if let Some(url) = config.get("url").and_then(Value::as_str) {
                if !safe_remote_url(url) {
                    return Err(AppError::Plugin(format!("Unsafe MCP URL for {}", id)));
                }
                let mut config = config;
                config
                    .entry("type")
                    .or_insert_with(|| Value::String("streamable-http".into()));
                let transport = config
                    .get("type")
                    .and_then(Value::as_str)
                    .unwrap_or("streamable-http")
                    .to_string();
                (transport, config)
            } else {
                let command = config
                    .get("command")
                    .and_then(Value::as_str)
                    .unwrap_or_default();
                if command.trim().is_empty() || contains_control(command) {
                    return Err(AppError::Plugin(format!("Invalid MCP command for {}", id)));
                }
                if let Some(args) = config.get("args").and_then(Value::as_array) {
                    if args.len() > 64
                        || args.iter().any(|arg| {
                            arg.as_str()
                                .is_none_or(|value| value.len() > 4096 || contains_control(value))
                        })
                    {
                        return Err(AppError::Plugin(format!(
                            "Invalid MCP arguments for {}",
                            id
                        )));
                    }
                }
                let cwd = config.get("cwd").and_then(Value::as_str).unwrap_or(".");
                let cwd = resolve_bundle_directory(bundle_dir, cwd)?;
                config.insert(
                    "cwd".into(),
                    Value::String(cwd.to_string_lossy().to_string()),
                );
                ("stdio".to_string(), config)
            };
            prepared.push(PreparedServer {
                id: id.clone(),
                qualified_name: qualified_name(plugin_id, manifest, id),
                display_name,
                description,
                transport,
                tools,
                required,
                enabled,
                config: Value::Object(config),
            });
        }
        Ok(prepared)
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

fn probe_prepared_server(server: &PreparedServer) -> crate::models::plugin::PluginMcpTestResult {
    let fail = |message: String| crate::models::plugin::PluginMcpTestResult {
        id: server.id.clone(),
        name: server.display_name.clone(),
        ok: false,
        message,
        tools: vec![],
        tested_at: None,
    };
    if server.transport != "stdio" {
        let url = server
            .config
            .get("url")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if url.is_empty() {
            return fail("URL MCP manquante.".into());
        }
        let client = match reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(8))
            .build()
        {
            Ok(client) => client,
            Err(error) => return fail(format!("Client HTTP indisponible : {error}")),
        };
        let mut request = client.get(url);
        if let Some(headers) = server.config.get("headers").and_then(Value::as_object) {
            for (key, value) in headers {
                if key == "_redacted" {
                    continue;
                }
                if let Some(header_value) = value.as_str() {
                    if header_value != "<stored securely>" {
                        request = request.header(key.as_str(), header_value);
                    }
                }
            }
        }
        return match request.send() {
            // 401/403 = auth/config failure. Other 4xx still count as "reachable"
            // because many MCP HTTP endpoints reject bare GET with Method Not Allowed.
            Ok(response) => {
                let status = response.status();
                let code = status.as_u16();
                if code == 401 || code == 403 {
                    fail(format!("Authentification refusée (HTTP {code})."))
                } else if status.is_success() || code < 500 {
                    crate::models::plugin::PluginMcpTestResult {
                        id: server.id.clone(),
                        name: server.display_name.clone(),
                        ok: true,
                        message: format!("Endpoint HTTP joignable ({url})."),
                        tools: server.tools.clone(),
                        tested_at: None,
                    }
                } else {
                    fail(format!("Endpoint HTTP a répondu HTTP {code}."))
                }
            }
            Err(error) => fail(format!("Endpoint HTTP injoignable : {error}")),
        };
    }

    let command = server
        .config
        .get("command")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if command.trim().is_empty() {
        return fail("Commande MCP manquante.".into());
    }
    let args = server
        .config
        .get("args")
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let cwd = server
        .config
        .get("cwd")
        .and_then(Value::as_str)
        .map(Path::new)
        .unwrap_or_else(|| Path::new("."));
    let mut child = match Command::new(command)
        .args(&args)
        .current_dir(cwd)
        .envs(server_env(&server.config))
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
    {
        Ok(child) => child,
        Err(error) => return fail(format!("Impossible de démarrer le serveur MCP : {error}")),
    };

    let Some(mut stdin) = child.stdin.take() else {
        let _ = child.kill();
        return fail("stdin MCP indisponible.".into());
    };
    let Some(stdout) = child.stdout.take() else {
        let _ = child.kill();
        return fail("stdout MCP indisponible.".into());
    };

    let init = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"bob-work","version":"0.1.4"}}}"#;
    let initialized = r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#;
    let tools_list = r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#;
    if writeln!(stdin, "{init}").is_err()
        || writeln!(stdin, "{initialized}").is_err()
        || writeln!(stdin, "{tools_list}").is_err()
    {
        let _ = child.kill();
        return fail("Écriture JSON-RPC vers le serveur MCP impossible.".into());
    }
    drop(stdin);

    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stdout);
        let mut lines = Vec::new();
        for line in reader.lines().flatten() {
            let trimmed = line.trim().to_string();
            if trimmed.is_empty() {
                continue;
            }
            lines.push(trimmed);
            if lines.len() >= 8 {
                break;
            }
        }
        let _ = tx.send(lines);
    });

    let lines = match rx.recv_timeout(std::time::Duration::from_secs(8)) {
        Ok(lines) => lines,
        Err(_) => {
            let _ = child.kill();
            let _ = child.wait();
            return fail(
                "Délai dépassé en attendant la réponse MCP (initialize / tools/list).".into(),
            );
        }
    };
    let _ = child.kill();
    let _ = child.wait();

    let mut saw_initialize = false;
    let mut tools = Vec::new();
    for line in &lines {
        let Ok(value) = serde_json::from_str::<Value>(line) else {
            continue;
        };
        if value.get("id").and_then(Value::as_u64) == Some(1) && value.get("result").is_some() {
            saw_initialize = true;
        }
        if value.get("id").and_then(Value::as_u64) == Some(2) {
            if let Some(list) = value.pointer("/result/tools").and_then(Value::as_array) {
                tools = list
                    .iter()
                    .filter_map(|tool| tool.get("name").and_then(Value::as_str))
                    .map(str::to_string)
                    .collect();
            }
            if value.get("error").is_some() {
                return fail(format!(
                    "tools/list a échoué : {}",
                    value
                        .pointer("/error/message")
                        .and_then(Value::as_str)
                        .unwrap_or("erreur MCP")
                ));
            }
        }
    }

    if !saw_initialize {
        let preview = lines
            .first()
            .cloned()
            .unwrap_or_else(|| "aucune sortie".into());
        return fail(format!("Pas de réponse initialize valide ({preview})."));
    }

    crate::models::plugin::PluginMcpTestResult {
        id: server.id.clone(),
        name: server.display_name.clone(),
        ok: true,
        message: if tools.is_empty() {
            "Connexion MCP OK (initialize).".into()
        } else {
            format!(
                "Connexion MCP OK — {} outil(s) : {}.",
                tools.len(),
                tools.join(", ")
            )
        },
        tools,
        tested_at: None,
    }
}

fn server_env(config: &Value) -> Vec<(String, String)> {
    config
        .get("env")
        .and_then(Value::as_object)
        .map(|env| {
            env.iter()
                .filter_map(|(key, value)| {
                    value.as_str().map(|text| (key.clone(), text.to_string()))
                })
                .collect()
        })
        .unwrap_or_default()
}

fn configured_names() -> std::collections::HashSet<String> {
    WorkspaceService::new()
        .list_mcp_servers()
        .into_iter()
        .map(|server| server.name)
        .collect()
}

/// Probe a server already present in Bob's mcp.json (Integrations → MCP).
pub fn test_workspace_server(
    server: &crate::models::workspace::McpServer,
) -> crate::models::plugin::PluginMcpTestResult {
    let mut config = if let Some(object) = server.raw.as_object() {
        object.clone()
    } else {
        Map::new()
    };
    if server.transport == "stdio" || server.transport.is_empty() {
        config
            .entry("command".to_string())
            .or_insert_with(|| Value::String(server.command_or_url.clone()));
        if !server.args.is_empty() {
            config.insert(
                "args".to_string(),
                Value::Array(
                    server
                        .args
                        .iter()
                        .map(|arg| Value::String(arg.clone()))
                        .collect(),
                ),
            );
        }
    } else {
        config
            .entry("url".to_string())
            .or_insert_with(|| Value::String(server.command_or_url.clone()));
    }
    let prepared = PreparedServer {
        id: server.name.clone(),
        qualified_name: server.name.clone(),
        display_name: server.name.clone(),
        description: None,
        transport: if server.transport.is_empty() {
            "stdio".into()
        } else {
            server.transport.clone()
        },
        tools: vec![],
        required: false,
        enabled: server.enabled,
        config: Value::Object(config),
    };
    probe_prepared_server(&prepared)
}

fn resolve_bundle_directory(bundle_dir: &Path, relative: &str) -> AppResult<std::path::PathBuf> {
    let relative = Path::new(relative);
    if relative.is_absolute()
        || relative
            .components()
            .any(|component| !matches!(component, Component::CurDir | Component::Normal(_)))
    {
        return Err(AppError::Plugin(
            "MCP cwd must remain inside the plugin bundle".into(),
        ));
    }
    let path = bundle_dir.join(relative);
    let metadata = std::fs::symlink_metadata(&path)?;
    if !metadata.is_dir() || metadata.file_type().is_symlink() {
        return Err(AppError::Plugin("Invalid MCP working directory".into()));
    }
    let bundle_dir = std::fs::canonicalize(bundle_dir)?;
    let path = std::fs::canonicalize(path)?;
    if !path.starts_with(&bundle_dir) {
        return Err(AppError::Plugin(
            "MCP cwd must remain inside the plugin bundle".into(),
        ));
    }
    Ok(path)
}

fn qualified_name(plugin_id: &str, manifest: &Value, server_id: &str) -> String {
    let slug = manifest
        .get("slug")
        .and_then(Value::as_str)
        .unwrap_or(plugin_id);
    let base = normalize_slug(&format!("bw-{}-{}", slug, server_id));
    if base.len() <= 64 {
        return base;
    }
    let mut hasher = DefaultHasher::new();
    base.hash(&mut hasher);
    let suffix = format!("{:08x}", hasher.finish() as u32);
    let prefix = base.chars().take(55).collect::<String>();
    format!("{}-{}", prefix.trim_end_matches('-'), suffix)
}

fn normalize_slug(value: &str) -> String {
    value
        .to_ascii_lowercase()
        .chars()
        .map(|character| {
            if character.is_ascii_alphanumeric() {
                character
            } else {
                '-'
            }
        })
        .collect::<String>()
        .split('-')
        .filter(|part| !part.is_empty())
        .collect::<Vec<_>>()
        .join("-")
}

fn valid_slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.chars().all(|character| {
            character.is_ascii_lowercase() || character.is_ascii_digit() || character == '-'
        })
        && !value.starts_with('-')
        && !value.ends_with('-')
        && !value.contains("--")
}

fn contains_control(value: &str) -> bool {
    value.contains('\0') || value.contains('\n') || value.contains('\r')
}

fn safe_remote_url(value: &str) -> bool {
    value.starts_with("https://")
        || value.starts_with("http://localhost")
        || value.starts_with("http://127.0.0.1")
        || value.starts_with("http://[::1]")
}

fn validate_no_embedded_secrets(server: &str, config: &Map<String, Value>) -> Vec<String> {
    let mut errors = vec![];
    for section in ["env", "headers"] {
        let Some(values) = config.get(section).and_then(Value::as_object) else {
            continue;
        };
        for (key, value) in values {
            let key_lower = key.to_ascii_lowercase();
            let sensitive = [
                "token",
                "secret",
                "password",
                "authorization",
                "api-key",
                "apikey",
            ]
            .iter()
            .any(|marker| key_lower.contains(marker));
            if sensitive
                && value
                    .as_str()
                    .is_some_and(|text| !text.starts_with("${") || !text.ends_with('}'))
            {
                errors.push(format!(
                    "MCP server {} cannot embed a secret in {}.{}; use an environment placeholder",
                    server, section, key
                ));
            }
        }
    }
    errors
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bundle() -> (std::path::PathBuf, Value) {
        let root =
            std::env::temp_dir().join(format!("bob-work-plugin-mcp-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("mcp")).unwrap();
        std::fs::write(root.join("mcp/server.py"), "print('server')\n").unwrap();
        let manifest = serde_json::json!({
            "slug": "cloud-architect",
            "permissions": [
                {"type": "mcp.connect"},
                {"type": "command.execute"}
            ],
            "mcpServers": {
                "architecture": {
                    "displayName": "Outils architecture",
                    "description": "Analyse structurée",
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "tools": [{"name": "assess_architecture"}],
                    "required": true
                }
            }
        });
        (root, manifest)
    }

    #[test]
    fn prepares_a_namespaced_local_mcp_server_without_ui_metadata() {
        let (root, manifest) = bundle();
        let prepared = PluginMcpService::new()
            .prepare("agentic-cloud-architect", &manifest, &root)
            .unwrap();
        assert_eq!(prepared.len(), 1);
        assert_eq!(
            prepared[0].qualified_name,
            "bw-cloud-architect-architecture"
        );
        assert_eq!(prepared[0].tools, vec!["assess_architecture"]);
        let canonical_root = std::fs::canonicalize(&root).unwrap();
        assert_eq!(
            prepared[0].config.get("cwd").and_then(Value::as_str),
            canonical_root.to_str()
        );
        assert!(prepared[0].config.get("displayName").is_none());
        assert!(prepared[0].config.get("tools").is_none());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_mcp_without_explicit_permissions_or_with_an_unsafe_cwd() {
        let (root, mut manifest) = bundle();
        manifest["permissions"] = serde_json::json!([]);
        let errors = PluginMcpService::validate_schema(&manifest);
        assert!(errors.iter().any(|error| error.contains("mcp.connect")));
        assert!(errors.iter().any(|error| error.contains("command.execute")));

        manifest["permissions"] = serde_json::json!([
            {"type": "mcp.connect"}, {"type": "command.execute"}
        ]);
        manifest["mcpServers"]["architecture"]["cwd"] = Value::String("../outside".into());
        assert!(PluginMcpService::new()
            .prepare("agentic-cloud-architect", &manifest, &root)
            .is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn rejects_literal_mcp_secrets_but_accepts_environment_placeholders() {
        let (_, mut manifest) = bundle();
        manifest["mcpServers"]["architecture"]["env"] =
            serde_json::json!({"API_TOKEN": "plain-secret"});
        assert!(PluginMcpService::validate_schema(&manifest)
            .iter()
            .any(|error| error.contains("cannot embed a secret")));
        manifest["mcpServers"]["architecture"]["env"] =
            serde_json::json!({"API_TOKEN": "${CLOUD_API_TOKEN}"});
        assert!(PluginMcpService::validate_schema(&manifest).is_empty());
    }

    #[test]
    fn probes_stdio_mcp_initialize_and_tools_list() {
        let root =
            std::env::temp_dir().join(format!("bob-work-mcp-probe-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("mcp")).unwrap();
        std::fs::write(
            root.join("cto_market.py"),
            include_str!("../../resources/finance/cto_market.py"),
        )
        .unwrap();
        std::fs::write(
            root.join("mcp/server.py"),
            include_str!("../../resources/finance/mcp/server.py"),
        )
        .unwrap();
        let manifest = serde_json::json!({
            "slug": "bob-work-cto-invest-probe",
            "permissions": [{"type":"mcp.connect"},{"type":"command.execute"},{"type":"network.request"}],
            "mcpServers": {
                "cto-market": {
                    "displayName": "Marché CTO",
                    "command": "python3",
                    "args": ["mcp/server.py"],
                    "cwd": ".",
                    "env": {"BOB_CTO_INVEST": "e2e-probe"},
                    "tools": ["cto_market_snapshot", "cto_screen_ideas"]
                }
            }
        });
        let results = PluginMcpService::new()
            .test("bob-work-cto-invest", &manifest, &root)
            .expect("probe");
        assert_eq!(results.len(), 1);
        assert!(results[0].ok, "{}", results[0].message);
        assert!(results[0]
            .tools
            .iter()
            .any(|tool| tool == "cto_screen_ideas"));
        assert!(results[0]
            .tools
            .iter()
            .any(|tool| tool == "cto_connector_status"));
        let _ = std::fs::remove_dir_all(root);
    }
}
