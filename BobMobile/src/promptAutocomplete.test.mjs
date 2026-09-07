import assert from 'node:assert/strict'
import test from 'node:test'
import { applyPromptAutocomplete, buildPromptAutocompleteItems, detectPromptAutocomplete } from './promptAutocomplete.ts'

const catalog = {
  plugins: [{ id: 'builtin-ibm-qiskit', name: 'IBM Qiskit', enabled: true }],
  skills: [{ slug: 'bob-work-github', name: 'GitHub', enabled: true }],
  integrations: [{ id: 'outlook-mail', name: 'Outlook', connected: true }],
  mcpServers: [{ name: 'custom-tools', enabled: true }],
  dbConnections: [{ id: 'sales', name: 'sales', enabled: true }],
}

test('detects and inserts slash commands', () => {
  const query = detectPromptAutocomplete('hello /co')
  assert.equal(query?.trigger, '/')
  const items = buildPromptAutocompleteItems('hello /co', catalog, [{ name: 'condense', description: 'Compact context', source: 'bob' }])
  assert.equal(items[0]?.label, '/condense')
  assert.equal(applyPromptAutocomplete('hello /co', query, items[0].insert), 'hello /condense ')
})

test('offers the same mention resource families as desktop', () => {
  const items = buildPromptAutocompleteItems('@', catalog, [])
  assert.deepEqual(items.map(item => item.kind), ['plugin', 'skill', 'integration', 'mcp', 'db'])
  assert.equal(items[0]?.insert, '@plugin:builtin-ibm-qiskit ')
})
