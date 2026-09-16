//! Intelligent lazy MCP selection for Bob Work sessions.
//!
//! Starts sessions with only the MCP servers likely needed for the prompt.
//! Specialized work (Office, Docling, Chrome, maps…) still loads on demand via
//! heuristics + the capability-router skill; trivial tasks (empty .txt) and
//! Visualize/HTML-only work get no MCP (skills cover them).

use serde_json::{Map, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum McpLoadMode {
    /// No MCP — `--disable-mcp` or empty mcp.json.
    None,
    /// Filtered subset written to workspace `.bob/mcp.json` / sandbox HOME.
    Filtered,
    /// Keep the full host catalog (complex / ambiguous prompts), minus gated servers.
    Full,
}

#[derive(Debug, Clone)]
pub struct McpLazyPlan {
    pub mode: McpLoadMode,
    /// Server names to keep when `mode == Filtered`.
    pub keep: BTreeSet<String>,
    pub reason: String,
    /// When false, Chrome MCP is stripped even in Full mode.
    pub chrome_enabled: bool,
}

/// Decide which MCP servers this prompt needs.
pub fn plan_mcp_for_prompt(
    prompt: &str,
    attachment_paths: &[String],
    chrome_enabled: bool,
    computer_use_enabled: bool,
) -> McpLazyPlan {
    let text = format!(
        "{}\n{}",
        prompt.to_lowercase(),
        attachment_paths
            .iter()
            .map(|path| path.to_lowercase())
            .collect::<Vec<_>>()
            .join("\n")
    );

    let mut keep = BTreeSet::new();
    let mut reasons = Vec::new();

    let mentioned_plugin = text.contains("@plugin:") || text.contains("@skill:");
    if mentioned_plugin {
        push_mention_servers(&text, chrome_enabled, &mut keep, &mut reasons);
    }

    // Attachment / extension driven
    if has_ext(&text, &[".pptx", ".ppt"])
        || contains_any(
            &text,
            &[
                "powerpoint",
                "pptx",
                "diapo",
                "présentation",
                "presentation",
                " doc ppt",
                "fichier ppt",
                "slide deck",
            ],
        )
        || text.ends_with(" ppt")
        || text.contains(" ppt ")
    {
        keep.insert("bw-bob-work-microsoft-powerpoint-office-tools".into());
        reasons.push("powerpoint");
    }
    if has_ext(&text, &[".docx", ".doc"])
        || contains_any(
            &text,
            &[
                "docx",
                "document word",
                "microsoft word",
                "fichier word",
                "fichier .doc",
            ],
        )
    {
        keep.insert("bw-bob-work-microsoft-word-office-tools".into());
        reasons.push("word");
    }
    if has_ext(&text, &[".xlsx", ".xls", ".csv"])
        || contains_any(
            &text,
            &[
                "xlsx",
                "spreadsheet",
                "tableur",
                "fichier excel",
                "microsoft excel",
                "fichier csv",
            ],
        )
        || (text.contains("excel") && !text.contains("excellent"))
    {
        keep.insert("bw-bob-work-microsoft-excel-office-tools".into());
        reasons.push("excel");
    }

    let wants_docling = contains_any(
        &text,
        &[
            "docling",
            "ocr",
            "pdf scann",
            "pdf scan",
            "extraire des tableaux",
            "transcribe",
            "transcription",
        ],
    );
    let has_pdf = has_ext(&text, &[".pdf"]) || text.contains(" pdf") || text.contains("pdf ");
    if wants_docling {
        keep.insert("bw-bob-work-docling-docling".into());
        keep.insert("bw-bob-work-documents-office-tools".into());
        reasons.push("docling/documents");
    } else if has_pdf {
        keep.insert("bw-bob-work-documents-office-tools".into());
        reasons.push("documents");
    }

    if contains_any(&text, &["github", "pull request", "pull-request", "repo ", "repository"])
        || text.contains("@integration:github")
    {
        keep.insert("bob-work-github".into());
        reasons.push("github");
    }
    if contains_any(&text, &["outlook", "teams", "onedrive", "onenote", "calendrier", "email"])
        || text.contains("@integration:outlook")
        || text.contains("@integration:teams")
        || text.contains("@integration:onedrive")
    {
        keep.insert("bob-work-microsoft".into());
        reasons.push("microsoft");
    }
    if contains_any(
        &text,
        &[
            "itinéraire",
            "itineraire",
            "geocode",
            "géocode",
            "map-tools",
            "builtin-map",
            "point d'intérêt",
            "points d'intérêt",
            "openstreetmap",
        ],
    ) || (text.contains("carte")
        && contains_any(&text, &["route", "paris", "lyon", "map", "geo", "gps", "poi"]))
        || text.contains(" map ")
        || text.contains("maps")
        || text.contains("@skill:map-tools")
    {
        keep.insert("bob-work-map-tools".into());
        reasons.push("maps");
    }
    if contains_any(&text, &["codegraph", "graphe de code", "dependency graph"]) {
        keep.insert("bob-work-codegraph".into());
        reasons.push("codegraph");
    }
    if chrome_enabled
        && (contains_any(
            &text,
            &[
                "chrome",
                "navigateur",
                "browser",
                "onglet",
                "http://",
                "https://",
                "ouvre le site",
                "open the site",
            ],
        ) || text.contains("bob-work-chrome-control")
            || text.contains("builtin-chrome-control"))
    {
        keep.insert("bob-work-chrome-control".into());
        reasons.push("chrome");
    }
    if computer_use_enabled
        && contains_any(
            &text,
            &[
                "computer use",
                "contrôle bureau",
                "controle bureau",
                "desktop control",
                "@skill:computer-use",
            ],
        )
    {
        keep.insert("bob-work-computer-use".into());
        reasons.push("computer-use");
    }

    // Custom API MCP servers referenced by name (tmdb, deepwiki, …)
    for token in prompt.split_whitespace() {
        let lower = token.trim_matches(|c: char| !c.is_alphanumeric() && c != '-' && c != '_');
        if lower.starts_with("@mcp:") || lower.starts_with('$') {
            let name = lower.trim_start_matches("@mcp:").trim_start_matches('$');
            if !name.is_empty() {
                keep.insert(name.to_string());
                reasons.push("explicit-mcp");
            }
        }
    }

    if is_native_simple_task(&text) && keep.is_empty() && !mentioned_plugin {
        return McpLazyPlan {
            mode: McpLoadMode::None,
            keep,
            reason: "tâche native simple (fichier texte / édition basique)".into(),
            chrome_enabled,
        };
    }

    // Visualize / interactive HTML is skill-only — do not fall through to Full
    // (which would expose Chrome and invite file:// misuse).
    if keep.is_empty() && is_visualize_html_task(&text) {
        return McpLazyPlan {
            mode: McpLoadMode::Filtered,
            keep,
            reason: "Visualize/HTML — skills only, pas de MCP".into(),
            chrome_enabled,
        };
    }

    // Explicit skill mentions that map to no MCP (router, visualize, architect…).
    if keep.is_empty() && mentioned_plugin && is_skill_only_mention(&text) {
        return McpLazyPlan {
            mode: McpLoadMode::Filtered,
            keep,
            reason: "mention skill-only — pas de MCP".into(),
            chrome_enabled,
        };
    }

    if keep.is_empty() {
        return McpLazyPlan {
            mode: McpLoadMode::Full,
            keep: BTreeSet::new(),
            reason: "prompt ambigu ou complexe — catalogue MCP complet".into(),
            chrome_enabled,
        };
    }

    McpLazyPlan {
        mode: McpLoadMode::Filtered,
        keep,
        reason: format!("MCP filtrés : {}", reasons.join(", ")),
        chrome_enabled,
    }
}

/// Filter a host `mcpServers` map according to the lazy plan.
pub fn apply_mcp_plan(servers: &Map<String, Value>, plan: &McpLazyPlan) -> Map<String, Value> {
    match plan.mode {
        McpLoadMode::None => Map::new(),
        McpLoadMode::Full => servers
            .iter()
            .filter(|(name, _)| {
                !is_computer_use(name) && (plan.chrome_enabled || !is_chrome(name))
            })
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
        McpLoadMode::Filtered => servers
            .iter()
            .filter(|(name, _)| plan.keep.iter().any(|keep| mcp_name_matches(name, keep)))
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect(),
    }
}

fn mcp_name_matches(server: &str, keep: &str) -> bool {
    let s = server.to_lowercase();
    let k = keep.to_lowercase();
    s == k || s.contains(&k) || k.contains(&s)
}

fn is_computer_use(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "bob-work-computer-use" || lower.starts_with("bob-work-computer")
}

fn is_chrome(name: &str) -> bool {
    let lower = name.to_lowercase();
    lower == "bob-work-chrome-control" || lower.contains("chrome-control")
}

fn is_native_simple_task(text: &str) -> bool {
    let simple_verbs = [
        "crée", "creer", "create", "touch", "écrit", "ecrit", "write", "ajoute", "supprime",
        "delete", "renomme", "rename", "liste", "list", "affiche", "show", "cat ", "echo ",
    ];
    let simple_targets = [
        ".txt", "fichier vide", "empty file", "fichier texte", "text file", "readme", ".md",
        "dossier", "directory", "folder",
    ];
    let complex_signals = [
        ".pptx", ".docx", ".xlsx", ".pdf", "powerpoint", "excel", "docx", "chrome", "navigateur",
        "docling", "ocr", "architecture", "aks", "azure", "diagram", "plugin", "skill", "mcp",
        "github", "outlook", "teams", "itinéraire", "presentation", "présentation", "chart",
        "dashboard", "visuel", "visuali", "graphique", "echarts", "plotly",
    ];
    if complex_signals.iter().any(|s| text.contains(s)) {
        return false;
    }
    let has_verb = simple_verbs.iter().any(|v| text.contains(v));
    let has_target = simple_targets.iter().any(|t| text.contains(t));
    has_verb && (has_target || text.len() < 120)
}

fn is_visualize_html_task(text: &str) -> bool {
    let signals = [
        "chart",
        "dashboard",
        "visuel",
        "visuali",
        "graphique",
        "echarts",
        "plotly",
        "builtin-visualize",
        "@plugin:visualize",
        "@skill:visualize",
        "html interact",
        "interactive html",
        "aperçu",
        "preview",
    ];
    signals.iter().any(|s| text.contains(s))
}

fn is_skill_only_mention(text: &str) -> bool {
    let skills = [
        "capability-router",
        "visualize",
        "cloud-architect",
        "agentic-cloud",
        "plugin-creator",
        "skill-creator",
        "orchestration",
        "orca-cli",
        "agent-review",
        "meeting-minutes",
        // When computer-use is disabled, the mention must not fall through to Full.
        "computer-use",
    ];
    skills.iter().any(|s| text.contains(s))
}

fn has_ext(text: &str, exts: &[&str]) -> bool {
    exts.iter().any(|ext| text.contains(ext))
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|n| text.contains(n))
}

