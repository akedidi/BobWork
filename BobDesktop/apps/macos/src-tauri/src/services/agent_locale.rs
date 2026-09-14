//! Resolve UI locale for agent scaffolding and user-visible runtime notices.
//!
//! `settings.language` drives the UI; until this module existed it never reached
//! Bob prompts, so French system prefixes biased replies even when UI + prompt
//! were English.

use std::env;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AppLocale {
    En,
    Fr,
    Es,
}

impl AppLocale {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::En => "en",
            Self::Fr => "fr",
            Self::Es => "es",
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::En => "English",
            Self::Fr => "French",
            Self::Es => "Spanish",
        }
    }
}

/// Match frontend `resolveLocale`: explicit en/fr/es, else system base, else en.
pub fn resolve_app_locale(preference: &str) -> AppLocale {
    resolve_app_locale_with_system(preference, &system_language_tag())
}

pub fn resolve_app_locale_with_system(preference: &str, system_language: &str) -> AppLocale {
    let pref = preference.trim().to_ascii_lowercase();
    match pref.as_str() {
        "en" => AppLocale::En,
        "fr" => AppLocale::Fr,
        "es" => AppLocale::Es,
        _ => {
            let system = system_language.trim().to_ascii_lowercase();
            let base = system.split(['-', '_']).next().unwrap_or("");
            match base {
                "fr" => AppLocale::Fr,
                "es" => AppLocale::Es,
                _ => AppLocale::En,
            }
        }
    }
}

fn system_language_tag() -> String {
    env::var("LC_ALL")
        .or_else(|_| env::var("LANG"))
        .unwrap_or_else(|_| "en".into())
}

/// Strong reply-language rule. Placed first in the prompt.
///
/// Priority: (1) language of the user's latest message, (2) UI locale only when
/// that language is unclear. UI English must not override a clear French/Spanish
/// (etc.) user prompt — plan/todo text and narration count as user-facing.
pub fn reply_language_policy(locale: AppLocale) -> String {
    match locale {
        AppLocale::En => concat!(
            "Reply language (mandatory): always match the language of the user's latest ",
            "message for every user-facing reply, summary, plan/todo update, step title, and ",
            "explanation. Example: a French user message → reply and todos in French, even if ",
            "the app UI is English. Use English only when the user's language is unclear or ",
            "mixed. System / tool instructions below may be written in another language — ignore ",
            "their language for your replies; keep tool names and paths unchanged."
        )
        .into(),
        AppLocale::Fr => concat!(
            "Langue de réponse (obligatoire) : suis toujours la langue du dernier message ",
            "utilisateur pour toute réponse visible, résumé, mise à jour de plan/todo, titre ",
            "d’étape et explication. Exemple : message en anglais → réponds et todos en anglais, ",
            "même si l’UI est en français. Utilise le français seulement si la langue du ",
            "message est ambiguë ou mixte. Des instructions système ci-dessous peuvent être ",
            "dans une autre langue — ignore leur langue pour tes réponses ; conserve noms ",
            "d’outils et chemins."
        )
        .into(),
        AppLocale::Es => concat!(
            "Idioma de respuesta (obligatorio): sigue siempre el idioma del último mensaje ",
            "del usuario en toda respuesta visible, resumen, actualización de plan/todo, título ",
            "de paso y explicación. Ejemplo: mensaje en francés → responde y todos en francés, ",
            "aunque la UI esté en español. Usa el español solo si el idioma del mensaje es ",
            "ambiguo o mixto. Las instrucciones del sistema más abajo pueden estar en otro ",
            "idioma: ignora ese idioma en tus respuestas; mantén nombres de herramientas y rutas."
        )
        .into(),
    }
}

