// ============================================================
// Bob Work - Audit Log Service
// Append-only event log for all sensitive actions
// ============================================================

use crate::db::Database;
use crate::error::AppResult;
use chrono::Utc;
use rusqlite::params;
use serde_json::json;
use tracing::info;
use uuid::Uuid;

pub struct AuditService;

impl AuditService {
    pub fn new() -> Self {
        Self
    }

    /// Log an event to the append-only events table
    pub fn log(
        &self,
        db: &Database,
        event_type: &str,
        entity_type: Option<&str>,
        entity_id: Option<&str>,
        data: serde_json::Value,
    ) -> AppResult<()> {
        let id = Uuid::new_v4().to_string();
        let now = Utc::now().to_rfc3339();

        let conn = db.conn.lock().unwrap();
        conn.execute(
            "INSERT INTO events (id, type, timestamp, entity_type, entity_id, data)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                id,
                event_type,
                now,
                entity_type,
                entity_id,
                data.to_string(),
            ],
        )?;

        info!(
            "Audit: {} | entity={:?}/{:?}",
            event_type, entity_type, entity_id
        );
        Ok(())
    }

    /// Convenience: log bob event
    pub fn bob_event(
        &self,
        db: &Database,
        event_type: &str,
        session_id: &str,
        conversation_id: &str,
    ) -> AppResult<()> {
        self.log(
            db,
            event_type,
            Some("session"),
            Some(session_id),
            json!({ "conversation_id": conversation_id }),
        )
    }

    /// Convenience: log approval event
    pub fn approval_event(
        &self,
        db: &Database,
        approval_id: &str,
        decision: &str,
        risk_level: &str,
    ) -> AppResult<()> {
        self.log(
            db,
            "approval.resolved",
            Some("approval"),
            Some(approval_id),
            json!({ "decision": decision, "riskLevel": risk_level }),
        )
    }

    /// Convenience: log plugin action
    #[allow(dead_code)]
    pub fn plugin_event(
        &self,
        db: &Database,
        action: &str,
        plugin_id: &str,
        plugin_name: &str,
    ) -> AppResult<()> {
        self.log(
            db,
            &format!("plugin.{}", action),
            Some("plugin"),
            Some(plugin_id),
            json!({ "name": plugin_name }),
        )
    }

    /// Get recent events for diagnostics
    #[allow(dead_code)]
    pub fn get_recent(&self, db: &Database, limit: usize) -> AppResult<Vec<serde_json::Value>> {
        let conn = db.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT id, type, timestamp, entity_type, entity_id, data
             FROM events ORDER BY timestamp DESC LIMIT ?1",
        )?;

        let events = stmt
            .query_map(params![limit as i64], |row| {
                Ok(json!({
                    "id": row.get::<_, String>(0)?,
                    "type": row.get::<_, String>(1)?,
                    "timestamp": row.get::<_, String>(2)?,
                    "entityType": row.get::<_, Option<String>>(3)?,
                    "entityId": row.get::<_, Option<String>>(4)?,
                    "data": row.get::<_, String>(5)?,
                }))
            })?
            .filter_map(|r| r.ok())
            .collect();

        Ok(events)
    }
}
