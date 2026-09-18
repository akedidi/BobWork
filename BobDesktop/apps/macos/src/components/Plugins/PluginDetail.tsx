import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { save as chooseSavePath } from '@tauri-apps/plugin-dialog';
import { open as openUrl } from '@tauri-apps/plugin-shell';
import { exportPluginZip, getPluginExtensionStatus, getPluginMcpStatus, getPluginResourceStatus, getSkills, testPluginMcp } from '../../lib/ipc';
import { errorMessage } from '../../lib/errorMessage';
import { useAppStore } from '../../stores/appStore';
import type { Plugin, PluginCategory, PluginExtensionStatus, PluginMcpStatus, PluginMcpTestResult, PluginResourceStatus, PluginScheduleTemplate, WorkspaceSkill } from '@bob-work/shared-types';
import { metadataOf, isEnabled, isProtectedBuiltin, pluginKindLabel, permissionLabel, friendlyCapabilities, pluginSkillsOf, pluginWorkflowsOf, catalogSlugForPluginSkill, PluginMetadata } from '../../lib/pluginUtils';
import { localizePluginResourceMessage, localizePluginResourceSetupHint } from '../../lib/pluginResourceMessages';
import { useAppDialog } from '../AppDialog';
import { LoadErrorBanner } from '../LoadErrorBanner';
import { statusTone } from '../../lib/statusTone';
import { PluginIcon, resolvePluginIcon, resolveSkillIcon } from '../PluginIcon';
import { PluginFileResourcesSection } from './PluginFileResources';
import { formatCatalogDate } from '../../lib/formatDate';
import { useT } from '../../i18n';
import { isBuiltinPlugin } from '../../lib/builtinCatalog';

type OpenIntegrationsOpts = { tab?: string; highlight?: string; provider?: string };

