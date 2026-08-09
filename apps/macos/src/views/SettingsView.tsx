import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openUrl } from '@tauri-apps/plugin-shell'
import { open as chooseFile, save as chooseSavePath } from '@tauri-apps/plugin-dialog'
import { isPermissionGranted, requestPermission } from '@tauri-apps/plugin-notification'
import { useNavigate } from 'react-router-dom'
import { bobAuthService } from '../services/BobAuthService'
import { errorMessage } from '../lib/errorMessage'
import {
  getBobProfile, getPermissionGrants, getSettings, getUsageStatus,
  revokePermissionGrant, updateSettings, importConversations, exportConversations,
} from '../lib/ipc'
import type { AppSettings, PermissionGrant, ShellProfile, UsageStatus } from '@bob-work/shared-types'

type Tab = 'general' | 'bob' | 'instructions' | 'permissions' | 'tasks' | 'extensions' | 'appearance' | 'data'

const TABS: { id: Tab; label: string; keywords: string }[] = [
  { id: 'general', label: 'Général', keywords: 'mode démarrage ouverture session barre menus notifications système' },
  { id: 'bob', label: 'IBM Bob Shell', keywords: 'clé api inférence session temporaire consommation crédits installation authentification' },
  { id: 'instructions', label: 'Instructions', keywords: 'prompt défaut personnalisées consignes projet réponse' },
  { id: 'permissions', label: 'Permissions', keywords: 'autorisations approbation fichiers terminal réseau applications révoquer' },
  { id: 'tasks', label: 'Tâches et planifié', keywords: 'planification historique coût tours limites notification rétention réveil' },
  { id: 'extensions', label: 'Extensions et web', keywords: 'mcp intégrations plugins skills sous-agents orchestrateur web ordinateur chrome' },
  { id: 'appearance', label: 'Apparence et langue', keywords: 'thème clair sombre dark light français english taille texte dictée animations' },
  { id: 'data', label: 'Données locales', keywords: 'import export conversations chatgpt claude cowork télémétrie diagnostic dossier' },
]

