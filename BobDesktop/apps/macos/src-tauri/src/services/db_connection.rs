use crate::db::Database;
use crate::error::{AppError, AppResult};
use crate::models::plugin::{ConnectionTestSummary, PluginMcpTestResult};
use crate::models::workspace::{
    DbConnection, DbConnectionConfig, DbConnectionTestResult, SaveDbConnectionInput,
};
use crate::services::connection_test::{ConnectionTestRecord, ConnectionTestService};
use crate::services::keychain::KeychainService;
use chrono::Utc;
use rusqlite::params;
use std::collections::HashMap;
use std::net::{TcpStream, ToSocketAddrs};
use std::path::Path;
use std::time::Duration;
use uuid::Uuid;

pub const ENGINES: &[&str] = &[
    "oracle",
    "mysql",
    "sqlserver",
    "postgresql",
    "mongodb",
    "redis",
    "elasticsearch",
    "db2",
    "sqlite",
    "snowflake",
    "mariadb",
    "cassandra",
    "dynamodb",
    "bigquery",
    "clickhouse",
];

const TCP_TIMEOUT: Duration = Duration::from_secs(3);

pub struct DbConnectionService;

impl DbConnectionService {
    pub fn new() -> Self {
        Self
    }

    pub fn list(&self, db: &Database) -> AppResult<Vec<DbConnection>> {
        let tests = ConnectionTestService::new().list(db)?;
        let conn = db.connection();
        let mut statement = conn.prepare(
            "SELECT id, name, engine, config, enabled, created_at, updated_at
             FROM db_connections ORDER BY name COLLATE NOCASE",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, i64>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })?;
        let mut out = Vec::new();
        for row in rows {
            let (id, name, engine, config_json, enabled, created_at, updated_at) = row?;
            out.push(self.hydrate(
                &id,
                name,
                engine,
                &config_json,
                enabled != 0,
                created_at,
                updated_at,
                tests.get(&Self::test_key(&id)),
            )?);
        }
        Ok(out)
    }

    pub fn get_by_id(&self, db: &Database, id: &str) -> AppResult<Option<DbConnection>> {
        Ok(self.list(db)?.into_iter().find(|item| item.id == id))
    }

    pub fn get_by_name(&self, db: &Database, name: &str) -> AppResult<Option<DbConnection>> {
        let needle = slugify_name(name)?;
        Ok(self.list(db)?.into_iter().find(|item| item.name == needle))
    }

    pub fn save(&self, db: &Database, input: SaveDbConnectionInput) -> AppResult<DbConnection> {
        let name = slugify_name(&input.name)?;
        let engine = normalize_engine(&input.engine)?;
        validate_config(engine, &input.config)?;
        let now = Utc::now().to_rfc3339();
        let config_json = serde_json::to_string(&input.config)?;
        let existing_id = input
            .id
            .as_deref()
            .filter(|value| !value.trim().is_empty())
            .map(str::to_string);
        if let Some(other) = self.get_by_name(db, &name)? {
            if existing_id.as_deref() != Some(other.id.as_str()) {
                return Err(AppError::ValidationFailed(format!(
                    "Une connexion « {name} » existe déjà."
                )));
            }
        }

        let (id, created_at) = if let Some(id) = existing_id {
            let current = self
                .get_by_id(db, &id)?
                .ok_or_else(|| AppError::NotFound(format!("Connexion {id} introuvable")))?;
            db.connection().execute(
                "UPDATE db_connections SET name=?1, engine=?2, config=?3, enabled=?4, updated_at=?5 WHERE id=?6",
                params![name, engine, config_json, input.enabled as i64, now, id],
            )?;
            (id, current.created_at)
        } else {
            let id = Uuid::new_v4().to_string();
            db.connection().execute(
                "INSERT INTO db_connections (id, name, engine, config, enabled, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7)",
                params![id, name, engine, config_json, input.enabled as i64, now, now],
            )?;
            (id, now)
        };

        if let Some(secret) = input
            .secret
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            KeychainService::new().set(&Self::vault_key(&id), secret)?;
        }

        self.get_by_id(db, &id)?
            .ok_or_else(|| AppError::Database("Connexion introuvable après enregistrement".into()))
            .map(|mut connection| {
                connection.created_at = created_at;
                connection
            })
    }

