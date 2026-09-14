---
name: capability-router
description: Décide si Bob Work doit exécuter une tâche avec les outils natifs ou charger un plugin/skill spécialisé (Visualize, Office, Docling, Chrome, architecture…).
icon: compass
user-invocable: true
---

# Capability router — natif vs plugin

Utilise ce skill **en premier** quand tu hésites entre une action native Bob Shell et un plugin plateforme.

## Règle d’or

1. **Mention `@plugin:` / `@skill:`** dans le prompt → charge cette ressource, point.
2. **Sinon**, choisis le chemin le **plus simple** qui livre correctement.

## Natif (sans plugin) — Bob le fait mieux / plus vite

- Créer / vider / écrire un fichier texte (`.txt`, `.md`, JSON, YAML, code source)
- `touch`, rename, delete, list dans le workspace
- Édition de code, shell simple, git basique
- Réponses purement conversationnelles

→ Utilise les outils fichiers / shell **directement**. Ne charge pas Documents / Office / Docling.

## Plugin / skill plateforme — charge à la volée

| Intention | Mention canonique | Slug skill / MCP |
|-----------|-------------------|------------------|
| Chart / dashboard / visuel interactif / preview HTML | `@plugin:visualize` ou `@plugin:builtin-visualize` | skill `visualize` (pas de MCP) → `.html` + chemin absolu |
| PPTX / diapos | `@plugin:builtin-powerpoint` | skill `bob-work-microsoft-powerpoint` / MCP `bw-bob-work-microsoft-powerpoint-office-tools` |
| DOCX Word | `@plugin:builtin-word` | `bob-work-microsoft-word` / `bw-…-word-office-tools` |
| XLSX / CSV | `@plugin:builtin-excel` | `bob-work-microsoft-excel` / `bw-…-excel-office-tools` |
| PDF générique / Markdown export | `@plugin:builtin-documents` | `bob-work-documents` / `bw-…-documents-office-tools` |
| OCR / PDF scanné / tableaux Docling | `@plugin:builtin-docling` | `bob-work-docling` / `bw-bob-work-docling-docling` |
| Architecture cloud (SVG pro) | `@plugin:agentic-cloud-architect` | skill `cloud-architect` (pas de MCP) |
| Site web **http(s)** visible | `@plugin:builtin-chrome-control` | MCP `bob-work-chrome-control` — **jamais** HTML local / `file://` |
| Bureau macOS | `@skill:computer-use` | MCP `bob-work-computer-use` (si activé) |
| Carte / itinéraire | `@plugin:builtin-map-tools` | skill `map-tools` / MCP `bob-work-map-tools` |
| GitHub PR / repo | `@integration:github` | MCP `bob-work-github` |

Appelle `use_skill` **une fois** le handler identifié. Ne parcours pas le catalogue.

## Preview chart / HTML (critique)

- Preview inline Bob Work = fichier **`.html`** (ou `.svg` / mermaid) dans le workspace, cité avec un **chemin absolu** `/Users/.../fichier.html`.
- **Interdit** : Chrome / `file://` pour un HTML local ; citation relative seule.
- Demande mixte « visuel interactif + PPT » → **Visualize (HTML) + PowerPoint (PPTX)**.
- Si l’utilisateur redemande preview : **re-cite le chemin absolu** (ou touche le HTML).

## En cas de doute

1. Fichier texte / action workspace triviale → **natif**.
2. Chart / dashboard interactif → **Visualize / HTML**, même si un PPT est aussi demandé.
3. Office / PDF riche / navigateur http(s) / diagramme pro → **plugin** dédié.
4. Deux handlers valides → le plus spécifique, ou une question courte.
5. Ne simule jamais un plugin absent.
