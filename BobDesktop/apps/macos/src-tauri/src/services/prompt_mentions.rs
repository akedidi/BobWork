use std::collections::HashSet;

use crate::db::Database;
use crate::error::AppResult;
use crate::services::plugin::PluginService;

pub fn canonical_plugin_mention_id(id: &str) -> &str {
    match id {
        "agentic-senior-cloud-architect" | "builtin-cloud-architect" => "agentic-cloud-architect",
        _ => id,
    }
}

pub fn plugin_reference_ids(db: &Database) -> AppResult<Vec<String>> {
    let mut ids = HashSet::new();
    for plugin in PluginService::new().get_all(db)? {
        ids.insert(plugin.id.clone());
        ids.insert(canonical_plugin_mention_id(&plugin.id).to_string());
        if let Some(slug) = plugin
            .manifest
            .get("slug")
            .and_then(serde_json::Value::as_str)
        {
            // Builtins and personal plugins: accept @plugin:<slug> and stripped
            // variants (visualize, powerpoint, bob-work-microsoft-powerpoint…).
            for key in crate::services::plugin::catalog_slug_keys(slug) {
                ids.insert(key);
            }
        }
        // Also accept catalog keys derived from the registry id itself.
        for key in crate::services::plugin::catalog_slug_keys(&plugin.id) {
            ids.insert(key);
        }
    }
    ids.insert("agentic-senior-cloud-architect".into());
    ids.insert("builtin-cloud-architect".into());
    Ok(ids.into_iter().collect())
}

fn longest_known_prefix<'a>(rest: &'a str, known_ids: &[String]) -> Option<&'a str> {
    known_ids
        .iter()
        .filter(|id| rest.starts_with(id.as_str()))
        .max_by_key(|id| id.len())
        .map(|id| &rest[..id.len()])
}

fn fallback_plugin_mention_id<'a>(rest: &'a str) -> Option<&'a str> {
    let end = rest
        .char_indices()
        .take_while(|(_, character)| character.is_ascii_alphanumeric() || *character == '-')
        .last()
        .map(|(index, character)| index + character.len_utf8())
        .unwrap_or(0);
    if end == 0 {
        None
    } else {
        Some(&rest[..end])
    }
}

pub fn match_plugin_mention_id<'a>(rest: &'a str, known_ids: &[String]) -> Option<&'a str> {
    longest_known_prefix(rest, known_ids).or_else(|| fallback_plugin_mention_id(rest))
}

pub fn collect_plugin_mention_ids(message: &str, known_ids: &[String]) -> Vec<String> {
    let marker = regex::Regex::new(r"@plugin:").unwrap();
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for mat in marker.find_iter(message) {
        let rest = &message[mat.end()..];
        let Some(raw) = match_plugin_mention_id(rest, known_ids) else {
            continue;
        };
        let id = canonical_plugin_mention_id(raw).to_string();
        if seen.insert(id.clone()) {
            out.push(id);
        }
    }
    out
}

fn detach_attached_plugin_mentions(message: &str, known_ids: &[String]) -> String {
    let marker = regex::Regex::new(r"@plugin:").unwrap();
    let mut result = String::new();
    let mut last_index = 0;
    for mat in marker.find_iter(message) {
        if last_index < mat.start() {
            result.push_str(&message[last_index..mat.start()]);
        }
        let rest = &message[mat.end()..];
        let Some(raw) = match_plugin_mention_id(rest, known_ids) else {
            result.push_str("@plugin:");
            last_index = mat.end();
            continue;
        };
        let tail = &rest[raw.len()..];
        let needs_space = !tail.is_empty()
            && !tail
                .chars()
                .next()
                .is_some_and(|character| character.is_whitespace() || character == '@');
        result.push_str("@plugin:");
        result.push_str(raw);
        if needs_space {
            result.push(' ');
        }
        last_index = mat.end() + raw.len();
    }
    if last_index < message.len() {
        result.push_str(&message[last_index..]);
    }
    result
}

pub fn normalize_plugin_mentions(message: &str, known_ids: &[String]) -> String {
    let detached = detach_attached_plugin_mentions(message, known_ids);
    let marker = regex::Regex::new(r"@plugin:").unwrap();
    let mut seen = HashSet::new();
    let mut result = String::new();
    let mut last_index = 0;
    for mat in marker.find_iter(&detached) {
        result.push_str(&detached[last_index..mat.start()]);
        let rest = &detached[mat.end()..];
        let Some(raw) = match_plugin_mention_id(rest, known_ids) else {
            result.push_str("@plugin:");
            last_index = mat.end();
            continue;
        };
        let canonical = canonical_plugin_mention_id(raw);
        if seen.insert(canonical.to_string()) {
            result.push_str("@plugin:");
            result.push_str(canonical);
        }
        last_index = mat.end() + raw.len();
    }
    result.push_str(&detached[last_index..]);
    regex::Regex::new(r"[ \t]{2,}")
        .unwrap()
        .replace_all(result.trim(), " ")
        .trim()
        .to_string()
}

pub fn translate_plugin_mentions(db: &Database, message: &str, known_ids: &[String]) -> String {
    let marker = regex::Regex::new(r"@plugin:").unwrap();
    let mut result = String::new();
    let mut last_index = 0;
    for mat in marker.find_iter(message) {
        result.push_str(&message[last_index..mat.start()]);
        let rest = &message[mat.end()..];
        let Some(raw) = match_plugin_mention_id(rest, known_ids) else {
            result.push_str("@plugin:");
            last_index = mat.end();
            continue;
        };
        let id = canonical_plugin_mention_id(raw);
        let replacement = PluginService::new()
            .get_by_reference(db, id)
            .ok()
            .flatten()
            .map(|plugin| {
                plugin
                    .manifest
                    .get("slug")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(&plugin.name)
                    .to_string()
            })
            .map(|value| {
                value
                    .to_lowercase()
                    .chars()
                    .map(|character| {
                        if character.is_ascii_alphanumeric() {
                            character
                        } else {
                            '-'
                        }
                    })
                    .collect::<String>()
            })
            .map(|value| format!("${}", value.trim_matches('-')))
            .unwrap_or_else(|| format!("@plugin:{id}"));
        result.push_str(&replacement);
        last_index = mat.end() + raw.len();
    }
    result.push_str(&message[last_index..]);
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn attached_prompt_text_is_detached_from_plugin_mention() {
        let known = vec!["builtin-word".to_string(), "bob-work-cto-invest".to_string()];
        assert_eq!(
            normalize_plugin_mentions("@plugin:builtin-wordAnalyse ce DOCX", &known),
            "@plugin:builtin-word Analyse ce DOCX"
        );
        assert_eq!(
            collect_plugin_mention_ids("@plugin:builtin-wordAnalyse ce DOCX", &known),
            vec!["builtin-word".to_string()]
        );
    }

    #[test]
    fn longest_known_plugin_id_wins_when_prefixes_overlap() {
        let known = vec![
            "bob-work-cto".to_string(),
            "bob-work-cto-invest".to_string(),
        ];
        assert_eq!(
            match_plugin_mention_id("bob-work-cto-invest go", &known),
            Some("bob-work-cto-invest")
        );
    }
}
