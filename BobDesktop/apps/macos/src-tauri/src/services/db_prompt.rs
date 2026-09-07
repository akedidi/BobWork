use crate::db::Database;
use crate::error::AppResult;
use crate::models::workspace::{DbConnection, DbConnectionConfig, SaveDbConnectionInput};
use crate::services::db_connection::{slugify_name, DbConnectionService};
use crate::services::plugin_user_resources::PluginUserResourceService;
use serde::Deserialize;
use std::path::Path;
use tracing::warn;

#[derive(Debug, Clone)]
pub struct PromptDbSpec {
    pub name: String,
    pub engine: String,
    pub config: DbConnectionConfig,
    pub secret: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SidecarDbSpec {
    #[serde(default)]
    name: Option<String>,
    engine: Option<String>,
    #[serde(default)]
    host: Option<String>,
    #[serde(default)]
    port: Option<u16>,
    #[serde(default)]
    database: Option<String>,
    #[serde(default)]
    username: Option<String>,
    #[serde(default)]
    password: Option<String>,
    #[serde(default)]
    secret: Option<String>,
    #[serde(default)]
    uri: Option<String>,
    #[serde(default)]
    url: Option<String>,
    #[serde(default)]
    file_path: Option<String>,
    #[serde(default)]
    ssl: Option<bool>,
}

impl SidecarDbSpec {
    fn into_prompt_spec(self, fallback_name: &str) -> Option<PromptDbSpec> {
        let engine = self.engine.as_deref().unwrap_or("").trim();
        if engine.is_empty() {
            return None;
        }
        let name = self
            .name
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or(fallback_name)
            .to_string();
        Some(PromptDbSpec {
            name,
            engine: engine.to_string(),
            config: DbConnectionConfig {
                host: self.host,
                port: self.port,
                database: self.database,
                username: self.username,
                ssl: self.ssl,
                file_path: self.file_path,
                uri: self.uri,
                url: self.url,
                ..Default::default()
            },
            secret: self
                .password
                .or(self.secret)
                .filter(|value| !value.trim().is_empty()),
        })
    }
}

pub fn parse_prompt_db_specs(text: &str) -> Vec<PromptDbSpec> {
    let mut specs = Vec::new();
    specs.extend(parse_connection_urls(text));
    specs.extend(parse_json_blocks(text));
    if let Some(labeled) = parse_labeled_fields(text) {
        if !specs
            .iter()
            .any(|item| item.engine == labeled.engine && item.config.host == labeled.config.host)
        {
            specs.push(labeled);
        }
    }
    specs
}

pub fn provision_for_plugin(
    db: &Database,
    plugin_id: &str,
    fallback_name: &str,
    specs: &[PromptDbSpec],
) -> AppResult<Vec<DbConnection>> {
    let svc = DbConnectionService::new();
    let overlay = PluginUserResourceService::new();
    let mut saved = Vec::new();
    for (index, spec) in specs.iter().enumerate() {
        let mut name = spec.name.clone();
        if name.trim().is_empty() || name == "db" {
            name = if index == 0 {
                fallback_name.to_string()
            } else {
                format!("{fallback_name}-{}", index + 1)
            };
        }
        let mut input = SaveDbConnectionInput {
            id: None,
            name,
            engine: spec.engine.clone(),
            config: spec.config.clone(),
            secret: spec.secret.clone(),
            enabled: true,
        };
        if let Ok(slug) = slugify_name(&input.name) {
            if let Ok(Some(existing)) = svc.get_by_name(db, &slug) {
                input.id = Some(existing.id);
            }
        }
        match svc.save(db, input) {
            Ok(connection) => {
                if let Err(error) =
                    overlay.link_database(plugin_id, &connection.id, &connection.name)
                {
                    warn!(
                        "Unable to link DB {} to plugin {plugin_id}: {error:?}",
                        connection.name
                    );
                }
                saved.push(connection);
            }
            Err(error) => {
                warn!("Unable to save prompt DB connection for plugin {plugin_id}: {error:?}")
            }
        }
    }
    Ok(saved)
}

pub fn provision_sidecar(
    db: &Database,
    plugin_id: &str,
    bundle_dir: &Path,
) -> AppResult<Vec<DbConnection>> {
    let path = bundle_dir.join(".bob-work-db.json");
    if !path.is_file() {
        return Ok(vec![]);
    }
    let raw = std::fs::read_to_string(&path)?;
    let specs = sidecar_specs(&raw, plugin_id);
    let saved = provision_for_plugin(db, plugin_id, plugin_id, &specs)?;
    let _ = std::fs::remove_file(&path);
    Ok(saved)
}

fn sidecar_specs(raw: &str, fallback_name: &str) -> Vec<PromptDbSpec> {
    if let Ok(items) = serde_json::from_str::<Vec<SidecarDbSpec>>(raw) {
        return items
            .into_iter()
            .filter_map(|item| item.into_prompt_spec(fallback_name))
            .collect();
    }
    if let Ok(item) = serde_json::from_str::<SidecarDbSpec>(raw) {
        return item.into_prompt_spec(fallback_name).into_iter().collect();
    }
    parse_prompt_db_specs(raw)
}

fn parse_connection_urls(text: &str) -> Vec<PromptDbSpec> {
    let Ok(regex) = regex::Regex::new(
        r#"(?i)\b(?:jdbc:)?(postgresql|postgres|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|mssql|sqlserver|oracle|db2|ibm-db2|clickhouse|sqlite)(?::[a-z0-9.]+)?://[^\s'"<>]+"#,
    ) else {
        return vec![];
    };
    regex
        .find_iter(text)
        .filter_map(|found| parse_one_url(found.as_str()))
        .collect()
}

fn parse_one_url(raw: &str) -> Option<PromptDbSpec> {
    let trimmed = raw.trim_end_matches(['.', ',', ';', ')', ']']);
    let without_jdbc = trimmed.strip_prefix("jdbc:").unwrap_or(trimmed);
    let (scheme, rest) = without_jdbc.split_once("://")?;
    let engine = engine_from_scheme(scheme)?;
    let (authority, path_and_query) = rest
        .split_once('/')
        .map(|(a, p)| (a, Some(p)))
        .unwrap_or((rest, None));
    let (userinfo, hostport) = authority
        .rsplit_once('@')
        .map(|(user, host)| (Some(user), host))
        .unwrap_or((None, authority));
    let (username, secret) = match userinfo {
        Some(info) => {
            if let Some((user, password)) = info.split_once(':') {
                (Some(percent_decode(user)), Some(percent_decode(password)))
            } else {
                (Some(percent_decode(info)), None)
            }
        }
        None => (None, None),
    };
    let (host, port) = if let Some((host, port)) = hostport.rsplit_once(':') {
        (host.trim().to_string(), port.parse().ok())
    } else {
        (hostport.trim().to_string(), None)
    };
    let mut database = path_and_query
        .map(|path| {
            path.split(['?', ';', '#'])
                .next()
                .unwrap_or(path)
                .trim()
                .trim_end_matches('/')
                .to_string()
        })
        .filter(|value| !value.is_empty());
    let mut extra_secret = secret;
    if let Some(query) = path_and_query.and_then(|path| {
        path.split_once('?')
            .map(|(_, q)| q)
            .or_else(|| path.split_once(';').map(|(_, q)| q))
    }) {
        for part in query.split([';', '&']) {
            let Some((key, value)) = part.split_once('=') else {
                continue;
            };
            match key.trim().to_ascii_lowercase().as_str() {
                "user" | "username" | "uid" => {
                    // keep URL userinfo first
                }
                "password" | "pwd" => {
                    if extra_secret.is_none() {
                        extra_secret = Some(percent_decode(value));
                    }
                }
                "database" | "dbname" | "currentSchema" => {
                    if database.as_deref().unwrap_or("").is_empty() {
                        database = Some(percent_decode(value));
                    }
                }
                _ => {}
            }
        }
    }
    if engine == "sqlite" {
        let file_path = path_and_query
            .map(|path| format!("/{path}"))
            .filter(|path| path.len() > 1)
            .or_else(|| (!host.is_empty()).then_some(host.clone()))?;
        return Some(PromptDbSpec {
            name: Path::new(&file_path)
                .file_stem()
                .and_then(|value| value.to_str())
                .unwrap_or("sqlite")
                .to_string(),
            engine: "sqlite".into(),
            config: DbConnectionConfig {
                file_path: Some(file_path),
                ..Default::default()
            },
            secret: None,
        });
    }
    if engine == "mongodb" {
        return Some(PromptDbSpec {
            name: database.clone().unwrap_or_else(|| "mongo".into()),
            engine: "mongodb".into(),
            config: DbConnectionConfig {
                uri: Some(trimmed.to_string()),
                host: (!host.is_empty()).then_some(host),
                port,
                database,
                username,
                ..Default::default()
            },
            secret: extra_secret,
        });
    }
    if host.is_empty() {
        return None;
    }
    Some(PromptDbSpec {
        name: database.clone().unwrap_or_else(|| engine.to_string()),
        engine: engine.to_string(),
        config: DbConnectionConfig {
            host: Some(host),
            port,
            database,
            username,
            ssl: matches!(scheme, "rediss" | "https").then_some(true),
            ..Default::default()
        },
        secret: extra_secret,
    })
}

fn engine_from_scheme(scheme: &str) -> Option<&'static str> {
    match scheme.to_ascii_lowercase().as_str() {
        "postgres" | "postgresql" => Some("postgresql"),
        "mysql" => Some("mysql"),
        "mariadb" => Some("mariadb"),
        "mongodb" | "mongodb+srv" => Some("mongodb"),
        "redis" | "rediss" => Some("redis"),
        "mssql" | "sqlserver" => Some("sqlserver"),
        "oracle" => Some("oracle"),
        "db2" | "ibm-db2" => Some("db2"),
        "clickhouse" => Some("clickhouse"),
        "sqlite" | "file" => Some("sqlite"),
        _ => None,
    }
}

