/**
 * Keep assistant Markdown compatible with the repairs performed by Bob Work
 * Desktop before the GFM renderer receives it.
 */
export function normalizeAssistantMarkdown(markdown: string): string {
  const expandedLines: string[] = []
  let fence: { character: string; length: number } | null = null

  for (const originalLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = originalLine.match(/^\s{0,3}(`{3,}|~{3,})/)
    const markerText = marker?.[1]
    if (fence) {
      expandedLines.push(originalLine)
      if (markerText && markerText[0] === fence.character && markerText.length >= fence.length) fence = null
      continue
    }
    if (markerText) {
      fence = { character: markerText[0]!, length: markerText.length }
      expandedLines.push(originalLine)
      continue
    }

    let line = originalLine.replace(/^(\s{0,3})(#{1,6})(?=[^\s#])/, '$1$2 ')
    // Streaming can flatten a complete table onto one line. Only split lines
    // that contain a delimiter row, so prose and code containing pipes stay intact.
    if (/\|\s*\|\s*:?-+:?\s*(?:\||$)/.test(line)) {
      line = line.replace(/\|\s*\|(?=\s*:?-+:?\s*(?:\||$))/g, '|\n|')
      line = line.replace(/\|\s*\|(?=\s*[^|\-])/g, '|\n|')
    }
    expandedLines.push(...line.split('\n'))
  }

  const lines = expandedLines
  const tableCells = (line: string): string[] | null => {
    const trimmed = line.trim()
    if (!trimmed.includes('|')) return null
    let body = trimmed
    if (body.startsWith('|')) body = body.slice(1)
    if (body.endsWith('|')) body = body.slice(0, -1)

    const cells: string[] = []
    let cell = ''
    let inlineCodeTicks = 0
    for (let cursor = 0; cursor < body.length; cursor += 1) {
      const character = body[cursor]
      if (character === '\\' && cursor + 1 < body.length) {
        cell += character + body[cursor + 1]
        cursor += 1
        continue
      }
      if (character === '`') {
        let count = 1
        while (body[cursor + count] === '`') count += 1
        if (inlineCodeTicks === 0) inlineCodeTicks = count
        else if (inlineCodeTicks === count) inlineCodeTicks = 0
        cell += '`'.repeat(count)
        cursor += count - 1
        continue
      }
      if (character === '|' && inlineCodeTicks === 0) {
        cells.push(cell.trim())
        cell = ''
      } else {
        cell += character
      }
    }
    cells.push(cell.trim())
    return cells
  }

  for (let index = 1; index < lines.length; index += 1) {
    const delimiters = tableCells(lines[index] ?? '')
    if (!delimiters || delimiters.length < 2 || !delimiters.every(cell => /^:?-+:?$/.test(cell))) continue
    for (let cellIndex = 0; cellIndex < delimiters.length; cellIndex += 1) {
      const delimiter = delimiters[cellIndex] ?? ''
      delimiters[cellIndex] = `${delimiter.startsWith(':') ? ':' : ''}---${delimiter.endsWith(':') ? ':' : ''}`
    }

    // Put prose or a heading flattened before the table header back on its own line.
    const precedingLine = lines[index - 1] ?? ''
    const firstPipe = precedingLine.indexOf('|')
    if ((lines[index] ?? '').trimStart().startsWith('|') && firstPipe > 0 && precedingLine.slice(0, firstPipe).trim()) {
      const prefix = precedingLine.slice(0, firstPipe).trimEnd()
      const header = precedingLine.slice(firstPipe)
      lines.splice(index - 1, 1, prefix, header)
      index += 1
    }

    const headerCells = tableCells(lines[index - 1] ?? '')
    if (!headerCells || headerCells.length < 2) continue

    if (headerCells.length > delimiters.length) {
      while (delimiters.length < headerCells.length) delimiters.push('---')
      lines[index - 1] = `| ${headerCells.join(' | ')} |`
      lines[index] = `| ${delimiters.join(' | ')} |`
      continue
    }
    if (headerCells.length === delimiters.length) {
      lines[index - 1] = `| ${headerCells.join(' | ')} |`
      lines[index] = `| ${delimiters.join(' | ')} |`
      continue
    }

    const lastHeader = headerCells[headerCells.length - 1] ?? ''
    const splitHeader = lastHeader.match(/^(Label)\s+(Couleur|Color)$/i)
    if (headerCells.length + 1 === delimiters.length && splitHeader) {
      headerCells.splice(-1, 1, splitHeader[1] ?? '', splitHeader[2] ?? '')
    }

    // An imperfect LLM header must not prevent the entire table from rendering.
    while (headerCells.length < delimiters.length) headerCells.push('')
    lines[index - 1] = `| ${headerCells.join(' | ')} |`
    lines[index] = `| ${delimiters.join(' | ')} |`
  }

  return lines.join('\n')
}
