import type { Plugin, PluginCategory } from '@bob-work/shared-types';
import { isBuiltinPlugin } from './builtinCatalog';

export type PluginMetadata = {
  builtin?: boolean;
  icon?: string;
  slug?: string;
  requiresIntegration?: string;
  agentic?: boolean;
  instructions?: string;
  content?: string;
  capabilities?: string[];
  permissions?: Array<{ type?: string; description?: string }>;
  mcpServers?: Record<string, unknown>;
  integrations?: Array<{ provider?: string; displayName?: string; authType?: string; optional?: boolean }>;
  browserExtensions?: Array<{ id?: string; displayName?: string; capability?: string; required?: boolean }>;
  hooks?: unknown[];
  scheduledTaskTemplates?: unknown[];
  releaseNotes?: string;
  connectorStrategy?: { tiers?: Array<{ id?: string; kind?: string; provider?: string; required?: boolean; auth?: string }>; explored?: string[]; fallback?: string };
  resources?: Array<{ kind?: string; label?: string; optional?: boolean; provider?: string; notes?: string }>;
};

export const permissionLabel = (permission: { type?: string; description?: string }) => ({
  'file.read': 'Lire les fichiers que vous avez autorisés',
  'file.write': 'Créer et modifier des fichiers dans les emplacements autorisés',
  'file.delete': 'Demander votre accord avant de supprimer un fichier',
  'network.request': 'Accéder au service connecté lorsque vous l’autorisez',
  'command.execute': 'Demander votre accord avant d’exécuter une action locale',
  'mcp.connect': 'Utiliser les outils connectés fournis par ce plugin',
  'hook.execute': 'Exécuter les actions automatiques déclarées par ce plugin',
  'browser.control': 'Contrôler le bureau ou le navigateur avec votre autorisation',
}[permission.type ?? ''] ?? permission.description ?? 'Utiliser une autorisation déclarée par ce plugin');

export const capabilityLabel = (capability: string) => {
  const [kind, action] = capability.split('.');
  const object = ({ document: 'des documents', docx: 'des documents Word', pptx: 'des présentations PowerPoint', xlsx: 'des classeurs Excel', onenote: 'des pages OneNote', formula: 'les formules', preview: 'les fichiers' } as Record<string, string>)[kind] ?? kind;
  const verb = ({ read: 'Lire', create: 'Créer', edit: 'Modifier', convert: 'Convertir', write: 'Publier', prepare: 'Préparer', verify: 'Vérifier' } as Record<string, string>)[action] ?? (kind === 'preview' ? 'Prévisualiser' : 'Utiliser');
  return `${verb} ${object}`;
};

export const metadataOf = (plugin: Plugin) => plugin.manifest as unknown as PluginMetadata;
export const isEnabled = (plugin: Plugin) => plugin.installState === 'installed';

/** Catalog builtins (id `builtin-*`) cannot be deleted; agentic/personal copies can. */
export const isProtectedBuiltin = (plugin: Plugin) => isBuiltinPlugin(plugin);

export const pluginKindLabel = (plugin: Plugin) => {
  const manifest = metadataOf(plugin);
  if (isProtectedBuiltin(plugin)) return 'Intégré';
  if (manifest.agentic) return 'Agentique';
  return 'Personnel';
};

export const nextPatchVersion = (version: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.1';
};

export function resourceKindLabel(kind: string): string {
  return ({
    integration: 'Compte externe',
    api: 'Clé d’API / Jeton',
    mcp: 'Pont système (MCP)',
    automation: 'Système macOS',
    calendar: 'Calendrier distant',
    mail: 'Boîte de messagerie',
  }[kind] ?? kind);
}

export function collectPluginResources(plugin: Plugin): { kind: string; label: string; count: number }[] {
  const meta = metadataOf(plugin);
  const resources: { kind: string; label: string; count: number }[] = [];

  if (meta.integrations) {
    const required = meta.integrations.filter(i => !i.optional).length;
    if (required > 0) resources.push({ kind: 'integration', label: 'Comptes requis', count: required });
  }
  if (meta.mcpServers) {
    const count = Object.keys(meta.mcpServers).length;
    if (count > 0) resources.push({ kind: 'mcp', label: 'Serveurs locaux (MCP)', count });
  }
  if (meta.browserExtensions) {
    const req = meta.browserExtensions.filter(e => e.required).length;
    if (req > 0) resources.push({ kind: 'automation', label: 'Autorisations locales requises', count: req });
  }

  return resources;
}