fn infer_engine(text: &str) -> Option<String> {
    if let Some(value) = labeled(text, &["moteur", "engine"]) {
        let lower = value.to_ascii_lowercase();
        if lower.contains("db2") {
            return Some("db2".into());
        }
        return Some(value);
    }
    let lower = text.to_lowercase();
    if lower.contains("db2") {
        return Some("db2".into());
    }
    if lower.contains("postgres") {
        return Some("postgresql".into());
    }
    if lower.contains("mysql") {
        return Some("mysql".into());
    }
    None
}

fn parse_labeled_fields(text: &str) -> Option<PromptDbSpec> {
    let engine = infer_engine(text)?;
    let host = labeled(text, &["hôte", "hote", "host", "hostname"]);
    let database = labeled(text, &["base", "database", "dbname"]);
    if host.is_none() && database.is_none() && engine != "sqlite" {
        return None;
    }
    let port = labeled(text, &["port"]).and_then(|value| value.parse().ok());
    let username = labeled(text, &["utilisateur", "username", "user"]);
    let secret = labeled(text, &["mot de passe", "password", "passwd", "pwd"]);
    let name = labeled(text, &["nom", "name", "connexion"])
        .unwrap_or_else(|| database.clone().unwrap_or_else(|| engine.clone()));
    Some(PromptDbSpec {
        name,
        engine,
        config: DbConnectionConfig {
            host,
            port,
            database,
            username,
            ..Default::default()
        },
        secret,
    })
}