pub fn mode_prefix(mode: &str, locale: AppLocale) -> &'static str {
    match (locale, mode) {
        (AppLocale::Fr, "ask" | "quick_chat") => "Réponds de façon concise et directe.",
        (AppLocale::Fr, "plan" | "planning") => {
            "Génère un plan structuré, validable étape par étape, avant toute action."
        }
        (AppLocale::Fr, "presentation") => {
            "Tu dois créer une présentation professionnelle. Commence par proposer le plan des slides."
        }
        (AppLocale::Fr, "document") => {
            "Crée un document structuré avec titres, sections et conclusion."
        }
        (AppLocale::Fr, "research") => {
            "Effectue une recherche approfondie avec sources et niveau de confiance."
        }
        (AppLocale::Fr, "spreadsheet") => {
            "Analyse les données et produis des tableaux et insights clairs."
        }
        (AppLocale::Fr, "orchestrator") => {
            "Décompose l'objectif en étapes avec dépendances. Liste chaque étape clairement."
        }
        (AppLocale::Fr, "plugin_builder") => {
            "Tu es en mode création de plugin, indépendamment du wizard. Décris d’abord l’intelligence métier, puis déclare les capacités Runtime Architecture V2 nécessaires : Shared pour les capacités génériques, External Managed pour un framework lourd optionnel, Private pour une dépendance spécifique approuvée. N’invente ni URL, ni chemin, ni commande d’installation et ne télécharge aucun exécutable. Ne mène un entretien que si le bénéfice utilisateur est encore flou. description = bénéfice utilisateur ; outils et intégrations dans resources."
        }
        (AppLocale::Fr, "skill_builder") => {
            "Tu es en mode création de skill. Mène un entretien court puis écris un SKILL.md local (pas un plugin agentique)."
        }
        (AppLocale::Fr, _) => "Tu es un assistant de travail professionnel.",

        (AppLocale::Es, "ask" | "quick_chat") => "Responde de forma concisa y directa.",
        (AppLocale::Es, "plan" | "planning") => {
            "Genera un plan estructurado y validable paso a paso antes de cualquier acción."
        }
        (AppLocale::Es, "presentation") => {
            "Debes crear una presentación profesional. Empieza proponiendo el plan de diapositivas."
        }
        (AppLocale::Es, "document") => {
            "Crea un documento estructurado con títulos, secciones y conclusión."
        }
        (AppLocale::Es, "research") => {
            "Realiza una investigación profunda con fuentes y nivel de confianza."
        }
        (AppLocale::Es, "spreadsheet") => {
            "Analiza los datos y produce tablas e insights claros."
        }
        (AppLocale::Es, "orchestrator") => {
            "Descompón el objetivo en pasos con dependencias. Lista cada paso con claridad."
        }
        (AppLocale::Es, "plugin_builder") => {
            "Estás en modo creación de plugin, independientemente del asistente. Describe primero la inteligencia de negocio, luego declara las capacidades Runtime Architecture V2 necesarias. No inventes URL, rutas ni comandos de instalación y no descargues ejecutables."
        }
        (AppLocale::Es, "skill_builder") => {
            "Estás en modo creación de skill. Haz una entrevista breve y escribe un SKILL.md local (no un plugin agentico)."
        }
        (AppLocale::Es, _) => "Eres un asistente de trabajo profesional.",

        (_, "ask" | "quick_chat") => "Reply concisely and directly.",
        (_, "plan" | "planning") => {
            "Produce a structured, step-by-step plan that can be validated before any action."
        }
        (_, "presentation") => {
            "Create a professional presentation. Start by proposing the slide outline."
        }
        (_, "document") => {
            "Create a structured document with headings, sections, and a conclusion."
        }
        (_, "research") => {
            "Do thorough research with sources and confidence levels."
        }
        (_, "spreadsheet") => "Analyze the data and produce clear tables and insights.",
        (_, "orchestrator") => {
            "Break the goal into steps with dependencies. List each step clearly."
        }
        (_, "plugin_builder") => {
            "You are in plugin-creation mode, independent of the wizard. Describe the business intelligence first, then declare required Runtime Architecture V2 capabilities: Shared for generic capabilities, External Managed for an optional heavy framework, Private for an approved specific dependency. Do not invent URLs, paths, or install commands, and do not download executables. Interview only if the user benefit is still unclear. description = user benefit; tools and integrations go in resources."
        }
        (_, "skill_builder") => {
            "You are in skill-creation mode. Run a short interview then write a local SKILL.md (not an agentic plugin)."
        }
        (_, _) => "You are a professional work assistant.",
    }
}

pub fn history_role_user(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::Fr => "Utilisateur",
        AppLocale::Es => "Usuario",
        AppLocale::En => "User",
    }
}

pub fn history_block(locale: AppLocale, history: &str, message: &str) -> String {
    match locale {
        AppLocale::Fr => format!(
            "--- Historique de la conversation ---\n{history}\n--- Fin de l'historique ---\n\nNouveau message: {message}"
        ),
        AppLocale::Es => format!(
            "--- Historial de la conversación ---\n{history}\n--- Fin del historial ---\n\nNuevo mensaje: {message}"
        ),
        AppLocale::En => format!(
            "--- Conversation history ---\n{history}\n--- End of history ---\n\nNew message: {message}"
        ),
    }
}

