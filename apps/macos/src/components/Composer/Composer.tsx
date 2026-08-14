import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  allowComposerAttachments,
  getBobModes,
  getSettings,
  getVoiceDictationAvailability,
  getIntegrationStatuses,
  getMcpServers,
  getPlugins,
  getProjects,
  getSkills,
  type IntegrationConnectionStatus,
} from '../../lib/ipc'
import type { BobMode, McpServer, Plugin, Project, WorkspaceSkill } from '@bob-work/shared-types'
import { isBuiltinPlugin, isBuiltinSkill, sortPluginsForDisplay, sortSkillsForDisplay } from '../../lib/builtinCatalog'
import { PluginIcon, resolveIconFromText, resolveIntegrationIcon, resolvePluginIcon } from '../PluginIcon'
import AttachmentPreview from './AttachmentPreview'
import { mergeAttachmentPaths, getSuggestedBuiltinPluginId, getActiveComposerMentions, removeComposerMention } from './composerAttachments'
import { errorMessage } from '../../lib/errorMessage'
import { useT, useI18n, localeToBcp47 } from '../../i18n'
import { useAppDialog } from '../AppDialog'

/** OAuth integrations that expose a Bob skill + MCP connector when connected. */
const INTEGRATION_PICKER = [
  { id: 'github', name: 'GitHub', description: 'Dépôts, issues et pull requests', skillSlug: 'bob-work-github', mcpName: 'bob-work-github' },
  { id: 'slack', name: 'Slack', description: 'Messages et canaux Slack', skillSlug: 'bob-work-slack', mcpName: 'bob-work-slack' },
  { id: 'monday', name: 'Monday.com', description: 'Tableaux Monday.com', skillSlug: 'bob-work-monday', mcpName: 'bob-work-monday' },
  { id: 'outlook-mail', name: 'Outlook', description: 'Messagerie Microsoft 365', skillSlug: 'bob-work-outlook-mail', mcpName: 'bob-work-microsoft' },
  { id: 'teams', name: 'Microsoft Teams', description: 'Équipes et canaux Teams', skillSlug: 'bob-work-teams', mcpName: 'bob-work-microsoft' },
  { id: 'outlook-calendar', name: 'Calendrier Outlook', description: 'Calendrier Microsoft 365', skillSlug: 'bob-work-outlook-calendar', mcpName: 'bob-work-microsoft' },
  { id: 'onedrive', name: 'OneDrive', description: 'Fichiers OneDrive', skillSlug: 'bob-work-onedrive', mcpName: 'bob-work-microsoft' },
  { id: 'onenote', name: 'OneNote', description: 'Carnets OneNote', skillSlug: 'bob-work-microsoft-onenote', mcpName: 'bob-work-microsoft' },
] as const

type McpPickerItem = {
  id: string
  name: string
  description: string
  icon: string
  insert: string
  kind: 'integration' | 'mcp'
}

interface Props {
  placeholder?: string
  showProjectPill?: boolean
  showModePill?: boolean
  onSend?: (text: string, mode: string, attachmentPaths: string[], projectId?: string) => void
  onStop?: () => void
  disabled?: boolean
  busy?: boolean
  queueCount?: number
  initialProjectId?: string
}

interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  abort?: () => void
  onresult: ((event: { results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }> }) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
}

const BUILTIN_MODES: BobMode[] = [
  { slug: 'agent', name: 'Agent', description: 'Exécuter une tâche', groups: [], builtin: true, source: 'fallback' },
  { slug: 'plan', name: 'Plan', description: 'Préparer un plan', groups: [], builtin: true, source: 'fallback' },
  { slug: 'ask', name: 'Ask', description: 'Répondre sans modifier', groups: [], builtin: true, source: 'fallback' },
]

async function registerAttachmentPaths(
  incoming: string[],
  setAttachments: React.Dispatch<React.SetStateAction<string[]>>,
) {
  if (incoming.length === 0) return
  try {
    const allowed = await allowComposerAttachments(incoming)
    if (allowed.length === 0) return
    setAttachments(prev => mergeAttachmentPaths(prev, allowed))
  } catch {
    // Ignore rejected paths (sensitive locations, missing files, etc.)
  }
}

