import { render, screen } from '@testing-library/react'
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
})
