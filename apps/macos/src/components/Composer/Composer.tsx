import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { open } from '@tauri-apps/plugin-dialog'
import { getBobModes, getPlugins, getProjects, getSkills } from '../../lib/ipc'
import type { BobMode, Plugin, Project, WorkspaceSkill } from '@bob-work/shared-types'
import { PluginIcon, resolvePluginIcon } from '../PluginIcon'
import { File as FileIcon, Folder as FolderIcon, X } from 'lucide-react'
import { convertFileSrc } from '@tauri-apps/api/core'
import { stat } from '@tauri-apps/plugin-fs'

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

function AttachmentPreview({ path, onRemove }: { path: string; onRemove: () => void }) {
  const [isDir, setIsDir] = useState(false)
  
  useEffect(() => {
    stat(path).then(info => {
      setIsDir(info.isDirectory)
    }).catch(() => {})
  }, [path])

  const name = path.split('/').pop() || path
  const isImage = /\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)

  return (
    <div className="relative group flex flex-col items-center justify-center p-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] shadow-sm" style={{ width: 68, height: 68 }} title={path}>
      {isImage ? (
        <img src={convertFileSrc(path)} alt={name} className="w-9 h-9 object-cover rounded shadow-sm mb-1" />
      ) : isDir ? (
        <FolderIcon className="w-8 h-8 text-blue-500 mb-1" strokeWidth={1.5} />
      ) : (
        <FileIcon className="w-8 h-8 text-gray-400 mb-1" strokeWidth={1.5} />
      )}
      <span className="text-[10px] truncate w-full text-center font-medium text-[var(--text-secondary)] leading-tight">{name}</span>
      <button 
        aria-label="Retirer"
        className="absolute -top-2 -right-2 bg-[var(--text-secondary)] text-[var(--bg-surface)] rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-[var(--text-primary)]"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onRemove(); }}
      >
        <X size={12} strokeWidth={2.5} />
      </button>
    </div>
  )
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
    setAttachments(current => Array.from(new Set([...current, ...paths])))
  }

  const chooseFolder = async () => {
    setAttachMenu(false)
    const selected = await open({ multiple: false, directory: true, title: 'Joindre un dossier' })
    if (typeof selected === 'string') setAttachments(current => Array.from(new Set([...current, selected])))
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
    const mentionValue = `@plugin:${plugin.id}`
    setText(current => {
      if (current.includes(mentionValue)) return current
      const separator = current.length > 0 && !current.endsWith(' ') ? ' ' : ''
      return `${current}${separator}${mentionValue} `
    })
    setAttachMenu(false)
    setPluginSearch('')
    window.requestAnimationFrame(() => taRef.current?.focus())
  }

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
        className={`composer ${isDragging ? 'ring-2 ring-indigo-500/50 bg-indigo-50/50 dark:bg-indigo-900/20' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setIsDragging(false); }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          const files = Array.from(e.dataTransfer.files);
          // @ts-expect-error path is injected by Tauri Webview
          const paths = files.map(f => f.path).filter(Boolean);
          if (paths.length > 0) {
            setAttachments(current => Array.from(new Set([...current, ...paths])));
          } else {
             const names = files.map(f => f.name).filter(Boolean);
             if (names.length > 0) setAttachments(current => Array.from(new Set([...current, ...names])));
          }
        }}
      >
        {attachments.length > 0 && (
          <div className="composer-attachments flex flex-wrap gap-3 p-3">
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
