import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import Composer, { resizeComposerTextarea } from './Composer'
import { AppDialogProvider } from '../AppDialog'

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getSkills: vi.fn(),
  getIntegrationStatuses: vi.fn(),
  getMcpServers: vi.fn(),
  getDbConnections: vi.fn(),
  listBobSlashCommands: vi.fn(),
  allowComposerAttachments: vi.fn(),
  startNativeAudioRecording: vi.fn(),
  stopNativeAudioRecording: vi.fn(),
  getNativeAudioRecordingLevel: vi.fn(),
  onDragDropHandler: null as null | ((event: { payload: { type: string; paths?: string[] } }) => void),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }))
vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onDragDropEvent: (handler: typeof mocks.onDragDropHandler) => {
      mocks.onDragDropHandler = handler
      return Promise.resolve(() => {
        mocks.onDragDropHandler = null
      })
    },
  }),
}))
vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))
vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: vi.fn(async (path: string) => ({
    isDirectory: path.endsWith('dossier-projet'),
    size: path.endsWith('.png') ? 2048 : 4096,
  })),
}))
vi.mock('../../lib/ipc', () => ({
  getBobModes: vi.fn().mockResolvedValue([
    { slug: 'agent', name: 'Agent', description: 'Exécuter une tâche', groups: [], builtin: true, source: 'test' },
    { slug: 'plan', name: 'Plan', description: 'Préparer un plan', groups: [], builtin: true, source: 'test' },
  ]),
  getSettings: vi.fn().mockResolvedValue({ defaultMode: 'agent' }),
  getProjects: vi.fn().mockResolvedValue([]),
  getSkills: mocks.getSkills,
  getPlugins: mocks.getPlugins,
  getIntegrationStatuses: mocks.getIntegrationStatuses,
  getMcpServers: mocks.getMcpServers,
  getDbConnections: mocks.getDbConnections,
  listBobSlashCommands: mocks.listBobSlashCommands,
  allowComposerAttachments: mocks.allowComposerAttachments,
  startNativeAudioRecording: mocks.startNativeAudioRecording,
  stopNativeAudioRecording: mocks.stopNativeAudioRecording,
  getNativeAudioRecordingLevel: mocks.getNativeAudioRecordingLevel,
}))

async function renderComposer(props: Partial<ComponentProps<typeof Composer>> = {}) {
  let result: ReturnType<typeof render>
  await act(async () => {
    result = render(<AppDialogProvider><MemoryRouter><Composer showModePill showProjectPill {...props} /></MemoryRouter></AppDialogProvider>)
  })
  return result!
}

