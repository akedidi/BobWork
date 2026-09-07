import { fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AddMcpForm } from './ConnectorForms'

function McpFormHarness({ persistMcp = vi.fn() }: { persistMcp?: () => void }) {
  const [mcpForm, setMcpForm] = useState({
    originalName: '',
    name: 'custom-server',
    transport: 'stdio',
    commandOrUrl: 'python3',
    args: '',
    envFields: [],
    originalEnvKeys: [],
    headersText: '',
  })
  return <AddMcpForm mcpForm={mcpForm} setMcpForm={setMcpForm} persistMcp={persistMcp} cancelEdit={() => {}} />
}

describe('AddMcpForm', () => {
  it('uses optional structured fields instead of a free-form environment textarea', () => {
    const { container } = render(<McpFormHarness />)

    expect(screen.getByText('Configuration avancée — optionnelle')).toBeInTheDocument()
    expect(container.querySelector('textarea')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une variable' }))
    const key = screen.getByRole('textbox', { name: 'Nom de la variable d’environnement' })
    const value = screen.getByRole('textbox', { name: 'Valeur de la variable d’environnement' })
    const save = screen.getByRole('button', { name: 'Ajouter avec Bob Shell' })

    fireEvent.change(key, { target: { value: 'API_TOKEN' } })
    expect(save).toBeDisabled()
    fireEvent.change(value, { target: { value: 'secret' } })
    expect(save).toBeEnabled()
  })

  it('removes an optional environment row explicitly', () => {
    render(<McpFormHarness />)
    fireEvent.click(screen.getByRole('button', { name: 'Ajouter une variable' }))
    fireEvent.change(screen.getByRole('textbox', { name: 'Nom de la variable d’environnement' }), { target: { value: 'DEBUG' } })
    fireEvent.click(screen.getByRole('button', { name: 'Supprimer DEBUG' }))
    expect(screen.queryByRole('textbox', { name: 'Nom de la variable d’environnement' })).not.toBeInTheDocument()
  })

  it('does not offer process environment variables to remote MCP connectors', () => {
    render(<McpFormHarness />)
    fireEvent.change(screen.getByLabelText('Transport'), { target: { value: 'streamable-http' } })
    expect(screen.queryByText('Configuration avancée — optionnelle')).not.toBeInTheDocument()
    expect(screen.getByText('En-têtes HTTP (Name: value)')).toBeInTheDocument()
  })
})
