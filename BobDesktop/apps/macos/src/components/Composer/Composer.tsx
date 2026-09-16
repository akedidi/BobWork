import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useContextDraftStore } from '../../stores/contextDraftStore'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import {
  allowComposerAttachments,
  getBobModes,
  getSettings,
  getVoiceDictationAvailability,
  getNativeAudioRecordingLevel,
  getIntegrationStatuses,
  getMcpServers,
  getDbConnections,
  getPlugins,
  getProjects,
  getSkills,
  listBobSlashCommands,
  openMacosPrivacyPane,
  readClipboardAttachmentPaths,
  requestVoiceDictationPermission,
  startNativeAudioRecording,
  stopNativeAudioRecording,
  writeClipboardAttachmentImage,
  type IntegrationConnectionStatus,
} from '../../lib/ipc'
import type { BobMode, BobSlashCommand, DbConnection, McpServer, Plugin, Project, WorkspaceSkill } from '@bob-work/shared-types'
import { isBuiltinPlugin, isBuiltinSkill, sortPluginsForDisplay, sortSkillsForDisplay } from '../../lib/builtinCatalog'
import { pluginMentionId } from '../../lib/pluginUtils'
import { engineMeta } from '../../lib/dbEngines'
import { CATALOG, isIntegrationVisibleById } from '../../views/IntegrationsTabs/catalogData'
import { PluginIcon, resolveSkillIcon, resolveIntegrationIcon, resolvePluginIcon } from '../PluginIcon'
import AttachmentPreview from './AttachmentPreview'
import { mergeAttachmentPaths, getActiveComposerMentions, normalizeComposerCapabilityMentions, removeComposerMention, clipboardLooksLikeAttachments, collectPasteAttachmentPaths, type ComposerAttachment, type ComposerMentionCatalog } from './composerAttachments'
import { errorMessage } from '../../lib/errorMessage'
import {
  applyAutocompleteInsert,
  cycleAutocompleteIndex,
  detectAutocompleteQuery,
  filterSlashCommands,
  slashCommandsToItems,
  type PromptAutocompleteItem,
} from '../../lib/promptAutocomplete'
import { useT } from '../../i18n'
import { useAppDialog } from '../AppDialog'
import { isApiServer } from '../../hooks/useMcpServers'
import { isPluginManagedMcp } from '../../lib/mcpVisibility'
import ComposerPermissionsMenu from './ComposerPermissionsMenu'
import { forbiddenTaskPermissionIds, getVisibleTaskPermissions } from '../../lib/taskPermissions'
import { useTaskPermissionStore } from '../../stores/taskPermissionStore'
import { useAppStore } from '../../stores/appStore'

type SpeechRecognitionLike = {
  lang: string
  interimResults: boolean
  continuous: boolean
  resultIndex?: number
  results: ArrayLike<{ isFinal: boolean; [index: number]: { transcript: string } }>
  onresult: ((event: SpeechRecognitionLike) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
}

/** OAuth integrations that expose a Bob skill + MCP connector when connected. */
const INTEGRATION_PICKER = [
  { id: 'github', skillSlug: 'bob-work-github', mcpName: 'bob-work-github' },
  { id: 'slack', skillSlug: 'bob-work-slack', mcpName: 'bob-work-slack' },
  { id: 'monday', skillSlug: 'bob-work-monday', mcpName: 'bob-work-monday' },
  { id: 'outlook-mail', skillSlug: 'bob-work-outlook-mail', mcpName: 'bob-work-microsoft' },
  { id: 'teams', skillSlug: 'bob-work-teams', mcpName: 'bob-work-microsoft' },
  { id: 'outlook-calendar', skillSlug: 'bob-work-outlook-calendar', mcpName: 'bob-work-microsoft' },
  { id: 'onedrive', skillSlug: 'bob-work-onedrive', mcpName: 'bob-work-microsoft' },
  { id: 'onenote', skillSlug: 'bob-work-microsoft-onenote', mcpName: 'bob-work-microsoft' },
].filter(integration => isIntegrationVisibleById(integration.id)) as Array<{
  id: string
  skillSlug: string
  mcpName: string
}>

const COMPOSER_MIN_TEXTAREA_HEIGHT = 52
const COMPOSER_MAX_TEXTAREA_HEIGHT = 240
const COMPOSER_VIEWPORT_HEIGHT_RATIO = 0.32

function NoProjectIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      data-testid="no-project-icon"
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M5.6 5.6 18.4 18.4" />
    </svg>
  )
}

export function resizeComposerTextarea(textarea: HTMLTextAreaElement, viewportHeight = window.innerHeight): void {
  const maximumHeight = Math.min(
    COMPOSER_MAX_TEXTAREA_HEIGHT,
    Math.max(120, Math.floor(viewportHeight * COMPOSER_VIEWPORT_HEIGHT_RATIO)),
  )
  textarea.style.height = 'auto'
  const contentHeight = Math.max(COMPOSER_MIN_TEXTAREA_HEIGHT, textarea.scrollHeight)
  textarea.style.height = `${Math.min(contentHeight, maximumHeight)}px`
  textarea.style.overflowY = contentHeight > maximumHeight ? 'auto' : 'hidden'
}

type McpPickerItem = {
  id: string
  name: string
  description: string
  icon: string
  insert: string
  kind: 'integration' | 'api' | 'mcp'
}

export interface ComposerDraftRequest {
  key: string
  text: string
  mode?: string
  attachmentPaths?: string[]
  projectId?: string
}

interface Props {
  placeholder?: string
  showProjectPill?: boolean
  showModePill?: boolean
  showPermissionsPill?: boolean
  onSend?: (text: string, mode: string, attachmentPaths: string[], projectId?: string) => void
  onStop?: () => void
  disabled?: boolean
  busy?: boolean
  queueCount?: number
  /** When true, Enter/Send updates a queued prompt instead of enqueueing/sending. */
  queueEditActive?: boolean
  /** Bump to force a clean remount of the right toolbar (WKWebView paint bugs). */
  toolbarEpoch?: string | number
  draftRequest?: ComposerDraftRequest | null
  initialProjectId?: string
  initialMode?: string
  onProjectChange?: (projectId?: string) => void
  onModeChange?: (mode: string) => void
  focusRequestKey?: string
}

