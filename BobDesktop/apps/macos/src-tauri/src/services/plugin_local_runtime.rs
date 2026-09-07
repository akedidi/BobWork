// ============================================================
// Probe host CLIs / binaries / packages required by a plugin.
// Used when @plugin:… is in the prompt: tell Bob to warn the user
// if the software is not installed on this Mac.
// ============================================================

use crate::models::plugin::Plugin;
use serde_json::Value;
use std::collections::HashSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MissingLocalTool {
    pub plugin_name: String,
    pub software: String,
    pub command: Option<String>,
    pub package: Option<String>,
    pub install_hint: String,
    pub can_self_install: bool,
}

pub fn missing_tools_for_plugin(plugin: &Plugin) -> Vec<MissingLocalTool> {
    missing_tools(&plugin.name, &plugin.manifest)
}

pub fn missing_tools(plugin_name: &str, manifest: &Value) -> Vec<MissingLocalTool> {
    let mut missing = Vec::new();
    let mut seen = HashSet::new();

    for runtime in required_host_runtimes(manifest) {
        if host_runtime_available(&runtime) {
            continue;
        }
        if !seen.insert(runtime.clone()) {
            continue;
        }
        missing.push(host_runtime_missing(plugin_name, &runtime));
    }

    for requirement in declared_cli_requirements(plugin_name, manifest) {
        if command_available(&requirement.command, &requirement.extra_paths) {
            continue;
        }
        if !seen.insert(requirement.command.clone()) {
            continue;
        }
        missing.push(MissingLocalTool {
            plugin_name: plugin_name.to_string(),
            software: requirement.software,
            command: Some(requirement.command),
            package: requirement.package,
            install_hint: requirement.install_hint,
            can_self_install: requirement.can_self_install && host_runtime_available("python3"),
        });
    }

    missing
}

pub fn prompt_block(tools: &[MissingLocalTool]) -> Option<String> {
    if tools.is_empty() {
        return None;
    }
    let mut lines = vec![
        "Prérequis locaux manquants — dis-le clairement à l’utilisateur, avant tout le reste :"
            .to_string(),
    ];
    for tool in tools {
        let mut line = format!(
            "- Plugin « {} » : {} n’est pas installé sur ce Mac.",
            tool.plugin_name, tool.software
        );
        if let Some(command) = tool.command.as_deref() {
            line.push_str(&format!(" Commande attendue : `{command}`."));
        }
        if let Some(package) = tool.package.as_deref() {
            line.push_str(&format!(" Package : `{package}`."));
        }
        if !tool.install_hint.trim().is_empty() {
            line.push_str(&format!(
                " Installation : {}.",
                tool.install_hint.trim().trim_end_matches('.')
            ));
        }
        lines.push(line);
    }
    lines.push(
        "Dis à l’utilisateur que ce logiciel / CLI / package doit être installé pour utiliser ce plugin.".to_string(),
    );
    lines.push(
        "Ne simule pas le résultat du plugin. Ne prétends pas qu’une conversion ou une commande a réussi.".to_string(),
    );
    if tools.iter().any(|tool| tool.can_self_install) {
        lines.push(
            "Si le plugin expose un outil d’installation locale (ex. docling_ensure_runtime) et que Python 3.10+ est présent, tu peux l’essayer ; si ça échoue, répète ce qu’il faut installer.".to_string(),
        );
    }
    Some(lines.join("\n"))
}