export default function Composer({
  placeholder, showProjectPill, showModePill,
  onSend, onStop, disabled, busy = false, queueCount = 0, initialProjectId,
}: Props) {
  const t = useT()
  const dialog = useAppDialog()
  const { locale } = useI18n()
  const resolvedPlaceholder = placeholder ?? t('composer.placeholder')
  const [text, setText] = useState('')
  const [mode, setMode] = useState('agent')
  const [modes, setModes] = useState<BobMode[]>(BUILTIN_MODES)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId)
  const [skills, setSkills] = useState<WorkspaceSkill[]>([])
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationConnectionStatus[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [attachments, setAttachments] = useState<string[]>([])
  const [attachMenu, setAttachMenu] = useState(false)
  const [pluginSearch, setPluginSearch] = useState('')
  const [skillSearch, setSkillSearch] = useState('')
  const [mcpSearch, setMcpSearch] = useState('')
  const [modeMenu, setModeMenu] = useState(false)
  const [modeSearch, setModeSearch] = useState('')
  const [projectMenu, setProjectMenu] = useState(false)
  const [listening, setListening] = useState(false)
  const [dictationStarting, setDictationStarting] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const attachButtonRef = useRef<HTMLButtonElement>(null)
  const projectButtonRef = useRef<HTMLButtonElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const dictationStartingRef = useRef(false)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const [isDragging, setIsDragging] = useState(false)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    if (initialProjectId !== undefined) setProjectId(initialProjectId)
  }, [initialProjectId])

  useEffect(() => () => {
    const recognition = recognitionRef.current
    recognitionRef.current = null
    if (!recognition) return
    recognition.onresult = null
    recognition.onend = null
    recognition.onerror = null
    try {
      recognition.abort?.()
    } catch {
      // WebKit may already have disposed the native recognition session.
    }
  }, [])

  const insertPluginMention = useCallback((pluginId: string) => {
    const mentionValue = `@plugin:${pluginId}`
    setText(current => {
      if (current.includes(mentionValue)) return current
      const separator = current.length > 0 && !current.endsWith(' ') ? ' ' : ''
      return `${current}${separator}${mentionValue} `
    })
    window.requestAnimationFrame(() => taRef.current?.focus())
  }, [])

  const insertSkillMention = useCallback((skillSlug: string) => {
    const mentionValue = `@skill:${skillSlug}`
    setText(current => {
      if (current.includes(mentionValue)) return current
      const separator = current.length > 0 && !current.endsWith(' ') ? ' ' : ''
      return `${current}${separator}${mentionValue} `
    })
    window.requestAnimationFrame(() => taRef.current?.focus())
  }, [])

  const insertMcpMention = useCallback((insert: string) => {
    const mentionValue = insert.trim()
    setText(current => {
      if (current.includes(mentionValue)) return current
      const separator = current.length > 0 && !current.endsWith(' ') ? ' ' : ''
      return `${current}${separator}${mentionValue} `
    })
    window.requestAnimationFrame(() => taRef.current?.focus())
  }, [])

  const refreshMcpIntegrations = useCallback(() => {
    void Promise.all([
      getIntegrationStatuses().then(items => ({ ok: true as const, items })).catch(error => ({ ok: false as const, error })),
      getMcpServers().then(items => ({ ok: true as const, items })).catch(error => ({ ok: false as const, error })),
    ]).then(([statusesResult, serversResult]) => {
      const errors: string[] = []
      if (statusesResult.ok) setIntegrationStatuses(statusesResult.items)
      else {
        setIntegrationStatuses([])
        errors.push(errorMessage(statusesResult.error, t('composer.catalogError')))
      }
      if (serversResult.ok) setMcpServers(serversResult.items.filter(server => server.enabled))
      else {
        setMcpServers([])
        errors.push(errorMessage(serversResult.error, t('composer.catalogError')))
      }
      if (errors.length) setCatalogError(errors[0])
    })
  }, [])

  const suggestPluginForPaths = useCallback((paths: string[]) => {
    const pluginIds = Array.from(new Set(
      paths.map(getSuggestedBuiltinPluginId).filter((id): id is string => Boolean(id)),
    ))
    if (pluginIds.length !== 1) return
    const pluginId = pluginIds[0]
    if (!plugins.some(item => item.id === pluginId)) return
    insertPluginMention(pluginId)
  }, [insertPluginMention, plugins])

  const addAttachmentPaths = useCallback((paths: string[]) => {
    void registerAttachmentPaths(paths, setAttachments)
    suggestPluginForPaths(paths)
  }, [suggestPluginForPaths])

  useEffect(() => {
    let cancelled = false
    let unlisten: (() => void) | undefined

    getCurrentWindow()
      .onDragDropEvent(event => {
        if (cancelled) return
        const payload = event.payload
        if (payload.type === 'enter' || payload.type === 'over') {
          setIsDragging(true)
        } else if (payload.type === 'drop') {
          setIsDragging(false)
          dragDepthRef.current = 0
          addAttachmentPaths(payload.paths)
        } else {
          setIsDragging(false)
          dragDepthRef.current = 0
        }
      })
      .then(fn => {
        if (cancelled) {
          fn()
          return
        }
        unlisten = fn
      })
      .catch(() => {})

    return () => {
      cancelled = true
      unlisten?.()
    }
  }, [addAttachmentPaths])

  useEffect(() => {
    setCatalogError(null)
    const loadCatalog = () => {
      Promise.all([
        getBobModes().catch(() => BUILTIN_MODES),
        getProjects().catch(() => [] as Project[]),
        getSettings().catch(() => null),
        getSkills().then(items => ({ ok: true as const, items })).catch(error => ({ ok: false as const, error })),
        getPlugins().then(items => ({ ok: true as const, items })).catch(error => ({ ok: false as const, error })),
      ]).then(([detectedModes, detectedProjects, settings, skillsResult, pluginsResult]) => {
        if (detectedModes.length) setModes(detectedModes)
        setProjects(detectedProjects.filter(project => !project.archived))
        if (settings?.defaultMode) setMode(current => current === 'agent' ? settings.defaultMode : current)
        const errors: string[] = []
        if (skillsResult.ok) {
          setSkills(skillsResult.items.filter(skill => skill.enabled))
        } else {
          setSkills([])
          errors.push(errorMessage(skillsResult.error, t('composer.catalogError')))
        }
        if (pluginsResult.ok) {
          setPlugins(pluginsResult.items.filter(plugin => plugin.installState === 'installed'))
        } else {
          setPlugins([])
          errors.push(errorMessage(pluginsResult.error, t('composer.catalogError')))
        }
        setCatalogError(errors[0] ?? null)
      })
    }
    loadCatalog()
    refreshMcpIntegrations()
    const onModes = () => { void getBobModes().then(items => { if (items.length) setModes(items) }).catch(() => {}) }
    window.addEventListener('bob-modes-updated', onModes)
    return () => window.removeEventListener('bob-modes-updated', onModes)
  }, [refreshMcpIntegrations])

  useEffect(() => {
    const ta = taRef.current
    if (!ta) return
    ta.style.height = 'auto'
    ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'
  }, [text])

  const closeMenus = useCallback(() => {
    setAttachMenu(false)
    setPluginSearch('')
    setSkillSearch('')
    setMcpSearch('')
    setProjectMenu(false)
    setModeMenu(false)
    setModeSearch('')
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target
      if (!(target instanceof Element)) return
      if (rootRef.current?.contains(target) || target.closest('[data-composer-popover="true"]')) return
      closeMenus()
    }
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeMenus()
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [closeMenus])

  const toggleMenu = (target: 'attach' | 'project' | 'mode') => {
    const shouldOpen = target === 'attach' ? !attachMenu : target === 'project' ? !projectMenu : !modeMenu
    setAttachMenu(target === 'attach' && shouldOpen)
    setProjectMenu(target === 'project' && shouldOpen)
    setModeMenu(target === 'mode' && shouldOpen)
    if (target !== 'mode' || !shouldOpen) setModeSearch('')
    if (target === 'attach' && shouldOpen) refreshMcpIntegrations()
  }

  const handleSend = () => {
    if (!text.trim() || disabled) return
    if (onSend) {
      onSend(text.trim(), mode, attachments, projectId)
    } else {
      navigate('/chat', { state: { initialPrompt: text.trim(), mode, attachmentPaths: attachments, projectId } })
    }
    setText('')
    setAttachments([])
    closeMenus()
  }

  const chooseFiles = async () => {
    setAttachMenu(false)
    const selected = await open({ multiple: true, directory: false, title: t('composer.attachFiles') })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    addAttachmentPaths(paths)
  }

  const chooseFolder = async () => {
    setAttachMenu(false)
    const selected = await open({ multiple: false, directory: true, title: t('composer.attachFolder') })
    if (typeof selected === 'string') addAttachmentPaths([selected])
  }

  const toggleDictation = async () => {
    const activeRecognition = recognitionRef.current
    if (activeRecognition) {
      try {
        activeRecognition.stop()
      } catch {
        recognitionRef.current = null
        setListening(false)
      }
      return
    }
    if (dictationStartingRef.current) return
    dictationStartingRef.current = true
    setDictationStarting(true)
    let availability
    try {
      availability = await getVoiceDictationAvailability()
    } catch (error) {
      await dialog.alert({ message: t('composer.dictationCheckFailed', { error: errorMessage(error) }) })
      dictationStartingRef.current = false
      setDictationStarting(false)
      return
    }
    if (!availability.available) {
      const message = availability.reason === 'requires_app_bundle'
        ? t('composer.dictationRequiresApp')
        : t('composer.dictationUnavailable')
      await dialog.alert({ message })
      dictationStartingRef.current = false
      setDictationStarting(false)
      return
    }
    const SpeechRecognition = (window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
    if (!SpeechRecognition) {
      await dialog.alert({ message: t('composer.dictationWebkitUnavailable') })
      dictationStartingRef.current = false
      setDictationStarting(false)
      return
    }
    try {
      const recognition = new SpeechRecognition()
      recognition.lang = localeToBcp47(locale)
      recognition.interimResults = true
      recognition.continuous = false
      const baseText = text
      recognition.onresult = event => {
        let transcript = ''
        for (let index = 0; index < event.results.length; index += 1) {
          transcript += event.results[index][0].transcript
        }
        const separator = baseText && !baseText.endsWith(' ') && transcript ? ' ' : ''
        setText(`${baseText}${separator}${transcript}`)
      }
      const finish = () => {
        if (recognitionRef.current === recognition) recognitionRef.current = null
        setListening(false)
      }
      recognition.onend = finish
      recognition.onerror = finish
      recognitionRef.current = recognition
      setListening(true)
      recognition.start()
    } catch (error) {
      recognitionRef.current = null
      setListening(false)
      await dialog.alert({ message: t('composer.dictationStartFailed', { error: errorMessage(error) }) })
    } finally {
      dictationStartingRef.current = false
      setDictationStarting(false)
    }
  }

  const selectedProject = projects.find(project => project.id === projectId)
  const capabilityFilter = selectedProject?.allowedPlugins ?? []
  const integrationFilter = selectedProject?.allowedIntegrations ?? []
  const allowedSkills = capabilityFilter.length === 0 ? skills : skills.filter(skill => capabilityFilter.includes(`skill:${skill.slug}`))
  const allowedPlugins = useMemo(() => {
    const filter = selectedProject?.allowedPlugins
    const filtered = !filter || filter.length === 0
      ? plugins
      : plugins.filter(plugin => filter.includes(plugin.id))
    return sortPluginsForDisplay(filtered)
  }, [plugins, selectedProject?.allowedPlugins])
  const mcpPickerItems = useMemo(() => {
    const connectedIds = new Set(
      integrationStatuses.filter(status => status.connected).map(status => status.integrationId),
    )
    const items: McpPickerItem[] = []
    for (const integration of INTEGRATION_PICKER) {
      if (!connectedIds.has(integration.id)) continue
      if (integrationFilter.length > 0 && !integrationFilter.includes(integration.id)) continue
      items.push({
        id: `integration:${integration.id}`,
        name: integration.name,
        description: integration.description,
        icon: resolveIntegrationIcon(integration.id),
        insert: `@skill:${integration.skillSlug}`,
        kind: 'integration',
      })
    }
    const coveredMcp = new Set<string>(
      INTEGRATION_PICKER
        .filter(integration => connectedIds.has(integration.id))
        .map(integration => integration.mcpName),
    )
    for (const server of mcpServers) {
      if (coveredMcp.has(server.name)) continue
      if (integrationFilter.length > 0 && !integrationFilter.includes(`mcp:${server.name}`)) continue
      items.push({
        id: `mcp:${server.name}`,
        name: server.name,
        description: `${server.transport} · ${server.commandOrUrl || 'serveur MCP'}`,
        icon: 'plugin',
        insert: `@mcp:${server.name}`,
        kind: 'mcp',
      })
    }
    return items
  }, [integrationFilter, integrationStatuses, mcpServers])
  const mention = text.match(/(?:^|\s)@([\w-]*)$/)?.[1]?.toLowerCase()
  const mentionItems = mention === undefined ? [] : [
    ...allowedPlugins.map(plugin => ({ id: `plugin:${plugin.id}`, label: plugin.name, subtitle: 'Plugin', insert: `@plugin:${plugin.id} ` })),
    ...allowedSkills.map(skill => ({ id: `skill:${skill.slug}`, label: skill.name, subtitle: 'Skill', insert: `@skill:${skill.slug} ` })),
    ...mcpPickerItems.map(item => ({ id: item.id, label: item.name, subtitle: item.kind === 'integration' ? 'Intégration MCP' : 'MCP', insert: `${item.insert} ` })),
  ].filter(item => item.label.toLowerCase().includes(mention) || item.id.toLowerCase().includes(mention)).slice(0, 8)

  const insertMention = (value: string) => {
    setText(current => current.replace(/@([\w-]*)$/, value))
    taRef.current?.focus()
  }

  const selectPlugin = (plugin: Plugin) => {
    insertPluginMention(plugin.id)
    setAttachMenu(false)
    setPluginSearch('')
    setSkillSearch('')
    setMcpSearch('')
  }

  const selectSkill = (skill: WorkspaceSkill) => {
    insertSkillMention(skill.slug)
    setAttachMenu(false)
    setPluginSearch('')
    setSkillSearch('')
    setMcpSearch('')
  }

  const selectMcpItem = (item: McpPickerItem) => {
    insertMcpMention(item.insert)
    setAttachMenu(false)
    setPluginSearch('')
    setSkillSearch('')
    setMcpSearch('')
  }

  const visibleSkills = useMemo(() => {
    const query = skillSearch.trim().toLocaleLowerCase()
    const filtered = query
      ? allowedSkills.filter(skill =>
          `${skill.name} ${skill.description ?? ''} ${skill.slug}`.toLocaleLowerCase().includes(query),
        )
      : allowedSkills
    return sortSkillsForDisplay(filtered)
  }, [allowedSkills, skillSearch])

  const visiblePlugins = useMemo(() => {
    const query = pluginSearch.trim().toLocaleLowerCase()
    if (!query) return allowedPlugins
    return allowedPlugins.filter(plugin => `${plugin.name} ${plugin.description ?? ''}`.toLocaleLowerCase().includes(query))
  }, [allowedPlugins, pluginSearch])

  const visibleMcpItems = useMemo(() => {
    const query = mcpSearch.trim().toLocaleLowerCase()
    if (!query) return mcpPickerItems
    return mcpPickerItems.filter(item =>
      `${item.name} ${item.description} ${item.insert}`.toLocaleLowerCase().includes(query),
    )
  }, [mcpPickerItems, mcpSearch])

  const filteredModes = useMemo(() => {
    const query = modeSearch.trim().toLowerCase()
    if (!query) return modes
    return modes.filter(item => item.name.toLowerCase().includes(query) || item.slug.includes(query) || item.description?.toLowerCase().includes(query))
  }, [modeSearch, modes])
  const selectedMode = modes.find(item => item.slug === mode) ?? BUILTIN_MODES[0]
  const mentionChips = useMemo(() => {
    type Chip = {
      key: string
      kind: 'plugin' | 'skill' | 'mcp'
      id: string
      name: string
      subtitle: string
      icon: string
    }
    const chips: Chip[] = []
    for (const mention of getActiveComposerMentions(text)) {
      if (mention.kind === 'plugin') {
        const plugin = plugins.find(item => item.id === mention.id)
        if (!plugin) continue
        chips.push({
          key: `plugin:${plugin.id}`,
          kind: 'plugin',
          id: plugin.id,
          name: plugin.name,
          subtitle: plugin.manifest && typeof plugin.manifest === 'object' && 'specializedMode' in (plugin.manifest as object)
            ? 'Mode de travail'
            : 'Plugin',
          icon: resolvePluginIcon(plugin),
        })
        continue
      }
      if (mention.kind === 'skill') {
        const skill = skills.find(item => item.slug === mention.id)
        if (!skill) {
          const integration = mcpPickerItems.find(item => item.insert === `@skill:${mention.id}`)
          if (!integration) continue
          chips.push({
            key: `skill:${mention.id}`,
            kind: 'skill',
            id: mention.id,
            name: integration.name,
            subtitle: 'Intégration',
            icon: integration.icon,
          })
          continue
        }
        chips.push({
          key: `skill:${skill.slug}`,
          kind: 'skill',
          id: skill.slug,
          name: skill.name,
          subtitle: 'Instructions',
          icon: resolveIconFromText(skill.slug, skill.name, skill.description),
        })
        continue
      }
      const mcp = mcpPickerItems.find(item => item.insert === `@mcp:${mention.id}` || item.id === `mcp:${mention.id}`)
      chips.push({
        key: `mcp:${mention.id}`,
        kind: 'mcp',
        id: mention.id,
        name: mcp?.name ?? mention.id,
        subtitle: 'MCP',
        icon: mcp?.icon ?? 'plugin',
      })
    }
    return chips
  }, [mcpPickerItems, plugins, skills, text])

  const removeMentionChip = (kind: 'plugin' | 'skill' | 'mcp', id: string) => {
    setText(current => removeComposerMention(current, kind, id))
    taRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="composer-root">
      {mentionItems.length > 0 && (
        <div className="composer-popover" style={{ left: 16, right: 16, bottom: 'calc(100% + 8px)' }}>
          <div className="composer-popover-title">Ajouter au prompt</div>
          {mentionItems.map(item => (
            <button key={item.id} className="composer-popover-row" onMouseDown={event => event.preventDefault()} onClick={() => insertMention(item.insert)}>
              <span>{item.label}</span><small>{item.subtitle}</small>
            </button>
          ))}
        </div>
      )}

      <div
        className={`composer ${isDragging ? 'composer-dragging' : ''}`}
        onDragEnter={event => {
          event.preventDefault()
          dragDepthRef.current += 1
          setIsDragging(true)
        }}
        onDragOver={event => {
          event.preventDefault()
          event.dataTransfer.dropEffect = 'copy'
          setIsDragging(true)
        }}
        onDragLeave={event => {
          event.preventDefault()
          dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
          if (dragDepthRef.current === 0) setIsDragging(false)
        }}
        onDrop={event => {
          event.preventDefault()
          dragDepthRef.current = 0
          setIsDragging(false)
          const files = Array.from(event.dataTransfer.files)
          const paths = files
            .map(file => (file as File & { path?: string }).path)
            .filter((path): path is string => Boolean(path))
          if (paths.length > 0) {
            addAttachmentPaths(paths)
          }
        }}
      >
        {isDragging && (
          <div className="composer-drop-hint" aria-hidden="true">
            <span>Déposer pour joindre au prompt</span>
          </div>
        )}
        {mentionChips.length > 0 && (
          <div className="composer-mention-chips" aria-label="Composants du prompt">
            {mentionChips.map(chip => (
              <div key={chip.key} className="composer-mention-chip" aria-label={`${chip.subtitle} ${chip.name}`}>
                <PluginIcon icon={chip.icon} size="sm" className="composer-mention-chip-icon" />
                <span className="composer-mention-chip-copy">
                  <strong>{chip.name}</strong>
                  <small>{chip.subtitle}</small>
                </span>
                <button
                  type="button"
                  className="composer-mention-chip-remove"
                  aria-label={`Retirer ${chip.name}`}
                  onClick={() => removeMentionChip(chip.kind, chip.id)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        {attachments.length > 0 && (
          <div className="composer-attachments">
            {attachments.map(path => (
              <AttachmentPreview key={path} path={path} onRemove={() => setAttachments(items => items.filter(item => item !== path))} />
            ))}
          </div>
        )}

        <textarea
          ref={taRef}
          className="composer-textarea"
          placeholder={resolvedPlaceholder}
          value={text}
          rows={1}
          disabled={disabled}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
        />

        <div className="composer-toolbar">
          <div>
            <button ref={attachButtonRef} className="icon-btn" title="Joindre un fichier ou un dossier" aria-haspopup="menu" aria-expanded={attachMenu} onClick={() => toggleMenu('attach')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            {attachMenu && (
              <ComposerPopover anchorRef={attachButtonRef} ariaLabel="Ajouter une pièce jointe" className="attach-popover">
                <div className="attach-popover-header">
                  <div className="composer-popover-title">Ajouter</div>
                  <button type="button" className="composer-popover-row attach-plugin-row" onClick={chooseFiles}>
                    <span className="attach-row-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </span>
                    <span className="attach-plugin-copy"><strong>Fichier(s)</strong></span>
                  </button>
                  <button type="button" className="composer-popover-row attach-plugin-row" onClick={chooseFolder}>
                    <span className="attach-row-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    </span>
                    <span className="attach-plugin-copy"><strong>Dossier</strong></span>
                  </button>
                </div>
                <div className="attach-popover-scroll">
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">Plugins & modes de travail</div>
                  {catalogError && allowedPlugins.length === 0 ? (
                    <p className="composer-popover-empty">{catalogError}</p>
                  ) : allowedPlugins.length > 0 ? <>
                    <input
                      value={pluginSearch}
                      onChange={event => setPluginSearch(event.target.value)}
                      placeholder={t('composer.searchPlugin')}
                      aria-label={t('composer.searchPlugin')}
                      className="popover-search"
                    />
                    <div className="attach-plugin-list">
                      {visiblePlugins.length > 0 ? visiblePlugins.map(plugin => {
                        const isWorkMode = plugin.manifest && typeof plugin.manifest === 'object' && 'specializedMode' in (plugin.manifest as object)
                        return (
                          <button type="button" className="composer-popover-row attach-plugin-row" key={plugin.id} onClick={() => selectPlugin(plugin)}>
                            <span className="attach-row-icon">
                              <PluginIcon icon={resolvePluginIcon(plugin)} size="sm" className="attach-plugin-icon" />
                            </span>
                            <span className="attach-plugin-copy">
                              <span className="attach-plugin-title">
                                <strong>{plugin.name}</strong>
                                {isBuiltinPlugin(plugin) ? <span className="skill-builtin-badge">Intégré</span> : null}
                              </span>
                              <small>{isWorkMode ? 'Mode de travail' : (plugin.description || 'Plugin activé')}</small>
                            </span>
                            <span className="attach-row-action" aria-hidden="true">+</span>
                          </button>
                        )
                      }) : <p className="composer-popover-empty">Aucun plugin correspondant.</p>}
                    </div>
                  </> : <p className="composer-popover-empty">{t('composer.noPlugins')}</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/plugins') }}>Gérer les plugins</button>
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">Skills (instructions)</div>
                  {catalogError && allowedSkills.length === 0 ? (
                    <p className="composer-popover-empty">{catalogError}</p>
                  ) : allowedSkills.length > 0 ? <>
                    <input
                      value={skillSearch}
                      onChange={event => setSkillSearch(event.target.value)}
                      placeholder={t('composer.searchSkill')}
                      aria-label={t('composer.searchSkill')}
                      className="popover-search"
                    />
                    <div className="attach-plugin-list">
                      {visibleSkills.length > 0 ? visibleSkills.map(skill => (
                        <button type="button" className="composer-popover-row attach-plugin-row" key={`${skill.scope}:${skill.slug}`} onClick={() => selectSkill(skill)}>
                          <span className="attach-row-icon">
                            <PluginIcon icon={resolveIconFromText(skill.slug, skill.name, skill.description)} size="sm" className="attach-plugin-icon" />
                          </span>
                          <span className="attach-plugin-copy">
                            <span className="attach-plugin-title">
                              <strong>{skill.name}</strong>
                              {isBuiltinSkill(skill) ? <span className="skill-builtin-badge">Intégré</span> : null}
                            </span>
                            <small>{skill.description || 'Skill activé'}</small>
                          </span>
                          <span className="attach-row-action" aria-hidden="true">+</span>
                        </button>
                      )) : <p className="composer-popover-empty">Aucun skill correspondant.</p>}
                    </div>
                  </> : <p className="composer-popover-empty">{t('composer.noSkills')}</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/skills') }}>Gérer les skills</button>
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">Intégrations MCP</div>
                  {mcpPickerItems.length > 0 ? <>
                    <input
                      value={mcpSearch}
                      onChange={event => setMcpSearch(event.target.value)}
                      placeholder={t('composer.searchMcp')}
                      aria-label={t('composer.searchMcp')}
                      className="popover-search"
                    />
                    <div className="attach-plugin-list">
                      {visibleMcpItems.length > 0 ? visibleMcpItems.map(item => (
                        <button type="button" className="composer-popover-row attach-plugin-row" key={item.id} onClick={() => selectMcpItem(item)}>
                          <span className="attach-row-icon">
                            <PluginIcon icon={item.icon} size="sm" className="attach-plugin-icon" />
                          </span>
                          <span className="attach-plugin-copy">
                            <span className="attach-plugin-title">
                              <strong>{item.name}</strong>
                            </span>
                            <small>{item.kind === 'integration' ? `Connecteur · ${item.description}` : item.description}</small>
                          </span>
                          <span className="attach-row-action" aria-hidden="true">+</span>
                        </button>
                      )) : <p className="composer-popover-empty">Aucune intégration MCP correspondante.</p>}
                    </div>
                  </> : <p className="composer-popover-empty">Aucune intégration MCP connectée{selectedProject ? ' pour ce projet' : ''}.</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/integrations') }}>Gérer les intégrations</button>
                </div>
              </ComposerPopover>
            )}
          </div>

          <button
            type="button"
            className={`icon-btn ${listening ? 'recording' : ''}`}
            title={t('composer.dictationLabel')}
            aria-label={t('composer.dictationLabel')}
            aria-pressed={listening}
            disabled={dictationStarting}
            onClick={toggleDictation}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>
          </button>

          {showProjectPill && (
            <div>
              <button ref={projectButtonRef} className="composer-pill" aria-haspopup="menu" aria-expanded={projectMenu} onClick={() => toggleMenu('project')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                {selectedProject?.name ?? 'Projet'}
              </button>
              {projectMenu && (
                <ComposerPopover anchorRef={projectButtonRef} ariaLabel="Choisir un projet" className="project-popover">
                  <button className="composer-popover-row" onClick={() => { setProjectId(undefined); setProjectMenu(false) }}>Sans projet</button>
                  {projects.map(project => <button className="composer-popover-row" key={project.id} onClick={() => { setProjectId(project.id); if (project.defaultMode) setMode(project.defaultMode); setProjectMenu(false) }}>{project.name}</button>)}
                </ComposerPopover>
              )}
            </div>
          )}

          <div style={{ flex: 1 }} />

          {showModePill && (
            <div>
              <button ref={modeButtonRef} className="composer-pill" aria-label={`Mode Bob : ${selectedMode.name}`} aria-haspopup="menu" aria-expanded={modeMenu} onClick={() => toggleMenu('mode')}>{selectedMode.name}<span aria-hidden="true">⌄</span></button>
              {modeMenu && (
                <ComposerPopover anchorRef={modeButtonRef} align="end" ariaLabel="Modes Bob" className="mode-popover">
                  <div className="composer-popover-title">Modes Bob</div>
                  <input autoFocus value={modeSearch} onChange={event => setModeSearch(event.target.value)} placeholder={t('composer.searchMode')} className="popover-search" />
                  <div className="mode-popover-list">
                    {filteredModes.map(item => (
                      <button className={`composer-popover-row mode-row ${item.slug === mode ? 'selected' : ''}`} key={item.slug} onClick={() => { setMode(item.slug); setModeMenu(false); setModeSearch('') }}>
                        <span><strong>{item.name}</strong><small>{item.description ?? item.slug}</small></span>
                        {item.slug === mode && <span>✓</span>}
                      </button>
                    ))}
                  </div>
                </ComposerPopover>
              )}
            </div>
          )}

          {busy && onStop && (
            <button className="composer-stop-btn" onClick={onStop} title="Arrêter l’exécution active" aria-label="Arrêter l’exécution active"><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>
          )}
          <button
            className={`send-btn ${busy ? 'queue-send-btn' : ''}`}
            disabled={!text.trim() || !!disabled}
            onClick={handleSend}
            title={busy ? `Ajouter à la file${queueCount ? ` (${queueCount} en attente)` : ''}` : 'Envoyer'}
            aria-label={busy ? 'Ajouter le prompt à la file' : t('composer.send')}
          >
            {busy ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 6h10M4 12h7M4 18h5"/><path d="M17 11v8M13 15h8"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

function ComposerPopover({
  anchorRef, align = 'start', ariaLabel, className = '', children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  align?: 'start' | 'end'
  ariaLabel: string
  className?: string
  children: React.ReactNode
}) {
  const popoverRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    const updatePosition = () => {
      const anchor = anchorRef.current
      const popover = popoverRef.current
      if (!anchor || !popover) return

      const gap = 8
      const viewportPadding = 12
      const anchorRect = anchor.getBoundingClientRect()
      const popoverRect = popover.getBoundingClientRect()
      let top = anchorRect.top - popoverRect.height - gap
      if (top < viewportPadding) top = Math.min(anchorRect.bottom + gap, window.innerHeight - popoverRect.height - viewportPadding)

      let left = align === 'end' ? anchorRect.right - popoverRect.width : anchorRect.left
      left = Math.max(viewportPadding, Math.min(left, window.innerWidth - popoverRect.width - viewportPadding))
      setPosition({ top: Math.max(viewportPadding, top), left })
    }

    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updatePosition)
    if (anchorRef.current) observer?.observe(anchorRef.current)
    if (popoverRef.current) observer?.observe(popoverRef.current)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
      observer?.disconnect()
    }
  }, [align, anchorRef])

  return createPortal(
    <div
      ref={popoverRef}
      role="menu"
      aria-label={ariaLabel}
      data-composer-popover="true"
      className={`composer-popover composer-floating-popover ${className}`}
      style={{ top: position?.top ?? 0, left: position?.left ?? 0, visibility: position ? 'visible' : 'hidden' }}
    >
      {children}
    </div>,
    document.body,
  )
}