fn push_mention_servers(
    text: &str,
    chrome_enabled: bool,
    keep: &mut BTreeSet<String>,
    reasons: &mut Vec<&str>,
) {
    if text.contains("powerpoint") || text.contains("pptx") {
        keep.insert("bw-bob-work-microsoft-powerpoint-office-tools".into());
        reasons.push("mention-pptx");
    }
    if text.contains("builtin-word") || text.contains("docx") || text.contains("microsoft-word") {
        keep.insert("bw-bob-work-microsoft-word-office-tools".into());
        reasons.push("mention-word");
    }
    if text.contains("builtin-excel") || text.contains("xlsx") || text.contains("microsoft-excel") {
        keep.insert("bw-bob-work-microsoft-excel-office-tools".into());
        reasons.push("mention-excel");
    }
    if text.contains("docling") {
        keep.insert("bw-bob-work-docling-docling".into());
        reasons.push("mention-docling");
    }
    if text.contains("documents") || text.contains("builtin-documents") {
        keep.insert("bw-bob-work-documents-office-tools".into());
        reasons.push("mention-documents");
    }
    if chrome_enabled
        && (text.contains("chrome") || text.contains("builtin-chrome-control"))
    {
        keep.insert("bob-work-chrome-control".into());
        reasons.push("mention-chrome");
    }
    if text.contains("map-tools") || text.contains("builtin-map") {
        keep.insert("bob-work-map-tools".into());
        reasons.push("mention-map");
    }
    if text.contains("cloud-architect") || text.contains("agentic-cloud") {
        reasons.push("mention-architect-skill");
    }
    if text.contains("visualize") {
        reasons.push("mention-visualize-skill");
    }
}