pub fn label_global_instructions(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::Fr => "Instructions globales",
        AppLocale::Es => "Instrucciones globales",
        AppLocale::En => "Global instructions",
    }
}

pub fn label_project_instructions(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::Fr => "Instructions du projet",
        AppLocale::Es => "Instrucciones del proyecto",
        AppLocale::En => "Project instructions",
    }
}

pub fn label_conversation_summary(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::Fr => {
            "Résumé cumulatif de la conversation (source de vérité pour les échanges plus anciens)"
        }
        AppLocale::Es => {
            "Resumen acumulado de la conversación (fuente de verdad para intercambios anteriores)"
        }
        AppLocale::En => {
            "Cumulative conversation summary (source of truth for older exchanges)"
        }
    }
}

pub fn sandbox_guidance(locale: AppLocale) -> String {
    match locale {
        AppLocale::Fr => crate::services::permission_governance::sandbox_guidance_fr(),
        AppLocale::Es => sandbox_guidance_es(),
        AppLocale::En => sandbox_guidance_en(),
    }
}

fn sandbox_guidance_en() -> String {
    "Bob Work sandbox mode: work only inside the folder connected via Bob Work (workspace) and a private per-session HOME/TMP destroyed when the run ends — installs and local state are not preserved. No access to other Mac folders (Home, Desktop, Documents, Downloads, /etc, other projects) or the macOS desktop — disk confinement is enforced by the OS sandbox (Seatbelt), not by a soft workspace tool block. Computer Use is unavailable. Chrome and subagents remain usable when enabled (Chrome via the Bob Work host bridge). Local configured MCP servers remain usable. These limits also apply to the terminal, scripts, subprocesses, symlinks, and plugins. Never retry a denied operation (Operation not permitted / sandbox limitations) with another tool to bypass the limit.\n\
$HOME points to a private sandbox HOME, not the user's real home: a success on ~/Desktop or ~/Documents only creates/reads that isolated HOME. To prove a host limit outside the workspace, use an absolute Mac host path (e.g. /Users/<user>/Desktop/…) and explicitly report that it is blocked by Bob Work sandbox limitations (Operation not permitted) — do not present the isolated HOME as the real Desktop.\n\
Network: public HTTPS remains available for model inference; local network, private addresses (RFC1918), link-local, and cloud metadata (169.254.169.254) are forbidden. Quotas: wall-clock time, CPU, memory, file size, and session HOME storage are capped.\n\
Platform shared runtimes (LaTeX, Pandoc, diagram/D2, skills) are exposed via `$HOME/.bob/skills` and `$HOME/.bob/runtimes` (links to the host) and via PATH / `$BOB_WORK_D2`. Use those paths — do not claim the plugin or D2 is absent without testing `test -f \"$HOME/.bob/skills/cloud-architect/scripts/render_professional_svg.py\"` and `command -v d2` (or `$BOB_WORK_D2`). Skill/plugin creation exception: when explicitly requested (`@skill:skill-creator`, `@skill:plugin-creator`, skill_builder / plugin_builder modes, “create a skill/plugin”), you **must** create or edit bundles under `$HOME/.bob/skills/<slug>/` with `write_file` / edit tools (or the terminal) — those writes go to the host and **persist** after the session. Do not refuse by citing a workspace soft-block: that tree is allowed in sandbox. Do not write elsewhere under `~/.bob` (settings, vault, runtimes). External-runtime exception: if a plugin cannot run because it depends on an external runtime (`externalRuntimes`, host CLI outside shared platform runtimes, install under ~/.bob/runtimes/external) and the failure is caused by the sandbox, always start with “This action is blocked by Bob Work sandbox limitations: this plugin depends on an external runtime”; name the plugin and runtime; clearly tell the user to turn off sandbox mode in Settings → Permissions, then retry outside isolation. Do not fake the result.\n\
For short summaries, prefer a Markdown bullet list (one line per finding) over a table.\n\
On denial: always start with “This action is blocked by Bob Work sandbox limitations: …” ; name the action and resource without revealing secrets; distinguish a policy refusal from a real tool error and never claim you performed an unexecuted operation.\n\
Never advise disabling the sandbox, switching to direct disk access, enabling Computer Use or full computer access, or elevating privileges — except the external-runtime exception above. Instead suggest attaching a copy of the needed file to the conversation or working on a copy explicitly provided in the workspace. For an incompatible system action or install unrelated to an external runtime, explain the sandbox limit and only provide steps the user can review and perform themselves, without executing them. If nothing in the workspace works, stop that action and ask for a compatible input.".into()
}

