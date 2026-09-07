use crate::error::{AppError, AppResult};
use crate::services::workspace::WorkspaceService;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{BufRead, Write};
use std::process::{Command, Stdio};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

pub struct McpGatewayService;
static MCP_GATEWAY_EXECUTION: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

impl McpGatewayService {
    pub fn handle(allowed: &[String], request: &Value) -> AppResult<Value> {
        Self::handle_with_config(allowed, request, &local_config)
    }

    fn handle_with_config<F>(
        allowed: &[String],
        request: &Value,
        config_for: &F,
    ) -> AppResult<Value>
    where
        F: Fn(&str) -> AppResult<Value>,
    {
        let id = request.get("id").cloned().unwrap_or(Value::Null);
        let method = request.get("method").and_then(Value::as_str).unwrap_or("");
        let result: AppResult<Value> = match method {
            "initialize" => Ok(json!({
                "protocolVersion": request.get("params").and_then(|value| value.get("protocolVersion")).and_then(Value::as_str).unwrap_or("2025-06-18"),
                "capabilities": {"tools": {"listChanged": false}},
                "serverInfo": {"name": "bob-work-mcp-gateway", "version": "1.0.0"}
            })),
            "ping" => Ok(json!({})),
            "tools/list" => {
                Self::listed_tools_with(allowed, config_for).map(|tools| json!({"tools": tools}))
            }
            "tools/call" => (|| -> AppResult<Value> {
                let params = request.get("params").cloned().unwrap_or_else(|| json!({}));
                let external = params.get("name").and_then(Value::as_str).unwrap_or("");
                let (server, tool) = allowed
                    .iter()
                    .filter_map(|entry| split_qualified(entry))
                    .find(|(server, tool)| external_name(server, tool) == external)
                    .ok_or_else(|| {
                        AppError::PermissionDenied(
                            "Cet outil n’est pas exposé par la passerelle MCP.".into(),
                        )
                    })?;
                let config = config_for(server)?;
                exchange(
                    &config,
                    "tools/call",
                    json!({"name": tool, "arguments": params.get("arguments").cloned().unwrap_or_else(|| json!({}))}),
                )
            })(),
            "notifications/initialized" => return Ok(Value::Null),
            _ => {
                return Ok(
                    json!({"jsonrpc":"2.0","id":id,"error":{"code":-32601,"message":"Méthode MCP non prise en charge"}}),
                )
            }
        };
        Ok(match result {
            Ok(result) => json!({"jsonrpc":"2.0","id":id,"result":result}),
            Err(error) => {
                json!({"jsonrpc":"2.0","id":id,"error":{"code":-32000,"message":error.to_string()}})
            }
        })
    }

    fn listed_tools_with<F>(allowed: &[String], config_for: &F) -> AppResult<Vec<Value>>
    where
        F: Fn(&str) -> AppResult<Value>,
    {
        let mut result = Vec::new();
        let mut servers = allowed
            .iter()
            .filter_map(|entry| split_qualified(entry).map(|v| v.0.to_string()))
            .collect::<Vec<_>>();
        servers.sort();
        servers.dedup();
        for server in servers {
            let config = config_for(&server)?;
            let response = exchange(&config, "tools/list", json!({}))?;
            for tool in response
                .get("tools")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default()
            {
                let Some(name) = tool.get("name").and_then(Value::as_str).map(str::to_string)
                else {
                    continue;
                };
                if !allowed
                    .iter()
                    .any(|entry| entry == &format!("{server}::{name}"))
                {
                    continue;
                }
                let mut exposed = tool;
                if let Some(object) = exposed.as_object_mut() {
                    object.insert("name".into(), Value::String(external_name(&server, &name)));
                    object.insert(
                        "title".into(),
                        Value::String(format!("{} · {}", server, name)),
                    );
                }
                result.push(exposed);
            }
        }
        Ok(result)
    }
}

