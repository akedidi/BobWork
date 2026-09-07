import { render, screen, fireEvent } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConversationInteractionCard, MessageBubble, interactionFromActivity, normalizeAssistantMarkdown } from './ChatView'
import { setTestLocale } from '../i18n'

vi.mock('@tauri-apps/api/core', () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
}))

describe('MessageBubble', () => {
  beforeEach(() => setTestLocale('fr'))
  afterEach(() => {
    setTestLocale(null)
    vi.useRealTimers()
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

  it('affiche les images locales comme des aperçus cliquables', () => {
    const onOpenResource = vi.fn()
    render(<MessageBubble msg={{
      id: 'assistant-images',
      role: 'assistant',
      content: 'Voici la proposition.',
      ts: '2026-08-24T12:00:00Z',
      state: 'done',
      sources: [{ id: 'image-1', title: 'proposition.png', path: '/tmp/proposition.png' }],
    }} onOpenResource={onOpenResource} />)

    expect(screen.getByRole('img', { name: 'Aperçu de proposition.png' })).toHaveAttribute('src', 'asset:///tmp/proposition.png')
    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir l’aperçu proposition.png' }))
    expect(onOpenResource).toHaveBeenCalledWith('/tmp/proposition.png', 'proposition.png', 'file')
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

  it('remplace une image en échec par un état explicite', () => {
    render(<MessageBubble msg={{
      id: 'assistant-broken-image', role: 'assistant', content: 'Image générée.',
      ts: '2026-08-24T12:00:00Z', state: 'done',
      sources: [{ id: 'broken', title: 'cassée.png', path: '/tmp/cassee.png' }],
    }} onOpenResource={vi.fn()} />)

    fireEvent.error(screen.getByRole('img', { name: 'Aperçu de cassée.png' }))
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
    expect(screen.getByText('https://api.weatherapi.com/v1/forecast.json?key=CLEF')).toBeVisible()
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
  })
})