fn sandbox_guidance_es() -> String {
    "Modo sandbox de Bob Work: trabaja solo en la carpeta conectada vía Bob Work (workspace) y un HOME/TMP privados de sesión destruidos al final de la ejecución — instalaciones y estado local no se conservan. Sin acceso a otras carpetas del Mac (Inicio, Escritorio, Documentos, Descargas, /etc, otros proyectos) ni al escritorio de macOS — el confinamiento de disco lo impone la sandbox del SO (Seatbelt), no un soft-block de workspace de las herramientas. Computer Use no está disponible. Chrome y los subagentes siguen usables si están activados (Chrome vía el bridge anfitrión de Bob Work). Los servidores MCP locales configurados siguen usables. Estos límites también aplican al terminal, scripts, subprocesos, enlaces simbólicos y plugins. Nunca reintentes una operación denegada (Operation not permitted / limitaciones sandbox) con otra herramienta para eludir el límite.\n\
$HOME apunta a un HOME privado de sandbox, no al hogar real del usuario: un éxito en ~/Desktop o ~/Documents solo crea/lee ese HOME aislado. Para demostrar un límite fuera del workspace, usa una ruta absoluta del Mac anfitrión (p. ej. /Users/<user>/Desktop/…) e informa explícitamente que está bloqueado por las limitaciones de la sandbox de Bob Work (Operation not permitted); no presentes el HOME aislado como el Escritorio real.\n\
Red: HTTPS público sigue disponible para la inferencia; la red local, direcciones privadas (RFC1918), link-local y metadatos cloud (169.254.169.254) están prohibidos. Cuotas: duración, CPU, memoria, tamaño de archivo y almacenamiento del HOME de sesión están limitados.\n\
Los runtimes compartidos de plataforma (LaTeX, Pandoc, diagram/D2, skills) se exponen vía `$HOME/.bob/skills` y `$HOME/.bob/runtimes` (enlaces al anfitrión) y vía PATH / `$BOB_WORK_D2`. Usa esas rutas — no declares ausente el plugin o D2 sin probar `test -f \"$HOME/.bob/skills/cloud-architect/scripts/render_professional_svg.py\"` y `command -v d2` (o `$BOB_WORK_D2`). Excepción creación skill/plugin: si el usuario lo pide explícitamente (`@skill:skill-creator`, `@skill:plugin-creator`, modos skill_builder / plugin_builder, « crea un skill/plugin »), **debes** crear o editar bundles bajo `$HOME/.bob/skills/<slug>/` con `write_file` / herramientas de edición (o el terminal) — esas escrituras van al anfitrión y **persisten** tras la sesión. No rechaces citando un soft-block de workspace: ese árbol está permitido en sandbox. No escribas en otros sitios bajo `~/.bob` (settings, vault, runtimes). Excepción runtime externo: si un plugin no puede ejecutarse porque depende de un runtime externo (`externalRuntimes`, CLI del host fuera de los runtimes compartidos, instalación bajo ~/.bob/runtimes/external) y el fallo viene de la sandbox, empieza siempre con « Esta acción está bloqueada por las limitaciones de la sandbox de Bob Work: este plugin depende de un runtime externo »; nombra el plugin y el runtime; di claramente al usuario que desactive el modo sandbox en Ajustes → Permisos y reintente fuera de la aislamiento. No simules el resultado.\n\
Para resúmenes cortos, prefiere una lista con viñetas Markdown (una línea por hallazgo) en lugar de una tabla.\n\
Ante un rechazo: empieza siempre con « Esta acción está bloqueada por las limitaciones de la sandbox de Bob Work: … »; nombra la acción y el recurso sin revelar secretos; distingue un rechazo de política de un error real de herramienta y nunca afirmes haber ejecutado una operación no realizada.\n\
Nunca aconsejes desactivar la sandbox, pasar a acceso directo al disco, activar Computer Use o el acceso completo al ordenador, ni elevar privilegios — salvo la excepción de runtime externo anterior. Propón adjuntar una copia del archivo necesario a la conversación o trabajar sobre una copia aportada explícitamente en el workspace. Si nada en el workspace sirve, detén esa acción y pide una entrada compatible.".into()
}

