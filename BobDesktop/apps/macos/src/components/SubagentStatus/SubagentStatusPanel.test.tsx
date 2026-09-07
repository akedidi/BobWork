import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { deriveSubagentStatuses, SubagentStatusPanel } from './SubagentStatusPanel'

describe('deriveSubagentStatuses', () => {
  it('groups start and finish events into one row per agent', () => {
    const statuses = deriveSubagentStatuses([
      { eventType: 'subagent_started', title: 'Sous-agent démarré : Analyse frontend', payload: { agent_id: 'agent-1', name: 'Analyse frontend' } },
      { eventType: 'subagent_started', payload: { agent_id: 'agent-2', name: 'Analyse backend' } },
      { eventType: 'subagent_finished', payload: { agent_id: 'agent-1', name: 'Analyse frontend' } },
    ])

    expect(statuses).toEqual([
      { id: 'agent-1', name: 'Analyse frontend', state: 'completed', thinking: '' },
      { id: 'agent-2', name: 'Analyse backend', state: 'running', thinking: '' },
    ])
  })

  it('supports spawn_subagent tool events and nested parameters', () => {
    const statuses = deriveSubagentStatuses([
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-1', parameters: { task_name: 'Revue sécurité' } } },
      { eventType: 'tool_error', toolName: 'spawn_subagent', payload: { tool_id: 'tool-1', status: 'error' } },
    ])

    expect(statuses).toHaveLength(1)
    expect(statuses[0]).toMatchObject({ id: 'tool-1', name: 'Revue sécurité', state: 'failed' })
  })

  it('keeps spawned agents running when only the delegation tool has finished', () => {
    const statuses = deriveSubagentStatuses([
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-open-meteo', parameters: { name: 'explore', description: 'Analyse **Open-Meteo**.' } } },
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-weather-api', parameters: { name: 'explore', description: 'Analyse **WeatherAPI**.' } } },
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-met-norway', parameters: { name: 'explore', description: 'Analyse **MET Norway**.' } } },
      { eventType: 'tool_finished', toolName: 'spawn_subagent', payload: { tool_id: 'tool-open-meteo', status: 'success' } },
      { eventType: 'tool_finished', toolName: 'spawn_subagent', payload: { tool_id: 'tool-met-norway', status: 'success' } },
      { eventType: 'tool_finished', toolName: 'spawn_subagent', payload: { tool_id: 'tool-weather-api', status: 'success' } },
    ])

    expect(statuses).toEqual([
      { id: 'tool-open-meteo', name: 'Open-Meteo', state: 'running', thinking: '' },
      { id: 'tool-weather-api', name: 'WeatherAPI', state: 'running', thinking: '' },
      { id: 'tool-met-norway', name: 'MET Norway', state: 'running', thinking: '' },
    ])
  })

  it('accepts a legacy spawn result only when it contains the child task result', () => {
    const statuses = deriveSubagentStatuses([
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-1', parameters: { task_name: 'Revue sécurité' } } },
      { eventType: 'tool_finished', toolName: 'spawn_subagent', content: '<task_result>Revue terminée</task_result>', payload: { tool_id: 'tool-1', status: 'success' } },
    ])

    expect(statuses[0]).toMatchObject({ id: 'tool-1', state: 'completed', thinking: 'Revue terminée' })
  })

  it('streams tagged reasoning onto the matching live row', () => {
    const statuses = deriveSubagentStatuses([
      { eventType: 'subagent_started', payload: { agent_id: 'agent-1', name: 'Analyse frontend' } },
      { eventType: 'analysis', content: 'Je lis le composant Header.', payload: { agent_id: 'agent-1' } },
      { eventType: 'analysis', content: 'Ensuite le store Redux.', payload: { agent_id: 'agent-1' } },
      { eventType: 'analysis', content: 'Raisonnement de l’agent principal', payload: {} },
    ])

    expect(statuses).toHaveLength(1)
    expect(statuses[0].thinking).toBe('Je lis le composant Header.\nEnsuite le store Redux.')
  })

  it('does not invent a row from untagged reasoning', () => {
    const statuses = deriveSubagentStatuses([
      { eventType: 'analysis', content: 'Je réfléchis.', payload: {} },
    ])
    expect(statuses).toEqual([])
  })
})

describe('SubagentStatusPanel', () => {
  it('shows the live count and can collapse its rows', () => {
    render(<SubagentStatusPanel events={[
      { eventType: 'subagent_started', payload: { agent_id: 'agent-1', name: 'Analyse frontend' } },
      { eventType: 'subagent_started', payload: { agent_id: 'agent-2', name: 'Analyse backend' } },
    ]} />)

    expect(screen.getByText('2 sous-agents en cours')).toBeVisible()
    expect(screen.getByText('Analyse frontend')).toBeVisible()

    fireEvent.click(screen.getByRole('button', { name: /2 sous-agents en cours/ }))
    expect(screen.queryByText('Analyse frontend')).not.toBeInTheDocument()
  })

  it('shows three concurrent explore agents as three distinct live rows', () => {
    render(<SubagentStatusPanel events={[
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-1', parameters: { name: 'explore', description: 'Analyse **Open-Meteo**.' } } },
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-2', parameters: { name: 'explore', description: 'Analyse **WeatherAPI**.' } } },
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-3', parameters: { name: 'explore', description: 'Analyse **MET Norway**.' } } },
    ]} />)

    expect(screen.getByText('3 sous-agents en cours')).toBeVisible()
    expect(screen.getByText('Open-Meteo')).toBeVisible()
    expect(screen.getByText('WeatherAPI')).toBeVisible()
    expect(screen.getByText('MET Norway')).toBeVisible()
    expect(screen.getAllByText('En cours')).toHaveLength(3)
  })

  it('shows the child summary in the dedicated frame when the task result arrives', () => {
    render(<SubagentStatusPanel events={[
      { eventType: 'tool_started', toolName: 'spawn_subagent', payload: { tool_id: 'tool-1', parameters: { task_name: 'Revue sécurité' } } },
      { eventType: 'tool_finished', toolName: 'spawn_subagent', content: '<task_result>Aucun secret exposé.</task_result>', payload: { tool_id: 'tool-1', status: 'success' } },
    ]} />)

    expect(screen.getByText('Revue sécurité')).toBeVisible()
    expect(screen.getByText('Aucun secret exposé.')).toBeVisible()
  })
})