    pub fn set_enabled(&self, db: &Database, id: &str, enabled: bool) -> AppResult<()> {
        let updated = db.connection().execute(
            "UPDATE db_connections SET enabled=?1, updated_at=?2 WHERE id=?3",
            params![enabled as i64, Utc::now().to_rfc3339(), id],
        )?;
        if updated == 0 {
            return Err(AppError::NotFound(format!("Connexion {id} introuvable")));
        }
        Ok(())
    }

    pub fn delete(&self, db: &Database, id: &str) -> AppResult<()> {
        let deleted = db
            .connection()
            .execute("DELETE FROM db_connections WHERE id=?1", params![id])?;
        if deleted == 0 {
            return Err(AppError::NotFound(format!("Connexion {id} introuvable")));
        }
        let _ = KeychainService::new().delete(&Self::vault_key(id));
        Ok(())
    }

    pub fn test(&self, db: &Database, id: &str) -> AppResult<DbConnectionTestResult> {
        let connection = self
            .get_by_id(db, id)?
            .ok_or_else(|| AppError::NotFound(format!("Connexion {id} introuvable")))?;
        let result = probe_connection(&connection, self.secret_for(&connection.id))?;
        let record = ConnectionTestRecord {
            id: connection.id.clone(),
            name: connection.name.clone(),
            ok: result.ok,
            message: result.message.clone(),
            tools: vec![],
            tested_at: result.tested_at.clone(),
            kind: "db".into(),
        };
        ConnectionTestService::new().save_record(db, &Self::test_key(&connection.id), record)?;
        Ok(result)
    }

    pub fn mentioned_names(message: &str) -> Vec<String> {
        let Ok(regex) = regex::Regex::new(r"@db:([A-Za-z0-9._-]+)") else {
            return vec![];
        };
        let mut seen = std::collections::HashSet::new();
        let mut names = Vec::new();
        for captures in regex.captures_iter(message) {
            let name = captures[1].to_string();
            if seen.insert(name.clone()) {
                names.push(name);
            }
        }
        names
    }

    pub fn resolve_mentioned(&self, db: &Database, message: &str) -> AppResult<Vec<DbConnection>> {
        let listed = self.list(db)?;
        let mut out = Vec::new();
        for name in Self::mentioned_names(message) {
            if let Some(connection) = listed.iter().find(|item| item.name == name) {
                out.push(connection.clone());
            }
        }
        Ok(out)
    }

    pub fn prompt_context(connections: &[DbConnection]) -> Option<String> {
        if connections.is_empty() {
            return None;
        }
        let mut lines = vec![
            "Connexions base de données disponibles (utilise les variables d’environnement nommées, sans jamais les afficher ni les coller dans le chat) :".into(),
        ];
        for connection in connections {
            lines.push(format_prompt_line(connection));
        }
        Some(lines.join("\n"))
    }

    pub fn sqlite_file_paths(connections: &[DbConnection]) -> Vec<String> {
        connections
            .iter()
            .filter(|item| item.engine == "sqlite")
            .filter_map(|item| item.config.file_path.clone())
            .filter(|path| !path.trim().is_empty())
            .collect()
    }

    pub fn env_for_connections(&self, connections: &[DbConnection]) -> HashMap<String, String> {
        let mut env = HashMap::new();
        for connection in connections {
            if let Some(secret) = self.secret_for(&connection.id) {
                env.insert(env_secret_name(&connection.name), secret);
            }
        }
        env
    }

    pub fn vault_key(id: &str) -> String {
        format!("db_connection_{id}")
    }

    pub fn test_key(id: &str) -> String {
        format!("db:{id}")
    }

    pub fn secret_for(&self, id: &str) -> Option<String> {
        KeychainService::new()
            .get(&Self::vault_key(id))
            .ok()
            .flatten()
            .filter(|value| !value.trim().is_empty())
    }