pub fn unauthorized_edit_notice(
    locale: AppLocale,
    removed: &[String],
    modified_names: &[String],
) -> Option<String> {
    if removed.is_empty() && modified_names.is_empty() {
        return None;
    }
    let mut notice = match locale {
        AppLocale::Fr => String::from("\n\nLa permission « Edit » est désactivée. "),
        AppLocale::Es => String::from("\n\nEl permiso « Edit » está desactivado. "),
        AppLocale::En => String::from("\n\nThe « Edit » permission is off. "),
    };
    if !removed.is_empty() {
        notice.push_str(match locale {
            AppLocale::Fr => "Les fichiers créés sans autorisation ont été supprimés : ",
            AppLocale::Es => "Los archivos creados sin autorización se eliminaron: ",
            AppLocale::En => "Unauthorized created files were removed: ",
        });
        notice.push_str(&removed.join(", "));
        notice.push('.');
    }
    if !modified_names.is_empty() {
        if !removed.is_empty() {
            notice.push(' ');
        }
        notice.push_str(match locale {
            AppLocale::Fr => "Des fichiers existants ont été modifiés malgré cette limite : ",
            AppLocale::Es => "Se modificaron archivos existentes pese a este límite: ",
            AppLocale::En => "Existing files were modified despite this limit: ",
        });
        notice.push_str(&modified_names.join(", "));
        notice.push('.');
    }
    notice.push_str(match locale {
        AppLocale::Fr => {
            " Cochez Edit dans le menu Permissions du composer pour autoriser les écritures."
        }
        AppLocale::Es => {
            " Activa Edit en el menú Permissions del composer para permitir escrituras."
        }
        AppLocale::En => {
            " Turn on Edit in the composer Permissions menu to allow writes."
        }
    });
    Some(notice)
}

pub fn edit_approval_required_content(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::Fr => {
            "La permission « Edit » n’est pas auto-approuvée. Bob Work affiche une carte Refuser / Autoriser une fois / Autoriser le groupe."
        }
        AppLocale::Es => {
            "El permiso « Edit » no está autoaprobado. Bob Work muestra una tarjeta Rechazar / Autorizar una vez / Autorizar el grupo."
        }
        AppLocale::En => {
            "The « Edit » permission is not auto-approved. Bob Work shows a Deny / Allow once / Allow group card."
        }
    }
}

pub fn edit_denied_content(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::Fr => {
            "La permission « Edit » est désactivée. Cochez Edit dans le menu Permissions du composer. Le fichier ne sera pas conservé."
        }
        AppLocale::Es => {
            "El permiso « Edit » está desactivado. Activa Edit en el menú Permissions del composer. El archivo no se conservará."
        }
        AppLocale::En => {
            "The « Edit » permission is off. Turn on Edit in the composer Permissions menu. The file will not be kept."
        }
    }
}

pub fn permission_resume_grant(locale: AppLocale, label: &str, duration: &str) -> String {
    let scope = match (locale, duration) {
        (AppLocale::Fr, "once") => "une fois",
        (AppLocale::Fr, _) => "pour cette tâche",
        (AppLocale::Es, "once") => "una vez",
        (AppLocale::Es, _) => "para esta tarea",
        (_, "once") => "once",
        (_, _) => "for this task",
    };
    match locale {
        AppLocale::Fr => format!(
            "L'utilisateur a autorisé le groupe « {label} » ({scope}). Reprends et effectue immédiatement l'action précédemment bloquée (appelle l'outil concerné, ne te contente pas d'expliquer)."
        ),
        AppLocale::Es => format!(
            "El usuario autorizó el grupo « {label} » ({scope}). Reanuda y ejecuta de inmediato la acción previamente bloqueada (llama a la herramienta correspondiente; no te limites a explicar)."
        ),
        AppLocale::En => format!(
            "The user authorized the « {label} » group ({scope}). Resume and immediately perform the previously blocked action (call the relevant tool; do not only explain)."
        ),
    }
}

