import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { MessageBubble } from './ChatView'

describe('MessageBubble', () => {
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
})