/// Readiness for a stdio-cli / bundled-bin / shell / node-cli resource card.
pub fn resource_readiness(
    plugin_name: &str,
    manifest: &Value,
    resource: &Value,
    kind: &str,
    optional: bool,
) -> (String, String, Option<String>) {
    match kind {
        "node-cli" if !host_runtime_available("node") => {
            return (
                if optional {
                    "inactive".into()
                } else {
                    "needs_setup".into()
                },
                "Node.js n’est pas installé sur ce Mac.".into(),
                Some("Installez Node.js (nodejs.org ou `brew install node`).".into()),
            );
        }
        "shell" => {
            return (
                "ready".into(),
                "Script shell du plugin disponible.".into(),
                None,
            );
        }
        _ => {}
    }
    let missing = missing_tools(plugin_name, manifest)
        .into_iter()
        .filter(|tool| resource_matches_tool(resource, tool))
        .collect::<Vec<_>>();
    if missing.is_empty() {
        let message = match kind {
            "bundled-bin" => "Binaire trouvé (bundle plugin ou PATH).",
            "shell" => "Script shell du plugin disponible.",
            "node-cli" => "CLI Node du plugin disponible.",
            _ => "CLI locale détectée.",
        };
        return ("ready".into(), message.into(), None);
    }
    let tool = &missing[0];
    let hint = if tool.install_hint.trim().is_empty() {
        format!("Installez {} pour utiliser ce plugin.", tool.software)
    } else {
        tool.install_hint.clone()
    };
    if optional {
        (
            "inactive".into(),
            format!("{} introuvable sur ce Mac.", tool.software),
            Some(hint),
        )
    } else {
        (
            "needs_setup".into(),
            format!("{} n’est pas installé sur ce Mac.", tool.software),
            Some(hint),
        )
    }
}

struct CliRequirement {
    command: String,
    software: String,
    package: Option<String>,
    install_hint: String,
    extra_paths: Vec<PathBuf>,
    can_self_install: bool,
}

fn required_host_runtimes(manifest: &Value) -> Vec<String> {
    let mut runtimes = Vec::new();
    if let Some(entrypoints) = manifest.get("entrypoints").and_then(Value::as_array) {
        for entry in entrypoints {
            match entry.get("runtime").and_then(Value::as_str).unwrap_or("") {
                "python3" => runtimes.push("python3".into()),
                "node" => runtimes.push("node".into()),
                _ => {}
            }
        }
    }
    if let Some(runtime) = manifest.get("runtime") {
        if runtime.get("python").is_some() {
            runtimes.push("python3".into());
        }
        if runtime.get("node").and_then(Value::as_bool) == Some(true) {
            runtimes.push("node".into());
        }
    }
    runtimes.sort();
    runtimes.dedup();
    runtimes
}

fn host_runtime_available(runtime: &str) -> bool {
    match runtime {
        "python3" => command_on_path("python3") || command_on_path("python"),
        "node" => command_on_path("node"),
        _ => command_on_path(runtime),
    }
}

fn host_runtime_missing(plugin_name: &str, runtime: &str) -> MissingLocalTool {
    match runtime {
        "python3" => MissingLocalTool {
            plugin_name: plugin_name.to_string(),
            software: "Python 3.10+".to_string(),
            command: Some("python3".into()),
            package: Some("python3".into()),
            install_hint: "Installez Python 3.10+ (python.org ou `brew install python`)".into(),
            can_self_install: false,
        },
        "node" => MissingLocalTool {
            plugin_name: plugin_name.to_string(),
            software: "Node.js".to_string(),
            command: Some("node".into()),
            package: Some("node".into()),
            install_hint: "Installez Node.js (nodejs.org ou `brew install node`)".into(),
            can_self_install: false,
        },
        other => MissingLocalTool {
            plugin_name: plugin_name.to_string(),
            software: other.to_string(),
            command: Some(other.into()),
            package: Some(other.into()),
            install_hint: format!("Installez `{other}`"),
            can_self_install: false,
        },
    }
}

fn declared_cli_requirements(plugin_name: &str, manifest: &Value) -> Vec<CliRequirement> {
    let mut requirements = Vec::new();
    let resources = manifest
        .get("resources")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    for resource in &resources {
        let kind = resource.get("kind").and_then(Value::as_str).unwrap_or("");
        if !matches!(kind, "stdio-cli" | "bundled-bin") {
            continue;
        }
        if resource.get("optional").and_then(Value::as_bool) == Some(true) {
            continue;
        }
        let Some(command) = inferred_command(plugin_name, manifest, resource, kind) else {
            continue;
        };
        if command == "python3" || command == "node" {
            continue;
        }
        let label = resource
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or(&command);
        let package = resource
            .get("package")
            .and_then(Value::as_str)
            .map(str::to_string)
            .or_else(|| Some(command.clone()));
        let install_hint = resource
            .get("installHint")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| {
                default_install_hint(&command, package.as_deref(), is_docling(manifest))
            });
        let extra_paths = extra_search_paths(manifest, &command);
        let bundled = bundled_binary_path(manifest, &command);
        let mut paths = extra_paths;
        if let Some(path) = bundled {
            paths.push(path);
        }
        requirements.push(CliRequirement {
            software: label.to_string(),
            command,
            package,
            install_hint,
            extra_paths: paths,
            can_self_install: is_docling(manifest),
        });
    }
    requirements
}