/// RAII: write filtered workspace `.bob/mcp.json`, restore previous bytes on drop.
pub struct WorkspaceMcpOverlay {
    path: PathBuf,
    previous: Option<Vec<u8>>,
    written: Vec<u8>,
}

impl WorkspaceMcpOverlay {
    pub fn apply(workspace: &Path, servers: &Map<String, Value>) -> std::io::Result<Self> {
        let bob_dir = workspace.join(".bob");
        std::fs::create_dir_all(&bob_dir)?;
        let path = bob_dir.join("mcp.json");
        let previous = std::fs::read(&path).ok();
        let config = serde_json::json!({ "mcpServers": servers });
        let written = serde_json::to_vec_pretty(&config)
            .map_err(|error| std::io::Error::new(std::io::ErrorKind::InvalidData, error))?;
        std::fs::write(&path, &written)?;
        Ok(Self {
            path,
            previous,
            written,
        })
    }
}

impl Drop for WorkspaceMcpOverlay {
    fn drop(&mut self) {
        let Ok(current) = std::fs::read(&self.path) else {
            return;
        };
        if current != self.written {
            return;
        }
        match &self.previous {
            Some(bytes) => {
                let _ = std::fs::write(&self.path, bytes);
            }
            None => {
                let _ = std::fs::remove_file(&self.path);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn sample_servers() -> Map<String, Value> {
        let mut map = Map::new();
        for name in [
            "bob-work-github",
            "bob-work-chrome-control",
            "bw-bob-work-microsoft-powerpoint-office-tools",
            "bw-bob-work-microsoft-word-office-tools",
            "bw-bob-work-microsoft-excel-office-tools",
            "bw-bob-work-docling-docling",
            "bw-bob-work-documents-office-tools",
            "bob-work-map-tools",
            "tmdb",
            "bob-work-computer-use",
        ] {
            map.insert(name.into(), json!({ "command": "echo", "args": [name] }));
        }
        map
    }

    #[test]
    fn empty_txt_gets_no_mcp() {
        let plan = plan_mcp_for_prompt("crée un fichier vide fichier.txt", &[], true, false);
        assert_eq!(plan.mode, McpLoadMode::None);
        let filtered = apply_mcp_plan(&sample_servers(), &plan);
        assert!(filtered.is_empty());
    }

    #[test]
    fn powerpoint_prompt_keeps_pptx_mcp() {
        let plan = plan_mcp_for_prompt(
            "crée une présentation PowerPoint sur Azure",
            &[],
            true,
            false,
        );
        assert_eq!(plan.mode, McpLoadMode::Filtered);
        let filtered = apply_mcp_plan(&sample_servers(), &plan);
        assert!(filtered.contains_key("bw-bob-work-microsoft-powerpoint-office-tools"));
        assert!(!filtered.contains_key("bob-work-chrome-control"));
        assert!(!filtered.contains_key("bob-work-computer-use"));
    }

    #[test]
    fn chart_html_gets_filtered_empty_not_full() {
        let plan = plan_mcp_for_prompt(
            "avec des données factices, agrège les revenus et produis un visuel interactif",
            &[],
            true,
            false,
        );
        assert_eq!(plan.mode, McpLoadMode::Filtered);
        assert!(plan.keep.is_empty());
        let filtered = apply_mcp_plan(&sample_servers(), &plan);
        assert!(filtered.is_empty(), "visualize-only must not load Chrome/Office MCP");
    }

    #[test]
    fn chart_plus_pptx_keeps_powerpoint_mcp() {
        let plan = plan_mcp_for_prompt(
            "visuel interactif et présente les dans un doc ppt avec screenshots",
            &[],
            true,
            false,
        );
        assert_eq!(plan.mode, McpLoadMode::Filtered);
        assert!(plan
            .keep
            .iter()
            .any(|k| k.contains("powerpoint")));
    }

    #[test]
    fn pdf_alone_keeps_documents_not_docling() {
        let plan = plan_mcp_for_prompt("résume ce fichier rapport.pdf", &[], true, false);
        assert_eq!(plan.mode, McpLoadMode::Filtered);
        let filtered = apply_mcp_plan(&sample_servers(), &plan);
        assert!(filtered.contains_key("bw-bob-work-documents-office-tools"));
        assert!(!filtered.contains_key("bw-bob-work-docling-docling"));
    }

    #[test]
    fn ambiguous_prompt_keeps_full_without_computer_use() {
        let plan = plan_mcp_for_prompt(
            "analyse tout le projet et propose une amélioration stratégique",
            &[],
            true,
            false,
        );
        assert_eq!(plan.mode, McpLoadMode::Full);
        let filtered = apply_mcp_plan(&sample_servers(), &plan);
        assert!(filtered.contains_key("bob-work-github"));
        assert!(!filtered.contains_key("bob-work-computer-use"));
    }

    #[test]
    fn full_mode_strips_chrome_when_disabled() {
        let plan = plan_mcp_for_prompt(
            "analyse tout le projet et propose une amélioration stratégique",
            &[],
            false,
            false,
        );
        assert_eq!(plan.mode, McpLoadMode::Full);
        let filtered = apply_mcp_plan(&sample_servers(), &plan);
        assert!(!filtered.contains_key("bob-work-chrome-control"));
    }

    #[test]
    fn chrome_disabled_does_not_force_chrome_mcp() {
        let plan = plan_mcp_for_prompt(
            "ouvre le site https://example.com dans Chrome",
            &[],
            false,
            false,
        );
        assert!(
            !plan.keep.iter().any(|k| k.contains("chrome")),
            "chrome MCP selected while chrome disabled: {:?}",
            plan
        );
    }

    #[test]
    fn password_does_not_select_word_mcp() {
        let plan = plan_mcp_for_prompt("change mon password dans le vault", &[], true, false);
        assert!(
            !plan.keep.iter().any(|k| k.contains("word")),
            "word MCP false positive: {:?}",
            plan
        );
    }

    #[test]
    fn capability_router_matrix_native_vs_plugin() {
        let cases: &[(&str, &[&str], bool, bool, McpLoadMode, Option<&str>)] = &[
            (
                "crée un fichier vide fichier.txt",
                &[],
                true,
                false,
                McpLoadMode::None,
                None,
            ),
            (
                "write an empty notes.txt",
                &[],
                true,
                false,
                McpLoadMode::None,
                None,
            ),
            (
                "ajoute une ligne dans README.md",
                &[],
                true,
                false,
                McpLoadMode::None,
                None,
            ),
            (
                "liste le dossier",
                &[],
                true,
                false,
                McpLoadMode::None,
                None,
            ),
            (
                "crée une présentation PowerPoint sur Azure",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bw-bob-work-microsoft-powerpoint-office-tools"),
            ),
            (
                "rédige un document Word (.docx) pour le comité",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bw-bob-work-microsoft-word-office-tools"),
            ),
            (
                "fais un tableur Excel des ventes",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bw-bob-work-microsoft-excel-office-tools"),
            ),
            (
                "OCR ce PDF scanné avec Docling",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bw-bob-work-docling-docling"),
            ),
            (
                "analyse le fichier",
                &["/tmp/brief.pptx"],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bw-bob-work-microsoft-powerpoint-office-tools"),
            ),
            (
                "ouvre le site https://example.com dans Chrome",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bob-work-chrome-control"),
            ),
            (
                "calcule un itinéraire Paris Lyon",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bob-work-map-tools"),
            ),
            (
                "ouvre la pull request sur github",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                Some("bob-work-github"),
            ),
            (
                "utilise @skill:capability-router pour décider",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                None,
            ),
            (
                "utilise @skill:computer-use pour cliquer dans Notes",
                &[],
                true,
                true,
                McpLoadMode::Filtered,
                Some("bob-work-computer-use"),
            ),
            (
                "utilise @skill:computer-use pour cliquer dans Notes",
                &[],
                true,
                false,
                McpLoadMode::Filtered,
                None,
            ),
            (
                "analyse tout le projet et propose une amélioration stratégique",
                &[],
                true,
                false,
                McpLoadMode::Full,
                None,
            ),
        ];

        let servers = sample_servers();
        for (prompt, attachments, chrome, computer, expected_mode, expected_server) in cases {
            let paths: Vec<String> = attachments.iter().map(|s| (*s).to_string()).collect();
            let plan = plan_mcp_for_prompt(prompt, &paths, *chrome, *computer);
            assert_eq!(
                plan.mode, *expected_mode,
                "mode mismatch for `{prompt}`: reason={}",
                plan.reason
            );
            let filtered = apply_mcp_plan(&servers, &plan);
            match expected_mode {
                McpLoadMode::None => assert!(
                    filtered.is_empty(),
                    "expected empty MCP for `{prompt}`, got {:?}",
                    filtered.keys().collect::<Vec<_>>()
                ),
                McpLoadMode::Filtered => {
                    if let Some(server) = expected_server {
                        assert!(
                            filtered.keys().any(|k| mcp_name_matches(k, server)),
                            "expected `{server}` for `{prompt}`, got {:?} (reason={})",
                            filtered.keys().collect::<Vec<_>>(),
                            plan.reason
                        );
                    } else {
                        assert!(
                            filtered.is_empty(),
                            "expected empty filtered MCP for `{prompt}`, got {:?}",
                            filtered.keys().collect::<Vec<_>>()
                        );
                    }
                    assert!(
                        !filtered.contains_key("bob-work-computer-use")
                            || *expected_server == Some("bob-work-computer-use"),
                        "computer-use leaked for `{prompt}`"
                    );
                }
                McpLoadMode::Full => {
                    assert!(
                        filtered.contains_key("bob-work-github"),
                        "Full mode should keep catalog for `{prompt}`"
                    );
                    assert!(
                        !filtered.contains_key("bob-work-computer-use"),
                        "Full mode must exclude computer-use for `{prompt}`"
                    );
                }
            }
            println!(
                "OK [{:?}] {} → {}",
                plan.mode,
                prompt.chars().take(56).collect::<String>(),
                plan.reason
            );
        }
    }

    #[test]
    fn workspace_mcp_overlay_restores_previous() {
        let dir = tempfile::tempdir().expect("tempdir");
        let workspace = dir.path();
        let bob = workspace.join(".bob");
        std::fs::create_dir_all(&bob).unwrap();
        let path = bob.join("mcp.json");
        std::fs::write(&path, br#"{"mcpServers":{"keep-me":{}}}"#).unwrap();

        let mut servers = Map::new();
        servers.insert("lazy-only".into(), json!({ "command": "echo" }));
        {
            let _overlay = WorkspaceMcpOverlay::apply(workspace, &servers).unwrap();
            let current = std::fs::read_to_string(&path).unwrap();
            assert!(current.contains("lazy-only"));
            assert!(!current.contains("keep-me"));
        }
        let restored = std::fs::read_to_string(&path).unwrap();
        assert!(restored.contains("keep-me"));
        assert!(!restored.contains("lazy-only"));
    }
}