    fn hydrate(
        &self,
        id: &str,
        name: String,
        engine: String,
        config_json: &str,
        enabled: bool,
        created_at: String,
        updated_at: String,
        test: Option<&ConnectionTestRecord>,
    ) -> AppResult<DbConnection> {
        let config: DbConnectionConfig = serde_json::from_str(config_json).unwrap_or_default();
        Ok(DbConnection {
            id: id.to_string(),
            name,
            engine,
            config,
            has_secret: self.secret_for(id).is_some(),
            enabled,
            last_test: test.map(|record| ConnectionTestSummary {
                ok: record.ok,
                message: record.message.clone(),
                tested_at: record.tested_at.clone(),
                tools: record.tools.clone(),
            }),
            created_at,
            updated_at,
        })
    }
}

pub fn slugify_name(name: &str) -> AppResult<String> {
    let slug: String = name
        .trim()
        .to_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect();
    let slug = slug.trim_matches('-').to_string();
    if slug.is_empty() {
        return Err(AppError::ValidationFailed(
            "Le nom de la connexion est obligatoire.".into(),
        ));
    }
    if slug.len() > 64 {
        return Err(AppError::ValidationFailed(
            "Le nom de la connexion est trop long.".into(),
        ));
    }
    Ok(slug)
}

pub fn env_secret_name(name: &str) -> String {
    let slug = name
        .to_uppercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '_' })
        .collect::<String>();
    format!("BOB_DB_{slug}_PASSWORD")
}

pub fn default_port(engine: &str) -> Option<u16> {
    match engine {
        "oracle" => Some(1521),
        "mysql" | "mariadb" => Some(3306),
        "sqlserver" => Some(1433),
        "postgresql" => Some(5432),
        "mongodb" => Some(27017),
        "redis" => Some(6379),
        "elasticsearch" => Some(9200),
        "db2" => Some(50000),
        "snowflake" | "dynamodb" | "bigquery" => Some(443),
        "cassandra" => Some(9042),
        "clickhouse" => Some(8123),
        _ => None,
    }
}

fn normalize_engine(engine: &str) -> AppResult<&'static str> {
    let normalized = engine
        .trim()
        .to_lowercase()
        .replace('_', "-")
        .replace(' ', "-");
    let canonical = match normalized.as_str() {
        "ibm-db2" | "ibmdb2" => "db2",
        other => other,
    };
    ENGINES
        .iter()
        .copied()
        .find(|item| *item == canonical)
        .ok_or_else(|| {
            AppError::ValidationFailed(format!("Moteur « {engine} » non pris en charge."))
        })
}

pub fn engine_label(engine: &str) -> &str {
    match engine {
        "oracle" => "Oracle",
        "mysql" => "MySQL",
        "sqlserver" => "SQL Server",
        "postgresql" => "PostgreSQL",
        "mongodb" => "MongoDB",
        "redis" => "Redis",
        "elasticsearch" => "Elasticsearch",
        "db2" => "IBM Db2",
        "sqlite" => "SQLite",
        "snowflake" => "Snowflake",
        "mariadb" => "MariaDB",
        "cassandra" => "Cassandra",
        "dynamodb" => "Amazon DynamoDB",
        "bigquery" => "Google BigQuery",
        "clickhouse" => "ClickHouse",
        other => other,
    }
}

fn required_text(value: Option<&String>, label: &str) -> AppResult<String> {
    let trimmed = value
        .map(|item| item.trim().to_string())
        .unwrap_or_default();
    if trimmed.is_empty() {
        return Err(AppError::ValidationFailed(format!(
            "{label} est obligatoire."
        )));
    }
    Ok(trimmed)
}

