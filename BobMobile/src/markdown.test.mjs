import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeAssistantMarkdown } from './markdown.ts'

test('repairs the streamed three-column action table used by Bob Work', () => {
  const malformed = '| Action | Responsable | Échéance | |---|---| | Organiser un petit-déjeuner | Équipe pédagogique | Vendredi |'
  const repaired = normalizeAssistantMarkdown(malformed)

  assert.match(repaired, /\| Action \| Responsable \| Échéance \|\n\| --- \| --- \| --- \|/)
  assert.match(repaired, /\n\| Organiser un petit-déjeuner \| Équipe pédagogique \| Vendredi \|/)
})

test('supports borderless tables, alignment and short delimiters', () => {
  const repaired = normalizeAssistantMarkdown('Action | Responsable | Échéance\r\n- | :- | --:\r\nPréparer le support | Équipe | Vendredi')

  assert.match(repaired, /\| Action \| Responsable \| Échéance \|\n\| --- \| :--- \| ---: \|/)
})

test('does not rewrite Markdown examples inside fenced code blocks', () => {
  const code = '```md\n#Titre\n| A | B | |--|--|\n```'
  assert.equal(normalizeAssistantMarkdown(code), code)
})

test('does not count escaped or inline-code pipes as extra columns', () => {
  const repaired = normalizeAssistantMarkdown('| Commande \\| alias | Résultat |\n| --- | --- |\n| `a | b` | ok |')

  assert.match(repaired, /\| Commande \\\| alias \| Résultat \|\n\| --- \| --- \|/)
  assert.match(repaired, /\| `a \| b` \| ok \|/)
})

test('preserves headings, task lists, quotes, emphasis, links, images and code', () => {
  const standard = [
    '# Titre', '- [x] Action terminée', '> Citation',
    '**gras** _italique_ ~~barré~~ [lien](https://example.com)',
    '![Schéma](https://example.com/schema.png)',
    '```ts', 'const value = "a | b"', '```',
  ].join('\n')

  assert.equal(normalizeAssistantMarkdown(standard), standard)
})
