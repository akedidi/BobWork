// Canonical local layout for agentic plugin bundles.
// Bob Work owns these paths; the LLM must not invent directories.

use crate::error::{AppError, AppResult};
use std::path::{Component, Path};

const ALLOWED_ROOTS: &[&str] = &["scripts", "bin", "vendor", "mcp", "skills"];

/// Human-readable schema injected into plugin-creation prompts.
pub fn protocol_section() -> &'static str {
    r#"## Runtime Architecture V2 (l’application décide des chemins)
Un plugin déclare des capacités ; il ne choisit jamais un chemin d’installation, ne modifie jamais le PATH global et ne télécharge jamais lui-même un exécutable.

Classification obligatoire :
- capacité générique réutilisable (`python`, `visualization`, `diagram`, `artifact`) → `sharedCapabilities`
- framework lourd optionnel géré par Bob Work → `externalRuntimes`
- dépendance propre au plugin, distribuée depuis une source approuvée → `privateDependencies`

Le Runtime Manager résout ensuite les handles physiques. Le modèle ne reçoit ni la responsabilité de choisir un chemin, ni celle d’exécuter `pip install`, `npm i -g`, `brew install`, `curl` ou un téléchargement arbitraire.

Schéma privé autorisé, créé et validé par Bob Work :

```
~/.bob/skills/<slug>/
  SKILL.md
  .bob-work-plugin.json
  scripts/                      # wrappers uniquement (python3, bash, sh, zsh, node)
  bin/                          # petits lanceurs privés explicitement déclarés
  vendor/<outil>/<version>/bin/ # binaire privé épinglé, approuvé et vérifié
  vendor/<outil>/<version>/     # JAR, npm pack, wheels Python
  mcp/                          # serveur MCP stdio du plugin
  skills/                       # skills imbriqués (SKILL.md)
```

Déclaration selon le type :
- Wrapper CLI Python / shell / Node → `scripts/<outil>_runtime.py` (ou `.sh` / `.js`)
- Binaire privé approuvé → `vendor/<outil>/<version>/bin/<exe>`, déclaré avec version, plateforme, architecture, source et SHA-256.
- CLI Node packagée → `vendor/<paquet>/<version>/` + wrapper `scripts/`
- Paquets Python privés → couche `python/` isolée ; ne jamais muter le Python partagé.
- MCP local → `mcp/`
- `privateDependencies[].entrypoint` = chemin relatif sûr dans ce schéma.
- `permissions` déclare au minimum `command.execute` pour un processus, `network.request` pour le réseau, et les permissions fichiers réellement nécessaires.

Bob Work exécute le chemin absolu résolu avec un environnement minimal. Le plugin A ne voit jamais le runtime privé du plugin B. Les moteurs partagés (D2, Mermaid, Graphviz, ECharts, Plotly, Three.js) ne doivent pas être recopiés dans un plugin."#
}

pub fn validate_entrypoint_path(runtime: &str, relative: &str) -> AppResult<()> {
    let path = Path::new(relative);
    if path.is_absolute()
        || path
            .components()
            .any(|component| !matches!(component, Component::Normal(_)))
    {
        return Err(AppError::Plugin(
            "Plugin entrypoints must use safe relative paths".into(),
        ));
    }
    if !root_allowed(path) {
        return Err(AppError::Plugin(format!(
            "Plugin entrypoint must live in scripts/, bin/, vendor/, mcp/ or skills/ (got {relative})"
        )));
    }
    if runtime == "binary" && !binary_location(path) {
        return Err(AppError::Plugin(format!(
            "Binary entrypoints belong in bin/<name> or vendor/<tool>/<version>/bin/<name> (got {relative})"
        )));
    }
    Ok(())
}

fn root_allowed(path: &Path) -> bool {
    match path.components().next() {
        Some(Component::Normal(name)) => {
            let name = name.to_string_lossy();
            ALLOWED_ROOTS.iter().any(|root| *root == name.as_ref())
                || name.ends_with(".py")
                || name.ends_with(".sh")
                || name.ends_with(".js")
        }
        _ => false,
    }
}

fn binary_location(path: &Path) -> bool {
    let parts: Vec<_> = path
        .components()
        .filter_map(|component| match component {
            Component::Normal(value) => Some(value.to_string_lossy().into_owned()),
            _ => None,
        })
        .collect();
    match parts.as_slice() {
        [bin, name] if bin == "bin" && !name.is_empty() => true,
        [vendor, _tool, _version, bin, name]
            if vendor == "vendor" && bin == "bin" && !name.is_empty() =>
        {
            true
        }
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::validate_entrypoint_path;

    #[test]
    fn accepts_cloud_architect_and_shim_locations() {
        validate_entrypoint_path("python3", "scripts/d2_runtime.py").unwrap();
        validate_entrypoint_path(
            "python3",
            "skills/senior-cloud-architect/scripts/validate_architecture.py",
        )
        .unwrap();
        validate_entrypoint_path("binary", "bin/echo-tool").unwrap();
        validate_entrypoint_path("binary", "vendor/d2/v0.7.1/bin/d2").unwrap();
        validate_entrypoint_path("node", "scripts/render.js").unwrap();
        validate_entrypoint_path("bash", "scripts/pack.sh").unwrap();
    }

    #[test]
    fn rejects_invented_directories_and_loose_binaries() {
        assert!(validate_entrypoint_path("python3", "tools/run.py").is_err());
        assert!(validate_entrypoint_path("binary", "scripts/ffmpeg").is_err());
        assert!(validate_entrypoint_path("binary", "vendor/ffmpeg").is_err());
        assert!(validate_entrypoint_path("python3", "../outside.py").is_err());
    }
}
