use crate::db::Database;
use crate::error::AppResult;
use crate::models::plugin::{ConnectionTestSummary, PluginMcpTestResult};
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

const SETTINGS_KEY: &str = "connection_tests";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionTestRecord {
    pub id: String,
    pub name: String,
    pub ok: bool,
    pub message: String,
    #[serde(default)]
    pub tools: Vec<String>,
    pub tested_at: String,
    #[serde(default)]
    pub kind: String,
}

impl ConnectionTestRecord {
    pub fn summary(&self) -> ConnectionTestSummary {
        ConnectionTestSummary {
            ok: self.ok,
            message: self.message.clone(),
            tested_at: self.tested_at.clone(),
            tools: self.tools.clone(),
        }
    }
}

fn integration_ids_for_mcp(name: &str) -> &'static [&'static str] {
    match name {
        "bob-work-github" => &["github"],
        "bob-work-slack" => &["slack"],
        "bob-work-monday" => &["monday"],
        "bob-work-microsoft" => &[
            "outlook-mail",
            "teams",
            "outlook-calendar",
            "onedrive",
            "onenote",
        ],
        _ => &[],
    }
}

pub struct ConnectionTestService;

impl ConnectionTestService {
    pub fn new() -> Self {
        Self
    }

    pub fn mcp_key(name: &str) -> String {
        format!("mcp:{}", name)
    }

    pub fn plugin_mcp_key(plugin_id: &str, server_id: &str) -> String {
        format!("plugin-mcp:{}:{}", plugin_id, server_id)
    }

    pub fn integration_key(integration_id: &str) -> String {
        format!("integration:{}", integration_id)
    }

    pub fn list(&self, db: &Database) -> AppResult<HashMap<String, ConnectionTestRecord>> {
        let raw = {
            let conn = db.conn.lock().unwrap();
            match conn.query_row(
                "SELECT value FROM settings WHERE key=?1",
                rusqlite::params![SETTINGS_KEY],
                |row| row.get::<_, String>(0),
            ) {
                Ok(value) => Some(value),
                Err(rusqlite::Error::QueryReturnedNoRows) => None,
                Err(error) => {
                    return Err(crate::error::AppError::Database(error.to_string()));
                }
            }
        };
        let Some(raw) = raw else {
            return Ok(HashMap::new());
        };
        Ok(serde_json::from_str(&raw).unwrap_or_default())
    }

    pub fn get(&self, db: &Database, key: &str) -> AppResult<Option<ConnectionTestRecord>> {
        Ok(self.list(db)?.get(key).cloned())
    }

    pub fn save_record(
        &self,
        db: &Database,
        key: &str,
        record: ConnectionTestRecord,
    ) -> AppResult<()> {
        let mut map = self.list(db)?;
        map.insert(key.to_string(), record);
        self.write_all(db, &map)
    }

    pub fn save_mcp_test(
        &self,
        db: &Database,
        result: &PluginMcpTestResult,
    ) -> AppResult<ConnectionTestRecord> {
        let tested_at = result
            .tested_at
            .clone()
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        let record = ConnectionTestRecord {
            id: result.id.clone(),
            name: result.name.clone(),
            ok: result.ok,
            message: result.message.clone(),
            tools: result.tools.clone(),
            tested_at: tested_at.clone(),
            kind: "mcp".into(),
        };
        self.save_record(db, &Self::mcp_key(&result.id), record.clone())?;
        if result.id != result.name {
            self.save_record(db, &Self::mcp_key(&result.name), record.clone())?;
        }
        for integration_id in integration_ids_for_mcp(&result.id) {
            let mut integration_record = record.clone();
            integration_record.id = (*integration_id).to_string();
            integration_record.kind = "integration".into();
            self.save_record(
                db,
                &Self::integration_key(integration_id),
                integration_record,
            )?;
        }
        Ok(record)
    }

    pub fn save_plugin_mcp_tests(
        &self,
        db: &Database,
        plugin_id: &str,
        results: &[PluginMcpTestResult],
    ) -> AppResult<Vec<ConnectionTestRecord>> {
        let mut saved = vec![];
        for result in results {
            let record = ConnectionTestRecord {
                id: result.id.clone(),
                name: result.name.clone(),
                ok: result.ok,
                message: result.message.clone(),
                tools: result.tools.clone(),
                tested_at: Utc::now().to_rfc3339(),
                kind: "plugin-mcp".into(),
            };
            self.save_record(
                db,
                &Self::plugin_mcp_key(plugin_id, &result.id),
                record.clone(),
            )?;
            let _ = self.save_record(db, &Self::mcp_key(&result.id), record.clone());
            saved.push(record);
        }
        Ok(saved)
    }

    pub fn save_integration_test(
        &self,
        db: &Database,
        integration_id: &str,
        result: &PluginMcpTestResult,
    ) -> AppResult<ConnectionTestRecord> {
        let record = ConnectionTestRecord {
            id: integration_id.to_string(),
            name: result.name.clone(),
            ok: result.ok,
            message: result.message.clone(),
            tools: result.tools.clone(),
            tested_at: Utc::now().to_rfc3339(),
            kind: "integration".into(),
        };
        self.save_record(db, &Self::integration_key(integration_id), record.clone())?;
        let _ = self.save_mcp_test(db, result);
        Ok(record)
    }

    fn write_all(
        &self,
        db: &Database,
        map: &HashMap<String, ConnectionTestRecord>,
    ) -> AppResult<()> {
        let value = serde_json::to_string(map)
            .map_err(|error| crate::error::AppError::ValidationFailed(error.to_string()))?;
        let now = Utc::now().to_rfc3339();
        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO settings(key,value,updated_at) VALUES(?1,?2,?3)
             ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            rusqlite::params![SETTINGS_KEY, value, now],
        )
        .map_err(|error| crate::error::AppError::Database(error.to_string()))?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::Database;

    #[test]
    fn persists_and_reads_mcp_connection_tests() {
        let db = Database::new_in_memory().unwrap();
        db.run_migrations().unwrap();
        let service = ConnectionTestService::new();
        let result = PluginMcpTestResult {
            id: "bob-work-github".into(),
            name: "GitHub".into(),
            ok: true,
            message: "2 tools".into(),
            tools: vec!["list".into()],
            tested_at: None,
        };
        service.save_mcp_test(&db, &result).unwrap();
        let stored = service
            .list(&db)
            .unwrap()
            .remove("mcp:bob-work-github")
            .expect("stored");
        assert!(stored.ok);
        assert_eq!(stored.tools, vec!["list".to_string()]);
        assert!(!stored.tested_at.is_empty());
    }
}