fn inferred_command(
    plugin_name: &str,
    manifest: &Value,
    resource: &Value,
    kind: &str,
) -> Option<String> {
    if let Some(command) = resource
        .get("command")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(command.to_string());
    }
    if let Some(binary) = resource
        .get("binary")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        return Some(
            Path::new(binary)
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or(binary)
                .to_string(),
        );
    }
    if is_docling(manifest) {
        return Some("docling".into());
    }
    if kind == "bundled-bin" {
        let label = resource
            .get("label")
            .and_then(Value::as_str)
            .unwrap_or(plugin_name);
        let slug = slugify(label);
        if !slug.is_empty() {
            return Some(slug);
        }
    }
    None
}

fn default_install_hint(command: &str, package: Option<&str>, docling: bool) -> String {
    if docling || command == "docling" {
        return "Python ≥ 3.10, puis `pip install 'docling==2.123.0'` ou l’outil MCP docling_ensure_runtime (venv ~/.bob/runtimes/docling)".into();
    }
    let pkg = package.unwrap_or(command);
    format!("`brew install {pkg}` ou installez la CLI `{command}`")
}

fn extra_search_paths(manifest: &Value, command: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if command == "docling" || is_docling(manifest) {
        if let Some(env_bin) = std::env::var_os("DOCLING_BIN") {
            paths.push(PathBuf::from(env_bin));
        }
        let root = bob_home().join("runtimes").join("docling");
        if let Ok(entries) = std::fs::read_dir(&root) {
            for entry in entries.flatten() {
                let bin = entry.path().join("bin").join("docling");
                paths.push(bin);
            }
        }
        paths.push(root.join("bin").join("docling"));
    }
    paths
}

fn bundled_binary_path(manifest: &Value, command: &str) -> Option<PathBuf> {
    let bundle = manifest.get("bundlePath").and_then(Value::as_str)?;
    let root = PathBuf::from(bundle);
    let direct = root.join("bin").join(command);
    if is_executable(&direct) {
        return Some(direct);
    }
    let vendor = root.join("vendor");
    find_named_binary(&vendor, command)
}

fn find_named_binary(dir: &Path, command: &str) -> Option<PathBuf> {
    let candidate = dir.join(command);
    if is_executable(&candidate) {
        return Some(candidate);
    }
    let nested = dir.join("bin").join(command);
    if is_executable(&nested) {
        return Some(nested);
    }
    let entries = std::fs::read_dir(dir).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_named_binary(&path, command) {
                return Some(found);
            }
        }
    }
    None
}

fn command_available(command: &str, extra_paths: &[PathBuf]) -> bool {
    extra_paths.iter().any(|path| is_executable(path)) || command_on_path(command)
}

fn command_on_path(command: &str) -> bool {
    which::which(command)
        .map(|path| is_executable(&path))
        .unwrap_or(false)
}

fn is_executable(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        path.metadata()
            .map(|meta| meta.permissions().mode() & 0o111 != 0)
            .unwrap_or(false)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn is_docling(manifest: &Value) -> bool {
    let slug = manifest
        .get("slug")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_ascii_lowercase();
    slug == "bob-work-docling" || slug == "docling" || slug.ends_with("-docling")
}

fn slugify(value: &str) -> String {
    let slug = value
        .to_ascii_lowercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '-' })
        .collect::<String>();
    slug.trim_matches('-').to_string()
}

