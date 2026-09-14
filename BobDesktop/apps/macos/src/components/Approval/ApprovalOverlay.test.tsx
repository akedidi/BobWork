import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Approval } from '@bob-work/shared-types'
import { ApprovalOverlay } from './ApprovalOverlay'
import { setTestLocale } from '../../i18n'

const mocks = vi.hoisted(() => ({
  resolveApproval: vi.fn(),
  removeApproval: vi.fn(),
  togglePermission: vi.fn(),
}))

vi.mock('../../lib/ipc', () => ({
  resolveApproval: mocks.resolveApproval,
}))

vi.mock('../../stores/appStore', () => ({
  useAppStore: () => ({
    removeApproval: mocks.removeApproval,
  }),
}))

vi.mock('../../stores/taskPermissionStore', () => ({
  useTaskPermissionStore: (selector: (state: { togglePermission: typeof mocks.togglePermission }) => unknown) =>
    selector({ togglePermission: mocks.togglePermission }),
}))

const approval: Approval = {
  id: 'appr-1',
  taskId: 'task-1',
  actionType: 'file.write',
  humanDescription: 'Bob souhaite écrire un fichier.',
  commandOrChange: 'write notes.md',
  dataAccessed: [],
  filesAffected: ['notes.md'],
  riskLevel: 'medium',
  decision: 'pending',
  undoPossible: true,
  createdAt: '2026-08-11T00:00:00Z',
}

describe('ApprovalOverlay', () => {
  beforeEach(() => {
    setTestLocale('fr')
    mocks.resolveApproval.mockReset()
    mocks.removeApproval.mockReset()
    mocks.togglePermission.mockReset()
  })

  it('propose Autoriser Edit pour une action edit, comme Bob IDE', () => {
    render(<ApprovalOverlay approval={approval} />)
    expect(screen.getByRole('button', { name: /Autoriser Edit/ })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Toujours autoriser/ })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveAttribute('aria-modal', 'false')
  })

  it('propose Autoriser MCP pour un outil MCP, comme Bob IDE', () => {
    render(<ApprovalOverlay approval={{
      ...approval,
      id: 'appr-mcp',
      actionType: 'mcp.connect',
      humanDescription: 'Bob souhaite utiliser un outil MCP.',
      commandOrChange: 'mcp__bob-work-computer-use__get_computer_use_guide',
    }} />)
    expect(screen.getByRole('button', { name: /Autoriser MCP/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Autoriser une fois/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Refuser/ })).toBeInTheDocument()
  })

  it('persiste le groupe MCP pour la tâche au clic sur Autoriser MCP', async () => {
    mocks.resolveApproval.mockResolvedValue(undefined)
    render(<ApprovalOverlay approval={{
      ...approval,
      id: 'appr-mcp-persist',
      actionType: 'bob.mcp',
      humanDescription: 'Bob souhaite utiliser un outil MCP.',
    }} />)

    fireEvent.click(screen.getByRole('button', { name: /Autoriser MCP/ }))
    await waitFor(() => {
      expect(mocks.togglePermission).toHaveBeenCalledWith('mcp', true)
      expect(mocks.resolveApproval).toHaveBeenCalledWith('appr-mcp-persist', {
        decision: 'approved',
        permissionDuration: 'task',
      })
    })
  })

  it('retire l’overlay après une approbation réussie', async () => {
    mocks.resolveApproval.mockResolvedValue(undefined)
    render(<ApprovalOverlay approval={approval} />)

    fireEvent.click(screen.getByRole('button', { name: /Autoriser une fois/ }))

    await waitFor(() => {
      expect(mocks.resolveApproval).toHaveBeenCalledWith('appr-1', {
        decision: 'approved',
        permissionDuration: 'once',
      })
      expect(mocks.removeApproval).toHaveBeenCalledWith('appr-1')
    })
  })

  it('affiche une erreur FR et permet de fermer si resolve échoue', async () => {
    mocks.resolveApproval.mockRejectedValue(new Error('IPC down'))
    render(<ApprovalOverlay approval={approval} />)

    fireEvent.click(screen.getByRole('button', { name: /Autoriser une fois/ }))

    expect(await screen.findByRole('alert')).toHaveTextContent('IPC down')
    expect(mocks.removeApproval).not.toHaveBeenCalled()

    fireEvent.click(screen.getByRole('button', { name: 'Fermer' }))
    expect(mocks.removeApproval).toHaveBeenCalledWith('appr-1')
  })

  it('relance la dernière décision au clic sur Réessayer', async () => {
    mocks.resolveApproval
      .mockRejectedValueOnce(new Error('IPC down'))
      .mockResolvedValueOnce(undefined)
    render(<ApprovalOverlay approval={approval} />)

    fireEvent.click(screen.getByRole('button', { name: /Autoriser une fois/ }))
    expect(await screen.findByRole('alert')).toHaveTextContent('IPC down')

    fireEvent.click(screen.getByRole('button', { name: 'Réessayer' }))
    await waitFor(() => {
      expect(mocks.resolveApproval).toHaveBeenCalledTimes(2)
      expect(mocks.removeApproval).toHaveBeenCalledWith('appr-1')
    })
  })
})