export default function SettingsView() {
  const [tab, setTab] = useState<Tab>('general')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [profile, setProfile] = useState<ShellProfile | null>(null)
  const [usage, setUsage] = useState<UsageStatus | null>(null)
  const [grants, setGrants] = useState<PermissionGrant[]>([])
  const [apiKey, setApiKey] = useState('')
  const [sessionKeyStatus, setSessionKeyStatus] = useState({ active: false, source: 'none' as 'session' | 'environment' | 'none' })
  const [status, setStatus] = useState('')
  const [saving, setSaving] = useState(false)
  const [settingsSearch, setSettingsSearch] = useState('')
  const navigate = useNavigate()

  const visibleTabs = useMemo(() => {
    const query = normalizeSettingsSearch(settingsSearch)
    if (!query) return TABS
    return TABS.filter(item => normalizeSettingsSearch(`${item.label} ${item.keywords}`).includes(query))
  }, [settingsSearch])

  const refreshProfile = async () => {
    const [nextProfile, nextUsage, nextGrants, nextSessionKeyStatus] = await Promise.all([
      getBobProfile().catch(() => null), getUsageStatus().catch(() => null),
      getPermissionGrants().catch(() => []), bobAuthService.getSessionApiKeyStatus().catch(() => ({ active: false, source: 'none' as const })),
    ])
    setProfile(nextProfile); setUsage(nextUsage); setGrants(nextGrants); setSessionKeyStatus(nextSessionKeyStatus)
    return nextProfile
  }

  useEffect(() => {
    getSettings().then(setSettings).catch(error => setStatus(String(error)))
    refreshProfile()
  }, [])

  useEffect(() => {
    if (!settingsSearch.trim() || visibleTabs.some(item => item.id === tab)) return
    if (visibleTabs[0]) setTab(visibleTabs[0].id)
  }, [settingsSearch, tab, visibleTabs])

  const change = <K extends keyof AppSettings>(key: K, value: AppSettings[K]) => {
    setSettings(current => current ? { ...current, [key]: value } : current)
    if (key === 'theme') applyTheme(String(value))
  }

  const save = async () => {
    if (!settings) return
    setSaving(true); setStatus('')
    try {
      let nextSettings = settings
      if (settings.notificationsEnabled && !(await isPermissionGranted())) {
        const permission = await requestPermission()
        if (permission !== 'granted') {
          nextSettings = { ...settings, notificationsEnabled: false }
          setSettings(nextSettings)
        }
      }
      await updateSettings(nextSettings)
      window.dispatchEvent(new CustomEvent('bob-settings-updated', { detail: nextSettings }))
      setStatus('Réglages enregistrés.')
    } catch (error) { setStatus(String(error)) } finally { setSaving(false) }
  }

  const install = async () => {
    setStatus('Téléchargement et vérification SHA-256 de Bob Shell…')
    try { await invoke('install_bob_shell'); setStatus('Bob Shell installé.'); await refreshProfile() }
    catch (error) { setStatus(`Installation impossible : ${String(error)}`) }
  }

  const saveKey = async () => {
    if (!apiKey.trim()) return
    try {
      await bobAuthService.setSessionApiKey(apiKey.trim())
      setApiKey('')
      setStatus('Clé IBM Bob enregistrée dans le coffre local chiffré.')
      await refreshProfile()
    } catch (error) { setStatus(errorMessage(error)) }
  }

  if (!settings) return <div className="task-empty"><span className="task-spinner" />Chargement des réglages…</div>

  return (
    <div className="settings-shell">
      <nav className="settings-nav">
        <h2>Réglages</h2>
        <div className="settings-search">
          <span aria-hidden="true">⌕</span>
          <input autoComplete="off" aria-label="Rechercher dans les réglages" placeholder="Rechercher" value={settingsSearch} onChange={event => setSettingsSearch(event.target.value)} />
          {settingsSearch && <button aria-label="Effacer la recherche" onClick={() => setSettingsSearch('')}>×</button>}
        </div>
        {visibleTabs.map(item => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}
        {visibleTabs.length === 0 && <p className="settings-search-empty">Aucun réglage trouvé.</p>}
      </nav>
      <main className="settings-content">
        <div style={{ display: visibleTabs.length > 0 ? 'contents' : 'none' }}>
        {tab === 'general' && <>
          <Heading title="Général" description="Comportement principal de Bob Work sur ce Mac." />
          <Card>
            <SelectRow title="Mode Bob par défaut" description="Le mode remplace le choix de modèle LLM." value={settings.defaultMode} onChange={value => change('defaultMode', value)}>
              <option value="agent">Agent</option><option value="plan">Plan</option><option value="ask">Ask</option>
              {profile?.modes.filter(mode => !['agent', 'plan', 'ask'].includes(mode.slug)).map(mode => <option key={mode.slug} value={mode.slug}>{mode.name}</option>)}
            </SelectRow>
            <ToggleRow title="Lancer à l’ouverture de session" description="Prépare l’exécution des tâches planifiées." value={settings.launchAtLogin} onChange={value => change('launchAtLogin', value)} />
            <ToggleRow title="Icône de barre des menus" description="Permet de laisser Bob Work actif en arrière-plan." value={settings.menuBarEnabled} onChange={value => change('menuBarEnabled', value)} />
            <ToggleRow title="Notifications système" value={settings.notificationsEnabled} onChange={value => change('notificationsEnabled', value)} />
          </Card>
        </>}

        {tab === 'bob' && <>
          <Heading title="IBM Bob Shell" description="Bob Work pilote l’installation locale et transmet une clé de session uniquement au processus bob run." />
          <Card>
            <StatusRow title="Installation" value={profile?.detection.found ? `Bob Shell ${profile.detection.version ?? ''}` : 'Non installé'} ok={!!profile?.detection.found} />
            <StatusRow title="Tâches Bob Work · bob run" value={authenticationLabel(profile?.authenticationMethod ?? 'required')} ok={!!profile?.detection.authenticated} />
            <StatusRow title="Emplacement" value={profile?.detection.path ?? '—'} />
            <div className="settings-actions">
              {!profile?.detection.found && <button className="btn-primary" onClick={install}>Installer la version officielle</button>}
              <button className="secondary-btn" onClick={refreshProfile}>Revérifier</button>
            </div>
          </Card>
          <Card title="Clé IBM Bob">
            <p className="settings-note">Bob Work conserve la clé dans un coffre local chiffré sur ce Mac. Aucun Trousseau macOS, aucune écriture en clair dans SQLite, et injection uniquement dans le processus <code>bob run</code> concerné.</p>
            {sessionKeyStatus.active && <>
              <StatusRow title="État" value={sessionKeyStatus.source === 'environment' ? 'Fournie par l’environnement de lancement' : 'Enregistrée dans le coffre local chiffré'} ok />
              {sessionKeyStatus.source === 'session' && <div className="settings-actions">
                <button className="danger-link" onClick={async () => { await bobAuthService.clearSessionApiKey(); setStatus('Clé effacée du coffre local.'); await refreshProfile() }}>Effacer du coffre</button>
              </div>}
            </>}
            <div className="vault-secret-fields">
              <strong>{sessionKeyStatus.source === 'session' ? 'Remplacer la clé enregistrée' : 'Enregistrer une clé IBM Bob'}</strong>
              <input type="password" aria-label="Clé d’inférence IBM Bob" value={apiKey} onChange={event => setApiKey(event.target.value)} placeholder="Clé d’inférence IBM Bob" />
              <button className="btn-primary" disabled={!apiKey.trim()} onClick={saveKey}>Enregistrer dans le coffre</button>
            </div>
            <button className="link-btn" onClick={() => openUrl('https://bob.ibm.com/')}>Ouvrir bob.ibm.com ↗</button>
          </Card>
          <div className="settings-warning">La clé et les jetons d’intégration restent disponibles après redémarrage de Bob Work tant qu’ils n’ont pas été effacés du coffre. Les planifications peuvent donc réutiliser ces secrets, y compris lorsque l’écran est verrouillé.</div>
          <Card title="Consommation">
            {usage?.available ? <StatusRow title="Crédits restants" value={`${usage.remainingAmount ?? '—'} ${usage.unit ?? ''}`} /> : <p className="settings-note">{usage?.message ?? 'Indisponible'}</p>}
          </Card>
        </>}

        {tab === 'instructions' && <>
          <Heading title="Instructions personnalisées" description="Ajoutées localement au début de chaque demande, avant les instructions propres au projet." />
          <Card><textarea className="settings-textarea" rows={12} value={settings.globalInstructions} onChange={event => change('globalInstructions', event.target.value)} placeholder="Ex. Répondre en français, citer les sources et demander confirmation avant un envoi externe…" /></Card>
        </>}

        {tab === 'permissions' && <>
          <Heading title="Permissions" description="Contrôlez les actions de Bob sur les fichiers, le terminal, le réseau et les applications." />
          <Card>
            <SelectRow title="Politique par défaut" description="Les actions sensibles restent soumises aux demandes d’approbation de Bob Shell." value={settings.permissionPolicy} onChange={value => change('permissionPolicy', value)}>
              <option value="always_ask">Toujours demander</option><option value="ask_for_modifications">Demander avant modification</option><option value="ask_for_important">Demander pour les actions importantes</option><option value="never_ask">Ne jamais demander</option>
            </SelectRow>
          </Card>
          <Card title={`Autorisations mémorisées (${grants.length})`}>
            {grants.length === 0 ? <p className="settings-note">Aucune autorisation persistante.</p> : grants.map(grant => <div className="grant-row" key={grant.id}><div><strong>{grant.actionType}</strong><small>{grant.scope} · {grant.resource}</small></div><button className="danger-link" onClick={async () => { await revokePermissionGrant(grant.id); setGrants(await getPermissionGrants()) }}>Révoquer</button></div>)}
          </Card>
        </>}

        {tab === 'tasks' && <>
          <Heading title="Tâches et planifié" description="Limites d’exécution, notifications et conservation de l’historique." />
          <Card>
            <NumberRow title="Nombre maximal de tours" value={settings.maxTurns} min={1} onChange={value => change('maxTurns', value)} />
            <NumberRow title="Coût maximal par tâche (0 = limite Bob)" value={settings.maxCost} min={0} step={0.1} onChange={value => change('maxCost', value)} />
            <NumberRow title="Conserver l’historique (jours)" value={settings.taskRetentionDays} min={1} onChange={value => change('taskRetentionDays', value)} />
            <ToggleRow title="Notifier quand une tâche se termine" value={settings.notifyTaskComplete} onChange={value => change('notifyTaskComplete', value)} />
          </Card>
          <div className="settings-warning">Les tâches continuent écran verrouillé si le Mac reste éveillé et Bob Work actif. Elles ne peuvent pas s’exécuter pendant l’extinction ou le sommeil profond ; « Exécuter au réveil » rattrape alors l’occurrence.</div>
        </>}

        {tab === 'extensions' && <>
          <Heading title="Extensions et accès" description="Activez les capacités que Bob Shell peut utiliser, puis configurez leur portée." />
          <Card>
            <ToggleRow title="Serveurs MCP" value={settings.mcpEnabled} onChange={value => change('mcpEnabled', value)} />
            <ToggleRow title="Sous-agents / orchestrateur" value={settings.subagentsEnabled} onChange={value => change('subagentsEnabled', value)} />
            <ToggleRow title="Accès web" description="Soumis aux permissions et aux capacités réellement disponibles dans Bob Shell." value={settings.webEnabled} onChange={value => change('webEnabled', value)} />
            <ToggleRow title="Contrôle de l’ordinateur" description="Nécessite une extension/MCP compatible et l’autorisation Accessibilité macOS." value={settings.computerUseEnabled} onChange={value => change('computerUseEnabled', value)} />
            <ToggleRow title="Contrôle de Chrome" description="Nécessite une extension/MCP compatible et une session Chrome locale." value={settings.chromeControlEnabled} onChange={value => change('chromeControlEnabled', value)} />
          </Card>
          <div className="settings-actions"><button className="btn-primary" onClick={() => navigate('/extensions')}>Gérer les skills</button><button className="secondary-btn" onClick={() => navigate('/integrations')}>Gérer les intégrations et MCP</button><button className="secondary-btn" onClick={() => navigate('/plugins')}>Gérer les plugins</button></div>
        </>}

        {tab === 'appearance' && <>
          <Heading title="Apparence et langue" description="La langue du système est utilisée par défaut et peut être remplacée." />
          <Card>
            <SelectRow title="Thème" value={settings.theme} onChange={value => change('theme', value as AppSettings['theme'])}><option value="system">Système</option><option value="light">Clair</option><option value="dark">Sombre</option></SelectRow>
            <SelectRow title="Langue" value={settings.language} onChange={value => change('language', value)}><option value="auto">Détecter automatiquement</option><option value="fr">Français</option><option value="en">English</option></SelectRow>
            <NumberRow title="Taille du texte" value={settings.fontSize} min={12} onChange={value => change('fontSize', value)} />
            <ToggleRow title="Réduire les animations" value={settings.reducedMotion} onChange={value => change('reducedMotion', value)} />
            <ToggleRow title="Dictée sur l’appareil" description="Utilise les capacités Apple/WebKit disponibles, sans service vocal Bob." value={settings.voiceOnDevice} onChange={value => change('voiceOnDevice', value)} />
          </Card>
        </>}

        {tab === 'data' && <>
          <Heading title="Données locales" description="Bob Work stocke projets, conversations, tâches et réglages uniquement sur ce Mac." />
          <Card>
            <ToggleRow title="Télémétrie" description="Désactivée par défaut. Aucun contenu n’est envoyé par Bob Work." value={settings.telemetryEnabled} onChange={value => change('telemetryEnabled', value)} />
            <div className="settings-actions">
              <button className="secondary-btn" onClick={async () => {
                const path = await chooseFile({ multiple: false, directory: false, filters: [{ name: 'Export conversations JSON', extensions: ['json'] }] })
                if (typeof path === 'string') { const result = await importConversations(path); setStatus(`${result.conversations} conversation(s) et ${result.messages} message(s) importés depuis ${result.detectedFormat}.`) }
              }}>Importer ChatGPT / Claude / Cowork</button>
              <button className="secondary-btn" onClick={async () => {
                const path = await chooseSavePath({ defaultPath: 'bob-work-conversations.json', filters: [{ name: 'JSON', extensions: ['json'] }] })
                if (path) { const result = await exportConversations(path); setStatus(`${result.conversations} conversation(s) exportées.`) }
              }}>Exporter les conversations</button>
              <button className="secondary-btn" onClick={() => invoke('open_data_dir')}>Ouvrir le dossier de données</button>
              <button className="secondary-btn" onClick={async () => setStatus(`Diagnostic exporté : ${await invoke<string>('export_diagnostics')}`)}>Exporter le diagnostic</button>
            </div>
          </Card>
        </>}

        {status && <div className="settings-status">{status}</div>}
        <div className="settings-save"><button className="btn-primary" disabled={saving} onClick={save}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button></div>
        </div>
        {visibleTabs.length === 0 && <div className="settings-no-results"><span>⌕</span><h1>Aucun réglage trouvé</h1><p>Essayez un autre mot, par exemple « langue », « session » ou « notification ».</p></div>}
      </main>
    </div>
  )
}

function Heading({ title, description }: { title: string; description: string }) { return <header className="settings-heading"><h1>{title}</h1><p>{description}</p></header> }
function Card({ title, children }: { title?: string; children: React.ReactNode }) { return <section className="settings-card">{title && <h2>{title}</h2>}{children}</section> }
function RowText({ title, description }: { title: string; description?: string }) { return <div><strong>{title}</strong>{description && <small>{description}</small>}</div> }
function ToggleRow({ title, description, value, onChange }: { title: string; description?: string; value: boolean; onChange: (value: boolean) => void }) { return <label className="settings-row"><RowText title={title} description={description} /><input type="checkbox" checked={value} onChange={event => onChange(event.target.checked)} /></label> }
function SelectRow({ title, description, value, onChange, children }: { title: string; description?: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) { return <label className="settings-row"><RowText title={title} description={description} /><select value={value} onChange={event => onChange(event.target.value)}>{children}</select></label> }
function NumberRow({ title, value, min, step, onChange }: { title: string; value: number; min: number; step?: number; onChange: (value: number) => void }) { return <label className="settings-row"><RowText title={title} /><input className="settings-number" type="number" value={value} min={min} step={step} onChange={event => onChange(Number(event.target.value))} /></label> }
function StatusRow({ title, value, ok }: { title: string; value: string; ok?: boolean }) { return <div className="settings-row"><RowText title={title} /><span className={ok === undefined ? '' : ok ? 'status-ok' : 'status-bad'}>{value}</span></div> }
function authenticationLabel(method: string) { return ({ api_key_session: 'Clé active pour cette session', api_key_environment: 'Clé fournie par l’environnement', required: 'Clé API requise' }[method] ?? method) }
function applyTheme(theme: string) { const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches); document.documentElement.classList.toggle('dark', dark) }
function normalizeSettingsSearch(value: string) { return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().trim() }
