import type { Plugin, PluginCategory } from '@bob-work/shared-types';
import { isBuiltinPlugin } from './builtinCatalog';
import { getActiveLocale } from '../i18n';
import { translate } from '../i18n/translate';

function t(key: string) {
  return translate(getActiveLocale(), key);
}

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
  skills?: Array<{ name?: string; displayName?: string; description?: string; path?: string }>;
  specializedMode?: { allowedSkills?: string[] };
};

export type PluginSkillRef = {
  name: string
  displayName: string
  description: string
  path?: string
};

export function pluginSkillsOf(manifest: PluginMetadata): PluginSkillRef[] {
  const seen = new Set<string>()
  const skills: PluginSkillRef[] = []
  for (const skill of manifest.skills ?? []) {
    const name = skill.name?.trim()
    if (!name) continue
    const key = name.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    skills.push({
      name,
      displayName: skill.displayName?.trim() || name,
      description: skill.description?.trim() || '',
      path: skill.path?.trim() || undefined,
    })
  }
  for (const allowed of manifest.specializedMode?.allowedSkills ?? []) {
    const name = allowed.trim()
    if (!name) continue
    const key = name.toLocaleLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    skills.push({ name, displayName: name, description: '' })
  }
  return skills
}

export function catalogSlugForPluginSkill(
  skillName: string,
  catalog: Array<{ slug: string; name: string }>,
  parentSlug?: string,
): { slug: string; kind: 'skill' | 'plugin-skill' } | null {
  const needle = skillName.trim().toLocaleLowerCase()
  if (!needle) return null
  const exact = catalog.find(item =>
    item.slug.toLocaleLowerCase() === needle || item.name.toLocaleLowerCase() === needle)
  if (exact) return { slug: exact.slug, kind: 'skill' }
  const suffix = catalog.find(item => item.slug.toLocaleLowerCase().endsWith(`-${needle}`))
  if (suffix) return { slug: suffix.slug, kind: 'skill' }
  const parent = parentSlug?.trim().toLocaleLowerCase()
  if (!parent) return null
  const parentMatch = catalog.find(item => item.slug.toLocaleLowerCase() === parent)
  return parentMatch ? { slug: parentMatch.slug, kind: 'plugin-skill' } : null
}

export const permissionLabel = (permission: { type?: string; description?: string }) => ({
  'file.read': t('plugins.permFileRead'),
  'file.write': t('plugins.permFileWrite'),
  'file.delete': t('plugins.permFileDelete'),
  'network.request': t('plugins.permNetwork'),
  'command.execute': t('plugins.permCommand'),
  'mcp.connect': t('plugins.permMcp'),
  'hook.execute': t('plugins.permHook'),
  'browser.control': t('plugins.permBrowser'),
}[permission.type ?? ''] ?? permission.description ?? t('plugins.permFallback'));

export const capabilityLabel = (capability: string) => {
  const [kind, action] = capability.split('.');
  const object = ({
    document: t('plugins.capObjectDocuments'),
    docx: t('plugins.capObjectWord'),
    pptx: t('plugins.capObjectPpt'),
    xlsx: t('plugins.capObjectExcel'),
    onenote: t('plugins.capObjectOnenote'),
    formula: t('plugins.capObjectFormulas'),
    preview: t('plugins.capObjectFiles'),
  } as Record<string, string>)[kind] ?? kind;
  const verb = ({
    read: t('plugins.capVerbRead'),
    create: t('plugins.capVerbCreate'),
    edit: t('plugins.capVerbEdit'),
    convert: t('plugins.capVerbConvert'),
    write: t('plugins.capVerbWrite'),
    prepare: t('plugins.capVerbPrepare'),
    verify: t('plugins.capVerbVerify'),
  } as Record<string, string>)[action] ?? (kind === 'preview' ? t('plugins.capVerbPreview') : t('plugins.capVerbUse'));
  return `${verb} ${object}`;
};

/**
 * Several technical capabilities can intentionally belong to the same product
 * family (for example `qiskit.circuit.create` and `qiskit.visualize`).  The
 * detail panel, however, presents a human label rather than the internal
 * capability identifier. Keep that friendly list concise and stable.
 */
export function friendlyCapabilities(capabilities: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const capability of capabilities ?? []) {
    if (capability === 'prompt') continue;
    const label = capabilityLabel(capability);
    const key = label.trim().toLocaleLowerCase();
    if (!label.trim() || seen.has(key)) continue;
    seen.add(key);
    labels.push(label);
  }
  return labels;
}

export const metadataOf = (plugin: Plugin) => plugin.manifest as unknown as PluginMetadata;
export const isEnabled = (plugin: Plugin) => plugin.installState === 'installed';

/** Catalog builtins (id `builtin-*`) cannot be deleted; agentic/personal copies can. */
export const isProtectedBuiltin = (plugin: Plugin) => isBuiltinPlugin(plugin);

export const pluginKindLabel = (plugin: Plugin) => {
  const manifest = metadataOf(plugin);
  if (isProtectedBuiltin(plugin)) return t('plugins.kindBuiltin');
  if (manifest.agentic) return t('plugins.kindAgentic');
  return t('plugins.kindPersonal');
};

export const nextPatchVersion = (version: string) => {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  return match ? `${match[1]}.${match[2]}.${Number(match[3]) + 1}` : '1.0.1';
};

export function resourceKindLabel(kind: string): string {
  return ({
    integration: t('plugins.resourceAccount'),
    api: t('plugins.resourceApiToken'),
    mcp: t('plugins.resourceMcpBridge'),
    automation: t('plugins.resourceAutomation'),
    calendar: t('plugins.resourceCalendar'),
    mail: t('plugins.resourceMail'),
  }[kind] ?? kind);
}

export function collectPluginResources(plugin: Plugin): { kind: string; label: string; count: number }[] {
  const meta = metadataOf(plugin);
  const resources: { kind: string; label: string; count: number }[] = [];

  if (meta.integrations) {
    const required = meta.integrations.filter(i => !i.optional).length;
    if (required > 0) resources.push({ kind: 'integration', label: t('plugins.resourceAccountsRequired'), count: required });
  }
  if (meta.mcpServers) {
    const count = Object.keys(meta.mcpServers).length;
    if (count > 0) resources.push({ kind: 'mcp', label: t('plugins.resourceLocalMcp'), count });
  }
  if (meta.browserExtensions) {
    const req = meta.browserExtensions.filter(e => e.required).length;
    if (req > 0) resources.push({ kind: 'automation', label: t('plugins.resourceLocalPerms'), count: req });
  }

  return resources;
}
