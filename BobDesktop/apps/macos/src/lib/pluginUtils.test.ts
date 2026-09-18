import { describe, expect, it } from 'vitest'
import type { Plugin } from '@bob-work/shared-types'
import { pluginKindLabel, pluginMentionId, pluginSkillsOf, pluginWorkflowsOf, skillNameFromPath } from './pluginUtils'

const personal = {
  id: 'agentic-bonjour-simple',
  name: 'Bonjour Simple',
  version: '1.0.1',
  description: 'Plugin personnel de test',
  scope: 'personal',
  category: 'executable',
  manifest: {
    id: 'agentic-bonjour-simple',
    name: 'Bonjour Simple',
    version: '1.0.1',
    description: 'Plugin personnel de test',
    author: 'Bob Work user',
    scope: 'personal',
    category: 'executable',
    capabilities: [],
    inputs: [],
    outputs: [],
    permissions: [],
    compatibility: { minimumBobVersion: '0.1.4', minimumAppVersion: '0.1.4' },
    createdAt: '2026-09-10T00:00:00Z',
    updatedAt: '2026-09-10T00:00:00Z',
    slug: 'bonjour-simple',
    agentic: true,
  } as Plugin['manifest'] & { slug: string; agentic: boolean },
  installState: 'installed',
  validationState: 'valid',
  createdAt: '2026-09-10T00:00:00Z',
  updatedAt: '2026-09-10T00:00:00Z',
} satisfies Plugin

describe('personal plugin identity', () => {
  it('uses the personal slug in prompt mentions', () => {
    expect(pluginMentionId(personal)).toBe('bonjour-simple')
  })

  it('labels prompt-created personal plugins as personal', () => {
    expect(pluginKindLabel(personal).toLocaleLowerCase()).toContain('person')
  })
})

describe('pluginSkillsOf', () => {
  it('accepts string skill paths from prompt-created manifests', () => {
    expect(skillNameFromPath('skills/canvas-design/SKILL.md')).toBe('canvas-design')
    const skills = pluginSkillsOf({
      skills: ['skills/canvas-design/SKILL.md', 'explore-dataset'],
    })
    expect(skills).toEqual([
      {
        name: 'canvas-design',
        displayName: 'canvas-design',
        description: '',
        path: 'skills/canvas-design/SKILL.md',
      },
      {
        name: 'explore-dataset',
        displayName: 'explore-dataset',
        description: '',
        path: undefined,
      },
    ])
  })

  it('keeps object skills and fills name from path when missing', () => {
    const skills = pluginSkillsOf({
      skills: [{ path: 'skills/mece/SKILL.md', description: 'Break down a question' }],
    })
    expect(skills[0]).toMatchObject({
      name: 'mece',
      displayName: 'mece',
      description: 'Break down a question',
      path: 'skills/mece/SKILL.md',
    })
  })
})

describe('pluginWorkflowsOf', () => {
  it('returns empty when workflows are absent', () => {
    expect(pluginWorkflowsOf({})).toEqual([])
  })

  it('normalizes Open Workflow Specification 1.0 documents for the detail panel', () => {
    const workflows = pluginWorkflowsOf({
      workflows: [{
        document: {
          dsl: '1.0.0',
          namespace: 'bob.work.plugins',
          name: 'weekly-sales-review',
          version: '1.0.0',
          title: 'Weekly sales review',
          summary: 'Detect anomalies and prepare a deck.',
        },
        schedule: { cron: '0 9 * * 1' },
        do: [
          { collect: { run: { shell: { command: 'python3' } }, metadata: { description: 'Collect files' } } },
          { analyze: { set: { phase: 'analyze' }, metadata: { description: 'Detect anomalies' } } },
        ],
      }],
    })
    expect(workflows).toEqual([{
      id: 'weekly-sales-review',
      name: 'Weekly sales review',
      description: 'Detect anomalies and prepare a deck.',
      trigger: 'schedule',
      schedule: '0 9 * * 1',
      steps: [
        { id: 'collect', name: 'Collect', description: 'Collect files', uses: 'run:shell' },
        { id: 'analyze', name: 'Analyze', description: 'Detect anomalies', uses: 'set' },
      ],
      dsl: '1.0.0',
    }])
  })
})
