import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../i18n'
import { useUpdateStore } from '../stores/updateStore'
import { UpdateButton } from './UpdateButton'

vi.mock('./AppDialog', () => ({
  useAppDialog: () => ({
    confirm: vi.fn().mockResolvedValue(false),
    alert: vi.fn(),
  }),
}))

describe('UpdateButton', () => {
  beforeEach(() => {
    useUpdateStore.setState({
      available: false,
      version: null,
      notes: null,
      installing: false,
    })
  })

  it('stays hidden when no release update is available', () => {
    render(
      <I18nProvider>
        <UpdateButton />
      </I18nProvider>,
    )
    expect(screen.queryByRole('button', { name: /Mise à jour/i })).not.toBeInTheDocument()
  })

  it('shows the update action beside settings when a release is available', () => {
    useUpdateStore.setState({ available: true, version: '0.1.9' })
    render(
      <I18nProvider>
        <UpdateButton />
      </I18nProvider>,
    )
    expect(screen.getByRole('button', { name: 'Mise à jour 0.1.9 disponible' })).toBeVisible()
  })
})