pub fn bob_wants_tool_description(locale: AppLocale, tool_name: &str, label: &str) -> String {
    match locale {
        AppLocale::Fr => format!(
            "Bob souhaite utiliser « {tool_name} » (groupe {label}). Cette action n’est pas auto-approuvée."
        ),
        AppLocale::Es => format!(
            "Bob quiere usar « {tool_name} » (grupo {label}). Esta acción no está autoaprobada."
        ),
        AppLocale::En => format!(
            "Bob wants to use « {tool_name} » (group {label}). This action is not auto-approved."
        ),
    }
}

pub fn permissions_appendix(locale: AppLocale, labels: &str) -> String {
    match locale {
        AppLocale::Fr => format!(
            "\n\nPermissions Bob Work : les groupes suivants ne sont pas auto-approuvés : {labels}. Quand tu en as besoin, appelle immédiatement l’outil correspondant (ex. write_file pour Edit) — ne refuse pas en texte, ne demande pas confirmation, et n’attends pas une permission préalable. Bob Work affichera alors une carte Refuser / Autoriser une fois / Autoriser le groupe et reprendra après décision. Ne prétends jamais avoir effectué une action non exécutée."
        ),
        AppLocale::Es => format!(
            "\n\nPermisos Bob Work: estos grupos no están autoaprobados: {labels}. Cuando los necesites, llama de inmediato a la herramienta correspondiente (p. ej. write_file para Edit) — no rechaces en texto, no pidas confirmación y no esperes un permiso previo. Bob Work mostrará una tarjeta Rechazar / Autorizar una vez / Autorizar el grupo y reanudará tras la decisión. Nunca digas que ejecutaste una acción no realizada."
        ),
        AppLocale::En => format!(
            "\n\nBob Work permissions: these groups are not auto-approved: {labels}. When you need them, immediately call the matching tool (e.g. write_file for Edit) — do not refuse in text, do not ask for confirmation, and do not wait for prior permission. Bob Work will then show a Deny / Allow once / Allow group card and resume after the decision. Never claim you performed an unexecuted action."
        ),
    }
}

pub fn outputs_workspace_guidance(locale: AppLocale, workspace: &str) -> String {
    match locale {
        AppLocale::Fr => format!(
            "\n\nSorties et visualisations : tout fichier que tu crées doit être écrit dans le workspace de cette conversation : `{workspace}`. N’utilise jamais /tmp pour un livrable. Pour toute visualisation / chart / dashboard interactif demandé (même avec un PPT), crée une exportation HTML locale durable (idéalement via `@plugin:visualize` / `builtin-visualize`) et cite le chemin absolu du fichier final dans la réponse sous la forme `/Users/.../fichier.html` — jamais `file://` ni un nom relatif seul. Ce HTML sera enregistré comme artefact et affiché en preview inline dans la conversation. N’ouvre pas Chrome pour prévisualiser un HTML local ; Chrome est réservé aux URLs http(s). Un PPTX est un export Office complémentaire, pas un substitut à la preview. Si l’utilisateur redemande un aperçu, re-cite le même chemin absolu. Si l’utilisateur demande un site, une page Web complète ou un graphique volontairement pleine page, conserve sa mise en page documentaire et ajoute `<meta name=\"bob-preview-mode\" content=\"full-page\">` dans le `<head>` : l’aperçu Bob Work utilisera alors la taille naturelle avec défilement horizontal et vertical au besoin. N’aplatis pas une page complète en dashboard compact uniquement pour supprimer le scroll."
        ),
        AppLocale::Es => format!(
            "\n\nSalidas y visualizaciones: todo archivo que crees debe escribirse en el workspace de esta conversación: `{workspace}`. Nunca uses /tmp para un entregable. Para cualquier visualización, chart o dashboard interactivo (aunque también pidan un PPT), crea un HTML local durable (idealmente con `@plugin:visualize` / `builtin-visualize`) y cita la ruta absoluta `/Users/.../archivo.html` — nunca `file://` ni solo el nombre relativo. Ese HTML se guarda como artefacto y se muestra en vista previa inline. No uses Chrome para previsualizar HTML local; Chrome solo para URLs http(s). Un PPTX es un export Office adicional, no sustituye la preview. Si el usuario pide de nuevo un aperçu/preview, vuelve a citar la misma ruta absoluta. Si pide un sitio o página completa, añade `<meta name=\"bob-preview-mode\" content=\"full-page\">` en el `<head>`."
        ),
        AppLocale::En => format!(
            "\n\nOutputs and visualizations: every file you create must be written in this conversation workspace: `{workspace}`. Never use /tmp for a deliverable. For any requested interactive chart/dashboard/visualization (even when a PPT is also requested), create a durable local HTML export (ideally via `@plugin:visualize` / `builtin-visualize`) and cite the absolute path as `/Users/.../file.html` — never `file://` and never a bare relative name. That HTML is stored as an artifact and shown as an inline conversation preview. Do not use Chrome to preview local HTML; Chrome is only for http(s) URLs. A PPTX is a complementary Office export, not a substitute for the inline preview. If the user asks again for a preview, re-cite the same absolute path. If the user asks for a site, full web page, or intentionally full-page chart, keep its documentary layout and add `<meta name=\"bob-preview-mode\" content=\"full-page\">` in `<head>` so Bob Work preview uses the natural size with horizontal/vertical scroll as needed. Do not flatten a full page into a compact dashboard just to remove scrolling."
        ),
    }
}

