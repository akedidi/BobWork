//! Regression guards for Tauri ACL / capability wiring.
//!
//! Frontend calls (`plugin-fs` `stat`, `process.relaunch`, dialogs, …) only work
//! when the matching identifiers are listed in `capabilities/default.json`.

#[cfg(test)]
mod tests {
    #[test]
    fn default_capability_grants_fs_stat_and_process_relaunch() {
        let raw = include_str!("../capabilities/default.json");
        let json: serde_json::Value = serde_json::from_str(raw).expect("capabilities json");
        let permissions = json["permissions"]
            .as_array()
            .expect("permissions array")
            .iter()
            .map(|entry| match entry {
                serde_json::Value::String(value) => value.clone(),
                serde_json::Value::Object(map) => map
                    .get("identifier")
                    .and_then(|value| value.as_str())
                    .unwrap_or("")
                    .to_string(),
                _ => String::new(),
            })
            .collect::<Vec<_>>();

        for required in [
            "fs:default",
            "fs:allow-stat",
            "fs:allow-exists",
            "fs:scope",
            "process:default",
            "dialog:default",
            "notification:default",
            "opener:default",
            "os:default",
            "shell:allow-open",
        ] {
            assert!(
                permissions.iter().any(|value| value == required),
                "capabilities/default.json missing {required}; got {permissions:?}"
            );
        }

        let scope = json["permissions"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|entry| entry.get("identifier").and_then(|v| v.as_str()) == Some("fs:scope"))
            .expect("fs:scope object");
        let allow = scope["allow"].as_array().expect("fs:scope.allow");
        let paths = allow
            .iter()
            .filter_map(|entry| entry.get("path").and_then(|v| v.as_str()))
            .collect::<Vec<_>>();
        assert!(
            paths.iter().any(|path| path.contains("com.bobwork.desktop.test")),
            "fs scope must include test app Application Support: {paths:?}"
        );
        assert!(
            paths.iter().any(|path| *path == "$HOME/.bob/**"),
            "fs scope must include ~/.bob: {paths:?}"
        );
    }

    #[test]
    fn asset_protocol_allows_appdata_not_only_cache() {
        let raw = include_str!("../tauri.conf.json");
        let json: serde_json::Value = serde_json::from_str(raw).expect("tauri.conf");
        let allow = json["app"]["security"]["assetProtocol"]["scope"]["allow"]
            .as_array()
            .expect("assetProtocol.scope.allow");
        let paths = allow
            .iter()
            .filter_map(|entry| entry.as_str())
            .collect::<Vec<_>>();
        for required in [
            "$APPCACHE/**",
            "$APPDATA/**",
            "$APPLOCALDATA/**",
            "$HOME/.bob/**",
            "$HOME/Library/Application Support/com.bobwork.desktop/**",
            "$HOME/Library/Application Support/com.bobwork.desktop.test/**",
        ] {
            assert!(
                paths.contains(&required),
                "assetProtocol missing {required}; got {paths:?}"
            );
        }
    }
}
