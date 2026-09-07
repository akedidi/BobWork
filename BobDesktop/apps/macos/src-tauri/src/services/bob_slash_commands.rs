// ============================================================
// Native Bob slash-command catalog
// Parsed from the installed bob.js when possible; otherwise fallback.
// ============================================================

use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct BobSlashCommand {
    pub name: String,
    pub description: String,
    pub source: String,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub alt_names: Vec<String>,
}

/// Built-ins shipped with Bob Shell 2.0 (`YEu` in bob.js). Used only when
/// the installed binary cannot be parsed.
pub fn fallback_slash_commands() -> Vec<BobSlashCommand> {
    [
        ("help", "Show available commands"),
        (
            "init",
            "Analyze codebase and create concise AGENTS.md files for AI assistants",
        ),
        ("clear", "Clear the screen and reset conversation history"),
        (
            "copy",
            "Copy an item from conversation history to the clipboard",
        ),
        ("condense", "Intelligently condense the context window"),
        ("exit", "Exit the CLI"),
        ("resume", "Browse and resume previous conversations"),
        ("team", "Select team"),
        ("manage-secrets", "Manage secrets for MCP configurations"),
        ("mcp", "Manage configured MCP servers"),
        ("mode", "Switch the active mode"),
        ("skills", "Insert a skill reference into the prompt"),
        (
            "status",
            "View Bob Shell task status, along with usage and version information",
        ),
        ("docs", "Open Bob Shell documentation in your browser"),
        ("logs", "Open the latest log file with system viewer"),
        ("bug", "Submit a bug report"),
        ("settings", "View and edit Bob Shell settings"),
        ("permissions", "View and change this folder's trust level"),
    ]
    .into_iter()
    .map(|(name, description)| BobSlashCommand {
        name: name.to_string(),
        description: description.to_string(),
        source: "fallback".into(),
        alt_names: Vec::new(),
    })
    .collect()
}

pub fn list_slash_commands(bob_path: Option<&str>) -> Vec<BobSlashCommand> {
    if let Some(path) = bob_path {
        if let Some(source) = read_bob_js(Path::new(path)) {
            let parsed = parse_builtin_slash_commands(&source);
            if !parsed.is_empty() {
                return parsed;
            }
        }
    }
    fallback_slash_commands()
}

fn read_bob_js(bob_path: &Path) -> Option<String> {
    let resolved = std::fs::canonicalize(bob_path).ok()?;
    let bytes = std::fs::read(&resolved).ok()?;
    if bytes.len() > 40_000_000 {
        return None;
    }
    let text = String::from_utf8_lossy(&bytes);
    if !text.contains("kind:\"built-in\"") {
        return None;
    }
    Some(text.into_owned())
}

pub fn parse_builtin_slash_commands(source: &str) -> Vec<BobSlashCommand> {
    let init_description = extract_quoted_assignment(source, "INIT_COMMAND_DESCRIPTION")
        .unwrap_or_else(|| "Initialize project context".into());
    let mut commands = Vec::new();
    let mut seen = std::collections::HashSet::new();
    let needle = "name:\"";
    let mut from = 0;
    while let Some(rel) = source[from..].find(needle) {
        let name_start = from + rel + needle.len();
        let Some(name_end) = source[name_start..].find('"') else {
            break;
        };
        let name = &source[name_start..name_start + name_end];
        from = name_start + name_end + 1;
        if name.is_empty()
            || !name
                .chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-')
        {
            continue;
        }
        let window_end = (from + 360).min(source.len());
        let window = &source[from..window_end];
        if !window.contains("kind:\"built-in\"") {
            continue;
        }
        if !seen.insert(name.to_string()) {
            continue;
        }
        let description = extract_description(window, name, &init_description);
        let alt_names = extract_alt_names(window);
        commands.push(BobSlashCommand {
            name: name.to_string(),
            description,
            source: "bob".into(),
            alt_names,
        });
    }
    commands
}

fn extract_description(window: &str, name: &str, init_description: &str) -> String {
    if name == "init" {
        return init_description.to_string();
    }
    if let Some(start) = window.find("description:\"") {
        let rest = &window[start + "description:\"".len()..];
        if let Some(end) = rest.find('"') {
            return rest[..end].to_string();
        }
    }
    name.to_string()
}

fn extract_alt_names(window: &str) -> Vec<String> {
    let Some(start) = window.find("altNames:[") else {
        return Vec::new();
    };
    let rest = &window[start + "altNames:[".len()..];
    let Some(end) = rest.find(']') else {
        return Vec::new();
    };
    rest[..end]
        .split(',')
        .filter_map(|item| {
            let item = item.trim().trim_matches('"');
            (!item.is_empty()).then(|| item.to_string())
        })
        .collect()
}

fn extract_quoted_assignment(source: &str, key: &str) -> Option<String> {
    let needle = format!("{key}=\"");
    let start = source.find(&needle)? + needle.len();
    let end = source[start..].find('"')?;
    Some(source[start..start + end].to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_bob_shell_builtin_catalog() {
        let source = r#"
            B5e.INIT_COMMAND_DESCRIPTION="Analyze codebase and create concise AGENTS.md files for AI assistants";
            var oAo={name:"bug",kind:"built-in",description:"Submit a bug report",directInvocation:!0,content:""};
            var sAo={name:"clear",description:"Clear the screen and reset conversation history",directInvocation:!0,kind:"built-in",content:""};
            var lAo={name:"condense",description:"Intelligently condense the context window",directInvocation:!0,kind:"built-in",content:""};
            var dAo={name:"exit",altNames:["quit","close"],description:"Exit the CLI",directInvocation:!0,kind:"built-in",content:""};
            var hAo={name:"init",kind:"built-in",description:zGt.INIT_COMMAND_DESCRIPTION,directInvocation:!0,content:zGt.INIT_BASE_PROMPT};
            var YEu=[fAo,hAo,sAo,lAo,dAo,oAo];
        "#;
        let commands = parse_builtin_slash_commands(source);
        let names: Vec<_> = commands.iter().map(|c| c.name.as_str()).collect();
        assert!(names.contains(&"condense"));
        assert!(names.contains(&"init"));
        assert!(names.contains(&"exit"));
        assert!(!names.contains(&"review"));
        let init = commands.iter().find(|c| c.name == "init").unwrap();
        assert!(init.description.contains("AGENTS.md"));
        let exit = commands.iter().find(|c| c.name == "exit").unwrap();
        assert_eq!(exit.alt_names, vec!["quit", "close"]);
    }

    #[test]
    fn fallback_includes_condense() {
        assert!(fallback_slash_commands()
            .iter()
            .any(|command| command.name == "condense"));
    }
}
