import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationInteractionCard, MessageBubble, interactionFromActivity, normalizeAssistantMarkdown } from './ChatView'
import { setTestLocale } from '../i18n'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

vi.mock('@tauri-apps/plugin-fs', () => ({
  stat: vi.fn(async (path: string) => {
    if (path.includes('.bob-sandbox-ui-probe.txt')) {
      throw new Error('ENOENT')
    }
    // Simulate missing FS scope on Application Support (production capability gap).
    if (path.includes('Application Support')) {
      throw new Error('path not allowed on the configured scope')
    }
    if (path.includes('missing-file')) {
      throw new Error('ENOENT')
    }
    return { isFile: true, isDirectory: false, size: 12 }
  }),
}))

vi.mock('../lib/ipc', async () => {
  const actual = await vi.importActual<typeof import('../lib/ipc')>('../lib/ipc')
  return {
    ...actual,
    prepareFilePreview: vi.fn(async (path: string) => {
      if (path.includes('missing') || path.includes('mainIBM') || path.includes('startedIBM')) {
        throw new Error('ENOENT')
      }
      return {
        path,
        name: path.split('/').pop() || 'file',
        kind: path.toLowerCase().endsWith('.pdf') ? 'pdf' : 'file',
        mimeType: path.toLowerCase().endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream',
        size: 12,
        previewPath: path,
        previewPaths: [],
      }
    }),
  }
})

vi.mock('../components/FittedHtmlFrame', () => ({
  FittedHtmlFrame: ({ src, title }: { src: string; title: string }) => (
    <div data-testid="inline-html-preview" data-src={src}>{title}</div>
  ),
  openHtmlPreviewExternally: vi.fn(),
}))

vi.mock('../components/PdfViewer/PdfViewer', () => ({
  PdfViewer: ({ path, title }: { path: string; title: string }) => <div data-testid="native-pdf" data-path={path}>{title}</div>,
}))