fn labeled(text: &str, keys: &[&str]) -> Option<String> {
    for key in keys {
        let pattern = format!(r"(?im)^\s*(?:{})\s*[:=]\s*(.+)$", regex::escape(key));
        if let Ok(regex) = regex::Regex::new(&pattern) {
            if let Some(captures) = regex.captures(text) {
                let value = captures.get(1)?.as_str().trim().trim_matches(['"', '\'']);
                if !value.is_empty() {
                    return Some(value.to_string());
                }
            }
        }
    }
    None
}

fn parse_json_blocks(text: &str) -> Vec<PromptDbSpec> {
    let Ok(regex) = regex::Regex::new(r"(?s)```(?:bob-work-db|json)\s*(\{.*?\}|\[.*?\])\s*```")
    else {
        return vec![];
    };
    regex
        .captures_iter(text)
        .flat_map(|captures| sidecar_specs(captures.get(1).map(|m| m.as_str()).unwrap_or(""), "db"))
        .collect()
}

fn percent_decode(raw: &str) -> String {
    let mut out = Vec::with_capacity(raw.len());
    let bytes = raw.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(value) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(value);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::services::keychain::init_secret_vault;
    use crate::services::plugin_user_resources::set_test_bob_home;

    fn temp_db() -> Database {
        let dir = std::env::temp_dir().join(format!("bob-db-prompt-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        init_secret_vault(&dir);
        set_test_bob_home(dir);
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        db
    }

    #[test]
    fn parses_postgres_url_with_password() {
        let specs = parse_prompt_db_specs(
            "Crée un plugin pour postgres://bob:s3cret@db.internal:5432/sales",
        );
        assert_eq!(specs.len(), 1);
        assert_eq!(specs[0].engine, "postgresql");
        assert_eq!(specs[0].config.host.as_deref(), Some("db.internal"));
        assert_eq!(specs[0].config.port, Some(5432));
        assert_eq!(specs[0].config.database.as_deref(), Some("sales"));
        assert_eq!(specs[0].config.username.as_deref(), Some("bob"));
        assert_eq!(specs[0].secret.as_deref(), Some("s3cret"));
    }

    #[test]
    fn parses_ibm_db2_jdbc_url() {
        let specs = parse_prompt_db_specs(
            "Plugin inventaire jdbc:db2://db2.ibm.local:50000/SAMPLE user déjà dans l’URL",
        );
        assert_eq!(specs[0].engine, "db2");
        assert_eq!(specs[0].config.host.as_deref(), Some("db2.ibm.local"));
        assert_eq!(specs[0].config.port, Some(50000));
        assert_eq!(specs[0].config.database.as_deref(), Some("SAMPLE"));
    }

    #[test]
    fn parses_labeled_db2_fields() {
        let specs = parse_prompt_db_specs(
            "Crée un plugin Db2\nmoteur: db2\nhôte: db2.internal\nport: 50000\nbase: FINANCE\nutilisateur: db2inst1\nmot de passe: hunter2\n",
        );
        let spec = specs.iter().find(|item| item.engine == "db2").expect("db2");
        assert_eq!(spec.config.host.as_deref(), Some("db2.internal"));
        assert_eq!(spec.config.database.as_deref(), Some("FINANCE"));
        assert_eq!(spec.secret.as_deref(), Some("hunter2"));
    }

    #[test]
    fn provisions_connection_and_links_plugin_without_secret_in_sqlite() {
        let db = temp_db();
        let specs = parse_prompt_db_specs("postgres://analyst:top-secret@localhost:5432/crm");
        let saved = provision_for_plugin(&db, "agentic-crm", "crm", &specs).unwrap();
        assert_eq!(saved.len(), 1);
        assert!(saved[0].has_secret);
        let raw: String = db
            .connection()
            .query_row(
                "SELECT config FROM db_connections WHERE id=?1",
                [saved[0].id.as_str()],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!raw.contains("top-secret"));
        let linked = PluginUserResourceService::new()
            .list_linked_databases("agentic-crm")
            .unwrap();
        assert_eq!(linked.len(), 1);
        assert_eq!(linked[0].name, saved[0].name);
    }
}