fn split_qualified(value: &str) -> Option<(&str, &str)> {
    let (server, tool) = value.split_once("::")?;
    (!server.is_empty() && !tool.is_empty()).then_some((server, tool))
}
fn external_name(server: &str, tool: &str) -> String {
    let digest = Sha256::digest(format!("{server}::{tool}").as_bytes());
    let suffix = digest[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    format!("{}__{}__{}", safe_name(server), safe_name(tool), suffix)
}
fn safe_name(value: &str) -> String {
    value
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn local_config(server: &str) -> AppResult<Value> {
    let workspace = WorkspaceService::new();
    let config = workspace
        .read_mcp_server_config(server)
        .ok_or_else(|| AppError::NotFound(format!("Serveur MCP {server} introuvable")))?;
    if config.get("url").is_some()
        || config
            .get("command")
            .and_then(Value::as_str)
            .unwrap_or("")
            .is_empty()
    {
        return Err(AppError::ValidationFailed(
            "La passerelle expose uniquement les MCP locaux stdio.".into(),
        ));
    }
    Ok(config)
}

fn exchange(config: &Value, method: &str, params: Value) -> AppResult<Value> {
    // A remote client must not be able to create an unbounded number of local
    // MCP processes. Calls are short-lived and deliberately serialized.
    let _execution = MCP_GATEWAY_EXECUTION
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let command = config
        .get("command")
        .and_then(Value::as_str)
        .ok_or_else(|| AppError::ValidationFailed("Commande MCP absente".into()))?;
    let args = config
        .get("args")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter_map(|v| v.as_str().map(str::to_string))
        .collect::<Vec<_>>();
    let cwd = config.get("cwd").and_then(Value::as_str).unwrap_or(".");
    let mut process = Command::new(command);
    process
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .env(
            "PATH",
            "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin",
        )
        .env("HOME", dirs::home_dir().unwrap_or_default());
    if let Some(env) = config.get("env").and_then(Value::as_object) {
        for (key, value) in env {
            if let Some(value) = value.as_str() {
                process.env(key, value);
            }
        }
    }
    let mut child = process
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| AppError::Io(format!("Impossible de démarrer le MCP {command}: {e}")))?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| AppError::Io("stdin MCP indisponible".into()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| AppError::Io("stdout MCP indisponible".into()))?;
    writeln!(stdin, "{}", json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"bob-work-gateway","version":"1.0.0"}}})).map_err(|e| AppError::Io(e.to_string()))?;
    writeln!(
        stdin,
        "{}",
        json!({"jsonrpc":"2.0","method":"notifications/initialized"})
    )
    .map_err(|e| AppError::Io(e.to_string()))?;
    writeln!(
        stdin,
        "{}",
        json!({"jsonrpc":"2.0","id":2,"method":method,"params":params})
    )
    .map_err(|e| AppError::Io(e.to_string()))?;
    stdin.flush().map_err(|e| AppError::Io(e.to_string()))?;
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in std::io::BufReader::new(stdout)
            .lines()
            .map_while(Result::ok)
        {
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                if value.get("id").and_then(Value::as_i64) == Some(2) {
                    let _ = tx.send(value);
                    break;
                }
            }
        }
    });
    let response = rx
        .recv_timeout(Duration::from_secs(15))
        .map_err(|_| AppError::Io("Délai dépassé lors de l’appel MCP.".into()));
    let _ = child.kill();
    let _ = child.wait();
    let response = response?;
    if let Some(error) = response.get("error") {
        return Err(AppError::Io(
            error
                .get("message")
                .and_then(Value::as_str)
                .unwrap_or("Erreur MCP")
                .into(),
        ));
    }
    Ok(response.get("result").cloned().unwrap_or(Value::Null))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn names_are_stable_and_safe() {
        assert_eq!(
            external_name("my-server", "read.file"),
            "my_server__read_file__978ad942"
        );
    }
    #[test]
    fn qualified_allowlist_is_strict() {
        assert_eq!(split_qualified("server::tool"), Some(("server", "tool")));
        assert!(split_qualified("tool").is_none());
    }

    #[test]
    fn returns_json_rpc_errors_for_non_allowlisted_calls() {
        let response = McpGatewayService::handle(
            &[],
            &json!({"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"private__tool","arguments":{}}}),
        )
        .unwrap();
        assert_eq!(response["id"], 7);
        assert_eq!(response["error"]["code"], -32000);
    }

    #[test]
    fn exchanges_json_lines_with_a_stdio_server() {
        let response = exchange(
            &json!({
                "command": "/bin/sh",
                "args": ["-c", "IFS= read -r a; IFS= read -r b; IFS= read -r c; printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":2,\"result\":{\"tools\":[{\"name\":\"echo\"}]}}'"],
                "cwd": "/tmp"
            }),
            "tools/list",
            json!({}),
        )
        .unwrap();
        assert_eq!(response["tools"][0]["name"], "echo");
    }

    #[test]
    fn gateway_lists_and_calls_a_real_python_mcp_process() {
        let root = tempfile::tempdir().expect("temporary MCP directory");
        let script = root.path().join("echo_mcp.py");
        std::fs::write(
            &script,
            include_str!("../../../e2e/fixtures/mcp-echo-server.py"),
        )
        .expect("write MCP fixture");
        let config = json!({
            "command": "python3",
            "args": [script.to_string_lossy()],
            "cwd": root.path().to_string_lossy()
        });
        let resolve = |server: &str| {
            if server == "echo-live" {
                Ok(config.clone())
            } else {
                Err(AppError::NotFound(server.into()))
            }
        };
        let allowed = vec!["echo-live::echo_text".to_string()];

        let listed = McpGatewayService::handle_with_config(
            &allowed,
            &json!({"jsonrpc":"2.0","id":10,"method":"tools/list"}),
            &resolve,
        )
        .expect("list tools through gateway");
        let exposed_name = listed["result"]["tools"][0]["name"]
            .as_str()
            .expect("external tool name")
            .to_string();
        assert!(exposed_name.starts_with("echo_live__echo_text__"));

        let called = McpGatewayService::handle_with_config(
            &allowed,
            &json!({
                "jsonrpc":"2.0",
                "id":11,
                "method":"tools/call",
                "params":{"name":exposed_name,"arguments":{"text":"passerelle-réelle"}}
            }),
            &resolve,
        )
        .expect("call tool through gateway");
        assert_eq!(
            called["result"]["structuredContent"]["echo"],
            "passerelle-réelle"
        );
    }
}