describe('MessageBubble', () => {
  beforeEach(() => setTestLocale('fr'))
  afterEach(() => {
    setTestLocale(null)
    vi.useRealTimers()
  })

  it('intègre les PDF produits par Bob dans le lecteur de la conversation', async () => {
    render(<MessageBubble msg={{
      id: 'generated-pdf', role: 'assistant', content: 'Document prêt.',
      ts: '2026-09-08T12:00:00Z', state: 'done',
      sources: [{ id: 'pdf', title: 'Rapport.pdf', path: '/tmp/Rapport.pdf' }],
    }} onOpenResource={vi.fn()} />)
    await waitFor(() => {
      expect(screen.getByTestId('native-pdf')).toHaveAttribute('data-path', '/tmp/Rapport.pdf')
      expect(screen.getByLabelText('PDF générés')).toBeVisible()
    })
  })

  it('n’affiche pas les aperçus PDF pour des chemins inventés absents du disque', async () => {
    render(<MessageBubble msg={{
      id: 'phantom-pdfs',
      role: 'assistant',
      content: [
        'Livrables :',
        '/tmp/Guide_installation_prise_en_mainIBM_Bob_Work_v2.pdf',
        '/tmp/Guide_installation_prise_en_main_IBM_Bob_Work_v2.pdf',
      ].join('\n'),
      ts: '2026-09-14T22:45:00Z',
      state: 'done',
      sources: [
        { id: 'bad', title: 'Guide_installation_prise_en_mainIBM_Bob_Work_v2.pdf', path: '/tmp/Guide_installation_prise_en_mainIBM_Bob_Work_v2.pdf' },
        { id: 'good', title: 'Guide_installation_prise_en_main_IBM_Bob_Work_v2.pdf', path: '/tmp/Guide_installation_prise_en_main_IBM_Bob_Work_v2.pdf' },
      ],
    }} onOpenResource={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByTestId('native-pdf')).toHaveAttribute(
        'data-path',
        '/tmp/Guide_installation_prise_en_main_IBM_Bob_Work_v2.pdf',
      )
    })
    expect(screen.queryByTestId('native-pdf')).toBeVisible()
    expect(screen.getAllByTestId('native-pdf')).toHaveLength(1)
    expect(screen.queryByText('Impossible de charger le PDF')).not.toBeInTheDocument()
  })

  it('n’affiche pas en chips les chemins sandbox bloqués absents du disque', async () => {
    render(<MessageBubble msg={{
      id: 'sandbox-blocked-paths',
      role: 'assistant',
      content: [
        'Workspace OK.',
        '[.bob-sandbox-ui-probe.txt](/Users/me/Desktop/.bob-sandbox-ui-probe.txt) — 🚫 BLOCKED',
        '[.bob-sandbox-ui-probe.txt](/Users/me/Documents/.bob-sandbox-ui-probe.txt) — 🚫 BLOCKED',
        'Créé : /tmp/sandbox-write-ok.txt',
      ].join('\n'),
      ts: '2026-09-11T22:38:00Z',
      state: 'done',
      fileChanges: [{ path: '/tmp/sandbox-write-ok.txt', changeType: 'created' }],
    }} onOpenResource={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'sandbox-write-ok.txt Créé' })).toBeVisible()
    })
    expect(screen.queryAllByRole('button', { name: '.bob-sandbox-ui-probe.txt' })).toHaveLength(0)
    expect(screen.queryByTitle('/Users/me/Desktop/.bob-sandbox-ui-probe.txt')).toBeNull()
    expect(screen.queryByTitle('/Users/me/Documents/.bob-sandbox-ui-probe.txt')).toBeNull()
  })

  it('sépare les documents créés des documents modifiés et supprimés', () => {
    const onOpen = vi.fn()
    render(<MessageBubble msg={{
      id: 'file-changes', role: 'assistant', content: 'Documents prêts',
      ts: '2026-09-08T12:00:00Z', state: 'done',
      fileChanges: [
        { path: '/tmp/ancien.docx', changeType: 'modified' },
        { path: '/tmp/nouveau.docx', changeType: 'created' },
        { path: '/tmp/supprime.docx', changeType: 'deleted' },
      ],
    }} onOpenResource={onOpen} />)
    const created = screen.getByText('Fichiers créés').parentElement!
    const modified = screen.getByText('Fichiers modifiés').parentElement!
    expect(created).toHaveTextContent('nouveau.docxCréé')
    expect(created).not.toHaveTextContent('ancien.docx')
    expect(modified).toHaveTextContent('ancien.docxModifié')
    expect(modified).not.toHaveTextContent('nouveau.docx')
    fireEvent.click(screen.getByRole('button', { name: 'nouveau.docx Créé' }))
    expect(onOpen).toHaveBeenCalledWith('/tmp/nouveau.docx', 'nouveau.docx', 'file')
    expect(screen.getByRole('button', { name: 'supprime.docx Supprimé' })).toBeDisabled()
  })

  it('affiche la date locale sur les messages utilisateur et Bob', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 30, 12, 0))
    const timestamp = new Date(2026, 7, 30, 7, 27).toISOString()

    render(<>
      <MessageBubble msg={{ id: 'dated-user', role: 'user', content: 'Bonjour', ts: timestamp, state: 'done' }} onOpenResource={vi.fn()} />
      <MessageBubble msg={{ id: 'dated-bob', role: 'assistant', content: 'Bonjour !', ts: timestamp, state: 'done' }} onOpenResource={vi.fn()} />
    </>)

    const dates = screen.getAllByText('07:27 · Aujourd’hui')
    expect(dates).toHaveLength(2)
    expect(dates.every(element => element.tagName === 'TIME')).toBe(true)
  })

  it('does not treat paths cited in a user prompt as created files', () => {
    render(<MessageBubble msg={{
      id: 'user-sandbox-prompt',
      role: 'user',
      content: 'écris /tmp/bob-sandbox-escape.txt puis ~/Desktop/bob-sandbox-escape.txt.',
      ts: '2026-09-11T16:52:00Z',
      state: 'sent',
    }} onOpenResource={vi.fn()} />)

    expect(screen.queryByRole('button', { name: 'bob-sandbox-escape.txt' })).not.toBeInTheDocument()
    expect(screen.queryByText('bob-sandbox-escape.txt')).not.toBeInTheDocument()
  })

  it('keeps long unbroken user content inside the message bubble', () => {
    const content = `Texte ${'x'.repeat(240)}\nDeuxième ligne`
    render(<MessageBubble msg={{
      id: 'user-long-message',
      role: 'user',
      content,
      ts: '2026-08-09T00:00:00Z',
      state: 'sent',
    }} onOpenResource={vi.fn()} />)

    const bubble = screen.getByText((_, element) => element?.classList.contains('msg-user') ?? false)
    expect(bubble).toHaveClass('msg-user')
    expect(bubble.parentElement).toHaveClass('msg-user-stack')
    expect(bubble.parentElement?.parentElement).toHaveClass('msg-user-row')
    expect(bubble).toHaveTextContent('Deuxième ligne')
  })

  it('place les actions du message utilisateur sous sa bulle', () => {
    const { container } = render(<MessageBubble msg={{
      id: 'user-copy-below', role: 'user', content: 'Message à copier',
      ts: '2026-09-09T00:00:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    const stack = container.querySelector('.msg-user-stack')!
    const bubble = stack.querySelector('.msg-user')!
    const actions = stack.querySelector('.message-actions-below')!
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Copier' }))
    expect(bubble.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('place le bouton de copie de Bob sous son message', () => {
    const { container } = render(<MessageBubble msg={{
      id: 'assistant-copy-below', role: 'assistant', content: 'Réponse à copier',
      ts: '2026-09-09T00:00:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    const stack = container.querySelector('.msg-assistant-stack')!
    const message = stack.querySelector('.msg-assistant')!
    const actions = stack.querySelector('.message-actions-below')!
    expect(actions).toContainElement(screen.getByRole('button', { name: 'Copier' }))
    expect(message.compareDocumentPosition(actions) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('affiche l’icône officielle de Bob à la place de la lettre B', () => {
    render(<MessageBubble msg={{
      id: 'assistant-avatar',
      role: 'assistant',
      content: 'Réponse de Bob',
      ts: '2026-08-24T12:00:00Z',
      state: 'done',
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'Bob' })).toHaveAttribute(
      'src',
      expect.stringContaining('bob-avatar'),
    )
    expect(screen.queryByText('B')).not.toBeInTheDocument()
  })

  it('shows edit affordance for persisted user messages', () => {
    render(<MessageBubble
      msg={{
        id: '7d9c1b2a-3f4a-4e5b-9c8d-1a2b3c4d5e6f',
        role: 'user',
        content: 'Question initiale',
        ts: '2026-08-09T00:00:00Z',
        state: 'done',
        persisted: true,
      }}
      onOpenResource={vi.fn()}
      canEdit
    />)

    expect(screen.getByTitle('Modifier')).toBeInTheDocument()
  })

  it('submits edited user content on Enter', () => {
    const onSubmitEdit = vi.fn()
    render(<MessageBubble
      msg={{
        id: 'user-edit',
        role: 'user',
        content: 'Question initiale',
        ts: '2026-08-09T00:00:00Z',
        state: 'done',
      }}
      onOpenResource={vi.fn()}
      canEdit
      isEditing
      onCancelEdit={vi.fn()}
      onSubmitEdit={onSubmitEdit}
    />)

    const textarea = screen.getByRole('textbox')
    fireEvent.change(textarea, { target: { value: 'Question modifiée' } })
    fireEvent.keyDown(textarea, { key: 'Enter' })
    expect(onSubmitEdit).toHaveBeenCalledWith('Question modifiée')
  })

  it('affiche les images locales comme des aperçus cliquables', async () => {
    const onOpenResource = vi.fn()
    render(<MessageBubble msg={{
      id: 'assistant-images',
      role: 'assistant',
      content: 'Voici la proposition.',
      ts: '2026-08-24T12:00:00Z',
      state: 'done',
      sources: [{ id: 'image-1', title: 'proposition.png', path: '/tmp/proposition.png' }],
    }} onOpenResource={onOpenResource} />)

    await waitFor(() => {
      expect(screen.getByRole('img', { name: 'Aperçu de proposition.png' })).toHaveAttribute('src', 'asset:///tmp/proposition.png')
    })
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir l’aperçu proposition.png' }))
    expect(onOpenResource).toHaveBeenCalledWith('/tmp/proposition.png', 'proposition.png', 'file')
  })

  it('affiche la preview HTML inline même si plugin-fs refuse Application Support', async () => {
    const htmlPath =
      '/Users/demo/Library/Application Support/com.bobwork.desktop.test/workspaces/run/chart-e2e.html'
    render(<MessageBubble msg={{
      id: 'assistant-html-preview',
      role: 'assistant',
      content: 'Dashboard prêt.',
      ts: '2026-09-14T12:00:00Z',
      state: 'done',
      sources: [{ id: 'html-1', title: 'chart-e2e.html', path: htmlPath }],
    }} onOpenResource={vi.fn()} />)

    await waitFor(() => {
      expect(screen.getByLabelText('Visualisations générées')).toBeVisible()
      expect(screen.getByTestId('inline-html-preview')).toHaveAttribute('data-src', htmlPath)
    })
  })

  it('convertit les images locales intégrées au Markdown', () => {
    render(<MessageBubble msg={{
      id: 'assistant-inline-image', role: 'assistant', content: '![Diagramme](/tmp/diagramme.png)',
      ts: '2026-08-24T12:00:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'Diagramme' })).toHaveAttribute('src', 'asset:///tmp/diagramme.png')
  })

  it('décode les espaces des chemins locaux avant de créer l’URL d’aperçu', () => {
    render(<MessageBubble msg={{
      id: 'assistant-inline-image-spaces',
      role: 'assistant',
      content: '![Architecture](/Users/demo/Library/Application%20Support/Bob/architecture.png)',
      ts: '2026-08-24T12:00:00Z',
      state: 'done',
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('img', { name: 'Architecture' })).toHaveAttribute(
      'src',
      'asset:///Users/demo/Library/Application Support/Bob/architecture.png',
    )
  })

  it('compacte les lectures web de fond en sources au lieu de cartes dans la réponse finale', () => {
    render(<MessageBubble msg={{
      id: 'assistant-background-web',
      role: 'assistant',
      content: 'Synthèse terminée.',
      ts: '2026-08-24T12:00:00Z',
      state: 'done',
      snapshots: [{
        id: 'web-fetch:source',
        url: 'https://example.com/source',
        title: 'Documentation officielle',
        background: true,
        headings: [],
        actions: [],
        text: 'Contenu récupéré en arrière-plan',
        pending: false,
        failed: false,
      }],
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('button', { name: 'Documentation officielle' })).toBeVisible()
    expect(screen.queryByText('Contenu récupéré en arrière-plan')).not.toBeInTheDocument()
  })

  it('remplace une image en échec par un état explicite', async () => {
    render(<MessageBubble msg={{
      id: 'assistant-broken-image', role: 'assistant', content: 'Image générée.',
      ts: '2026-08-24T12:00:00Z', state: 'done',
      sources: [{ id: 'broken', title: 'cassée.png', path: '/tmp/cassee.png' }],
    }} onOpenResource={vi.fn()} />)

    const image = await screen.findByRole('img', { name: 'Aperçu de cassée.png' })
    fireEvent.error(image)
    expect(screen.getByText('Aperçu de l’image indisponible')).toBeVisible()
  })

  it('affiche les tableaux GFM dans une zone horizontale sans corrompre les URL', () => {
    const content = [
      '| Critère | Open-Meteo | WeatherAPI |',
      '|---|---|---|',
      '| Exemple | `https://api.open-meteo.com/v1/forecast.json?lat=1` | `https://api.weatherapi.com/v1/forecast.json?key=CLEF` |',
    ].join('\n')
    const { container } = render(<MessageBubble msg={{
      id: 'assistant-table', role: 'assistant', content, ts: '2026-08-24T12:00:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('table')).toBeVisible()
    expect(container.querySelector('.markdown-table-scroll')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Copier le tableau' })).toBeVisible()
    expect(screen.getByText('https://api.weatherapi.com/v1/forecast.json?key=CLEF')).toBeVisible()
  })

  it('ajoute un bouton avec icône pour copier chaque tableau généré par Bob', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<MessageBubble msg={{
      id: 'assistant-table-copy', role: 'assistant',
      content: [
        '| Ville | Temp |',
        '|---|---|',
        '| Paris | 18 °C |',
      ].join('\n'),
      ts: '2026-09-13T00:00:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    fireEvent.click(screen.getByRole('button', { name: 'Copier le tableau' }))
    expect(writeText).toHaveBeenCalledWith('Ville\tTemp\nParis\t18 °C')
  })

  it('ajoute un bouton avec icône pour copier chaque cadre de code généré par Bob', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    })
    render(<MessageBubble msg={{
      id: 'assistant-code', role: 'assistant',
      content: '```sh\necho "Bob Work"\n```',
      ts: '2026-09-09T00:00:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    const frame = screen.getByText('echo "Bob Work"').closest('.markdown-code-frame')!
    const copy = frame.querySelector('button[aria-label="Copier"]')!
    expect(copy).toBeVisible()
    fireEvent.click(copy)
    expect(writeText).toHaveBeenCalledWith('echo "Bob Work"\n')
  })

  it('répare les titres Markdown sans espace', () => {
    expect(normalizeAssistantMarkdown('####🟢 Open-Meteo')).toBe('#### 🟢 Open-Meteo')
  })

  it('répare le tableau des 16 flux dont Label et Couleur ont été fusionnés', () => {
    const malformed = [
      '### 🔗 16 flux',
      '',
      '| # | From | To | Label Couleur |',
      '|---|---|---|---|---|',
      '| 1 | `user` | `app-gateway` | HTTPS443 | 🔵 Primary |',
      '| 2 | `app-gateway` | `apim` | WAF-filtered | 🔵 Primary |',
    ].join('\n')

    const repaired = normalizeAssistantMarkdown(malformed)
    expect(repaired).toContain('| # | From | To | Label | Couleur |')

    render(<MessageBubble msg={{
      id: 'assistant-flows-table', role: 'assistant', content: malformed,
      ts: '2026-08-24T12:00:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Label' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Couleur' })).toBeVisible()
    expect(screen.getByText('WAF-filtered')).toBeVisible()
  })

  it('restaure les lignes d’un tableau aplati pendant le streaming', () => {
    const flattened = '### 🔗 16 flux | # | From | To | Label Couleur | |---|---|---|---|---| | 1 | user | app-gateway | HTTPS443 | 🔵 Primary | | 2 | app-gateway | apim | WAF-filtered | 🔵 Primary |'
    const repaired = normalizeAssistantMarkdown(flattened)

    expect(repaired).toContain('### 🔗 16 flux\n| # | From | To | Label | Couleur |\n| --- | --- | --- | --- | --- |')
    expect(repaired).toContain('\n| 1 | user | app-gateway | HTTPS443 | 🔵 Primary |')
    expect(repaired).toContain('\n| 2 | app-gateway | apim | WAF-filtered | 🔵 Primary |')
  })

  it('répare un tableau aplati dont la ligne de séparation perd une colonne', () => {
    const malformed = '| Action | Responsable | Échéance | |---|---| | Organiser un petit-déjeuner | Équipe pédagogique | Vendredi | | Afficher les conseils de prévention | Référent santé | Cette semaine |'
    const repaired = normalizeAssistantMarkdown(malformed)

    expect(repaired).toContain('| Action | Responsable | Échéance |\n| --- | --- | --- |')
    expect(repaired).toContain('\n| Organiser un petit-déjeuner | Équipe pédagogique | Vendredi |')

    render(<MessageBubble msg={{
      id: 'assistant-underfilled-delimiter-table', role: 'assistant', content: malformed,
      ts: '2026-09-01T09:15:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Échéance' })).toBeVisible()
    expect(screen.getByText('Référent santé')).toBeVisible()
  })

  it('répare un résumé sandbox aplati avec un seul séparateur |---|', () => {
    const malformed = [
      'Résumé du test sandbox:',
      '',
      '| Action | Résultat | |---| | Création de sandbox-ok.txt dans le workspace | ✅ Réussi — fichier créé avec le contenu sandbox-works | | Listage de ~/Desktop | 🚫 Bloqué — le chemin ~/Desktop est redirigé vers un répertoire isolé |',
    ].join('\n')
    const repaired = normalizeAssistantMarkdown(malformed)

    expect(repaired).toContain('| Action | Résultat |\n| --- | --- |')
    expect(repaired).toContain('\n| Création de sandbox-ok.txt dans le workspace | ✅ Réussi — fichier créé avec le contenu sandbox-works |')
    expect(repaired).toContain('\n| Listage de ~/Desktop | 🚫 Bloqué — le chemin ~/Desktop est redirigé vers un répertoire isolé |')

    render(<MessageBubble msg={{
      id: 'assistant-sandbox-flat-table', role: 'assistant', content: malformed,
      ts: '2026-09-11T22:24:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)

    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Action' })).toBeVisible()
    expect(screen.getByRole('columnheader', { name: 'Résultat' })).toBeVisible()
    expect(screen.getByText(/sandbox-ok\.txt/)).toBeVisible()
  })

  it('répare le tableau d’itinéraire aplati avec un en-tête vide', () => {
    const malformed = '| | |---|---| | **Distance** | 3,8 km | | **Durée estimée** | ~49 minutes | | **Mode** | 🚶 À pied |'
    const repaired = normalizeAssistantMarkdown(malformed)

    expect(repaired).toContain('|  |  |\n| --- | --- |')
    expect(repaired).toContain('\n| **Distance** | 3,8 km |')
    expect(repaired).toContain('\n| **Mode** | 🚶 À pied |')

    render(<MessageBubble msg={{
      id: 'assistant-route-table', role: 'assistant', content: malformed,
      ts: '2026-09-06T02:20:00Z', state: 'done',
    }} onOpenResource={vi.fn()} />)
    expect(screen.getByRole('table')).toBeVisible()
    expect(screen.getByText('Durée estimée')).toBeVisible()

    const persisted = '| |\n|---|---|\n| **Distance** | 3,8 km |\n| **Durée estimée** | ~49 minutes |\n| **Mode** | 🚶 À pied |'
    expect(normalizeAssistantMarkdown(persisted)).toContain('|  |  |\n| --- | --- |')
  })

  it('normalise les tableaux sans bordure et les séparateurs Markdown courts', () => {
    const repaired = normalizeAssistantMarkdown('Action | Responsable | Échéance\r\n- | :- | --:\r\nPréparer le support | Équipe | Vendredi')

    expect(repaired).toContain('| Action | Responsable | Échéance |\n| --- | :--- | ---: |')
    expect(repaired).toContain('Préparer le support | Équipe | Vendredi')
  })

  it('préserve les blocs de code et les barres verticales échappées', () => {
    const code = '```md\n#Titre\n| A | B | |--|--|\n```'
    expect(normalizeAssistantMarkdown(code)).toBe(code)

    const escaped = normalizeAssistantMarkdown('| Commande \\| alias | Résultat |\n| --- | --- |\n| `a | b` | ok |')
    expect(escaped).toContain('| Commande \\| alias | Résultat |\n| --- | --- |')
    expect(escaped).toContain('| `a | b` | ok |')
  })

  it('préserve les autres formats Markdown GFM', () => {
    const standard = [
      '# Titre', '- [x] Action terminée', '> Citation',
      '**gras** _italique_ ~~barré~~ [lien](https://example.com)',
      '![Schéma](https://example.com/schema.png)',
      '```ts', 'const value = "a | b"', '```',
    ].join('\n')
    expect(normalizeAssistantMarkdown(standard)).toBe(standard)
  })
})

describe('structured conversation interactions', () => {
  beforeEach(() => setTestLocale('fr'))
  afterEach(() => setTestLocale(null))

  it('affiche les réponses follow_up de Bob comme boutons cliquables', () => {
    const interaction = interactionFromActivity({
      sessionId: 'session-followup', conversationId: 'conversation-1',
      eventType: 'user_input_required', toolName: 'ask_followup_question',
      payload: { parameters: {
        question: 'Quel format souhaitez-vous ?',
        follow_up: [{ text: 'PDF' }, { text: 'Document Word' }],
      } },
    })!
    expect(interaction.choices).toHaveLength(2)
    const onChoose = vi.fn()
    const { container } = render(<ConversationInteractionCard interaction={interaction} busy={false} onChoose={onChoose} />)
    expect(screen.getByTestId('conversation-interaction')).toHaveClass('conversation-interaction--right')
    expect(container.querySelector('.conversation-interaction__choices')).toHaveClass('conversation-interaction__choices--right')
    fireEvent.click(screen.getByRole('button', { name: 'Document Word' }))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ label: 'Document Word', value: 'Document Word' }))
  })

  it('normalizes Bob IDE ask_followup_question choices', () => {
    const interaction = interactionFromActivity({
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      eventType: 'user_input_required',
      title: 'Choix utilisateur requis',
      toolName: 'ask_followup_question',
      payload: {
        type: 'tool_use',
        tool_name: 'ask_followup_question',
        parameters: {
          questions: [{
            header: 'Indexation',
            question: 'Installer CodeGraph ?',
            options: [
              { label: 'Installer', description: 'Indexe le dépôt.' },
              { label: 'Continuer sans' },
            ],
          }],
        },
      },
    })

    expect(interaction).toMatchObject({
      kind: 'question',
      title: 'Indexation',
      question: 'Installer CodeGraph ?',
      choices: [
        { label: 'Installer', value: 'Installer', description: 'Indexe le dépôt.' },
        { label: 'Continuer sans', value: 'Continuer sans' },
      ],
    })
  })

  it('ignores ordinary tool activity', () => {
    expect(interactionFromActivity({
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      eventType: 'tool_started',
      payload: { tool_name: 'read_file' },
    })).toBeNull()
  })

  it('keeps an open-ended Bob question even when no buttons were suggested', () => {
    const interaction = interactionFromActivity({
      sessionId: 'session-1',
      conversationId: 'conversation-1',
      eventType: 'user_input_required',
      payload: { parameters: { question: 'Quel nom souhaitez-vous donner au projet ?' } },
    })

    expect(interaction).toMatchObject({
      question: 'Quel nom souhaitez-vous donner au projet ?',
      choices: [],
    })
  })

  it('renders each structured choice as a separate accessible button', () => {
    const onChoose = vi.fn()
    render(<ConversationInteractionCard
      interaction={{
        id: 'codegraph-runtime-project-1',
        kind: 'runtime_suggestion',
        title: 'CodeGraph peut aider',
        question: 'Installer le runtime ?',
        detail: 'Les données restent sur ce Mac.',
        runtimeId: 'external.codegraph',
        projectId: 'project-1',
        choices: [
          { id: 'install', label: 'Installer et continuer', value: 'Installer', action: 'install_runtime' },
          { id: 'continue', label: 'Continuer sans', value: 'Continuer', action: 'continue' },
        ],
      }}
      busy={false}
      onChoose={onChoose}
    />)

    expect(screen.getByTestId('conversation-interaction')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Installer et continuer' }))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ action: 'install_runtime' }))

    onChoose.mockClear()
    fireEvent.click(screen.getByRole('button', { name: /Autre/ }))
    const otherInput = screen.getByPlaceholderText('Écrivez votre choix…')
    expect(otherInput).toHaveFocus()
    fireEvent.change(otherInput, { target: { value: 'Indexer seulement le dossier src' } })
    fireEvent.click(screen.getByRole('button', { name: 'Envoyer' }))
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({
      action: 'custom_input',
      value: 'Indexer seulement le dossier src',
    }))
  })

  it('turns an existing Other option into one free-text input instead of duplicating it', () => {
    const onChoose = vi.fn()
    render(<ConversationInteractionCard
      interaction={{
        id: 'question-with-other',
        kind: 'question',
        title: 'Format',
        question: 'Quel format préférez-vous ?',
        choices: [
          { id: 'pdf', label: 'PDF', value: 'PDF' },
          { id: 'other', label: 'Other', description: 'Specify another format.', value: 'Other' },
        ],
      }}
      busy={false}
      onChoose={onChoose}
    />)

    expect(screen.getAllByRole('button', { name: /Other/ })).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: /Other/ }))
    fireEvent.change(screen.getByPlaceholderText('Écrivez votre choix…'), { target: { value: 'SVG interactif' } })
    fireEvent.submit(screen.getByPlaceholderText('Écrivez votre choix…').closest('form')!)
    expect(onChoose).toHaveBeenCalledWith(expect.objectContaining({ id: 'other', value: 'SVG interactif' }))
  })
})