describe('Composer popovers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPlugins.mockResolvedValue([])
    mocks.getSkills.mockResolvedValue([])
    mocks.getIntegrationStatuses.mockResolvedValue([])
    mocks.getMcpServers.mockResolvedValue([])
    mocks.getDbConnections.mockResolvedValue([])
    mocks.listBobSlashCommands.mockResolvedValue([
      { name: 'ask', description: 'Ask Bob a question', source: 'fallback' },
      { name: 'code', description: 'Switch to coding mode', source: 'fallback' },
      { name: 'compact', description: 'Compact conversation context', source: 'fallback' },
      { name: 'condense', description: 'Condense conversation context', source: 'fallback' },
      { name: 'copy', description: 'Copy from conversation history', source: 'fallback' },
      { name: 'init', description: 'Initialize project context', source: 'fallback' },
    ])
    mocks.allowComposerAttachments.mockImplementation(async (paths: string[]) => paths)
    mocks.startNativeAudioRecording.mockResolvedValue(undefined)
    mocks.stopNativeAudioRecording.mockResolvedValue({
      id: 'meeting-1',
      createdAt: '2026-08-24T10:00:00Z',
      format: 'm4a/aac',
      recordingPath: '/tmp/meeting.m4a',
      microphonePath: '/tmp/meeting.microphone.m4a',
      systemAudioPath: '/tmp/meeting.system_audio.m4a',
      manifestPath: '/tmp/meeting.recording.json',
      transcriptPath: null,
    })
    mocks.getNativeAudioRecordingLevel.mockResolvedValue(0.5)
  })

  it('grows with multiline content, then scrolls internally at the responsive cap', () => {
    const textarea = document.createElement('textarea')
    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 116 })

    resizeComposerTextarea(textarea, 800)
    expect(textarea.style.height).toBe('116px')
    expect(textarea.style.overflowY).toBe('hidden')

    Object.defineProperty(textarea, 'scrollHeight', { configurable: true, value: 520 })
    resizeComposerTextarea(textarea, 800)
    expect(textarea.style.height).toBe('240px')
    expect(textarea.style.overflowY).toBe('auto')

    resizeComposerTextarea(textarea, 500)
    expect(textarea.style.height).toBe('160px')
    expect(textarea.style.overflowY).toBe('auto')
  })

  it('focuses the textarea again when a new focus request arrives', async () => {
    const view = await renderComposer()
    const textarea = screen.getByRole('textbox')
    const attachButton = screen.getByTitle('Joindre un fichier ou un dossier')
    attachButton.focus()
    expect(attachButton).toHaveFocus()

    await act(async () => {
      view.rerender(
        <AppDialogProvider>
          <MemoryRouter>
            <Composer showModePill showProjectPill focusRequestKey="new-conversation-1" />
          </MemoryRouter>
        </AppDialogProvider>,
      )
    })

    expect(textarea).toHaveFocus()
  })

  it('renders popovers in a portal outside the clipped composer surface', async () => {
    const { container } = await renderComposer()
    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = screen.getByRole('menu', { name: 'Ajouter une pièce jointe' })

    expect(menu).toBeVisible()
    expect(container.querySelector('.composer')?.contains(menu)).toBe(false)
    expect(menu).toHaveClass('composer-floating-popover')
  })

  it('keeps only one composer menu open at a time', async () => {
    await renderComposer()
    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    expect(screen.getByRole('menu', { name: 'Ajouter une pièce jointe' })).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: 'Mode Bob : Agent' }))
    expect(screen.queryByRole('menu', { name: 'Ajouter une pièce jointe' })).not.toBeInTheDocument()
    expect(screen.getByRole('menu', { name: 'Modes Bob' })).toBeVisible()
  })

  it('shows a distinct no-project icon in the project picker', async () => {
    await renderComposer()
    fireEvent.click(screen.getByRole('button', { name: 'Projet' }))
    const option = screen.getByRole('button', { name: 'Sans projet' })
    const icon = screen.getByTestId('no-project-icon')
    expect(option).toContainElement(icon)
    expect(icon.querySelector('circle')).not.toBeNull()
  })

  it('closes the active menu with Escape or an outside click', async () => {
    await renderComposer()
    const modeButton = screen.getByRole('button', { name: 'Mode Bob : Agent' })
    fireEvent.click(modeButton)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(screen.queryByRole('menu', { name: 'Modes Bob' })).not.toBeInTheDocument()

    fireEvent.click(modeButton)
    fireEvent.pointerDown(document.body)
    await waitFor(() => expect(screen.queryByRole('menu', { name: 'Modes Bob' })).not.toBeInTheDocument())
  })

  it('keeps the prompt editable while busy and exposes separate queue and stop actions', async () => {
    const onSend = vi.fn()
    const onStop = vi.fn()
    await renderComposer({ busy: true, queueCount: 2, onSend, onStop })

    const input = screen.getByRole('textbox')
    expect(input).toBeEnabled()
    fireEvent.change(input, { target: { value: 'À exécuter ensuite' } })
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter le prompt à la file' }))

    expect(onSend).toHaveBeenCalledWith('À exécuter ensuite', 'agent', [], undefined)
    expect(screen.getByTitle('Ajouter à la file (2 en attente)')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Arrêter l’exécution active' }))
    expect(onStop).toHaveBeenCalledOnce()
  })

  it('démarre une capture native légère puis joint le M4A finalisé au STOP', async () => {
    await renderComposer()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: 'Résume cette réunion' } })

    fireEvent.click(screen.getByRole('button', { name: 'Enregistrer le micro et l’audio système' }))
    await waitFor(() => expect(mocks.startNativeAudioRecording).toHaveBeenCalledOnce())
    const stop = screen.getByRole('button', { name: 'Arrêter l’enregistrement audio' })
    expect(stop).toHaveAttribute('aria-pressed', 'true')
    expect(input).toHaveValue('Résume cette réunion')
    expect(screen.getByRole('button', { name: 'Envoyer le prompt' })).toBeDisabled()

    fireEvent.click(stop)
    await waitFor(() => expect(mocks.stopNativeAudioRecording).toHaveBeenCalledOnce())
    await waitFor(() => expect(mocks.allowComposerAttachments).toHaveBeenCalledWith(['/tmp/meeting.m4a']))
    expect(await screen.findByText('meeting.m4a')).toBeVisible()
    expect(input).toHaveValue('Résume cette réunion')
  })

  it('joint plusieurs fichiers, déduplique les chemins et transmet les pièces jointes', async () => {
    const onSend = vi.fn()
    vi.mocked(open).mockResolvedValue(['/tmp/rapport.pdf', '/tmp/tableau.xlsx', '/tmp/rapport.pdf'])
    await renderComposer({ onSend })

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    fireEvent.click(screen.getByRole('button', { name: /Fichier\(s\)/ }))
    await waitFor(() => expect(screen.getByText('rapport.pdf')).toBeVisible())
    expect(screen.getByText('tableau.xlsx')).toBeVisible()
    expect(screen.getByText('PDF')).toBeVisible()
    expect(screen.getByText('XLSX')).toBeVisible()
    expect(screen.getAllByRole('button', { name: 'Retirer' })).toHaveLength(2)

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Analyse les pièces jointes' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer le prompt' }))
    expect(onSend).toHaveBeenCalledWith(
      'Analyse les pièces jointes',
      'agent',
      ['/tmp/rapport.pdf', '/tmp/tableau.xlsx'],
      undefined,
    )
  })

  it('joint un dossier et permet de retirer la pièce jointe avant envoi', async () => {
    vi.mocked(open).mockResolvedValue('/tmp/dossier-projet')
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    fireEvent.click(screen.getByRole('button', { name: /Dossier/ }))
    await waitFor(() => expect(screen.getByText('dossier-projet')).toBeVisible())
    fireEvent.click(screen.getByRole('button', { name: 'Retirer' }))
    expect(screen.queryByText('dossier-projet')).not.toBeInTheDocument()
  })

  it('accepte le drag & drop natif Tauri avec chemins absolus', async () => {
    await renderComposer()
    await waitFor(() => expect(mocks.onDragDropHandler).toBeTypeOf('function'))

    await act(async () => {
      mocks.onDragDropHandler?.({ payload: { type: 'enter', paths: [] } })
      mocks.onDragDropHandler?.({
        payload: { type: 'drop', paths: ['/tmp/photo.png', '/tmp/note.txt'] },
      })
    })

    await waitFor(() => expect(screen.getByRole('img', { name: 'photo.png' })).toBeVisible())
    expect(screen.getByText('note.txt')).toBeVisible()
    expect(mocks.allowComposerAttachments).toHaveBeenCalledWith(['/tmp/photo.png', '/tmp/note.txt'])
  })

  it('accepte le drag & drop HTML avec chemins injectés par Tauri', async () => {
    await renderComposer()
    const composer = document.querySelector('.composer')
    expect(composer).toBeTruthy()

    fireEvent.dragEnter(composer!)
    expect(composer).toHaveClass('composer-dragging')
    expect(screen.getByText('Déposer pour joindre au prompt')).toBeVisible()
    expect(document.querySelector('.composer-drag-overlay')).toBeNull()

    const file = new File(['hello'], 'hello.pdf', { type: 'application/pdf' })
    Object.defineProperty(file, 'path', { value: '/tmp/hello.pdf' })

    fireEvent.drop(composer!, {
      dataTransfer: { files: [file] },
    })

    expect(composer).not.toHaveClass('composer-dragging')
    await waitFor(() => expect(screen.getByText('hello.pdf')).toBeVisible())
    expect(screen.getByText('PDF')).toBeVisible()
  })

  it('sélectionne un skill activé depuis le bouton plus et l’ajoute au prompt', async () => {
    mocks.getSkills.mockResolvedValue([{
      slug: 'bob-work-github',
      name: 'GitHub',
      description: 'Utiliser gh et GH_TOKEN localement.',
      content: 'Instructions…',
      sourcePath: '/tmp/.bob/skills/bob-work-github/SKILL.md',
      scope: 'global-bob',
      enabled: true,
      builtin: true,
    }])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = screen.getByRole('menu', { name: 'Ajouter une pièce jointe' })
    expect(menu).toHaveTextContent('Skills')
    expect(menu).toHaveTextContent('Intégré')
    fireEvent.click(screen.getByRole('button', { name: /GitHub/ }))

    expect(screen.getByRole('textbox')).toHaveValue('@skill:bob-work-github ')
    expect(screen.queryByRole('menu', { name: 'Ajouter une pièce jointe' })).not.toBeInTheDocument()
  })

  it('sélectionne un plugin activé depuis le bouton plus et l’ajoute au prompt', async () => {
    mocks.getPlugins.mockResolvedValue([{
      id: 'plugin-cloud-architect', name: 'Cloud Architect', version: '1.0.0',
      description: 'Analyse une architecture cloud.', scope: 'personal', category: 'executable',
      manifest: {}, installState: 'installed', validationState: 'valid',
      createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
    }])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = screen.getByRole('menu', { name: 'Ajouter une pièce jointe' })
    expect(menu).toHaveTextContent('Plugins & modes de travail')
    fireEvent.click(screen.getByRole('button', { name: /Cloud Architect/ }))

    expect(screen.getByRole('textbox')).toHaveValue('@plugin:plugin-cloud-architect ')
    expect(screen.queryByRole('menu', { name: 'Ajouter une pièce jointe' })).not.toBeInTheDocument()
  })

  it('affiche plusieurs chips plugins côte à côte dans le preview', async () => {
    mocks.getPlugins.mockResolvedValue([
      {
        id: 'bob-work-ibm-pursuit', name: 'Brief Mission IBM', version: '1.0.0',
        description: 'Brief atelier', scope: 'personal', category: 'executable',
        manifest: { specializedMode: { label: 'Mode Brief' } }, installState: 'installed', validationState: 'valid',
        createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
      },
      {
        id: 'bob-work-cto-invest', name: 'CTO Investissements', version: '1.0.0',
        description: 'Screening CTO', scope: 'personal', category: 'executable',
        manifest: { specializedMode: { label: 'Mode CTO' } }, installState: 'installed', validationState: 'valid',
        createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
      },
    ])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    fireEvent.click(screen.getByRole('button', { name: /Brief Mission IBM/ }))
    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    fireEvent.click(screen.getByRole('button', { name: /CTO Investissements/ }))

    expect(screen.getByRole('textbox')).toHaveValue('@plugin:bob-work-ibm-pursuit @plugin:bob-work-cto-invest ')
    const chips = screen.getByLabelText('Composants du prompt')
    expect(chips).toHaveTextContent('Brief Mission IBM')
    expect(chips).toHaveTextContent('CTO Investissements')
    expect(chips.querySelectorAll('.composer-mention-chip')).toHaveLength(2)

    fireEvent.click(screen.getByRole('button', { name: 'Retirer Brief Mission IBM' }))
    expect(screen.getByRole('textbox')).toHaveValue('@plugin:bob-work-cto-invest ')
    expect(screen.getByLabelText('Composants du prompt').querySelectorAll('.composer-mention-chip')).toHaveLength(1)
  })

  it('montre le badge Intégré pour Computer Use en skill et en plugin', async () => {
    mocks.getSkills.mockResolvedValue([{
      slug: 'bob-work-computer-use',
      name: 'Computer Use',
      description: 'Contrôle local du Mac.',
      content: '…',
      sourcePath: '/tmp/.bob/skills/bob-work-computer-use/SKILL.md',
      scope: 'global-bob',
      enabled: true,
    }])
    mocks.getPlugins.mockResolvedValue([{
      id: 'builtin-computer-use', name: 'Computer Use', version: '1.0.0',
      description: 'Contrôle local du Mac.', scope: 'personal', category: 'executable',
      manifest: { builtin: true, slug: 'bob-work-computer-use', icon: 'computer' },
      installState: 'installed', validationState: 'valid',
      createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
    }])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = screen.getByRole('menu', { name: 'Ajouter une pièce jointe' })
    expect(menu.querySelectorAll('.skill-builtin-badge').length).toBeGreaterThanOrEqual(2)
    expect(menu).toHaveTextContent('Computer Use')
  })

  it('explique clairement quand aucun plugin n’est activé', async () => {
    await renderComposer()
    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))

    expect(screen.getByText('Aucun skill activé.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Gérer les skills' })).toBeVisible()
    expect(screen.getByText('Aucun plugin activé.')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Gérer les plugins' })).toBeVisible()
  })

  it('liste les intégrations MCP connectées dans le menu plus', async () => {
    mocks.getIntegrationStatuses.mockResolvedValue([{
      integrationId: 'github',
      connected: true,
      authMethod: 'oauth',
      accountLabel: 'akedidi',
      expiresAt: null,
      oauthClientConfigured: false,
      deviceFlowAvailable: true,
      scopeSatisfied: true,
    }])
    mocks.getMcpServers.mockResolvedValue([
      {
        name: 'bob-work-github',
        transport: 'stdio',
        commandOrUrl: 'python3',
        args: ['github_server.py'],
        enabled: true,
        status: 'ready',
        raw: {},
      },
      {
        name: 'mcp-custom-hub',
        transport: 'stdio',
        commandOrUrl: 'python3',
        args: ['hub.py'],
        enabled: true,
        status: 'ready',
        raw: {},
      },
    ])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = await screen.findByRole('menu', { name: 'Ajouter une pièce jointe' })
    expect(menu).toHaveTextContent('Intégrations MCP')
    expect(menu).toHaveTextContent('GitHub')
    expect(menu).toHaveTextContent('mcp-custom-hub')
    const githubRow = screen.getByRole('button', { name: /GitHub/ })
    expect(githubRow.querySelector('.attach-row-icon')).toBeTruthy()
    expect(githubRow.querySelector('.attach-plugin-copy')?.textContent).toContain('GitHub')
    expect(githubRow.querySelector('.attach-row-action')).toBeTruthy()

    fireEvent.click(githubRow)
    expect(screen.getByRole('textbox')).toHaveValue('@skill:bob-work-github ')
  })

  it('shows Plugins before Skills in one shared scroll body', async () => {
    mocks.getSkills.mockResolvedValue(Array.from({ length: 12 }, (_, index) => ({
      slug: `skill-${index}`,
      name: `Skill ${index}`,
      description: `Description ${index}`,
      content: '',
      sourcePath: '',
      scope: 'global-bob',
      enabled: true,
    })))
    mocks.getPlugins.mockResolvedValue([{
      id: 'plugin-cloud-architect', name: 'Cloud Architect', version: '1.0.0',
      description: 'Analyse une architecture cloud.', scope: 'personal', category: 'executable',
      manifest: {}, installState: 'installed', validationState: 'valid',
      createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
    }])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = screen.getByRole('menu', { name: 'Ajouter une pièce jointe' })
    const scrollBody = menu.querySelector('.attach-popover-scroll')
    expect(scrollBody).toBeTruthy()
    expect(scrollBody?.textContent).toContain('Cloud Architect')
    expect(scrollBody?.textContent).toContain('Skill 0')
    expect(scrollBody?.textContent?.indexOf('Plugins & modes de travail')).toBeLessThan(scrollBody?.textContent?.indexOf('Skills (instructions)') ?? -1)
    expect(scrollBody).toHaveTextContent('Capacités complètes pouvant inclure des outils, des runtimes et des instructions.')
    expect(scrollBody).toHaveTextContent('Instructions qui guident Bob ; elles peuvent être fournies par un plugin.')
    expect(screen.getByRole('button', { name: /Plugin Cloud Architect/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Skill Skill 0/ })).toBeInTheDocument()
    expect(menu.querySelector('.attach-popover-header')?.textContent).toContain('Fichier')
    expect(menu.querySelectorAll('input.popover-search')).toHaveLength(1)
  })

  it('place visiblement le focus dans la recherche à l’ouverture du catalogue', async () => {
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))

    const search = screen.getByRole('textbox', { name: 'Rechercher un skill, plugin ou intégration…' })
    await waitFor(() => expect(search).toHaveFocus())
    expect(search).toHaveClass('popover-search')
  })

  it('filtre skills, plugins et intégrations avec un seul champ de recherche', async () => {
    mocks.getSkills.mockResolvedValue([{
      slug: 'bob-work-github',
      name: 'GitHub',
      description: 'Utiliser gh et GH_TOKEN localement.',
      content: 'Instructions…',
      sourcePath: '/tmp/.bob/skills/bob-work-github/SKILL.md',
      scope: 'global-bob',
      enabled: true,
      builtin: true,
    }])
    mocks.getPlugins.mockResolvedValue([{
      id: 'plugin-cloud-architect', name: 'Cloud Architect', version: '1.0.0',
      description: 'Analyse une architecture cloud.', scope: 'personal', category: 'executable',
      manifest: {}, installState: 'installed', validationState: 'valid',
      createdAt: '2026-08-09T00:00:00Z', updatedAt: '2026-08-09T00:00:00Z',
    }])
    mocks.getIntegrationStatuses.mockResolvedValue([{
      integrationId: 'slack',
      connected: true,
      authMethod: 'oauth',
      accountLabel: 'bob',
      expiresAt: null,
      oauthClientConfigured: false,
      deviceFlowAvailable: true,
      scopeSatisfied: true,
    }])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = screen.getByRole('menu', { name: 'Ajouter une pièce jointe' })
    const search = screen.getByRole('textbox', { name: 'Rechercher un skill, plugin ou intégration…' })
    expect(menu.querySelectorAll('input.popover-search')).toHaveLength(1)
    expect(menu).toHaveTextContent('Cloud Architect')
    expect(menu).toHaveTextContent('GitHub')
    expect(menu).toHaveTextContent('Slack')

    fireEvent.change(search, { target: { value: 'Cloud' } })
    expect(menu).toHaveTextContent('Cloud Architect')
    expect(menu).toHaveTextContent('Aucun skill correspondant.')
    expect(menu).toHaveTextContent('Aucune intégration MCP correspondante.')
    expect(screen.queryByRole('button', { name: /GitHub/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Slack/ })).not.toBeInTheDocument()

    fireEvent.change(search, { target: { value: 'git' } })
    expect(menu).toHaveTextContent('GitHub')
    expect(menu).toHaveTextContent('Aucun plugin correspondant.')
    expect(screen.queryByRole('button', { name: /Cloud Architect/ })).not.toBeInTheDocument()
  })

  it('sélectionne une connexion DB depuis le bouton plus et affiche la puce @db:', async () => {
    mocks.getDbConnections.mockResolvedValue([{
      id: 'db-1',
      name: 'sales',
      engine: 'sqlite',
      config: { filePath: '/tmp/sales.sqlite' },
      hasSecret: false,
      enabled: true,
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    }])
    await renderComposer()

    fireEvent.click(screen.getByTitle('Joindre un fichier ou un dossier'))
    const menu = await screen.findByRole('menu', { name: 'Ajouter une pièce jointe' })
    expect(menu).toHaveTextContent('Bases de données')
    const dbRow = await screen.findByRole('button', { name: /sales/ })
    expect(dbRow.querySelector('.attach-row-icon')).toBeTruthy()
    expect(dbRow.querySelector('.attach-plugin-copy')?.textContent).toContain('sales')
    expect(dbRow.querySelector('.attach-row-action')).toBeTruthy()
    fireEvent.click(dbRow)

    expect(screen.getByRole('textbox')).toHaveValue('@db:sales ')
    const chips = screen.getByLabelText('Composants du prompt')
    expect(chips).toHaveTextContent('sales')
    expect(chips.querySelectorAll('.composer-mention-chip')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Retirer sales' }))
    expect(screen.getByRole('textbox')).toHaveValue('')
  })

  it('propose @db:sales dans l’autocomplétion @', async () => {
    mocks.getDbConnections.mockResolvedValue([{
      id: 'db-1',
      name: 'sales',
      engine: 'postgresql',
      config: { host: 'localhost', port: 5432 },
      hasSecret: true,
      enabled: true,
      createdAt: '2026-08-28T00:00:00Z',
      updatedAt: '2026-08-28T00:00:00Z',
    }])
    await renderComposer()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '@sa' } })
    expect(await screen.findByText('Ajouter au prompt')).toBeVisible()
    fireEvent.click(screen.getByRole('option', { name: /sales/ }))
    expect(screen.getByRole('textbox')).toHaveValue('@db:sales ')
  })
})

