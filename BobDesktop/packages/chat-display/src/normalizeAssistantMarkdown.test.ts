import test from 'node:test'
import assert from 'node:assert/strict'

import { normalizeAssistantMarkdown } from './normalizeAssistantMarkdown.ts'

test('repairs the streamed three-column action table used by Bob Work', () => {
  const malformed =
    '| Action | Responsable | Échéance | |---|---| | Organiser un petit-déjeuner | Équipe pédagogique | Vendredi |'
  const repaired = normalizeAssistantMarkdown(malformed)

  assert.match(repaired, /\| Action \| Responsable \| Échéance \|\n\| --- \| --- \| --- \|/)
  assert.match(
    repaired,
    /\n\| Organiser un petit-déjeuner \| Équipe pédagogique \| Vendredi \|/,
  )
})

test('repairs flattened Label Couleur architecture tables', () => {
  const flattened =
    '### 🔗 16 flux | # | From | To | Label Couleur | |---|---|---|---|---| | 1 | user | app-gateway | HTTPS443 | 🔵 Primary |'
  const repaired = normalizeAssistantMarkdown(flattened)
  assert.match(repaired, /\| # \| From \| To \| Label \| Couleur \|/)
  assert.match(repaired, /\| --- \| --- \| --- \| --- \| --- \|/)
})

test('repairs a flattened sandbox summary with a single |---| separator', () => {
  const malformed = [
    'Résumé du test sandbox:',
    '',
    '| Action | Résultat | |---| | Création de sandbox-ok.txt dans le workspace | ✅ Réussi |',
  ].join('\n')
  const repaired = normalizeAssistantMarkdown(malformed)
  assert.match(repaired, /\| Action \| Résultat \|\n\| --- \| --- \|/)
  assert.match(repaired, /\n\| Création de sandbox-ok\.txt dans le workspace \| ✅ Réussi \|/)
})

test('pads empty streamed headers `| |` before delimiters', () => {
  const malformed =
    '| | |---|---| | **Distance** | 3,8 km | | **Durée estimée** | ~49 minutes |'
  assert.match(normalizeAssistantMarkdown(malformed), /\|  \|  \|\n\| --- \| --- \|/)

  const persisted =
    '| |\n|---|---|\n| **Distance** | 3,8 km |\n| **Durée estimée** | ~49 minutes |'
  assert.match(normalizeAssistantMarkdown(persisted), /\|  \|  \|\n\| --- \| --- \|/)
})

test('supports borderless tables, alignment and short delimiters', () => {
  const repaired = normalizeAssistantMarkdown(
    'Action | Responsable | Échéance\r\n- | :- | --:\r\nPréparer le support | Équipe | Vendredi',
  )
  assert.match(repaired, /\| Action \| Responsable \| Échéance \|\n\| --- \| :--- \| ---: \|/)
})

test('does not rewrite Markdown examples inside fenced code blocks', () => {
  const code = '```md\n#Titre\n| A | B | |--|--|\n```'
  assert.equal(normalizeAssistantMarkdown(code), code)
})

test('does not count escaped or inline-code pipes as extra columns', () => {
  const repaired = normalizeAssistantMarkdown(
    '| Commande \\| alias | Résultat |\n| --- | --- |\n| `a | b` | ok |',
  )
  assert.match(repaired, /\| Commande \\\| alias \| Résultat \|\n\| --- \| --- \|/)
  assert.match(repaired, /\| `a \| b` \| ok \|/)
})

test('preserves headings, task lists, quotes, emphasis, links, images and code', () => {
  const standard = [
    '# Titre',
    '- [x] Action terminée',
    '> Citation',
    '**gras** _italique_ ~~barré~~ [lien](https://example.com)',
    '![Schéma](https://example.com/schema.png)',
    '```ts',
    'const value = "a | b"',
    '```',
  ].join('\n')
  assert.equal(normalizeAssistantMarkdown(standard), standard)
})

test('inserts a space after compacted heading markers', () => {
  assert.equal(normalizeAssistantMarkdown('####🟢 Open-Meteo'), '#### 🟢 Open-Meteo')
})
