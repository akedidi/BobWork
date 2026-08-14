import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { ComponentProps } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import Composer from './Composer'
import { AppDialogProvider } from '../AppDialog'

const mocks = vi.hoisted(() => ({
  getPlugins: vi.fn(),
  getSkills: vi.fn(),
  getIntegrationStatuses: vi.fn(),
  getMcpServers: vi.fn(),
  allowComposerAttachments: vi.fn(),
  getVoiceDictationAvailability: vi.fn(),
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
  allowComposerAttachments: mocks.allowComposerAttachments,
  getVoiceDictationAvailability: mocks.getVoiceDictationAvailability,
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
    mocks.allowComposerAttachments.mockImplementation(async (paths: string[]) => paths)
    mocks.getVoiceDictationAvailability.mockResolvedValue({ available: true, reason: null })
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

  it('bloque la dictée dans un binaire sans bundle avant l’appel WebKit', async () => {
    const recognition = vi.fn()
    Object.defineProperty(window, 'webkitSpeechRecognition', {
      configurable: true,
      value: recognition,
    })
    mocks.getVoiceDictationAvailability.mockResolvedValue({
      available: false,
      reason: 'requires_app_bundle',
    })
    await renderComposer()

    fireEvent.click(screen.getByTitle('Dictée Apple'))

    await waitFor(() => expect(mocks.getVoiceDictationAvailability).toHaveBeenCalledOnce())
    expect(recognition).not.toHaveBeenCalled()
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('véritable application Bob Work')
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

    fireEvent.click(screen.getByRole('button', { name: /GitHub/ }))
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
    expect(menu.querySelector('.attach-popover-header')?.textContent).toContain('Fichier')
  })
})