fn validate_config(engine: &str, config: &DbConnectionConfig) -> AppResult<()> {
    match engine {
        "sqlite" => {
            required_text(config.file_path.as_ref(), "Le chemin du fichier SQLite")?;
        }
        "mongodb" => {
            let uri = config.uri.as_deref().unwrap_or("").trim();
            if uri.is_empty() {
                required_text(config.host.as_ref(), "L’hôte MongoDB")?;
            }
        }
        "elasticsearch" => {
            required_text(config.url.as_ref(), "L’URL Elasticsearch")?;
        }
        "snowflake" => {
            required_text(config.account.as_ref(), "Le compte Snowflake")?;
            required_text(config.username.as_ref(), "L’utilisateur Snowflake")?;
        }
        "dynamodb" => {
            required_text(config.region.as_ref(), "La région DynamoDB")?;
        }
        "bigquery" => {
            required_text(config.project_id.as_ref(), "Le projet BigQuery")?;
        }
        "cassandra" => {
            let points = config.contact_points.as_deref().unwrap_or("").trim();
            if points.is_empty() {
                required_text(config.host.as_ref(), "Les points de contact Cassandra")?;
            }
        }
        "db2" => {
            required_text(config.host.as_ref(), "L’hôte IBM Db2")?;
            required_text(config.database.as_ref(), "Le nom de la base Db2")?;
        }
        _ => {
            required_text(config.host.as_ref(), "L’hôte")?;
        }
    }
    Ok(())
}

fn format_prompt_line(connection: &DbConnection) -> String {
    let env = env_secret_name(&connection.name);
    let target = describe_target(connection);
    format!(
        "- @db:{} · {}{} · secret via {env}",
        connection.name,
        engine_label(&connection.engine),
        target
    )
}

fn describe_target(connection: &DbConnection) -> String {
    match connection.engine.as_str() {
        "sqlite" => connection
            .config
            .file_path
            .as_deref()
            .map(|path| format!(" · fichier {path}"))
            .unwrap_or_default(),
        "elasticsearch" => connection
            .config
            .url
            .as_deref()
            .map(|url| format!(" · {url}"))
            .unwrap_or_default(),
        "snowflake" => {
            let account = connection.config.account.as_deref().unwrap_or("");
            let warehouse = connection.config.warehouse.as_deref().unwrap_or("");
            format!(" · compte {account} warehouse {warehouse}")
        }
        "bigquery" => connection
            .config
            .project_id
            .as_deref()
            .map(|project| format!(" · projet {project}"))
            .unwrap_or_default(),
        "dynamodb" => connection
            .config
            .region
            .as_deref()
            .map(|region| format!(" · région {region}"))
            .unwrap_or_default(),
        _ => {
            let host = connection.config.host.as_deref().unwrap_or("");
            let port = connection
                .config
                .port
                .or_else(|| default_port(&connection.engine))
                .unwrap_or(0);
            let database = connection
                .config
                .database
                .as_deref()
                .or(connection.config.keyspace.as_deref())
                .unwrap_or("");
            if host.is_empty() {
                String::new()
            } else if database.is_empty() {
                format!(" · {host}:{port}")
            } else {
                format!(" · {host}:{port}/{database}")
            }
        }
    }
}

fn probe_connection(
    connection: &DbConnection,
    secret: Option<String>,
) -> AppResult<DbConnectionTestResult> {
    let tested_at = Utc::now().to_rfc3339();
    match connection.engine.as_str() {
        "sqlite" => {
            let path = connection.config.file_path.as_deref().unwrap_or("");
            return Ok(probe_sqlite(path, tested_at));
        }
        "snowflake" | "dynamodb" | "bigquery" => {
            if let Some((host, port)) = cloud_endpoint(connection) {
                return Ok(probe_tcp(
                    &host,
                    port,
                    &connection.engine,
                    secret.is_some(),
                    tested_at,
                ));
            }
            if secret.is_none() && engine_secret_expected(&connection.engine) {
                return Ok(DbConnectionTestResult {
                    ok: false,
                    message: "Secret manquant dans le coffre.".into(),
                    tested_at,
                });
            }
            return Ok(DbConnectionTestResult {
                ok: true,
                message: "Connexion enregistrée. Sonde réseau limitée (pas de driver natif)."
                    .into(),
                tested_at,
            });
        }
        _ => {}
    }

    let Some((host, port)) = endpoint(connection) else {
        return Ok(DbConnectionTestResult {
            ok: false,
            message: "Hôte ou port manquant pour tester la connexion.".into(),
            tested_at,
        });
    };
    Ok(probe_tcp(
        &host,
        port,
        &connection.engine,
        secret.is_some() || !engine_secret_expected(&connection.engine),
        tested_at,
    ))
}

