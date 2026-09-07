import { fireEvent, render } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ModalOverlay, ModalPanel } from './ModalOverlay'

describe('ModalOverlay', () => {
  it('closes with Escape and restores focus to the opener', () => {
    const onClose = vi.fn()
    const opener = document.createElement('button')
    document.body.appendChild(opener)
    opener.focus()
    const { unmount } = render(
      <ModalOverlay onClose={onClose}>
        <ModalPanel><button type="button">Action</button></ModalPanel>
      </ModalOverlay>,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledOnce()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })

  it('does not close a busy modal with backdrop or Escape', () => {
    const onClose = vi.fn()
    const { container } = render(
      <ModalOverlay onClose={onClose} closeOnBackdrop={false}>
        <ModalPanel><button type="button">Action</button></ModalPanel>
      </ModalOverlay>,
    )

    fireEvent.mouseDown(container.querySelector('.modal-overlay')!)
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).not.toHaveBeenCalled()
  })
})
