import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { AppDialogProvider, useAppDialog } from './AppDialog'

function Harness({ onResult }: { onResult: (value: boolean) => void }) {
  const dialog = useAppDialog()
  return (
    <>
      <button onClick={() => void dialog.confirm({ message: 'Supprimer ce fichier ?', confirmLabel: 'Supprimer', destructive: true }).then(onResult)}>
        Ouvrir
      </button>
      <button onClick={() => void dialog.alert('Opération terminée')}>Alerte</button>
    </>
  )
}

describe('AppDialogProvider', () => {
  it('résout une confirmation via la modale applicative', async () => {
    const onResult = vi.fn()
    render(<AppDialogProvider><Harness onResult={onResult} /></AppDialogProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Supprimer ce fichier ?')
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer' }))
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(true))
  })

  it('annule avec Échap et affiche ensuite les dialogues en file', async () => {
    const onResult = vi.fn()
    render(<AppDialogProvider><Harness onResult={onResult} /></AppDialogProvider>)

    fireEvent.click(screen.getByRole('button', { name: 'Ouvrir' }))
    fireEvent.click(screen.getByRole('button', { name: 'Alerte' }))
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onResult).toHaveBeenCalledWith(false))
    expect(await screen.findByRole('alertdialog')).toHaveTextContent('Opération terminée')
  })
})