pub fn session_start_denied_message(locale: AppLocale) -> &'static str {
    match locale {
        AppLocale::Fr => {
            "Je m’arrête ici : le démarrage de la session n’a pas été autorisé, donc je ne peux pas traiter cette demande."
        }
        AppLocale::Es => {
            "Me detengo aquí: no se autorizó el inicio de la sesión, así que no puedo procesar esta solicitud."
        }
        AppLocale::En => {
            "Stopping here: session start was not authorized, so I cannot process this request."
        }
    }
}

pub fn permission_group_denied_message(locale: AppLocale, label: &str) -> String {
    match locale {
        AppLocale::Fr => format!(
            "Je m’arrête ici : la permission **{label}** n’a pas été accordée, donc je ne peux pas poursuivre cette action. Envoie une nouvelle demande si tu veux continuer autrement (sans cette permission), ou accorde-la la prochaine fois."
        ),
        AppLocale::Es => format!(
            "Me detengo aquí: no se concedió el permiso **{label}**, así que no puedo continuar esta acción. Envía una nueva solicitud si quieres continuar de otra forma (sin ese permiso), o concédelo la próxima vez."
        ),
        AppLocale::En => format!(
            "Stopping here: the **{label}** permission was not granted, so I cannot continue this action. Send a new request if you want to continue another way (without that permission), or grant it next time."
        ),
    }
}

pub fn permission_appendix_markers() -> &'static [&'static str] {
    &[
        "\n\nPermissions Bob Work :",
        "\n\nBob Work permissions:",
        "\n\nPermisos Bob Work:",
        "\n\nL'utilisateur a autorisé le groupe",
        "\n\nL’utilisateur a autorisé le groupe",
        "\n\nThe user authorized the",
        "\n\nEl usuario autorizó el grupo",
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolves_explicit_and_auto_locales() {
        assert_eq!(resolve_app_locale_with_system("en", "fr-FR"), AppLocale::En);
        assert_eq!(resolve_app_locale_with_system("fr", "en-US"), AppLocale::Fr);
        assert_eq!(resolve_app_locale_with_system("auto", "fr-FR"), AppLocale::Fr);
        assert_eq!(resolve_app_locale_with_system("auto", "en-GB"), AppLocale::En);
        assert_eq!(resolve_app_locale_with_system("auto", "es-MX"), AppLocale::Es);
        assert_eq!(resolve_app_locale_with_system("auto", "de-DE"), AppLocale::En);
    }

    #[test]
    fn english_edit_notice_is_english() {
        let notice = unauthorized_edit_notice(
            AppLocale::En,
            &["sandbox-write-ok.txt".into()],
            &["index.html".into()],
        )
        .expect("notice");
        assert!(notice.contains("Edit"));
        assert!(notice.contains("permission is off"));
        assert!(notice.contains("Turn on Edit"));
        assert!(!notice.contains("désactivée"));
    }

    #[test]
    fn reply_policy_prioritizes_user_message_over_ui_locale() {
        let en = reply_language_policy(AppLocale::En);
        assert!(en.contains("always match the language of the user's latest message"));
        assert!(en.contains("French user message → reply and todos in French"));
        assert!(en.contains("Use English only when"));
        assert!(!en.contains("write every user-facing reply, summary, plan update, and explanation in English"));

        let fr = reply_language_policy(AppLocale::Fr);
        assert!(fr.contains("suis toujours la langue du dernier message"));
        assert!(fr.contains("Utilise le français seulement"));
    }
}