fn engine_secret_expected(engine: &str) -> bool {
    !matches!(engine, "sqlite")
}

fn probe_sqlite(path: &str, tested_at: String) -> DbConnectionTestResult {
    if path.trim().is_empty() {
        return DbConnectionTestResult {
            ok: false,
            message: "Chemin SQLite manquant.".into(),
            tested_at,
        };
    }
    let file = Path::new(path);
    if !file.exists() {
        return DbConnectionTestResult {
            ok: false,
            message: format!("Fichier SQLite introuvable : {path}"),
            tested_at,
        };
    }
    match rusqlite::Connection::open(file) {
        Ok(conn) => match conn.query_row("SELECT 1", [], |row| row.get::<_, i64>(0)) {
            Ok(_) => DbConnectionTestResult {
                ok: true,
                message: "SQLite ouvert.".into(),
                tested_at,
            },
            Err(error) => DbConnectionTestResult {
                ok: false,
                message: format!("SQLite illisible : {error}"),
                tested_at,
            },
        },
        Err(error) => DbConnectionTestResult {
            ok: false,
            message: format!("Impossible d’ouvrir SQLite : {error}"),
            tested_at,
        },
    }
}

fn probe_tcp(
    host: &str,
    port: u16,
    engine: &str,
    has_secret: bool,
    tested_at: String,
) -> DbConnectionTestResult {
    let address = format!("{host}:{port}");
    let resolved = match address.to_socket_addrs() {
        Ok(addrs) => addrs.collect::<Vec<_>>(),
        Err(error) => {
            return DbConnectionTestResult {
                ok: false,
                message: format!("Hôte injoignable ({address}) : {error}"),
                tested_at,
            };
        }
    };
    if resolved.is_empty() {
        return DbConnectionTestResult {
            ok: false,
            message: format!("Aucun enregistrement pour {address}."),
            tested_at,
        };
    }
    let mut last_error = String::new();
    for addr in resolved {
        match TcpStream::connect_timeout(&addr, TCP_TIMEOUT) {
            Ok(_) => {
                let secret_note = if has_secret {
                    ""
                } else {
                    " Secret non fourni — identifiants à compléter."
                };
                let cli_note = optional_cli_note(engine);
                return DbConnectionTestResult {
                    ok: true,
                    message: format!(
                        "Port {} joignable sur {address}.{secret_note}{cli_note}",
                        engine_label(engine)
                    ),
                    tested_at,
                };
            }
            Err(error) => last_error = error.to_string(),
        }
    }
    DbConnectionTestResult {
        ok: false,
        message: format!("Impossible de joindre {address} : {last_error}"),
        tested_at,
    }
}

fn endpoint(connection: &DbConnection) -> Option<(String, u16)> {
    if let Some(url) = connection
        .config
        .url
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return host_port_from_url(url, default_port(&connection.engine).unwrap_or(443));
    }
    if let Some(uri) = connection
        .config
        .uri
        .as_deref()
        .filter(|value| !value.trim().is_empty())
    {
        return host_port_from_url(uri, default_port(&connection.engine).unwrap_or(27017));
    }
    let host = connection
        .config
        .contact_points
        .as_deref()
        .or(connection.config.host.as_deref())
        .map(str::trim)
        .filter(|value| !value.is_empty())?
        .split(',')
        .next()?
        .trim()
        .to_string();
    let (host, inline_port) = split_host_port(&host);
    let port = connection
        .config
        .port
        .or(inline_port)
        .or_else(|| default_port(&connection.engine))?;
    Some((host, port))
}

