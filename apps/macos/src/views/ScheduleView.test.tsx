import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { CreateModal } from './ScheduleView'

const mocks = vi.hoisted(() => ({
  getBobModes: vi.fn(),
  getProjects: vi.fn(),
}))

vi.mock('../lib/ipc', () => ({
  getBobModes: mocks.getBobModes,
  getProjects: mocks.getProjects,
  createSchedule: vi.fn(),
  getSchedules: vi.fn(),
  updateScheduleState: vi.fn(),
  deleteSchedule: vi.fn(),
  getScheduleRuns: vi.fn(),
  runScheduleNow: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}))

describe('CreateModal', () => {
  beforeEach(() => {
    mocks.getBobModes.mockResolvedValue([])
    mocks.getProjects.mockResolvedValue([])
  })

  it('keeps focus while typing complete schedule fields', async () => {
    const user = userEvent.setup()
    render(<CreateModal onClose={vi.fn()} onDone={vi.fn()} />)

    const name = screen.getByPlaceholderText('Ex : Rapport quotidien')
    await user.type(name, 'Rapport quotidien')
    expect(name).toHaveValue('Rapport quotidien')
    expect(name).toHaveFocus()

    const instructions = screen.getByPlaceholderText('Génère un rapport des tickets en cours et envoie-le…')
    await user.type(instructions, 'Analyse les tickets ouverts et prépare un résumé.')
    expect(instructions).toHaveValue('Analyse les tickets ouverts et prépare un résumé.')
    expect(instructions).toHaveFocus()
  })

  it('closes when clicking the backdrop', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    const { container } = render(<CreateModal onClose={onClose} onDone={vi.fn()} />)

    const backdrop = container.querySelector('.modal-overlay')
    expect(backdrop).toBeTruthy()
    await user.click(backdrop!)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('prefills a real plugin schedule template without losing the plugin binding', async () => {
    render(<CreateModal onClose={vi.fn()} onDone={vi.fn()} initialTemplate={{
      id: 'weekly-review',
      name: 'Revue cloud hebdomadaire',
      description: 'Contrôle les écarts.',
      instructions: 'Analyse les changements cloud.',
      cronOrEvent: 'every week',
      offlineBehavior: 'run_on_wake',
      overlapPolicy: 'queue',
      pluginId: 'agentic-cloud-architect',
      pluginName: 'Cloud Architect',
    }} />)

    await waitFor(() => expect(screen.getByPlaceholderText('Ex : Rapport quotidien')).toHaveValue('Revue cloud hebdomadaire'))
    expect(screen.getByPlaceholderText('Génère un rapport des tickets en cours et envoie-le…')).toHaveValue('Analyse les changements cloud.')
    expect(screen.getByDisplayValue('Plugin · Cloud Architect')).toHaveValue('plugin:agentic-cloud-architect')
  })
})
