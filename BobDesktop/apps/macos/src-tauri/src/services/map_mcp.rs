use crate::error::{AppError, AppResult};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::process::Command;

pub const MAP_MCP_NAME: &str = "bob-work-map-tools";
const MAP_MCP_SCRIPT: &str = include_str!("../../resources/maps/map_mcp.py");

pub struct MapMcpService;

impl MapMcpService {
    pub fn bundle_dir() -> AppResult<PathBuf> {
        let home = dirs::home_dir()
            .ok_or_else(|| AppError::Io("Cannot determine home directory".into()))?;
        Ok(home.join(".bob").join("resources").join("maps"))
    }

    pub fn ensure_bundle() -> AppResult<PathBuf> {
        let bundle = Self::bundle_dir()?;
        std::fs::create_dir_all(&bundle)?;
        let candidate = bundle.join(".server.py.next");
        std::fs::write(&candidate, MAP_MCP_SCRIPT)?;
        let target = bundle.join("server.py");
        std::fs::rename(candidate, &target)?;
        Ok(bundle)
    }

    pub fn mcp_config(bundle: &Path) -> Value {
        json!({
            "command": "python3",
            "args": ["server.py"],
            "cwd": bundle.to_string_lossy(),
            "env": {
                "BOB_MAP_GEOCODER_URL": "https://photon.komoot.io",
                "BOB_MAP_ROUTER_URL": "https://valhalla1.openstreetmap.de",
                "BOB_MAP_USER_AGENT": "Bob-Work/1.0 map-tools (interactive user requests)"
            }
        })
    }

    pub fn sync(&self, bob_path: &str) -> AppResult<()> {
        let bundle = Self::ensure_bundle()?;
        let config = Self::mcp_config(&bundle);
        run_bob(
            bob_path,
            &[
                "mcp",
                "add-json",
                "--scope",
                "global",
                MAP_MCP_NAME,
                &config.to_string(),
            ],
        )?;
        run_bob(
            bob_path,
            &["mcp", "enable", MAP_MCP_NAME, "--scope", "global"],
        )
    }

    pub fn sync_location(
        &self,
        enabled: bool,
        latitude: Option<f64>,
        longitude: Option<f64>,
        updated_at: Option<&str>,
    ) -> AppResult<()> {
        let bundle = Self::ensure_bundle()?;
        let target = bundle.join("current-location.json");
        let valid = enabled
            && latitude.is_some_and(|value| value.is_finite() && (-90.0..=90.0).contains(&value))
            && longitude
                .is_some_and(|value| value.is_finite() && (-180.0..=180.0).contains(&value));
        if !valid {
            if target.exists() {
                std::fs::remove_file(target)?;
            }
            return Ok(());
        }
        let candidate = bundle.join(".current-location.json.next");
        std::fs::write(
            &candidate,
            serde_json::to_vec(&json!({
                "lat": latitude,
                "lon": longitude,
                "updatedAt": updated_at,
            }))?,
        )?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&candidate, std::fs::Permissions::from_mode(0o600))?;
        }
        std::fs::rename(candidate, target)?;
        Ok(())
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bundle_exposes_complete_map_toolset() {
        for tool in [
            "map_geocode",
            "map_reverse_geocode",
            "map_search_poi",
            "map_route",
            "map_current_location",
        ] {
            assert!(MAP_MCP_SCRIPT.contains(tool), "missing {tool}");
        }
        assert!(MAP_MCP_SCRIPT.contains("bob-map"));
        assert!(MAP_MCP_SCRIPT.contains("OpenStreetMap contributors"));
    }

    #[test]
    fn config_uses_configurable_public_services() {
        let config = MapMcpService::mcp_config(Path::new("/tmp/maps"));
        assert_eq!(config["command"], "python3");
        assert_eq!(config["cwd"], "/tmp/maps");
        assert_eq!(
            config["env"]["BOB_MAP_GEOCODER_URL"],
            "https://photon.komoot.io"
        );
        assert_eq!(
            config["env"]["BOB_MAP_ROUTER_URL"],
            "https://valhalla1.openstreetmap.de"
        );
    }
}