fn cloud_endpoint(connection: &DbConnection) -> Option<(String, u16)> {
    match connection.engine.as_str() {
        "snowflake" => {
            let account = connection.config.account.as_deref()?.trim();
            if account.is_empty() {
                return None;
            }
            let host = if account.contains('.') {
                format!("{account}.snowflakecomputing.com")
            } else {
                format!("{account}.snowflakecomputing.com")
            };
            Some((host, 443))
        }
        "dynamodb" => {
            let region = connection.config.region.as_deref()?.trim();
            if region.is_empty() {
                return None;
            }
            Some((format!("dynamodb.{region}.amazonaws.com"), 443))
        }
        "bigquery" => Some(("bigquery.googleapis.com".into(), 443)),
        _ => None,
    }
}

fn host_port_from_url(raw: &str, fallback: u16) -> Option<(String, u16)> {
    let trimmed = raw.trim();
    let without_scheme = trimmed
        .split("://")
        .nth(1)
        .unwrap_or(trimmed)
        .split('/')
        .next()
        .unwrap_or(trimmed);
    let (host, port) = split_host_port(without_scheme);
    if host.is_empty() {
        return None;
    }
    Some((host, port.unwrap_or(fallback)))
}

fn split_host_port(value: &str) -> (String, Option<u16>) {
    if let Some((host, port)) = value.rsplit_once(':') {
        if let Ok(port) = port.parse::<u16>() {
            return (host.trim().to_string(), Some(port));
        }
    }
    (value.trim().to_string(), None)
}

fn optional_cli_names(engine: &str) -> &'static [&'static str] {
    match engine {
        "db2" => &["db2", "db2cli", "clpplus"],
        "postgresql" => &["psql"],
        "mysql" | "mariadb" => &["mysql"],
        "redis" => &["redis-cli"],
        "mongodb" => &["mongosh", "mongo"],
        "oracle" => &["sqlplus"],
        "sqlserver" => &["sqlcmd"],
        "clickhouse" => &["clickhouse-client"],
        _ => &[],
    }
}

fn optional_cli_note(engine: &str) -> String {
    optional_cli_names(engine)
        .iter()
        .find(|name| cli_on_path(name))
        .map(|name| format!(" CLI {name} détecté."))
        .unwrap_or_default()
}

fn cli_on_path(name: &str) -> bool {
    std::env::var_os("PATH")
        .map(|paths| std::env::split_paths(&paths).any(|dir| dir.join(name).is_file()))
        .unwrap_or(false)
}

/// Used by tests that assert prompt context never includes vault secrets.
#[allow(dead_code)]
pub fn prompt_contains_secret(context: &str, secret: &str) -> bool {
    context.contains(secret)
}