const BUILTIN_MODES: BobMode[] = [
  { slug: 'agent', name: 'Agent', description: 'Exécuter une tâche', groups: ['read', 'edit', 'execute', 'mcp', 'skill', 'todo', 'subtask', 'subagent', 'mode'], builtin: true, source: 'fallback' },
  { slug: 'plan', name: 'Plan', description: 'Préparer un plan', groups: [], builtin: true, source: 'fallback' },
  { slug: 'ask', name: 'Ask', description: 'Répondre sans modifier', groups: [], builtin: true, source: 'fallback' },
]

async function registerAttachmentPaths(
  incoming: string[],
  setAttachments: React.Dispatch<React.SetStateAction<ComposerAttachment[]>>,
) {
  if (incoming.length === 0) return
  try {
    const allowed = await allowComposerAttachments(incoming)
    if (allowed.length === 0) return
    const items: ComposerAttachment[] = allowed.map(grant => ({
      path: grant.path,
      isDirectory: grant.isDirectory,
    }))
    setAttachments(prev => mergeAttachmentPaths(prev, items))
  } catch {
    // Ignore rejected paths (sensitive locations, missing files, etc.)
  }
}

function formatRecordingDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return hours > 0
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

export default function Composer({
  placeholder, showProjectPill, showModePill, showPermissionsPill = true,
  onSend, onStop, disabled, busy = false, queueCount = 0, queueEditActive = false,
  toolbarEpoch, draftRequest, initialProjectId, initialMode, onProjectChange, onModeChange, focusRequestKey,
}: Props) {
  const t = useT()
  const dialog = useAppDialog()
  const resolvedPlaceholder = placeholder ?? t('composer.placeholder')
  const [text, setText] = useState('')
  useEffect(() => {
    useContextDraftStore.setState({ text })
    return () => { useContextDraftStore.setState({ text: '' }) }
  }, [text])
  const [mode, setMode] = useState(initialMode ?? 'agent')
  const [modes, setModes] = useState<BobMode[]>(BUILTIN_MODES)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId)
  const [skills, setSkills] = useState<WorkspaceSkill[]>([])
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [catalogError, setCatalogError] = useState<string | null>(null)
  const [integrationStatuses, setIntegrationStatuses] = useState<IntegrationConnectionStatus[]>([])
  const [mcpServers, setMcpServers] = useState<McpServer[]>([])
  const [dbConnections, setDbConnections] = useState<DbConnection[]>([])
  const [slashCommands, setSlashCommands] = useState<BobSlashCommand[]>([])
  const [autocompleteIndex, setAutocompleteIndex] = useState(0)
  const [autocompleteDismissed, setAutocompleteDismissed] = useState<string | null>(null)
  const [caretIndex, setCaretIndex] = useState(0)
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([])
  const [attachMenu, setAttachMenu] = useState(false)
  const [attachSearch, setAttachSearch] = useState('')
  const [modeMenu, setModeMenu] = useState(false)
  const [modeSearch, setModeSearch] = useState('')
  const [permissionsMenu, setPermissionsMenu] = useState(false)
  const [projectMenu, setProjectMenu] = useState(false)
  const [runtimeSettings, setRuntimeSettings] = useState({ mcpEnabled: true, subagentsEnabled: true })
  const [listening, setListening] = useState(false)
  const [dictationBusy, setDictationBusy] = useState(false)
  const [recording, setRecording] = useState(false)
  const [recordingBusy, setRecordingBusy] = useState(false)
  const [recordingLevel, setRecordingLevel] = useState(0)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [recordingError, setRecordingError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const attachButtonRef = useRef<HTMLButtonElement>(null)
  const attachSearchRef = useRef<HTMLInputElement>(null)
  const projectButtonRef = useRef<HTMLButtonElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const permissionsButtonRef = useRef<HTMLButtonElement>(null)
  const applyVisiblePermissions = useTaskPermissionStore(state => state.applyVisiblePermissions)
  const recordingRef = useRef(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const recordingActionRef = useRef(false)
  const recordingStartedAtRef = useRef(0)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const bobStatus = useAppStore(state => state.bobStatus)
  const apiKeyRequired = bobStatus === 'unauthenticated'
  const [isDragging, setIsDragging] = useState(false)
  const dragDepthRef = useRef(0)

  useEffect(() => {
    if (initialProjectId !== undefined) setProjectId(initialProjectId)
  }, [initialProjectId])

  useEffect(() => {
    setMode(initialMode ?? 'agent')
    setModeMenu(false)
    setModeSearch('')
  }, [initialMode])

  useEffect(() => {
    if (!focusRequestKey || disabled) return
    taRef.current?.focus()
  }, [disabled, focusRequestKey])

  useEffect(() => {
    if (!draftRequest) return
    setText(draftRequest.text)
    if (draftRequest.mode) {
      setMode(draftRequest.mode)
      onModeChange?.(draftRequest.mode)
    }
    if (draftRequest.projectId !== undefined) {
      setProjectId(draftRequest.projectId)
      onProjectChange?.(draftRequest.projectId)
    }
    setAttachments([])
    setAttachMenu(false)
    setProjectMenu(false)
    setModeMenu(false)
    setPermissionsMenu(false)
    setAttachSearch('')
    setModeSearch('')
    if (draftRequest.attachmentPaths?.length) {
      void registerAttachmentPaths(draftRequest.attachmentPaths, setAttachments)
    }
    window.requestAnimationFrame(() => {
      const ta = taRef.current
      if (!ta) return
      ta.focus()
      const end = draftRequest.text.length
      ta.setSelectionRange(end, end)
    })
  // Intentionally keyed by draftRequest.key only — callers bump key to reload.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftRequest?.key])

  useLayoutEffect(() => {
    if (!attachMenu) return
    const input = attachSearchRef.current
    if (!input) return
    input.focus({ preventScroll: true })
    input.setSelectionRange(input.value.length, input.value.length)
  }, [attachMenu])

  useEffect(() => () => {
    if (!recordingRef.current) return
    recordingRef.current = false
    void stopNativeAudioRecording().catch(() => undefined)
  }, [])

  useEffect(() => {
    if (!recording) return
    const updateDuration = () => {
      setRecordingSeconds(Math.max(0, Math.floor((Date.now() - recordingStartedAtRef.current) / 1000)))
    }
    updateDuration()
    const durationTimer = window.setInterval(updateDuration, 250)
    const levelTimer = window.setInterval(() => {
      void getNativeAudioRecordingLevel()
        .then(level => setRecordingLevel(Math.max(0, Math.min(1, level))))
        .catch(() => setRecordingLevel(0))
    }, 90)
    return () => {
      window.clearInterval(durationTimer)
      window.clearInterval(levelTimer)
    }
  }, [recording])

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

  const insertDbMention = useCallback((name: string) => {
    insertMcpMention(`@db:${name}`)
  }, [insertMcpMention])

  const refreshMcpIntegrations = useCallback(() => {
    void Promise.all([
      getIntegrationStatuses().then(items => ({ ok: true as const, items })).catch(error => ({ ok: false as const, error })),
      getMcpServers().then(items => ({ ok: true as const, items })).catch(error => ({ ok: false as const, error })),
      getDbConnections().then(items => ({ ok: true as const, items })).catch(error => ({ ok: false as const, error })),
    ]).then(([statusesResult, serversResult, dbResult]) => {
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
      if (dbResult.ok) setDbConnections(dbResult.items.filter(item => item.enabled))
      else {
        setDbConnections([])
        errors.push(errorMessage(dbResult.error, t('composer.catalogError')))
      }
      if (errors.length) setCatalogError(errors[0])
    })
  }, [])

  const addAttachmentPaths = useCallback((paths: string[]) => {
    // Attachments stay plain files — never auto-insert @plugin mentions.
    void registerAttachmentPaths(paths, setAttachments)
  }, [])

  const pasteClipboardAttachments = useCallback(async (clipboardData: DataTransfer | null) => {
    const unique = await collectPasteAttachmentPaths(clipboardData, {
      readClipboardPaths: readClipboardAttachmentPaths,
      writeImage: writeClipboardAttachmentImage,
    })
    if (unique.length > 0) addAttachmentPaths(unique)
    return unique.length > 0
  }, [addAttachmentPaths])

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
          // Window-level Tauri drops only attach when this composer is mounted
          // (home / chat). Ignore empty path lists from cancelled OS drops.
          if (payload.paths.length > 0) addAttachmentPaths(payload.paths)
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
        if (settings?.defaultMode && initialMode === undefined) {
          setMode(current => current === 'agent' ? settings.defaultMode : current)
        }
        if (settings) {
          setRuntimeSettings({
            mcpEnabled: settings.mcpEnabled,
            subagentsEnabled: settings.subagentsEnabled,
          })
        }
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
    let unlistenPlugins: (() => void) | undefined
    void listen<number>('plugins-refreshed', () => {
      void getPlugins()
        .then(items => setPlugins(items.filter(plugin => plugin.installState === 'installed')))
        .catch(() => {})
    }).then(fn => { unlistenPlugins = fn }).catch(() => {})
    return () => {
      window.removeEventListener('bob-modes-updated', onModes)
      unlistenPlugins?.()
    }
  }, [refreshMcpIntegrations])

  useEffect(() => {
    let cancelled = false
    void listBobSlashCommands()
      .then(commands => {
        if (!cancelled) setSlashCommands(commands)
      })
      .catch(() => {
        if (!cancelled) setSlashCommands([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const resizeTextarea = useCallback(() => {
    const ta = taRef.current
    if (!ta) return
    resizeComposerTextarea(ta)
  }, [])

  useLayoutEffect(() => {
    resizeTextarea()
  }, [resizeTextarea, text])

  useEffect(() => {
    window.addEventListener('resize', resizeTextarea)
    return () => window.removeEventListener('resize', resizeTextarea)
  }, [resizeTextarea])

  const closeMenus = useCallback(() => {
    setAttachMenu(false)
    setAttachSearch('')
    setProjectMenu(false)
    setModeMenu(false)
    setModeSearch('')
    setPermissionsMenu(false)
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

  const toggleMenu = (target: 'attach' | 'project' | 'mode' | 'permissions') => {
    const shouldOpen = target === 'attach'
      ? !attachMenu
      : target === 'project'
        ? !projectMenu
        : target === 'permissions'
          ? !permissionsMenu
          : !modeMenu
    setAttachMenu(target === 'attach' && shouldOpen)
    setProjectMenu(target === 'project' && shouldOpen)
    setModeMenu(target === 'mode' && shouldOpen)
    setPermissionsMenu(target === 'permissions' && shouldOpen)
    if (target !== 'mode' || !shouldOpen) setModeSearch('')
    if (target !== 'attach' || !shouldOpen) setAttachSearch('')
    if (target === 'attach' && shouldOpen) refreshMcpIntegrations()
  }

  const handleSend = () => {
    if (!text.trim() || disabled || recording || recordingBusy || apiKeyRequired) return
    const prompt = normalizeComposerCapabilityMentions(text, mentionCatalog)
    if (onSend) {
      onSend(prompt, mode, attachments.map(item => item.path), projectId)
    } else {
      navigate('/chat', { state: { initialPrompt: prompt, mode, attachmentPaths: attachments.map(item => item.path), projectId } })
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

  const toggleRecording = async () => {
    if (recordingActionRef.current) return
    recordingActionRef.current = true
    setRecordingBusy(true)
    setRecordingError(null)
    try {
      if (recordingRef.current) {
        const asset = await stopNativeAudioRecording()
        recordingRef.current = false
        setRecording(false)
        setRecordingLevel(0)
        await registerAttachmentPaths([asset.recordingPath], setAttachments)
      } else {
        await startNativeAudioRecording()
        recordingStartedAtRef.current = Date.now()
        recordingRef.current = true
        setRecordingSeconds(0)
        setRecording(true)
      }
    } catch (error) {
      const message = errorMessage(error)
      setRecordingError(t(recordingRef.current ? 'composer.recordingSaveFailed' : 'composer.recordingStartFailed', { error: message }))
      if (recordingRef.current) {
        recordingRef.current = false
        setRecording(false)
        setRecordingLevel(0)
      }
    } finally {
      recordingActionRef.current = false
      setRecordingBusy(false)
    }
  }

  const toggleDictation = async () => {
    const active = recognitionRef.current
    if (active) {
      recognitionRef.current = null
      setListening(false)
      try { active.stop() } catch { /* the engine may already be stopped */ }
      return
    }
    if (dictationBusy) return
    setDictationBusy(true)
    try {
      const availability = await getVoiceDictationAvailability()
      if (!availability.available) {
        await dialog.alert({
          message: availability.reason === 'requires_app_bundle'
            ? t('composer.dictationRequiresApp')
            : availability.reason === 'missing_usage_description'
              ? t('composer.dictationMissingUsageDescription')
              : t('composer.dictationUnavailable'),
        })
        return
      }
      const permission = await requestVoiceDictationPermission()
      const deniedPane = permission.microphone !== 'authorized' ? 'microphone' : permission.speechRecognition !== 'authorized' ? 'speech' : null
      if (deniedPane) {
        const openSettings = await dialog.confirm({ title: t('composer.voicePermissionTitle'), message: t('composer.voicePermissionDenied'), confirmLabel: deniedPane === 'microphone' ? t('composer.openMicrophoneSettings') : t('composer.openSpeechSettings') })
        if (openSettings) void openMacosPrivacyPane(deniedPane).catch(() => undefined)
        return
      }
      const Recognition = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike }).SpeechRecognition
        ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
      if (!Recognition) { await dialog.alert({ message: t('composer.dictationWebkitUnavailable') }); return }
      const recognition = new Recognition()
      recognition.lang = navigator.language || 'fr-FR'
      recognition.interimResults = true
      recognition.continuous = true
      let committed = text
      recognition.onresult = event => {
        let interim = ''
        for (let index = event.resultIndex ?? 0; index < event.results.length; index += 1) {
          const result = event.results[index]
          if (!result) continue
          const value = result[0]?.transcript?.trim()
          if (!value) continue
          if (result.isFinal) committed = `${committed}${committed && !committed.endsWith(' ') ? ' ' : ''}${value}`
          else interim += `${interim ? ' ' : ''}${value}`
        }
        setText(`${committed}${committed && interim ? ' ' : ''}${interim}`)
      }
      recognition.onend = () => { if (recognitionRef.current === recognition) { recognitionRef.current = null; setListening(false) } }
      recognition.onerror = () => undefined
      recognitionRef.current = recognition
      setListening(true)
      recognition.start()
    } catch (error) {
      setListening(false)
      recognitionRef.current = null
      await dialog.alert({ message: t('composer.dictationStartFailed', { error: errorMessage(error) }) })
    } finally { setDictationBusy(false) }
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
  const mentionCatalog = useMemo<ComposerMentionCatalog>(() => ({
    pluginIds: plugins.flatMap(plugin => {
      const mentionId = pluginMentionId(plugin)
      return mentionId === plugin.id ? [mentionId] : [mentionId, plugin.id]
    }),
    skillSlugs: skills.map(skill => skill.slug),
  }), [plugins, skills])
  const mcpPickerItems = useMemo(() => {
    const connectedIds = new Set(
      integrationStatuses.filter(status => status.connected).map(status => status.integrationId),
    )
    const items: McpPickerItem[] = []
    for (const integration of INTEGRATION_PICKER) {
      if (!connectedIds.has(integration.id)) continue
      if (integrationFilter.length > 0 && !integrationFilter.includes(integration.id)) continue
      const catalog = CATALOG.find(item => item.id === integration.id)
      items.push({
        id: `integration:${integration.id}`,
        name: integration.id === 'outlook-calendar' ? t('integrations.outlookCalendar') : (catalog?.name ?? integration.id),
        description: catalog ? t(catalog.shortKey) : '',
        icon: resolveIntegrationIcon(integration.id),
        insert: `@integration:${integration.id}`,
        kind: 'integration',
      })
    }
    const coveredMcp = new Set<string>(
      INTEGRATION_PICKER
        .filter(integration => connectedIds.has(integration.id))
        .map(integration => integration.mcpName),
    )
    for (const server of mcpServers) {
      if (isPluginManagedMcp(server)) continue
      if (coveredMcp.has(server.name)) continue
      if (integrationFilter.length > 0 && !integrationFilter.includes(`mcp:${server.name}`)) continue
      if ((server.raw?.env as Record<string, unknown> | undefined)?.BOB_WORK_API_CREDENTIAL_ONLY === '1') continue
      const api = isApiServer(server)
      items.push({
        id: `${api ? 'api' : 'mcp'}:${server.name}`,
        name: server.name,
        description: api
          ? `REST · ${String((server.raw?.env as Record<string, unknown> | undefined)?.BOB_WORK_API_BASE_URL || '')}`
          : `${server.transport} · ${server.commandOrUrl || t('composer.mcpServerFallback')}`,
        icon: 'plugin',
        insert: `@${api ? 'api' : 'mcp'}:${server.name}`,
        kind: api ? 'api' : 'mcp',
      })
    }
    return items
  }, [integrationFilter, integrationStatuses, mcpServers, t])

  const autocompleteQuery = detectAutocompleteQuery(text, caretIndex)
  const mention = autocompleteQuery?.trigger === '@' ? autocompleteQuery.query.toLowerCase() : undefined
  const mentionItems = mention === undefined ? [] : [
    ...allowedPlugins.map(plugin => ({ id: `plugin:${pluginMentionId(plugin)}`, label: plugin.name, subtitle: 'Plugin', insert: `@plugin:${pluginMentionId(plugin)} ` })),
    ...allowedSkills.map(skill => ({ id: `skill:${skill.slug}`, label: skill.name, subtitle: 'Skill', insert: `@skill:${skill.slug} ` })),
    ...mcpPickerItems.map(item => ({ id: item.id, label: item.name, subtitle: item.kind === 'integration' ? t('composer.integrationKind') : item.kind === 'api' ? t('composer.apiKind') : t('composer.mcpKind'), insert: `${item.insert} ` })),
    ...dbConnections.map(item => ({ id: `db:${item.name}`, label: item.name, subtitle: 'DB', insert: `@db:${item.name} ` })),
  ].filter(item => item.label.toLowerCase().includes(mention) || item.id.toLowerCase().includes(mention)).slice(0, 8)

  const autocompleteItems: PromptAutocompleteItem[] = useMemo(() => {
    if (!autocompleteQuery) return []
    if (autocompleteQuery.trigger === '/') {
      return slashCommandsToItems(filterSlashCommands(slashCommands, autocompleteQuery.query)).slice(0, 12)
    }
    return mentionItems.map(item => ({
      id: item.id,
      trigger: '@' as const,
      label: item.label,
      subtitle: item.subtitle,
      insert: item.insert,
    }))
  }, [autocompleteQuery, mentionItems, slashCommands])

  useEffect(() => {
    setAutocompleteIndex(0)
  }, [autocompleteQuery?.trigger, autocompleteQuery?.query, autocompleteItems.length])

  const visibleAutocompleteItems = autocompleteDismissed === `${text}:${caretIndex}` ? [] : autocompleteItems

  const insertAutocomplete = (item: PromptAutocompleteItem) => {
    const query = detectAutocompleteQuery(text, caretIndex)
    if (!query) return
    const nextCaretIndex = query.startIndex + item.insert.length
    setAutocompleteDismissed(null)
    setText(applyAutocompleteInsert(text, query, item.insert))
    setCaretIndex(nextCaretIndex)
    window.requestAnimationFrame(() => {
      taRef.current?.focus()
      taRef.current?.setSelectionRange(nextCaretIndex, nextCaretIndex)
    })
  }
  const selectPlugin = (plugin: Plugin) => {
    insertPluginMention(pluginMentionId(plugin))
    setAttachMenu(false)
    setAttachSearch('')
  }

  const selectSkill = (skill: WorkspaceSkill) => {
    insertSkillMention(skill.slug)
    setAttachMenu(false)
    setAttachSearch('')
  }

  const selectMcpItem = (item: McpPickerItem) => {
    insertMcpMention(item.insert)
    setAttachMenu(false)
    setAttachSearch('')
  }

  const attachQuery = attachSearch.trim().toLocaleLowerCase()

  const visibleSkills = useMemo(() => {
    const filtered = attachQuery
      ? allowedSkills.filter(skill =>
          `${skill.name} ${skill.description ?? ''} ${skill.slug}`.toLocaleLowerCase().includes(attachQuery),
        )
      : allowedSkills
    return sortSkillsForDisplay(filtered)
  }, [allowedSkills, attachQuery])

  const visiblePlugins = useMemo(() => {
    if (!attachQuery) return allowedPlugins
    return allowedPlugins.filter(plugin => `${plugin.name} ${plugin.description ?? ''}`.toLocaleLowerCase().includes(attachQuery))
  }, [allowedPlugins, attachQuery])

  const apiPickerItems = useMemo(
    () => mcpPickerItems.filter(item => item.kind === 'api'),
    [mcpPickerItems],
  )
  const integrationMcpPickerItems = useMemo(
    () => mcpPickerItems.filter(item => item.kind !== 'api'),
    [mcpPickerItems],
  )

  const visibleMcpItems = useMemo(() => {
    if (!attachQuery) return integrationMcpPickerItems
    return integrationMcpPickerItems.filter(item =>
      `${item.name} ${item.description} ${item.insert}`.toLocaleLowerCase().includes(attachQuery),
    )
  }, [attachQuery, integrationMcpPickerItems])

  const visibleApiItems = useMemo(() => {
    if (!attachQuery) return apiPickerItems
    return apiPickerItems.filter(item =>
      `${item.name} ${item.description} ${item.insert}`.toLocaleLowerCase().includes(attachQuery),
    )
  }, [apiPickerItems, attachQuery])

  const visibleDbItems = useMemo(() => {
    if (!attachQuery) return dbConnections
    return dbConnections.filter(item =>
      `${item.name} ${item.engine}`.toLocaleLowerCase().includes(attachQuery),
    )
  }, [attachQuery, dbConnections])

  const filteredModes = useMemo(() => {
    const query = modeSearch.trim().toLowerCase()
    if (!query) return modes
    return modes.filter(item => item.name.toLowerCase().includes(query) || item.slug.includes(query) || item.description?.toLowerCase().includes(query))
  }, [modeSearch, modes])
  const selectedMode = modes.find(item => item.slug === mode) ?? BUILTIN_MODES[0]
  const visiblePermissionIds = useMemo(
    () => getVisibleTaskPermissions(
      selectedMode,
      forbiddenTaskPermissionIds(runtimeSettings),
    ).map(permission => permission.id),
    [runtimeSettings, selectedMode],
  )

  useEffect(() => {
    applyVisiblePermissions(visiblePermissionIds)
  }, [applyVisiblePermissions, visiblePermissionIds])

  const mentionChips = useMemo(() => {
    type Chip = {
      key: string
      kind: 'plugin' | 'skill' | 'integration' | 'api' | 'mcp' | 'db'
      id: string
      name: string
      subtitle: string
      icon: string
    }
    const chips: Chip[] = []
    for (const mention of getActiveComposerMentions(text, mentionCatalog)) {
      if (mention.kind === 'plugin') {
        const plugin = plugins.find(item => item.id === mention.id || pluginMentionId(item) === mention.id)
        if (!plugin) continue
        const mentionId = pluginMentionId(plugin)
        chips.push({
          key: `plugin:${plugin.id}`,
          kind: 'plugin',
          id: mentionId,
          name: plugin.name,
          subtitle: plugin.manifest && typeof plugin.manifest === 'object' && 'specializedMode' in (plugin.manifest as object)
            ? t('composer.workMode')
            : t('composer.plugins'),
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
            subtitle: t('composer.integrationKind'),
            icon: integration.icon,
          })
          continue
        }
        chips.push({
          key: `skill:${skill.slug}`,
          kind: 'skill',
          id: skill.slug,
          name: skill.name,
          subtitle: t('composer.instructionsKind'),
          icon: resolveSkillIcon(skill),
        })
        continue
      }
      if (mention.kind === 'integration') {
        const integration = mcpPickerItems.find(item => item.id === `integration:${mention.id}`)
        if (!integration) continue
        chips.push({
          key: `integration:${mention.id}`,
          kind: 'integration',
          id: mention.id,
          name: integration.name,
          subtitle: t('composer.integrationKind'),
          icon: integration.icon,
        })
        continue
      }
      if (mention.kind === 'api') {
        const api = mcpPickerItems.find(item => item.id === `api:${mention.id}`)
        chips.push({
          key: `api:${mention.id}`,
          kind: 'api',
          id: mention.id,
          name: api?.name ?? mention.id,
          subtitle: t('composer.apiKind'),
          icon: api?.icon ?? 'plugin',
        })
        continue
      }
      if (mention.kind === 'db') {
        const connection = dbConnections.find(item => item.name === mention.id)
        chips.push({
          key: `db:${mention.id}`,
          kind: 'db',
          id: mention.id,
          name: connection?.name ?? mention.id,
          subtitle: 'DB',
          icon: 'plugin',
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
  }, [dbConnections, mcpPickerItems, mentionCatalog, plugins, skills, t, text])

  const removeMentionChip = (kind: 'plugin' | 'skill' | 'integration' | 'api' | 'mcp' | 'db', id: string) => {
    setText(current => removeComposerMention(current, kind, id))
    taRef.current?.focus()
  }

  return (
    <div ref={rootRef} className="composer-root">
      {visibleAutocompleteItems.length > 0 && (
        <div className="composer-popover" role="listbox" aria-label={t('composer.commandAutocomplete')} style={{ left: 16, right: 16, bottom: 'calc(100% + 8px)' }}>
          <div className="composer-popover-title">{autocompleteQuery?.trigger === '/' ? t('composer.bobCommands') : t('composer.addToPrompt')}</div>
          {visibleAutocompleteItems.map((item, index) => (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={index === autocompleteIndex}
              className={`composer-popover-row${index === autocompleteIndex ? ' selected' : ''}`}
              onMouseDown={event => event.preventDefault()}
              onClick={() => insertAutocomplete(item)}
            >
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
            <span>{t('composer.dropToAttach')}</span>
          </div>
        )}
        {mentionChips.length > 0 && (
          <div className="composer-mention-chips" aria-label={t('composer.promptComponents')}>
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
          <>
            <div className="composer-attachments">
              {attachments.map(item => (
                <AttachmentPreview
                  key={item.path}
                  path={item.path}
                  isDirectory={item.isDirectory}
                  onRemove={() => setAttachments(items => items.filter(entry => entry.path !== item.path))}
                />
              ))}
            </div>
          </>
        )}
        {recordingError && <p className="composer-recording-error" role="alert">{recordingError}</p>}

        <textarea
          ref={taRef}
          className="composer-textarea"
          placeholder={resolvedPlaceholder}
          value={text}
          rows={1}
          disabled={disabled}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          onChange={event => {
            setAutocompleteDismissed(null)
            setText(event.target.value)
            setCaretIndex(event.target.selectionStart ?? event.target.value.length)
          }}
          onSelect={event => setCaretIndex(event.currentTarget.selectionStart ?? event.currentTarget.value.length)}
          onPaste={event => {
            const data = event.clipboardData
            if (clipboardLooksLikeAttachments(data)) {
              event.preventDefault()
              void pasteClipboardAttachments(data)
              return
            }
            // Finder copies may omit web MIME types — attach without blocking text paste.
            void readClipboardAttachmentPaths()
              .then(paths => { if (paths.length) addAttachmentPaths(paths) })
              .catch(() => undefined)
          }}
          onKeyDown={event => {
            if (visibleAutocompleteItems.length > 0) {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setAutocompleteIndex(current => cycleAutocompleteIndex(current, 1, visibleAutocompleteItems.length))
                return
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setAutocompleteIndex(current => cycleAutocompleteIndex(current, -1, visibleAutocompleteItems.length))
                return
              }
              if (event.key === 'Tab' || event.key === 'Enter') {
                event.preventDefault()
                const selected = visibleAutocompleteItems[autocompleteIndex] ?? visibleAutocompleteItems[0]
                if (selected) insertAutocomplete(selected)
                return
              }
              if (event.key === 'Escape') {
                event.preventDefault()
                event.stopPropagation()
                setAutocompleteDismissed(`${text}:${caretIndex}`)
                return
              }
            }
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              handleSend()
            }
          }}
        />

        <div className="composer-toolbar">
          <div className="composer-toolbar-start">
          <div>
            <button ref={attachButtonRef} className="icon-btn" title={t('composer.attachFileOrFolder')} aria-haspopup="menu" aria-expanded={attachMenu} onClick={() => toggleMenu('attach')}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            </button>
            {attachMenu && (
              <ComposerPopover anchorRef={attachButtonRef} ariaLabel={t('composer.attachMenuAria')} className="attach-popover">
                <div className="attach-popover-header">
                  <div className="composer-popover-title">{t('composer.add')}</div>
                  <button type="button" className="composer-popover-row attach-plugin-row" onClick={chooseFiles}>
                    <span className="attach-row-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    </span>
                    <span className="attach-plugin-copy"><strong>{t('composer.files')}</strong></span>
                  </button>
                  <button type="button" className="composer-popover-row attach-plugin-row" onClick={chooseFolder}>
                    <span className="attach-row-icon" aria-hidden="true">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                    </span>
                    <span className="attach-plugin-copy"><strong>{t('composer.folder')}</strong></span>
                  </button>
                  <input
                    ref={attachSearchRef}
                    autoFocus
                    value={attachSearch}
                    onChange={event => setAttachSearch(event.target.value)}
                    placeholder={t('composer.searchCatalog')}
                    aria-label={t('composer.searchCatalog')}
                    className="popover-search"
                  />
                </div>
                <div className="attach-popover-scroll">
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">{t('composer.pluginsAndModes')}</div>
                  <p className="composer-popover-explanation">{t('composer.pluginsExplanation')}</p>
                  {catalogError && allowedPlugins.length === 0 ? (
                    <p className="composer-popover-empty">{catalogError}</p>
                  ) : allowedPlugins.length > 0 ? (
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
                                <span className="catalog-kind-badge catalog-kind-badge--plugin">{t('composer.pluginKind')}</span>
                                <strong>{plugin.name}</strong>
                                {isBuiltinPlugin(plugin) ? <span className="skill-builtin-badge">{t('composer.builtin')}</span> : null}
                              </span>
                              <small>{isWorkMode ? t('composer.workMode') : (plugin.description || t('composer.pluginEnabled'))}</small>
                            </span>
                            <span className="attach-row-action" aria-hidden="true">+</span>
                          </button>
                        )
                      }) : <p className="composer-popover-empty">{t('composer.noPluginMatch')}</p>}
                    </div>
                  ) : <p className="composer-popover-empty">{t('composer.noPlugins')}</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/plugins') }}>{t('composer.managePlugins')}</button>
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">{t('composer.skillsInstructions')}</div>
                  <p className="composer-popover-explanation">{t('composer.skillsExplanation')}</p>
                  {catalogError && allowedSkills.length === 0 ? (
                    <p className="composer-popover-empty">{catalogError}</p>
                  ) : allowedSkills.length > 0 ? (
                    <div className="attach-plugin-list">
                      {visibleSkills.length > 0 ? visibleSkills.map(skill => (
                        <button type="button" className="composer-popover-row attach-plugin-row" key={`${skill.scope}:${skill.slug}`} onClick={() => selectSkill(skill)}>
                          <span className="attach-row-icon">
                            <PluginIcon icon={resolveSkillIcon(skill)} size="sm" className="attach-plugin-icon" />
                          </span>
                          <span className="attach-plugin-copy">
                            <span className="attach-plugin-title">
                              <span className="catalog-kind-badge catalog-kind-badge--skill">{t('composer.skillKind')}</span>
                              <strong>{skill.name}</strong>
                              {isBuiltinSkill(skill) ? <span className="skill-builtin-badge">{t('composer.builtin')}</span> : null}
                            </span>
                            <small>{skill.description || t('composer.skillEnabled')}</small>
                          </span>
                          <span className="attach-row-action" aria-hidden="true">+</span>
                        </button>
                      )) : <p className="composer-popover-empty">{t('composer.noSkillMatch')}</p>}
                    </div>
                  ) : <p className="composer-popover-empty">{t('composer.noSkills')}</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/skills') }}>{t('composer.manageSkills')}</button>
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">{t('composer.mcpIntegrations')}</div>
                  {integrationMcpPickerItems.length > 0 ? (
                    <div className="attach-plugin-list">
                      {visibleMcpItems.length > 0 ? visibleMcpItems.map(item => (
                        <button type="button" className="composer-popover-row attach-plugin-row" key={item.id} onClick={() => selectMcpItem(item)}>
                          <span className="attach-row-icon">
                            <PluginIcon icon={item.icon} size="sm" className="attach-plugin-icon" />
                          </span>
                          <span className="attach-plugin-copy">
                            <span className="attach-plugin-title">
                              <span className={`catalog-kind-badge catalog-kind-badge--${item.kind}`}>
                                {item.kind === 'integration' ? t('composer.integrationKind') : t('composer.mcpKind')}
                              </span>
                              <strong>{item.name}</strong>
                            </span>
                            <small>{item.kind === 'integration' ? t('composer.connectorLine', { description: item.description }) : item.description}</small>
                          </span>
                          <span className="attach-row-action" aria-hidden="true">+</span>
                        </button>
                      )) : <p className="composer-popover-empty">{t('composer.noMcpMatch')}</p>}
                    </div>
                  ) : <p className="composer-popover-empty">{selectedProject ? t('composer.noMcpConnectedForProject') : t('composer.noMcpConnected')}</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/integrations') }}>{t('composer.manageIntegrations')}</button>
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">{t('composer.apis')}</div>
                  {apiPickerItems.length > 0 ? (
                    <div className="attach-plugin-list">
                      {visibleApiItems.length > 0 ? visibleApiItems.map(item => (
                        <button type="button" className="composer-popover-row attach-plugin-row" key={item.id} onClick={() => selectMcpItem(item)}>
                          <span className="attach-row-icon">
                            <PluginIcon icon={item.icon} size="sm" className="attach-plugin-icon" />
                          </span>
                          <span className="attach-plugin-copy">
                            <span className="attach-plugin-title"><strong>{item.name}</strong></span>
                            <small>{item.description}</small>
                          </span>
                          <span className="attach-row-action" aria-hidden="true">+</span>
                        </button>
                      )) : <p className="composer-popover-empty">{t('composer.noApiMatch')}</p>}
                    </div>
                  ) : <p className="composer-popover-empty">{t('composer.noApis')}</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/integrations', { state: { tab: 'apis' } }) }}>{t('composer.manageApis')}</button>
                  <div className="composer-popover-separator" />
                  <div className="composer-popover-title">{t('composer.databases')}</div>
                  {dbConnections.length > 0 ? (
                    <div className="attach-plugin-list">
                      {visibleDbItems.length > 0 ? visibleDbItems.map(item => (
                        <button type="button" className="composer-popover-row attach-plugin-row" key={item.id} onClick={() => { insertDbMention(item.name); setAttachMenu(false); setAttachSearch('') }}>
                          <span className="attach-row-icon" aria-hidden="true">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/><path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3"/></svg>
                          </span>
                          <span className="attach-plugin-copy">
                            <span className="attach-plugin-title"><strong>{item.name}</strong></span>
                            <small>{engineMeta(item.engine).label}</small>
                          </span>
                          <span className="attach-row-action" aria-hidden="true">+</span>
                        </button>
                      )) : <p className="composer-popover-empty">{t('composer.noDbMatch')}</p>}
                    </div>
                  ) : <p className="composer-popover-empty">{t('composer.noDatabases')}</p>}
                  <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/integrations', { state: { tab: 'db' } }) }}>{t('composer.manageDatabases')}</button>
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
            disabled={dictationBusy || recording}
            onClick={toggleDictation}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10a7 7 0 0 0 14 0M12 17v5M8 22h8"/></svg>
          </button>

          <button
            type="button"
            className={`icon-btn recording-control ${recording ? 'recording' : ''}`}
            title={recording ? `${t('composer.recordingStopLabel')} · ${formatRecordingDuration(recordingSeconds)}` : t('composer.recordingStartLabel')}
            aria-label={recording ? t('composer.recordingStopLabel') : t('composer.recordingStartLabel')}
            aria-pressed={recording}
            disabled={recordingBusy}
            onClick={toggleRecording}
          >
            {recording ? (
              <span className="live-audio-meter" aria-hidden="true">
                {[0.45, 0.75, 1, 0.62].map((weight, index) => (
                  <span
                    className="live-audio-meter__bar"
                    key={index}
                    style={{ height: `${3 + Math.round(recordingLevel * weight * 11)}px` }}
                  />
                ))}
                <span className="live-audio-meter__stop" />
              </span>
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor" stroke="currentColor"/></svg>
            )}
          </button>
          {recording && <span className="composer-recording-duration" aria-live="off">{formatRecordingDuration(recordingSeconds)}</span>}

          {showProjectPill && (
            <div>
              <button ref={projectButtonRef} className="composer-pill" aria-haspopup="menu" aria-expanded={projectMenu} onClick={() => toggleMenu('project')}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
                {selectedProject?.name ?? 'Projet'}
              </button>
              {projectMenu && (
                <ComposerPopover anchorRef={projectButtonRef} ariaLabel="Choisir un projet" className="project-popover">
                  <button className="composer-popover-row" onClick={() => { setProjectId(undefined); onProjectChange?.(undefined); setProjectMenu(false) }}>
                    <span className="composer-project-option"><NoProjectIcon />{t('composer.noProject')}</span>
                  </button>
                  {projects.map(project => <button className="composer-popover-row" key={project.id} onClick={() => { setProjectId(project.id); onProjectChange?.(project.id); if (project.defaultMode) { setMode(project.defaultMode); onModeChange?.(project.defaultMode) } setProjectMenu(false) }}>{project.name}</button>)}
                </ComposerPopover>
              )}
            </div>
          )}
          </div>

          <div className="composer-toolbar-end" key={toolbarEpoch ?? 'composer-toolbar-end'}>
          {showPermissionsPill && showModePill && (
            <div className="composer-toolbar-control">
              <button
                ref={permissionsButtonRef}
                className="composer-pill composer-permissions-pill"
                aria-haspopup="menu"
                aria-expanded={permissionsMenu}
                aria-label={t('composer.permissions.title')}
                onClick={() => toggleMenu('permissions')}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true">
                  <path d="M12 3l8 4v5c0 5-3.5 8.5-8 9-4.5-.5-8-4-8-9V7l8-4z" />
                </svg>
                {t('composer.permissions.pill')}
                <span aria-hidden="true">⌄</span>
              </button>
              {permissionsMenu && (
                <ComposerPopover
                  anchorRef={permissionsButtonRef}
                  align="end"
                  ariaLabel={t('composer.permissions.title')}
                  className="permissions-popover-shell"
                >
                  <ComposerPermissionsMenu
                    selectedMode={selectedMode}
                    mcpEnabled={runtimeSettings.mcpEnabled}
                    subagentsEnabled={runtimeSettings.subagentsEnabled}
                  />
                </ComposerPopover>
              )}
            </div>
          )}

          {showModePill && (
            <div className="composer-toolbar-control">
              <button ref={modeButtonRef} className="composer-pill" aria-label={`Mode Bob : ${selectedMode.name}`} aria-haspopup="menu" aria-expanded={modeMenu} onClick={() => toggleMenu('mode')}>{selectedMode.name}<span aria-hidden="true">⌄</span></button>
              {modeMenu && (
                <ComposerPopover anchorRef={modeButtonRef} align="end" ariaLabel="Modes Bob" className="mode-popover">
                  <div className="composer-popover-title">{t('composer.bobModes')}</div>
                  <input autoFocus value={modeSearch} onChange={event => setModeSearch(event.target.value)} placeholder={t('composer.searchMode')} className="popover-search" />
                  <div className="mode-popover-list">
                    {filteredModes.map(item => (
                      <button className={`composer-popover-row mode-row ${item.slug === mode ? 'selected' : ''}`} key={item.slug} onClick={() => { setMode(item.slug); onModeChange?.(item.slug); setModeMenu(false); setModeSearch('') }}>
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
            <button className="composer-stop-btn" onClick={onStop} title={t('composer.stopActive')} aria-label={t('composer.stopActive')}><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg></button>
          )}
          <button
            className={`send-btn ${busy && !queueEditActive ? 'queue-send-btn' : ''}`}
            disabled={!text.trim() || !!disabled || recording || recordingBusy || apiKeyRequired}
            onClick={handleSend}
            title={
              queueEditActive
                ? t('composer.updateQueuedPrompt')
                : busy
                  ? `Ajouter à la file${queueCount ? ` (${queueCount} en attente)` : ''}`
                  : 'Envoyer'
            }
            aria-label={
              queueEditActive
                ? t('composer.updateQueuedPrompt')
                : busy
                  ? 'Ajouter le prompt à la file'
                  : t('composer.send')
            }
          >
            {queueEditActive ? (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg>
            ) : busy ? (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M4 6h10M4 12h7M4 18h5"/><path d="M17 11v8M13 15h8"/></svg>
            ) : (
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            )}
          </button>
          </div>
        </div>
      </div>
      {apiKeyRequired && (
        <p className="composer-auth-hint" role="alert">
          {t('composer.apiKeyRequired')}{' '}
          <button
            type="button"
            className="composer-auth-hint-link"
            onClick={() => navigate('/settings', { state: { tab: 'bob' } })}
          >
            {t('composer.apiKeyRequiredLink')}
          </button>
        </p>
      )}
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