export default function PluginDetail({ plugin, mcpRevision, toggling, onClose, onToggle, onEdit, onDelete, onStatus, onOpenIntegrations, onUseSchedule }: {
  plugin: Plugin
  mcpRevision: number
  toggling: boolean
  onClose: () => void
  onToggle: (enabled: boolean) => void
  onEdit: () => void
  onDelete: () => void
  onStatus: (message: string) => void
  onOpenIntegrations: (opts?: OpenIntegrationsOpts) => void
  onUseSchedule: (template: PluginScheduleTemplate) => void
}) {
  const navigate = useNavigate()
  const t = useT()
  const manifest = metadataOf(plugin)
  const enabled = isEnabled(plugin)
  const protectedBuiltin = isProtectedBuiltin(plugin)
  const capabilities = friendlyCapabilities(manifest.capabilities)
  const permissions = manifest.permissions?.map(permissionLabel) ?? []

  const exportZip = async () => {
    const slug = manifest.slug?.trim() || plugin.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || plugin.id
    try {
      const destination = await chooseSavePath({
        defaultPath: `${slug}.zip`,
        filters: [{ name: 'ZIP', extensions: ['zip'] }],
        title: `Exporter « ${plugin.name} »`,
      })
      if (!destination) return
      await exportPluginZip(plugin.id, destination)
      onStatus(`${plugin.name} a été exporté.`)
    } catch (error) {
      onStatus(errorMessage(error))
    }
  }

  return <aside className="skill-detail-panel" aria-label={`Détails du plugin ${plugin.name}`}>
    <div className="skill-panel-heading">
      <div className="skill-detail-title"><PluginIcon icon={resolvePluginIcon(plugin)} size="md" className="skill-row-icon" /><div><h2>{plugin.name}</h2><small>{pluginKindLabel(plugin)} · Version {plugin.version}</small></div></div>
      <button className="icon-btn" aria-label="Fermer les détails" onClick={onClose}>×</button>
    </div>
    <div className="skill-detail-status">
      <div><strong>{enabled ? 'Activé' : 'Désactivé'}</strong><small>{enabled ? 'Bob peut utiliser ce plugin.' : 'Bob n’utilisera pas ce plugin.'}</small></div>
      <label className="skill-switch"><input type="checkbox" checked={enabled} disabled={toggling} aria-label={`${enabled ? 'Désactiver' : 'Activer'} le plugin ${plugin.name}`} onChange={event => onToggle(event.target.checked)} /><span aria-hidden="true" /></label>
    </div>
    <div className="skill-panel-actions">
      {!protectedBuiltin && <>
        {!manifest.agentic && <button type="button" className="secondary-btn" onClick={onEdit}>Modifier</button>}
        {manifest.agentic && (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => {
              const brief = `Mets à jour le plugin agentique « ${plugin.name} » (id ${plugin.id}). Demande-moi les changements souhaités. Si l’utilisateur décrit des workflows (enchaînements métier), ajoute ou mets à jour le tableau \`workflows\` au format Open Workflow Specification (Serverless Workflow) 1.0 (\`document\` + \`do\`) même si le plugin n’en avait pas. Si un CLI, shell ou binaire open source est utile, choisis-le, télécharge une release épinglée et embarque-le toi-même (pas Homebrew, pas le wizard). Conserve ou corrige la description pour qu’elle reste fonctionnelle (bénéfice utilisateur, pas jargon MCP/CLI). Puis régénère/ajuste le bundle local et vérifie-le.`
              useAppStore.getState().setBuilderSession({ kind: 'plugin_builder', brief, guided: false })
              navigate('/chat', { state: { mode: 'plugin_builder', initialPrompt: brief } })
            }}
          >
            Faire évoluer avec Bob
          </button>
        )}
        <button type="button" className="secondary-btn" onClick={() => void exportZip()}>Exporter .zip</button>
        <button type="button" className="secondary-btn plugin-delete-btn" onClick={onDelete}>Supprimer</button>
      </>}
      {protectedBuiltin && <p className="settings-note" style={{ margin: 0 }}>Plugin intégré : désactivation possible, suppression impossible.</p>}
    </div>
    <section className="skill-detail-section"><h3>Description</h3><p>{plugin.description || 'Aucune description.'}</p></section>
    <PluginWorkflowsSection manifest={manifest} />
    {(plugin.createdAt || plugin.updatedAt || plugin.author) ? (
      <section className="skill-detail-section">
        <h3>{t('plugins.metadata')}</h3>
        <dl>
          {plugin.createdAt ? (
            <div>
              <dt>{isBuiltinPlugin(plugin) ? t('plugins.availableSince') : t('plugins.createdAt')}</dt>
              <dd>{formatCatalogDate(plugin.createdAt)}</dd>
            </div>
          ) : null}
          {plugin.updatedAt && plugin.updatedAt !== plugin.createdAt ? (
            <div><dt>{t('plugins.updatedAt')}</dt><dd>{formatCatalogDate(plugin.updatedAt)}</dd></div>
          ) : null}
          {plugin.author ? (
            <div><dt>{t('plugins.author')}</dt><dd>{plugin.author}</dd></div>
          ) : null}
        </dl>
      </section>
    ) : null}
    <PluginBundledContentSection manifest={manifest} />
    <PluginSkillsSection plugin={plugin} manifest={manifest} />
    <PluginResourcesSection
      pluginId={plugin.id}
      manifest={manifest}
      description={plugin.description}
      revision={mcpRevision}
      onConfigureResource={(target: any) => {
        navigate('/integrations', {
          state: {
            tab: target.tab,
            apiKeyPreset: target.envKey
              ? {
                  name: target.label,
                  envName: target.envKey,
                  authMode: 'env' as const,
                  url: target.url || '',
                  transport: 'http',
                }
              : undefined,
            highlight: target.tab === 'mcp' ? 'mcp' : target.tab === 'apis' ? 'keyed-api' : undefined,
          },
        })
      }}
    />
    {!isProtectedBuiltin(plugin) && (
      <PluginFileResourcesSection pluginId={plugin.id} revision={mcpRevision} onStatus={onStatus} />
    )}
    <section className="skill-detail-section"><h3>Ce plugin peut faire</h3>{capabilities.length ? <ul className="plugin-friendly-list">{capabilities.map((value: any) => <li key={value}>{value}</li>)}</ul> : <p>Aider Bob à réaliser les demandes correspondant à sa description.</p>}</section>
    {manifest.mcpServers && <PluginMcpSection key={`${plugin.id}-${plugin.installState}-${mcpRevision}`} plugin={plugin} onOpenIntegrations={onOpenIntegrations} />}
    {(Boolean(manifest.integrations?.length) || Boolean(manifest.browserExtensions?.length) || Boolean(manifest.hooks?.length) || Boolean(manifest.scheduledTaskTemplates?.length)) && <PluginExtensionsSection key={`extensions-${plugin.id}-${plugin.installState}-${mcpRevision}`} plugin={plugin} onOpenIntegrations={onOpenIntegrations} onUseSchedule={onUseSchedule} />}
    <section className="skill-detail-section"><h3>Autorisations</h3>{permissions.length ? <ul className="plugin-friendly-list">{permissions.map((value: any) => <li key={value}>{value}</li>)}</ul> : <p>Aucune autorisation supplémentaire.</p>}</section>
    <PluginCurrentVersionSection plugin={plugin} />
    <ManifestReadOnlySection plugin={plugin} />
    {manifest.requiresIntegration && <section className="skill-detail-section"><h3>Connexion</h3><p>Ce plugin nécessite un compte ou un service connecté.</p><button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Gérer les connexions</button></section>}
  </aside>
}