#[allow(dead_code)]
pub fn as_mcp_style_result(
    connection: &DbConnection,
    result: &DbConnectionTestResult,
) -> PluginMcpTestResult {
    PluginMcpTestResult {
        id: connection.id.clone(),
        name: connection.name.clone(),
        ok: result.ok,
        message: result.message.clone(),
        tools: vec![],
        tested_at: Some(result.tested_at.clone()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;
    use crate::services::keychain::init_secret_vault;

    fn temp_vault() {
        let dir = std::env::temp_dir().join(format!("bob-db-vault-{}", Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        init_secret_vault(&dir);
    }

    fn temp_db() -> Database {
        temp_vault();
        let db = Database::new_in_memory().expect("db");
        db.run_migrations().expect("migrations");
        db
    }

    fn sqlite_input(path: &str) -> SaveDbConnectionInput {
        SaveDbConnectionInput {
            id: None,
            name: "sales".into(),
            engine: "sqlite".into(),
            config: DbConnectionConfig {
                file_path: Some(path.into()),
                ..Default::default()
            },
            secret: None,
            enabled: true,
        }
    }

    #[test]
    fn rejects_empty_name_and_unknown_engine() {
        let db = temp_db();
        let svc = DbConnectionService::new();
        let err = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "   ".into(),
                    engine: "sqlite".into(),
                    config: DbConnectionConfig {
                        file_path: Some("/tmp/x.db".into()),
                        ..Default::default()
                    },
                    secret: None,
                    enabled: true,
                },
            )
            .unwrap_err();
        assert!(err.to_string().contains("obligatoire"));
        let err = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "ok".into(),
                    engine: "access".into(),
                    config: Default::default(),
                    secret: None,
                    enabled: true,
                },
            )
            .unwrap_err();
        assert!(err.to_string().contains("non pris en charge"));
    }

    #[test]
    fn validates_required_fields_per_engine() {
        let db = temp_db();
        let svc = DbConnectionService::new();
        assert!(svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "pg".into(),
                    engine: "postgresql".into(),
                    config: Default::default(),
                    secret: Some("secret".into()),
                    enabled: true,
                },
            )
            .is_err());
        assert!(svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "bq".into(),
                    engine: "bigquery".into(),
                    config: Default::default(),
                    secret: Some("{}".into()),
                    enabled: true,
                },
            )
            .is_err());
        let saved = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "Warehouse Prod".into(),
                    engine: "bigquery".into(),
                    config: DbConnectionConfig {
                        project_id: Some("ibm-analytics".into()),
                        ..Default::default()
                    },
                    secret: Some("{\"type\":\"service_account\"}".into()),
                    enabled: true,
                },
            )
            .unwrap();
        assert_eq!(saved.name, "warehouse-prod");
        assert!(saved.has_secret);
    }

    #[test]
    fn saves_ibm_db2_and_accepts_aliases() {
        let db = temp_db();
        let svc = DbConnectionService::new();
        let missing_database = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "db2-incomplete".into(),
                    engine: "db2".into(),
                    config: DbConnectionConfig {
                        host: Some("db2.internal".into()),
                        ..Default::default()
                    },
                    secret: Some("pwd".into()),
                    enabled: true,
                },
            )
            .unwrap_err();
        assert!(missing_database.to_string().contains("base Db2"));

        let saved = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "finance".into(),
                    engine: "ibm-db2".into(),
                    config: DbConnectionConfig {
                        host: Some("db2.internal".into()),
                        database: Some("SAMPLE".into()),
                        username: Some("db2inst1".into()),
                        ..Default::default()
                    },
                    secret: Some("db2-secret".into()),
                    enabled: true,
                },
            )
            .unwrap();
        assert_eq!(saved.engine, "db2");
        assert_eq!(saved.config.database.as_deref(), Some("SAMPLE"));
        assert_eq!(engine_label(&saved.engine), "IBM Db2");
        assert_eq!(default_port("db2"), Some(50000));
        let context = DbConnectionService::prompt_context(&[saved.clone()]).unwrap();
        assert!(context.contains("IBM Db2"));
        assert!(context.contains("BOB_DB_FINANCE_PASSWORD"));
        assert!(!context.contains("db2-secret"));
        assert!(ENGINES.contains(&"db2"));
    }

    #[test]
    fn crud_keeps_secret_out_of_sqlite() {
        let db = temp_db();
        let svc = DbConnectionService::new();
        let created = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "crm".into(),
                    engine: "postgresql".into(),
                    config: DbConnectionConfig {
                        host: Some("localhost".into()),
                        port: Some(5432),
                        database: Some("crm".into()),
                        username: Some("bob".into()),
                        ..Default::default()
                    },
                    secret: Some("super-secret-password".into()),
                    enabled: true,
                },
            )
            .unwrap();
        let raw: String = db
            .connection()
            .query_row(
                "SELECT config FROM db_connections WHERE id=?1",
                params![created.id],
                |row| row.get(0),
            )
            .unwrap();
        assert!(!raw.contains("super-secret-password"));
        assert_eq!(svc.list(&db).unwrap().len(), 1);
        svc.set_enabled(&db, &created.id, false).unwrap();
        assert!(!svc.get_by_id(&db, &created.id).unwrap().unwrap().enabled);
        svc.delete(&db, &created.id).unwrap();
        assert!(svc.list(&db).unwrap().is_empty());
        assert!(svc.secret_for(&created.id).is_none());
    }

    #[test]
    fn unique_name_and_sqlite_probe() {
        let db = temp_db();
        let svc = DbConnectionService::new();
        let file = std::env::temp_dir().join(format!("bob-db-{}.sqlite", Uuid::new_v4()));
        rusqlite::Connection::open(&file).unwrap();
        svc.save(&db, sqlite_input(&file.to_string_lossy()))
            .unwrap();
        let duplicate = svc.save(&db, sqlite_input(&file.to_string_lossy()));
        assert!(duplicate.is_err());
        let listed = svc.list(&db).unwrap();
        let tested = svc.test(&db, &listed[0].id).unwrap();
        assert!(tested.ok, "{}", tested.message);

        let missing = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "missing-file".into(),
                    engine: "sqlite".into(),
                    config: DbConnectionConfig {
                        file_path: Some("/tmp/does-not-exist-bob-work.sqlite".into()),
                        ..Default::default()
                    },
                    secret: None,
                    enabled: true,
                },
            )
            .unwrap();
        let failed = svc.test(&db, &missing.id).unwrap();
        assert!(!failed.ok);
    }

    #[test]
    #[ignore = "live network probe against ensembldb.ensembl.org"]
    fn ensembl_mysql_tcp_probe_saves_tests_and_deletes() {
        let svc = DbConnectionService::new();
        let live = std::env::var("BOB_WORK_LIVE_DB").ok();
        let db = if let Some(path) = live.as_deref() {
            let path = std::path::Path::new(path);
            init_secret_vault(path.parent().unwrap_or(path));
            Database::new(path).expect("open live Bob Work sqlite")
        } else {
            temp_db()
        };
        let name = format!("ensembl-probe-{}", Uuid::new_v4().simple());
        let saved = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: name.clone(),
                    engine: "mysql".into(),
                    config: DbConnectionConfig {
                        host: Some("ensembldb.ensembl.org".into()),
                        port: Some(3306),
                        database: Some("information_schema".into()),
                        username: Some("anonymous".into()),
                        ssl: Some(false),
                        ..Default::default()
                    },
                    secret: None,
                    enabled: true,
                },
            )
            .expect("save ensembl connection");
        let listed_before = svc
            .list(&db)
            .unwrap()
            .into_iter()
            .any(|item| item.id == saved.id);
        assert!(listed_before, "connection should exist before test");
        let tested = svc.test(&db, &saved.id).expect("test ensembl");
        println!("ensembl test: ok={} message={}", tested.ok, tested.message);
        let delete = || {
            svc.delete(&db, &saved.id)
                .expect("delete ensembl connection");
            assert!(
                svc.get_by_id(&db, &saved.id).unwrap().is_none(),
                "connection should be gone after delete"
            );
        };
        if !tested.ok {
            delete();
            panic!("Ensembl MySQL probe failed: {}", tested.message);
        }
        assert!(
            tested.message.contains("ensembldb.ensembl.org:3306"),
            "{}",
            tested.message
        );
        delete();
    }

    #[test]
    fn tcp_timeout_on_invalid_host() {
        let db = temp_db();
        let svc = DbConnectionService::new();
        let saved = svc
            .save(
                &db,
                SaveDbConnectionInput {
                    id: None,
                    name: "down".into(),
                    engine: "postgresql".into(),
                    config: DbConnectionConfig {
                        host: Some("127.0.0.1".into()),
                        port: Some(1),
                        database: Some("x".into()),
                        ..Default::default()
                    },
                    secret: Some("pwd".into()),
                    enabled: true,
                },
            )
            .unwrap();
        let tested = svc.test(&db, &saved.id).unwrap();
        assert!(!tested.ok);
    }

    #[test]
    fn prompt_context_omits_secret() {
        let connection = DbConnection {
            id: "1".into(),
            name: "sales".into(),
            engine: "postgresql".into(),
            config: DbConnectionConfig {
                host: Some("db.internal".into()),
                port: Some(5432),
                database: Some("sales".into()),
                username: Some("bob".into()),
                ..Default::default()
            },
            has_secret: true,
            enabled: true,
            last_test: None,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let context = DbConnectionService::prompt_context(&[connection]).unwrap();
        assert!(context.contains("@db:sales"));
        assert!(context.contains("BOB_DB_SALES_PASSWORD"));
        assert!(!context.contains("super-secret"));
        assert_eq!(
            DbConnectionService::mentioned_names("voir @db:sales et @db:sales encore @mcp:x"),
            vec!["sales"]
        );
    }
}
