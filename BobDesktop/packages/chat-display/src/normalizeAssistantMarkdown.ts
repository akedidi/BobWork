/**
 * Repair streamed / imperfect assistant Markdown before a GFM renderer sees it.
 * Canonical display rule for Bob Desktop and Bob Mobile.
 */
export function normalizeAssistantMarkdown(markdown: string): string {
  const expandedLines: string[] = []
  let fence: { character: string; length: number } | null = null

  for (const originalLine of markdown.replace(/\r\n?/g, '\n').split('\n')) {
    const marker = originalLine.match(/^\s{0,3}(`{3,}|~{3,})/)
    const markerText = marker?.[1]
    if (fence) {
      expandedLines.push(originalLine)
      if (
        markerText
        && markerText[0] === fence.character
        && markerText.length >= fence.length
      ) {
        fence = null
      }
      continue
    }
    if (markerText) {
      fence = { character: markerText[0]!, length: markerText.length }
      expandedLines.push(originalLine)
      continue
    }

    let line = originalLine.replace(/^(\s{0,3})(#{1,6})(?=[^\s#])/, '$1$2 ')
    // Streaming can flatten a complete table onto one line. Identify the
    // delimiter block itself: an empty header such as `| | |---|---|` does
    // not contain the usual double-pipe boundary before that block.
    // Accept a single `|---|` too — 2-column summaries often stream as
    // `| Action | Résultat | |---| | row… |` and GFM needs a real break.
    const delimiterBlock = line.match(/\|(?:\s*:?-+:?\s*\|)+/)
    if (delimiterBlock?.index !== undefined) {
      const afterStart = delimiterBlock.index + delimiterBlock[0].length
      // Require another pipe *after* the delimiter block so we only unflatten
      // streamed tables, not borderless separator rows like `- | :- | --:`.
      if (line.includes('|', afterStart)) {
        let before = line.slice(0, delimiterBlock.index).trimEnd()
        const after = line.slice(afterStart).trimStart()
        // Bob occasionally emits `| | |---|---|`: the empty two-column header
        // has lost its final closing pipe while being streamed.
        if (/^\s*\|\s*\|\s*$/.test(before)) before = '| | |'
        line = [before, delimiterBlock[0], after].filter(Boolean).join('\n')
        line = line.replace(/\|\s*\|(?=\s*[^\s|\-])/g, '|\n|')
      }
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
    // Allow a single `|---|` separator: 2-column flattened summaries often
    // stream with one delimiter cell and must be padded to the header width.
    if (
      !delimiters
      || delimiters.length < 1
      || !delimiters.every(cell => /^:?-+:?$/.test(cell))
    ) {
      continue
    }
    if (/^\s*\|\s*\|\s*$/.test(lines[index - 1] ?? '')) {
      lines[index - 1] = '| | |'
    }
    for (let cellIndex = 0; cellIndex < delimiters.length; cellIndex += 1) {
      const delimiter = delimiters[cellIndex] ?? ''
      delimiters[cellIndex] =
        `${delimiter.startsWith(':') ? ':' : ''}---${delimiter.endsWith(':') ? ':' : ''}`
    }

    // A flattened block can leave prose/the heading directly before the first
    // header pipe. Move that prefix back to its own line.
    const precedingLine = lines[index - 1] ?? ''
    const firstPipe = precedingLine.indexOf('|')
    if (
      (lines[index] ?? '').trimStart().startsWith('|')
      && firstPipe > 0
      && precedingLine.slice(0, firstPipe).trim()
    ) {
      const prefix = precedingLine.slice(0, firstPipe).trimEnd()
      const header = precedingLine.slice(firstPipe)
      lines.splice(index - 1, 1, prefix, header)
      index += 1
    }

    const headerCells = tableCells(lines[index - 1] ?? '')
    if (!headerCells || headerCells.length < 2) continue

    // Some streamed responses omit the last separator cell even though the
    // header and data rows contain it, for example a 3-column action table
    // emitted as `|---|---|`. GFM rejects the whole table in that case.
    if (headerCells.length > delimiters.length) {
      while (delimiters.length < headerCells.length) delimiters.push('---')
      lines[index] = `| ${delimiters.join(' | ')} |`
      lines[index - 1] = `| ${headerCells.join(' | ')} |`
      continue
    }
    if (headerCells.length === delimiters.length) {
      lines[index - 1] = `| ${headerCells.join(' | ')} |`
      lines[index] = `| ${delimiters.join(' | ')} |`
      continue
    }

    // This is the malformed header emitted by the architecture report:
    // `Label Couleur` represents two data columns. Repair it semantically.
    const lastHeader = headerCells[headerCells.length - 1] ?? ''
    const splitHeader = lastHeader.match(/^(Label)\s+(Couleur|Color)$/i)
    if (headerCells.length + 1 === delimiters.length && splitHeader) {
      headerCells.splice(-1, 1, splitHeader[1] ?? '', splitHeader[2] ?? '')
    }

    // Keep other imperfect LLM tables renderable without inventing labels.
    while (headerCells.length < delimiters.length) headerCells.push('')
    lines[index - 1] = `| ${headerCells.join(' | ')} |`
    lines[index] = `| ${delimiters.join(' | ')} |`
  }

  return lines.join('\n')
}
