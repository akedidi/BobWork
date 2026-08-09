import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { allowComposerAttachments, getBobModes, getPlugins, getProjects, getSkills } from '../../lib/ipc'
import type { BobMode, Plugin, Project, WorkspaceSkill } from '@bob-work/shared-types'
import { PluginIcon, resolvePluginIcon } from '../PluginIcon'
import AttachmentPreview from './AttachmentPreview'
import { mergeAttachmentPaths, getSuggestedBuiltinPluginId, getActivePluginMention } from './composerAttachments'

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
  placeholder = 'Demandez quelque chose…', showProjectPill, showModePill,
  onSend, onStop, disabled, busy = false, queueCount = 0, initialProjectId,
}: Props) {
  const [text, setText] = useState('')
  const [mode, setMode] = useState('agent')
  const [modes, setModes] = useState<BobMode[]>(BUILTIN_MODES)
  const [projects, setProjects] = useState<Project[]>([])
  const [projectId, setProjectId] = useState<string | undefined>(initialProjectId)
  const [skills, setSkills] = useState<WorkspaceSkill[]>([])
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [attachments, setAttachments] = useState<string[]>([])
  const [attachMenu, setAttachMenu] = useState(false)
  const [pluginSearch, setPluginSearch] = useState('')
  const [skillSearch, setSkillSearch] = useState('')
  const [modeMenu, setModeMenu] = useState(false)
  const [modeSearch, setModeSearch] = useState('')
  const [projectMenu, setProjectMenu] = useState(false)
  const [listening, setListening] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const attachButtonRef = useRef<HTMLButtonElement>(null)
  const projectButtonRef = useRef<HTMLButtonElement>(null)
  const modeButtonRef = useRef<HTMLButtonElement>(null)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)
  const navigate = useNavigate()
  const [isDragging, setIsDragging] = useState(false)
  const dragDepthRef = useRef(0)

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
    Promise.all([
      getBobModes().catch(() => BUILTIN_MODES),
      getProjects().catch(() => []),
      getSkills().catch(() => []),
      getPlugins().catch(() => []),
    ]).then(([detectedModes, detectedProjects, detectedSkills, detectedPlugins]) => {
      if (detectedModes.length) setModes(detectedModes)
      setProjects(detectedProjects.filter(project => !project.archived))
      setSkills(detectedSkills.filter(skill => skill.enabled))
      setPlugins(detectedPlugins.filter(plugin => plugin.installState === 'installed'))
    })
  }, [])

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
    const selected = await open({ multiple: true, directory: false, title: 'Joindre des fichiers' })
    if (!selected) return
    const paths = Array.isArray(selected) ? selected : [selected]
    addAttachmentPaths(paths)
  }

  const chooseFolder = async () => {
    setAttachMenu(false)
    const selected = await open({ multiple: false, directory: true, title: 'Joindre un dossier' })
    if (typeof selected === 'string') addAttachmentPaths([selected])
  }

  const toggleDictation = () => {
    if (listening) {
      recognitionRef.current?.stop()
      return
    }
    const SpeechRecognition = (window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike
      webkitSpeechRecognition?: new () => SpeechRecognitionLike
    }).SpeechRecognition ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionLike }).webkitSpeechRecognition
    if (!SpeechRecognition) {
      alert('La dictée Apple n’est pas disponible dans cette version de WebKit. Activez la dictée macOS ou utilisez le collage vocal.')
      return
    }
    const recognition = new SpeechRecognition()
    recognition.lang = navigator.language || 'fr-FR'
    recognition.interimResults = true
    recognition.continuous = false
    let finalTranscript = ''
    recognition.onresult = event => {
      let interim = ''
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index]
        if (result.isFinal) finalTranscript += result[0].transcript
        else interim += result[0].transcript
      }
      setText(current => `${current}${current && !current.endsWith(' ') ? ' ' : ''}${finalTranscript || interim}`)
    }
    recognition.onend = () => setListening(false)
    recognition.onerror = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }

  const selectedProject = projects.find(project => project.id === projectId)
  const capabilityFilter = selectedProject?.allowedPlugins ?? []
  const allowedSkills = capabilityFilter.length === 0 ? skills : skills.filter(skill => capabilityFilter.includes(`skill:${skill.slug}`))
  const allowedPlugins = capabilityFilter.length === 0 ? plugins : plugins.filter(plugin => capabilityFilter.includes(plugin.id))
  const mention = text.match(/(?:^|\s)@([\w-]*)$/)?.[1]?.toLowerCase()
  const mentionItems = mention === undefined ? [] : [
    ...allowedSkills.map(skill => ({ id: `skill:${skill.slug}`, label: skill.name, subtitle: 'Skill', insert: `@skill:${skill.slug} ` })),
    ...allowedPlugins.map(plugin => ({ id: `plugin:${plugin.id}`, label: plugin.name, subtitle: 'Plugin', insert: `@plugin:${plugin.id} ` })),
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
  }

  const selectSkill = (skill: WorkspaceSkill) => {
    insertSkillMention(skill.slug)
    setAttachMenu(false)
    setPluginSearch('')
    setSkillSearch('')
  }

  const visibleSkills = useMemo(() => {
    const query = skillSearch.trim().toLocaleLowerCase()
    if (!query) return allowedSkills
    return allowedSkills.filter(skill =>
      `${skill.name} ${skill.description ?? ''} ${skill.slug}`.toLocaleLowerCase().includes(query),
    )
  }, [allowedSkills, skillSearch])

  const visiblePlugins = useMemo(() => {
    const query = pluginSearch.trim().toLocaleLowerCase()
    if (!query) return allowedPlugins
    return allowedPlugins.filter(plugin => `${plugin.name} ${plugin.description ?? ''}`.toLocaleLowerCase().includes(query))
  }, [allowedPlugins, pluginSearch])

  const filteredModes = useMemo(() => {
    const query = modeSearch.trim().toLowerCase()
    if (!query) return modes
    return modes.filter(item => item.name.toLowerCase().includes(query) || item.slug.includes(query) || item.description?.toLowerCase().includes(query))
  }, [modeSearch, modes])
  const selectedMode = modes.find(item => item.slug === mode) ?? BUILTIN_MODES[0]
  const activePluginId = getActivePluginMention(text)
  const activePlugin = plugins.find(plugin => plugin.id === activePluginId)

  return (
    <div ref={rootRef} className="composer-root">
      {isDragging && createPortal(
        <div className="composer-drag-overlay" aria-hidden="true">
          <div className="composer-drag-overlay-inner">
            <span className="composer-drag-overlay-icon">+</span>
            <strong>Déposer les fichiers ici</strong>
            <span>Images, documents, dossiers…</span>
          </div>
        </div>,
        document.body,
      )}
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
        {activePlugin && (
          <div className="composer-active-plugin" aria-label={`Mode spécialisé ${activePlugin.name}`}>
            <PluginIcon icon={resolvePluginIcon(activePlugin)} size="sm" className="composer-active-plugin-icon" />
            <span className="composer-active-plugin-copy">
              <strong>{activePlugin.name}</strong>
              <small>Mode spécialisé · analyse locale</small>
            </span>
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
          placeholder={placeholder}
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
                <div className="composer-popover-title">Ajouter</div>
                <button className="composer-popover-row" onClick={chooseFiles}>📄 Fichier(s)</button>
                <button className="composer-popover-row" onClick={chooseFolder}>📁 Dossier</button>
                <div className="composer-popover-separator" />
                <div className="composer-popover-title">Skills</div>
                {allowedSkills.length > 0 ? <>
                  <input
                    value={skillSearch}
                    onChange={event => setSkillSearch(event.target.value)}
                    placeholder="Rechercher un skill…"
                    aria-label="Rechercher un skill à ajouter"
                    className="popover-search"
                  />
                  <div className="attach-plugin-list">
                    {visibleSkills.length > 0 ? visibleSkills.map(skill => (
                      <button className="composer-popover-row attach-plugin-row" key={`${skill.scope}:${skill.slug}`} onClick={() => selectSkill(skill)}>
                        <span className="attach-skill-icon" aria-hidden="true">✦</span>
                        <span className="attach-plugin-copy"><strong>{skill.name}</strong><small>{skill.description || 'Skill activé'}</small></span>
                        <span aria-hidden="true">+</span>
                      </button>
                    )) : <p className="composer-popover-empty">Aucun skill correspondant.</p>}
                  </div>
                </> : <p className="composer-popover-empty">Aucun skill activé{selectedProject ? ' pour ce projet' : ''}.</p>}
                <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/extensions') }}>Gérer les skills</button>
                <div className="composer-popover-separator" />
                <div className="composer-popover-title">Plugins</div>
                {allowedPlugins.length > 0 ? <>
                  <input
                    value={pluginSearch}
                    onChange={event => setPluginSearch(event.target.value)}
                    placeholder="Rechercher un plugin…"
                    aria-label="Rechercher un plugin à ajouter"
                    className="popover-search"
                  />
                  <div className="attach-plugin-list">
                    {visiblePlugins.length > 0 ? visiblePlugins.map(plugin => (
                      <button className="composer-popover-row attach-plugin-row" key={plugin.id} onClick={() => selectPlugin(plugin)}>
                        <PluginIcon icon={resolvePluginIcon(plugin)} size="sm" className="attach-plugin-icon" />
                        <span className="attach-plugin-copy"><strong>{plugin.name}</strong><small>{plugin.description || 'Plugin activé'}</small></span>
                        <span aria-hidden="true">+</span>
                      </button>
                    )) : <p className="composer-popover-empty">Aucun plugin correspondant.</p>}
                  </div>
                </> : <p className="composer-popover-empty">Aucun plugin activé{selectedProject ? ' pour ce projet' : ''}.</p>}
                <button className="composer-popover-manage" onClick={() => { setAttachMenu(false); navigate('/plugins') }}>Gérer les plugins</button>
              </ComposerPopover>
            )}
          </div>

          <button className={`icon-btn ${listening ? 'recording' : ''}`} title="Dictée Apple" onClick={toggleDictation}>
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
                  <input autoFocus value={modeSearch} onChange={event => setModeSearch(event.target.value)} placeholder="Rechercher un mode…" className="popover-search" />
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
            aria-label={busy ? 'Ajouter le prompt à la file' : 'Envoyer le prompt'}
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