describe('Composer slash autocomplete', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getPlugins.mockResolvedValue([])
    mocks.getSkills.mockResolvedValue([])
    mocks.getIntegrationStatuses.mockResolvedValue([])
    mocks.getMcpServers.mockResolvedValue([])
    mocks.getDbConnections.mockResolvedValue([])
    mocks.listBobSlashCommands.mockResolvedValue([
      { name: 'ask', description: 'Ask Bob a question', source: 'fallback' },
      { name: 'code', description: 'Switch to coding mode', source: 'fallback' },
      { name: 'compact', description: 'Compact conversation context', source: 'fallback' },
      { name: 'condense', description: 'Condense conversation context', source: 'fallback' },
      { name: 'copy', description: 'Copy from conversation history', source: 'fallback' },
      { name: 'init', description: 'Initialize project context', source: 'fallback' },
    ])
    mocks.allowComposerAttachments.mockImplementation(async (paths: string[]) => paths)
  })

  it('shows native Bob commands when the user types /', async () => {
    await renderComposer()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/' } })
    expect(await screen.findByText('Commandes Bob')).toBeVisible()
    expect(screen.getByRole('option', { name: /\/condense/i })).toBeVisible()
    expect(screen.getByRole('option', { name: /\/code/i })).toBeVisible()
  })

  it('filters /co to code, compact, condense and copy', async () => {
    await renderComposer()
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '/co' } })
    await screen.findByText('Commandes Bob')
    expect(screen.getByRole('option', { name: /\/code/i })).toBeVisible()
    expect(screen.getByRole('option', { name: /\/condense/i })).toBeVisible()
    expect(screen.getByRole('option', { name: /\/compact/i })).toBeVisible()
    expect(screen.queryByRole('option', { name: /\/init/i })).not.toBeInTheDocument()
  })

  it('inserts the highlighted command on Enter without sending', async () => {
    const onSend = vi.fn()
    await renderComposer({ onSend })
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '/co' } })
    await screen.findByText('Commandes Bob')
    fireEvent.keyDown(input, { key: 'Enter' })
    expect(input).toHaveValue('/code ')
    expect(onSend).not.toHaveBeenCalled()
  })

  it('closes the list on Escape and keeps the typed text', async () => {
    await renderComposer()
    const input = screen.getByRole('textbox')
    fireEvent.change(input, { target: { value: '/co' } })
    await screen.findByText('Commandes Bob')
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(screen.queryByText('Commandes Bob')).not.toBeInTheDocument()
    expect(input).toHaveValue('/co')
  })
})