function PluginWorkflowsSection({ manifest }: { manifest: PluginMetadata }) {
  const t = useT()
  const workflows = pluginWorkflowsOf(manifest)
  if (workflows.length === 0) return null

  const triggerLabel = (trigger?: string) => {
    switch (trigger) {
      case 'manual': return t('plugins.workflowTriggerManual')
      case 'chat': return t('plugins.workflowTriggerChat')
      case 'schedule': return t('plugins.workflowTriggerSchedule')
      case 'event': return t('plugins.workflowTriggerEvent')
      default: return trigger || t('plugins.workflowTriggerChat')
    }
  }

  return (
    <section className="skill-detail-section" aria-label={t('plugins.workflows')}>
      <h3>{t('plugins.workflows')}</h3>
      <p className="settings-note" style={{ marginTop: 0 }}>{t('plugins.workflowsNote')}</p>
      <div className="plugin-mcp-list">
        {workflows.map(workflow => (
          <div className="plugin-mcp-card" key={workflow.id}>
            <div className="plugin-mcp-heading">
              <strong>{workflow.name}</strong>
              <span className="plugin-mcp-state">{triggerLabel(workflow.trigger)}</span>
            </div>
            {workflow.description ? <p>{workflow.description}</p> : null}
            <small>{t('plugins.workflowStandard', { dsl: workflow.dsl })}</small>
            {workflow.schedule ? (
              <small style={{ display: 'block' }}>{t('plugins.workflowSchedule', { schedule: workflow.schedule })}</small>
            ) : null}
            {workflow.steps.length > 0 ? (
              <ol className="plugin-friendly-list" style={{ marginTop: 8 }}>
                {workflow.steps.map(step => (
                  <li key={step.id}>
                    <strong>{step.name}</strong>
                    {step.description ? ` — ${step.description}` : ''}
                  </li>
                ))}
              </ol>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  )
}

function PluginBundledContentSection({ manifest }: { manifest: PluginMetadata }) {
  const t = useT()
  const content = manifest.bundledContent
  if (!content) return null

  const icons = content.icons
  const providerParts = icons?.providers
    ? Object.entries(icons.providers)
      .filter(([, count]) => count > 0)
      .map(([provider, count]) => `${count} ${provider.toUpperCase()}`)
    : []

  const rows: string[] = []
  const instructionCount = (content.instructions?.length ?? 0) + (manifest.skills?.length ?? 0)
  if (instructionCount > 0) {
    rows.push(t('plugins.bundledInstructions', { count: instructionCount }))
  }
  if (typeof content.referenceDocs === 'number' && content.referenceDocs > 0) {
    rows.push(t('plugins.bundledReferenceDocs', { count: content.referenceDocs }))
  }
  if (typeof content.scripts === 'number' && content.scripts > 0) {
    rows.push(t('plugins.bundledScripts', { count: content.scripts }))
  }
  if (icons?.total) {
    rows.push(t('plugins.bundledIcons', {
      total: icons.total,
      details: providerParts.join(', '),
    }))
  }
  if (rows.length === 0) return null

  return (
    <section className="skill-detail-section" aria-label={t('plugins.bundledContentHeading')}>
      <h3>{t('plugins.bundledContentHeading')}</h3>
      <p className="settings-note" style={{ marginTop: 0 }}>{t('plugins.bundledContentNote')}</p>
      <ul className="plugin-friendly-list">
        {rows.map(row => <li key={row}>{row}</li>)}
      </ul>
    </section>
  )
}

function PluginSkillsSection({ plugin, manifest }: { plugin: Plugin; manifest: PluginMetadata }) {
  const t = useT()
  const navigate = useNavigate()
  const skills = pluginSkillsOf(manifest)
  const [catalog, setCatalog] = useState<WorkspaceSkill[] | null>(null)
  useEffect(() => {
    if (skills.length === 0) return
    let active = true
    void getSkills()
      .then((items: WorkspaceSkill[]) => { if (active) setCatalog(items) })
      .catch(() => { if (active) setCatalog([]) })
    return () => { active = false }
  }, [plugin.id, skills.length])

  if (skills.length === 0) return null

  const parentSlug = manifest.slug?.trim() || undefined
  return (
    <section className="skill-detail-section" aria-label={t('plugins.skills')}>
      <h3>{t('plugins.skills')}</h3>
      <p className="settings-note" style={{ marginTop: 0 }}>{t('plugins.skillsNote')}</p>
      <div className="plugin-mcp-list">
        {skills.map(skill => {
          const match = catalog ? catalogSlugForPluginSkill(skill.name, catalog, parentSlug) : null
          const bundled = match?.kind === 'plugin-skill'
            || Boolean(skill.path?.replace(/\\/g, '/').includes('/skills/') || skill.path?.startsWith('skills/'))
          return (
            <div className="plugin-mcp-card" key={skill.name}>
              <div className="plugin-mcp-heading">
                <strong style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <PluginIcon icon={resolveSkillIcon({ slug: skill.name, name: skill.displayName })} size="sm" className="skill-row-icon" />
                  {skill.displayName}
                </strong>
                {bundled ? (
                  <span className="plugin-mcp-state">{t('plugins.skillBundled')}</span>
                ) : null}
              </div>
              {skill.description ? <p>{skill.description}</p> : null}
              {match ? (
                <button
                  type="button"
                  className="secondary-btn"
                  onClick={() => navigate('/skills', { state: { skillSlug: match.slug } })}
                >
                  {match.kind === 'skill' ? t('plugins.openInSkills') : t('plugins.openPluginSkill')}
                </button>
              ) : null}
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PluginCurrentVersionSection({ plugin }: { plugin: Plugin }) {
  return <section className="skill-detail-section plugin-versions" aria-label="Version du plugin">
    <h3>Version</h3>
    <div className="plugin-version-row">
      <div><strong>Version {plugin.version}</strong><small>Version utilisée actuellement</small></div>
      <span className="plugin-current-version">Actuelle</span>
    </div>
  </section>
}

function localResourceKindLabel(kind: string, t: (key: string) => string) {
  const keys: Record<string, string> = {
    oauth: 'plugins.resourceKindOauth',
    database: 'plugins.resourceKindDatabase',
    pdf: 'plugins.resourceKindPdf',
    spreadsheet: 'plugins.resourceKindSpreadsheet',
    file: 'plugins.resourceKindFile',
    mcp: 'plugins.resourceKindMcp',
    'api-public': 'plugins.resourceKindApiPublic',
    'api-key': 'plugins.resourceKindApiKey',
    'web-search': 'plugins.resourceKindWebSearch',
    'bob-llm': 'plugins.resourceKindBobLlm',
    'computer-use': 'plugins.resourceKindComputerUse',
    chrome: 'plugins.resourceKindChrome',
    'stdio-cli': 'plugins.resourceKindStdioCli',
    'host-cli': 'plugins.resourceKindHostCli',
    'bundled-bin': 'plugins.resourceKindBundledBin',
    'bundled-python': 'plugins.resourceKindBundledPython',
    'bundled-assets': 'plugins.resourceKindBundledAssets',
    'shared-runtime': 'plugins.resourceKindSharedRuntime',
    shell: 'plugins.resourceKindShell',
    'node-cli': 'plugins.resourceKindNodeCli',
    'web-reference': 'plugins.resourceKindWebReference',
  }
  return keys[kind] ? t(keys[kind]) : kind
}

function resourceActionLabel(state: string, t: (key: string) => string) {
  if (state === 'needs_key') return t('plugins.resourceNeedsKey')
  if (state === 'needs_setup') return t('plugins.resourceNeedsSetup')
  return null
}

function resourceStateClass(state: string) {
  if (state === 'ready' || state === 'always_on') return 'connected'
  if (state === 'needs_key') return 'needs-key'
  if (state === 'needs_setup') return 'needs-setup'
  return ''
}

function localCollectPluginResources(manifest: PluginMetadata, description?: string | null) {
  const items: Array<{ key: string; kind: string; label: string; optional: boolean; notes?: string }> = []
  const push = (kind: string, label: string, optional = false, notes?: string) => {
    const key = `${kind}:${label}`
    if (items.some((item: any) => item.key === key)) return
    items.push({ key, kind, label, optional, notes })
  }

  const declaredResources = (manifest.resources ?? []).filter((resource: any) => resource?.label || resource?.kind)
  // Prefer an explicit `resources` list when present — otherwise the same
  // connectors were also mirrored in integrations / mcpServers / connectorStrategy
  // and the detail panel looked redundant.
  if (declaredResources.length > 0) {
    for (const resource of declaredResources) {
      push(
        resource.kind || 'mcp',
        resource.label || resource.provider || resource.kind || 'Ressource',
        Boolean(resource.optional),
        resource.notes,
      )
    }
    return items
  }

  for (const integration of manifest.integrations ?? []) {
    push(
      integration.authType === 'token' ? 'api-key' : 'oauth',
      integration.displayName || integration.provider || 'Connexion',
      Boolean(integration.optional),
      integration.provider,
    )
  }
  for (const [id, server] of Object.entries(manifest.mcpServers ?? {})) {
    const entry = server as { displayName?: string; description?: string; url?: string; command?: string }
    push('mcp', entry.displayName || id, false, entry.description || entry.url || entry.command)
  }
  for (const extension of manifest.browserExtensions ?? []) {
    const kind = extension.capability === 'chrome' ? 'chrome' : extension.capability === 'computer_use' ? 'computer-use' : 'mcp'
    push(kind, extension.displayName || extension.id || kind, extension.required === false)
  }
  for (const tier of manifest.connectorStrategy?.tiers ?? []) {
    const kind = tier.kind?.includes('oauth')
      ? 'oauth'
      : tier.kind?.includes('open-api') || tier.kind === 'open-api'
        ? (tier.auth === 'token' || String(tier.provider || '').includes('finnhub') ? 'api-key' : 'api-public')
        : tier.kind?.includes('remote')
          ? 'mcp'
          : tier.kind?.includes('local') || tier.kind?.includes('cli')
            ? (tier.kind?.includes('bin') ? 'bundled-bin' : 'stdio-cli')
            : (tier.kind || 'mcp')
    push(kind, tier.provider || tier.id || kind, tier.required === false)
  }
  const permissions = manifest.permissions ?? []
  if (permissions.some((item: any) => item.type === 'network.request')) {
    push('web-search', 'Recherche / réseau web Bob', true)
  }
  if (manifest.capabilities?.some((value: any) => value.includes('llm') || value.includes('brief') || value.includes('synthesize'))) {
    push('bob-llm', 'LLM Bob (synthèse)', false)
  }
  if (description?.toLowerCase().includes('llm bob') || description?.toLowerCase().includes('synthèse')) {
    push('bob-llm', 'LLM Bob', false)
  }
  return items
}

function PluginResourcesSection({
  pluginId,
  manifest,
  description,
  revision,
  onConfigureResource,
}: {
  pluginId: string
  manifest: PluginMetadata
  description?: string | null
  revision: number
  onConfigureResource: (target: {
    tab: 'integrations' | 'apis' | 'mcp' | 'db'
    label: string
    envKey?: string
    url?: string
  }) => void
}) {
  const t = useT()
  const [live, setLive] = useState<PluginResourceStatus[] | null>(null)
  useEffect(() => {
    let active = true
    void getPluginResourceStatus(pluginId)
      .then((value: any) => { if (active) setLive(value) })
      .catch(() => { if (active) setLive([]) })
    return () => { active = false }
  }, [pluginId, revision])

  const fallback = localCollectPluginResources(manifest, description)
  if (live === null) {
    return <section className="skill-detail-section" aria-label={t('plugins.sources')}><h3>{t('plugins.sources')}</h3><p>{t('plugins.sourcesChecking')}</p></section>
  }
  if (live.length === 0 && fallback.length === 0) return null

  const rows = live.length > 0 ? live : fallback.map((resource, index) => ({
    id: `${resource.key}-${index}`,
    label: resource.label,
    kind: resource.kind,
    optional: resource.optional,
    state: 'ready',
    message: resource.notes || '',
    setupHint: null as string | null,
    configureTab: resource.kind === 'api-key' ? 'apis' : resource.kind === 'mcp' ? 'mcp' : resource.kind === 'oauth' ? 'integrations' : null,
    envKey: resource.notes?.match(/[A-Z][A-Z0-9_]{5,}/)?.[0] ?? null,
    configureUrl: null as string | null,
  }))

  return (
    <section className="skill-detail-section" aria-label={t('plugins.sources')}>
      <h3>{t('plugins.sources')}</h3>
      <p className="settings-note" style={{ marginTop: 0 }}>
        {t('plugins.sourcesNote')}
      </p>
      <div className="plugin-mcp-list">
        {rows.map((resource: any) => {
          const tab = (resource.configureTab === 'apis' || resource.configureTab === 'mcp' || resource.configureTab === 'integrations' || resource.configureTab === 'db')
            ? resource.configureTab
            : resource.kind === 'api-key'
              ? 'apis'
              : resource.kind === 'mcp'
                ? 'mcp'
                : resource.kind === 'database'
                  ? 'db'
                  : null
          const actionLabel = resourceActionLabel(resource.state, t)
          const showOpenReference = resource.kind === 'web-reference' && Boolean(resource.configureUrl)
          const showConfigure = !showOpenReference && Boolean(tab) && (
            resource.kind === 'api-key'
            || resource.kind === 'mcp'
            ||             resource.kind === 'oauth'
            || resource.kind === 'database'
            || resource.state === 'needs_key'
            || resource.state === 'needs_setup'
          )
          const configureLabel = tab === 'apis'
            ? (resource.state === 'ready' ? t('plugins.manageInApis') : t('plugins.configureInApis'))
            : tab === 'mcp'
              ? t('plugins.configureInMcp')
              : tab === 'db'
                ? t('plugins.configureInDb')
                : t('plugins.openIntegrations')
          return (
            <div className="plugin-mcp-card" key={resource.id}>
              <div className="plugin-mcp-heading">
                <strong>{resource.label}</strong>
                {actionLabel ? (
                  <span className={`plugin-mcp-state ${resourceStateClass(resource.state)}`}>
                    {actionLabel}
                  </span>
                ) : null}
              </div>
              <p>{localizePluginResourceMessage(resource, t) || localResourceKindLabel(resource.kind, t)}</p>
              {'setupHint' in resource && resource.setupHint && (
                <p className="settings-note">{localizePluginResourceSetupHint(resource.setupHint, t)}</p>
              )}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: 6 }}>
                <small>{localResourceKindLabel(resource.kind, t)}</small>
                {showOpenReference && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => void openUrl(resource.configureUrl).catch(() => undefined)}
                  >
                    {t('plugins.openSource')}
                  </button>
                )}
                {showConfigure && tab && (
                  <button
                    type="button"
                    className="link-btn"
                    onClick={() => onConfigureResource({
                      tab,
                      label: resource.label,
                      envKey: resource.envKey || undefined,
                      url: resource.configureUrl || undefined,
                    })}
                  >
                    {configureLabel}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function PluginExtensionsSection({ plugin, onOpenIntegrations, onUseSchedule }: { plugin: Plugin; onOpenIntegrations: (opts?: OpenIntegrationsOpts) => void; onUseSchedule: (template: PluginScheduleTemplate) => void }) {
  const [status, setStatus] = useState<PluginExtensionStatus | null>(null)
  const [statusError, setStatusError] = useState<unknown>(null)
  useEffect(() => {
    let active = true
    setStatusError(null)
    void getPluginExtensionStatus(plugin.id)
      .then((value: any) => { if (active) setStatus(value) })
      .catch(error => {
        if (!active) return
        setStatusError(error)
        setStatus({ integrations: [], browserExtensions: [], hooks: [], scheduledTaskTemplates: [] })
      })
    return () => { active = false }
  }, [plugin.id])
  if (!status) return <section className="skill-detail-section"><p>Vérification des extensions du plugin…</p></section>
  if (statusError) return <section className="skill-detail-section" role="alert"><p className="plugin-version-warning">{errorMessage(statusError, 'Impossible de charger les connexions du plugin.')}</p></section>
  return <>
    {status.integrations.length > 0 && <section className="skill-detail-section" aria-label="Connexions du plugin">
      <h3>Connexions</h3>
      <p className="settings-note" style={{ marginTop: 0 }}>
        Comptes à autoriser (OAuth / jeton) pour ce plugin — distinct des sources API publiques listées plus haut.
      </p>
      <div className="plugin-mcp-list">{status.integrations.map(integration => <div className="plugin-mcp-card" key={integration.provider}>
        <div className="plugin-mcp-heading"><strong>{integration.name}</strong><span className={`plugin-mcp-state ${integration.state === 'connected' ? 'connected' : integration.state === 'failed' ? 'failed' : integration.state === 'configured' ? 'configured' : ''}`} title={integration.message}>{integration.state === 'connected' ? 'Connecté' : integration.state === 'configured' ? 'Configuré (compte à vérifier)' : integration.state === 'failed' ? 'Test échoué' : integration.state === 'disabled' ? 'Désactivé' : 'À connecter'}</span></div>
        <p>{integration.message}</p>
        {integration.scopes.length > 0 && <small>Accès demandé : {integration.scopes.join(', ')}</small>}
        {integration.state !== 'connected' && (
          <button
            type="button"
            className="link-btn"
            onClick={() => onOpenIntegrations({ tab: 'integrations', highlight: integration.provider, provider: integration.provider })}
          >
            Connecter
          </button>
        )}
      </div>)}</div>
      <button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Gérer les connexions</button>
    </section>}
    {status.browserExtensions.length > 0 && <section className="skill-detail-section" aria-label="Capacités navigateur du plugin">
      <h3>Navigateur</h3>
      <div className="plugin-mcp-list">{status.browserExtensions.map(extension => <div className="plugin-mcp-card" key={extension.id}>
        <div className="plugin-mcp-heading"><strong>{extension.name}</strong><span className={`plugin-mcp-state ${extension.state === 'ready' ? 'connected' : ''}`}>{extension.state === 'ready' ? 'Prêt' : extension.state === 'disabled' ? 'Désactivé' : 'Outil requis'}</span></div>
        <p>{extension.message}</p>
      </div>)}</div>
      <button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Configurer les outils</button>
    </section>}
    {status.hooks.length > 0 && <section className="skill-detail-section" aria-label="Actions automatiques du plugin">
      <h3>Actions automatiques</h3>
      <ul className="plugin-friendly-list">{status.hooks.map(hook => <li key={hook.id}>{hook.name} · {hook.enabled ? hookEventLabel(hook.event) : 'désactivée'}</li>)}</ul>
      <p>Ces actions locales s’exécutent uniquement quand vous utilisez ce plugin et après autorisation.</p>
    </section>}
    {status.scheduledTaskTemplates.length > 0 && <section className="skill-detail-section" aria-label="Automatisations proposées par le plugin">
      <h3>Automatisations</h3>
      <div className="plugin-mcp-list">{status.scheduledTaskTemplates.map(template => <div className="plugin-mcp-card" key={template.id}>
        <div className="plugin-mcp-heading"><strong>{template.name}</strong><button className="link-btn" onClick={() => onUseSchedule(template)}>Planifier</button></div>
        {template.description && <p>{template.description}</p>}
      </div>)}</div>
    </section>}
  </>
}

function PluginMcpSection({ plugin, onOpenIntegrations }: { plugin: Plugin; onOpenIntegrations: (opts?: OpenIntegrationsOpts) => void }) {
  const [servers, setServers] = useState<PluginMcpStatus[] | null>(null)
  const [testing, setTesting] = useState(false)
  const [testResults, setTestResults] = useState<PluginMcpTestResult[] | null>(null)
  const [testError, setTestError] = useState('')
  const [statusError, setStatusError] = useState('')

  const refresh = () => getPluginMcpStatus(plugin.id)
    .then((value: any) => { setServers(value); setStatusError('') })
    .catch(error => { setStatusError(errorMessage(error, 'Impossible de charger les outils MCP.')); setServers([]) })

  useEffect(() => {
    let active = true
    setStatusError('')
    void getPluginMcpStatus(plugin.id)
      .then((value: any) => { if (active) setServers(value) })
      .catch(error => {
        if (!active) return
        setStatusError(errorMessage(error, 'Impossible de charger les outils MCP.'))
        setServers([])
      })
    return () => { active = false }
  }, [plugin.id])

  const runTest = async () => {
    setTesting(true)
    setTestError('')
    setTestResults(null)
    try {
      const results = await testPluginMcp(plugin.id)
      setTestResults(results)
      await refresh()
    } catch (error) {
      setTestError(errorMessage(error))
    } finally {
      setTesting(false)
    }
  }

  return <section className="skill-detail-section" aria-label="Outils connectés du plugin">
    <h3>Outils connectés</h3>
    <p className="settings-note" style={{ marginTop: 0 }}>
      Serveurs MCP exposés par ce plugin (outils appelables). Les APIs comme Stooq ou Finnhub sont listées dans Sources — Finnhub n’est pas un outil MCP séparé.
    </p>
    {servers === null ? <p>Vérification de la connexion…</p> : servers.length === 0 ? <p>Les outils de ce plugin restent à configurer.</p> : <div className="plugin-mcp-list">
      {servers.map(server => {
        const live = testResults?.find((item: any) => item.id === server.id)
        const persisted = server.lastTest
        const result = live
          ? { ok: live.ok, message: live.message, testedAt: live.testedAt ?? undefined }
          : persisted
            ? { ok: persisted.ok, message: persisted.message, testedAt: persisted.testedAt }
            : null
        const stateClass = result ? (result.ok ? 'connected' : 'failed') : server.enabled ? 'configured' : 'untested'
        const stateLabel = result
          ? (result.ok ? 'Test réussi' : 'Échec')
          : server.enabled
            ? 'Installé · non testé'
            : server.configured
              ? 'Désactivé'
              : 'À configurer'
        return <div className="plugin-mcp-card" key={server.id}>
          <div className="plugin-mcp-heading">
            <strong>{server.name}</strong>
            <span className={`plugin-mcp-state ${stateClass}`} title={result?.testedAt ? `Testé le ${result.testedAt}` : undefined}>
              {stateLabel}
            </span>
          </div>
          {server.description && <p>{server.description}</p>}
          {server.tools.length > 0 && <ul className="plugin-friendly-list">{server.tools.map(tool => <li key={tool}>{tool.replace(/_/g, ' ')}</li>)}</ul>}
          {result && <p className={result.ok ? 'settings-note' : 'plugin-version-warning'} role={result.ok ? undefined : 'alert'}>{result.message}</p>}
        </div>
      })}
    </div>}
    <div className="skill-panel-actions">
      <button className="secondary-btn" disabled={testing || !servers?.length} onClick={() => void runTest()}>
        {testing ? 'Test en cours…' : 'Tester la connexion MCP'}
      </button>
      <button className="link-btn" onClick={() => onOpenIntegrations({ tab: 'integrations' })}>Gérer les connexions</button>
    </div>
    {statusError && <p className="plugin-version-warning" role="alert">{statusError}</p>}
    {testError && <p className="plugin-version-warning" role="alert">{testError}</p>}
  </section>
}

function ManifestReadOnlySection({ plugin }: { plugin: Plugin }) {
  const [expanded, setExpanded] = useState(false)
  return <section className="skill-detail-section" aria-label="Manifeste du plugin">
    <h3>
      <button type="button" className="link-btn" aria-expanded={expanded} onClick={() => setExpanded((value: any) => !value)}>
        Manifeste (lecture seule)
      </button>
    </h3>
    {expanded && <pre className="plugin-manifest-pre">{JSON.stringify(plugin.manifest, null, 2)}</pre>}
  </section>
}

function Empty({ text }: { text: string }) { return <div className="task-empty"><span>{text}</span></div> }
function hookEventLabel(event: string) { return ({ before_task: 'avant la tâche', after_task: 'après la tâche', task_error: 'en cas d’erreur' } as Record<string, string>)[event] ?? event }