fn bob_home() -> PathBuf {
    std::env::var("BOB_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".bob")))
        .unwrap_or_else(|| PathBuf::from(".bob"))
}

fn resource_matches_tool(resource: &Value, tool: &MissingLocalTool) -> bool {
    if let Some(command) = tool.command.as_deref() {
        if resource.get("command").and_then(Value::as_str) == Some(command) {
            return true;
        }
        if resource.get("label").and_then(Value::as_str) == Some(tool.software.as_str()) {
            return true;
        }
        if command == "docling" {
            return resource
                .get("label")
                .and_then(Value::as_str)
                .is_some_and(|label| label.to_ascii_lowercase().contains("docling"));
        }
        if resource
            .get("label")
            .and_then(Value::as_str)
            .is_some_and(|label| slugify(label) == command)
        {
            return true;
        }
    }
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_unknown_cli_is_reported() {
        let manifest = serde_json::json!({
            "name": "Diagrammes",
            "slug": "diagram-kit",
            "resources": [{
                "kind": "stdio-cli",
                "label": "CLI introuvable",
                "command": "bob-work-missing-cli-xyz",
                "package": "bob-work-missing-cli-xyz",
                "installHint": "brew install bob-work-missing-cli-xyz",
                "optional": false
            }]
        });
        let missing = missing_tools("Diagrammes", &manifest);
        assert_eq!(missing.len(), 1);
        assert_eq!(
            missing[0].command.as_deref(),
            Some("bob-work-missing-cli-xyz")
        );
        let prompt = prompt_block(&missing).expect("prompt");
        assert!(prompt.contains("Plugin « Diagrammes »"));
        assert!(prompt.contains("`bob-work-missing-cli-xyz`"));
        assert!(prompt.contains("doit être installé"));
        assert!(prompt.contains("Ne simule pas"));
    }

    #[test]
    fn present_unix_cli_is_not_reported() {
        let manifest = serde_json::json!({
            "slug": "ls-kit",
            "resources": [{
                "kind": "stdio-cli",
                "label": "ls",
                "command": "ls",
                "optional": false
            }]
        });
        assert!(missing_tools("ls-kit", &manifest).is_empty());
    }

    #[test]
    fn docling_venv_binary_counts_as_installed() {
        let root = std::env::temp_dir().join(format!("bob-docling-home-{}", uuid::Uuid::new_v4()));
        let bin = root.join("runtimes/docling/2.123.0/bin/docling");
        std::fs::create_dir_all(bin.parent().unwrap()).expect("dir");
        std::fs::write(&bin, "#!/bin/sh\necho docling 2.123.0\n").expect("bin");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&bin, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        }
        let previous = std::env::var("BOB_HOME").ok();
        std::env::set_var("BOB_HOME", &root);
        let manifest = serde_json::json!({
            "slug": "bob-work-docling",
            "resources": [{
                "kind": "stdio-cli",
                "label": "CLI Docling 2.123.0",
                "command": "docling",
                "package": "docling",
                "optional": false
            }]
        });
        let missing = missing_tools("Docling", &manifest);
        match previous {
            Some(value) => std::env::set_var("BOB_HOME", value),
            None => std::env::remove_var("BOB_HOME"),
        }
        let _ = std::fs::remove_dir_all(&root);
        assert!(
            missing
                .iter()
                .all(|tool| tool.command.as_deref() != Some("docling")),
            "docling venv should count as installed: {missing:?}"
        );
    }

    #[test]
    fn bundled_binary_in_plugin_dir_is_ready() {
        let bundle = std::env::temp_dir().join(format!("bob-bundle-{}", uuid::Uuid::new_v4()));
        let echo = bundle.join("bin/echo-tool");
        std::fs::create_dir_all(echo.parent().unwrap()).expect("dir");
        std::fs::write(&echo, "#!/bin/sh\necho ok\n").expect("bin");
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&echo, std::fs::Permissions::from_mode(0o755)).expect("chmod");
        }
        let manifest = serde_json::json!({
            "bundlePath": bundle.to_string_lossy(),
            "resources": [{
                "kind": "bundled-bin",
                "label": "echo-tool",
                "optional": false
            }]
        });
        let missing = missing_tools("kit", &manifest);
        let _ = std::fs::remove_dir_all(&bundle);
        assert!(missing.is_empty(), "{missing:?}");
    }

    #[test]
    fn prompt_tells_bob_not_to_fake_plugin_output() {
        let prompt = prompt_block(&[MissingLocalTool {
            plugin_name: "Docling".into(),
            software: "CLI Docling 2.123.0".into(),
            command: Some("docling".into()),
            package: Some("docling".into()),
            install_hint: "Python ≥ 3.10".into(),
            can_self_install: true,
        }])
        .expect("prompt");
        assert!(prompt.contains("docling_ensure_runtime"));
        assert!(prompt.contains("Docling"));
    }
}
