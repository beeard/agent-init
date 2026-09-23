/**
 * A line-oriented Markdown block scanner and a small inline tokenizer, enough
 * to enforce the one-physical-line-per-paragraph rule and to find every link
 * target without a parser dependency.
 *
 * Blocks follow CommonMark where the gates depend on them: fenced code opens on
 * three or more backticks or tildes and closes only on a run of the same
 * character at least as long, carrying no info string, indented at most three
 * spaces beyond its container; indented code needs four columns and cannot
 * interrupt a paragraph; a link reference definition starts a block but cannot
 * interrupt a paragraph either. Line endings are normalised first, so a CRLF
 * document reads exactly like an LF one.
 *
 * The scanner is deliberately conservative: it never rewrites, and it does not
 * model deeply nested list indentation or HTML block extents — a document using
 * those forms may need a manual exception.
 */

const HEADING = /^#{1,6}(?:[ \t]|$)/u
const TABLE_ROW = /^\|/u
const THEMATIC_BREAK = /^(?:(?:-[ \t]*){3,}|(?:\*[ \t]*){3,}|(?:_[ \t]*){3,})$/u
const SETEXT_UNDERLINE = /^(?:=+|-+)[ \t]*$/u
const HTML_BLOCK = /^</u
const CONTAINER = /^:::/u
const BLOCKQUOTE_PREFIX = /^ {0,3}>[ \t]?/u
const LIST_MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])([ \t]+|$)/u
const FENCE_OPEN = /^(`{3,}|~{3,})(.*)$/u
const FENCE_CLOSE = /^(`{3,}|~{3,})[ \t]*$/u
const DEFINITION = /^\[((?:\\.|[^\\[\]])+)\]:/u
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/u

/**
 * Normalise CRLF and lone CR line endings to LF.
 * @param source - File contents.
 * @returns The contents with `\n` line endings only.
 */
export function normalizeLineEndings(source) {
  return source.replace(/\r\n?/gu, '\n')
}

/**
 * Split source into lines, dropping a trailing empty element.
 * @param source - File contents, in any line-ending style.
 * @returns The lines.
 */
export function splitLines(source) {
  const lines = normalizeLineEndings(source).split('\n')
  if (lines.at(-1) === '') lines.pop()
  return lines
}

/**
 * Locate the exclusive end index of a leading YAML frontmatter block.
 * @param lines - Document lines.
 * @returns The index after the closing delimiter, or 0 when there is none.
 */
function frontmatterEnd(lines) {
  if (lines[0] !== '---') return 0
  const closing = lines.indexOf('---', 1)
  return closing === -1 ? 0 : closing + 1
}

/**
 * Measure a line's leading indentation in columns, a tab advancing to the next multiple of four.
 * @param line - A source line.
 * @returns The indentation width and the offset of the first non-blank character.
 */
function indentation(line) {
  let columns = 0
  let offset = 0
  while (offset < line.length && (line[offset] === ' ' || line[offset] === '\t')) {
    columns = line[offset] === '\t' ? columns + 4 - (columns % 4) : columns + 1
    offset++
  }
  return { columns, offset }
}

/**
 * Strip every leading blockquote marker from a line.
 * @param line - A source line.
 * @returns The line with blockquote markers removed.
 */
function stripBlockquote(line) {
  let current = line
  while (BLOCKQUOTE_PREFIX.test(current)) current = current.replace(BLOCKQUOTE_PREFIX, '')
  return current
}

/**
 * The block role of one source line.
 *
 * `kind` is one of `frontmatter`, `fence` (a delimiter or a line inside fenced
 * code), `indented` (indented code), `blank`, `heading`, `table`, `break`
 * (thematic break or setext underline), `html`, `container`, `definition`
 * (a link reference definition), or `text` (paragraph content).
 *
 * @typedef {object} LineBlock
 * @property {string} kind - The line's block role.
 * @property {boolean} listItem - Whether the line opens a list item.
 * @property {string} content - The inline content, with blockquote and list markers removed.
 */

/**
 * Classify every line of a document by its block role.
 * @param lines - Document lines, already split.
 * @returns One entry per line, in order.
 */
export function classifyLines(lines) {
  const blocks = []
  const bodyStart = frontmatterEnd(lines)
  let fence = null
  let listIndent = null
  let previous = 'blank'

  for (let index = 0; index < lines.length; index++) {
    const raw = lines[index] ?? ''
    const push = (kind, extra = {}) => {
      blocks.push({ kind, listItem: false, content: '', ...extra })
      previous = kind
    }

    if (index < bodyStart) {
      push('frontmatter')
      continue
    }

    const unquoted = stripBlockquote(raw)
    const { columns, offset } = indentation(unquoted)
    const rest = unquoted.slice(offset)

    if (fence !== null) {
      const closing = FENCE_CLOSE.exec(rest)
      if (closing !== null && closing[1][0] === fence.char && closing[1].length >= fence.length
        && columns <= fence.container + 3) {
        fence = null
      }
      push('fence')
      continue
    }

    if (rest === '') {
      push('blank')
      continue
    }

    // Inside a list item, indentation up to the item's content column belongs
    // to the item rather than to an indented code block.
    const container = listIndent !== null && columns >= listIndent ? listIndent : 0
    if (listIndent !== null && columns < listIndent && !LIST_MARKER.test(unquoted)) listIndent = null
    const relative = columns - container

    if (relative >= 4 && previous !== 'text' && previous !== 'definition') {
      push('indented')
      continue
    }

    const opening = FENCE_OPEN.exec(rest)
    if (opening !== null && !(opening[1][0] === '`' && opening[2].includes('`'))) {
      fence = { char: opening[1][0], length: opening[1].length, container }
      push('fence')
      continue
    }

    if (HEADING.test(rest)) {
      push('heading', { content: rest.replace(/^#{1,6}/u, '') })
      continue
    }
    if (TABLE_ROW.test(rest)) {
      push('table', { content: rest })
      continue
    }
    if (THEMATIC_BREAK.test(rest) || (previous === 'text' && SETEXT_UNDERLINE.test(rest))) {
      push('break')
      continue
    }
    if (HTML_BLOCK.test(rest)) {
      push('html')
      continue
    }
    if (CONTAINER.test(rest)) {
      push('container')
      continue
    }

    const marker = LIST_MARKER.exec(unquoted)
    if (marker !== null) {
      const markerWidth = indentation(marker[1]).columns + marker[2].length
      listIndent = markerWidth + Math.max(1, Math.min(indentation(marker[3]).columns, 4))
      const content = unquoted.slice(marker[0].length)
      if (content.trim() === '') {
        push('blank', { listItem: true })
        continue
      }
      push('text', { listItem: true, content })
      continue
    }

    if (previous !== 'text' && DEFINITION.test(rest)) {
      push('definition', { content: rest })
      continue
    }

    push('text', { content: rest })
  }

  return blocks
}

/**
 * Whether a classified line is code, and so carries no Markdown structure.
 * @param block - One entry from `classifyLines`.
 * @returns True for fenced and indented code lines.
 */
export function isCode(block) {
  return block.kind === 'fence' || block.kind === 'indented'
}

/**
 * One paragraph continuation found in a document.
 * @typedef {object} WrappedParagraph
 * @property {number} line - 1-based line where the paragraph continues.
 * @property {string} text - The offending continuation line, trimmed.
 */

/**
 * Find every line that continues a paragraph started on an earlier line.
 * @param source - The Markdown document.
 * @returns One entry per violating line, in source order.
 */
export function findWrappedParagraphs(source) {
  const lines = splitLines(source)
  const blocks = classifyLines(lines)
  const violations = []

  for (let index = 1; index < blocks.length; index++) {
    const block = blocks[index]
    // A list marker opens a new block; any other text line directly after a
    // text line continues the same paragraph.
    if (block.kind === 'text' && !block.listItem && blocks[index - 1].kind === 'text') {
      violations.push({ line: index + 1, text: lines[index].trim() })
    }
  }

  return violations
}

/**
 * Skip a code span opening at `start`, when it has a matching closing run.
 * @param text - Inline content.
 * @param start - Offset of the first backtick.
 * @returns The offset after the span, or -1 when the run is literal.
 */
function skipCodeSpan(text, start) {
  let end = start
  while (text[end] === '`') end++
  const run = end - start
  let cursor = end
  while (cursor < text.length) {
    const next = text.indexOf('`', cursor)
    if (next === -1) return -1
    let close = next
    while (text[close] === '`') close++
    if (close - next === run) return close
    cursor = close
  }
  return -1
}

/**
 * Find the `]` that closes link text opening at `start`.
 * @param text - Inline content.
 * @param start - Offset of the opening `[`.
 * @returns The offset of the matching `]`, or -1.
 */
function closingBracket(text, start) {
  let depth = 0
  for (let index = start; index < text.length; index++) {
    const character = text[index]
    if (character === '\\' && ASCII_PUNCTUATION.test(text[index + 1] ?? '')) {
      index++
    } else if (character === '`') {
      const after = skipCodeSpan(text, index)
      if (after !== -1) index = after - 1
      else while (text[index + 1] === '`') index++
    } else if (character === '[') {
      depth++
    } else if (character === ']') {
      depth--
      if (depth === 0) return index
    }
  }
  return -1
}

/**
 * Resolve backslash escapes in a link destination.
 * @param value - The raw destination.
 * @returns The destination with escapes removed.
 */
function unescape(value) {
  return value.replace(/\\([!-/:-@[-`{-~])/gu, '$1')
}

/**
 * Skip spaces, tabs, and at most one line ending.
 * @param text - Inline content.
 * @param start - Offset to start at.
 * @returns The offset of the next non-blank character.
 */
function skipWhitespace(text, start) {
  let index = start
  let newlines = 0
  while (index < text.length && (text[index] === ' ' || text[index] === '\t' || text[index] === '\n')) {
    if (text[index] === '\n' && ++newlines > 1) break
    index++
  }
  return index
}

/**
 * Parse a link destination.
 * @param text - Inline content.
 * @param start - Offset where the destination begins.
 * @returns The destination and the offset after it, or null when malformed.
 */
function parseDestination(text, start) {
  if (text[start] === '<') {
    for (let index = start + 1; index < text.length; index++) {
      const character = text[index]
      if (character === '\\' && ASCII_PUNCTUATION.test(text[index + 1] ?? '')) index++
      else if (character === '\n' || character === '<') return null
      else if (character === '>') return { target: unescape(text.slice(start + 1, index)), end: index + 1 }
    }
    return null
  }
  let depth = 0
  let index = start
  for (; index < text.length; index++) {
    const character = text[index]
    if (character === '\\' && ASCII_PUNCTUATION.test(text[index + 1] ?? '')) {
      index++
    } else if (character === '(') {
      depth++
    } else if (character === ')') {
      if (depth === 0) break
      depth--
    } else if (/[\s\p{Cc}]/u.test(character)) {
      break
    }
  }
  if (depth !== 0) return null
  return { target: unescape(text.slice(start, index)), end: index }
}

/**
 * Parse an optional link title.
 * @param text - Inline content.
 * @param start - Offset where the title would begin.
 * @returns The offset after the title, or -1 when a title opens but never closes.
 */
function skipTitle(text, start) {
  const opener = text[start]
  const closer = { '"': '"', '\'': '\'', '(': ')' }[opener]
  if (closer === undefined) return start
  for (let index = start + 1; index < text.length; index++) {
    const character = text[index]
    if (character === '\\' && ASCII_PUNCTUATION.test(text[index + 1] ?? '')) index++
    else if (opener === '(' && character === '(') return -1
    else if (character === closer) return index + 1
  }
  return -1
}

/**
 * Parse the `(destination "title")` part of an inline link.
 * @param text - Inline content.
 * @param start - Offset of the `(`.
 * @returns The destination and the offset after `)`, or null when it is not an inline link.
 */
function parseInlineLink(text, start) {
  let index = skipWhitespace(text, start + 1)
  if (text[index] === ')') return { target: '', end: index + 1 }
  const destination = parseDestination(text, index)
  if (destination === null) return null
  index = destination.end
  const beforeTitle = skipWhitespace(text, index)
  if (beforeTitle > index || text[beforeTitle] === ')') {
    const afterTitle = skipTitle(text, beforeTitle)
    if (afterTitle === -1) return null
    index = skipWhitespace(text, afterTitle)
  }
  if (text[index] !== ')') return null
  return { target: destination.target, end: index + 1 }
}

/**
 * Collect inline link destinations from one run of inline content.
 * @param text - Inline content, possibly spanning lines joined by `\n`.
 * @param out - Sink receiving `{ target, offset }` with the offset of each link.
 */
function scanInline(text, out) {
  for (let index = 0; index < text.length; index++) {
    const character = text[index]
    if (character === '\\' && ASCII_PUNCTUATION.test(text[index + 1] ?? '')) {
      index++
      continue
    }
    if (character === '`') {
      const after = skipCodeSpan(text, index)
      if (after !== -1) index = after - 1
      else while (text[index + 1] === '`') index++
      continue
    }
    if (character === '<') {
      // An autolink is a destination of its own and never a relative path.
      const autolink = /^<[A-Za-z][A-Za-z0-9+.-]{1,31}:[^\s<>]*>/u.exec(text.slice(index))
      if (autolink !== null) index += autolink[0].length - 1
      continue
    }
    if (character !== '[') continue
    const close = closingBracket(text, index)
    if (close === -1) continue
    if (text[close + 1] !== '(') continue
    const link = parseInlineLink(text, close + 1)
    if (link === null) continue
    out.push({ target: link.target, offset: index })
    // Link text may itself hold an image, as in a badge that links elsewhere.
    const inner = []
    scanInline(text.slice(index + 1, close), inner)
    for (const found of inner) out.push({ target: found.target, offset: index + 1 + found.offset })
    index = link.end - 1
  }
}

/**
 * Parse a link reference definition.
 * @param text - The definition line, stripped of indentation.
 * @param next - The following line, which may hold the title.
 * @returns The destination and whether the title consumed the next line, or null.
 */
function parseDefinition(text, next) {
  const label = DEFINITION.exec(text)
  if (label === null || label[1].trim() === '' || label[1].startsWith('^')) return null
  let index = skipWhitespace(text, label[0].length)
  if (index >= text.length) return null
  const destination = parseDestination(text, index)
  if (destination === null || (destination.target === '' && text[index] !== '<')) return null
  index = skipWhitespace(text, destination.end)
  if (index < text.length) {
    if (index === destination.end) return null
    const afterTitle = skipTitle(text, index)
    if (afterTitle === -1 || afterTitle === index || text.slice(afterTitle).trim() !== '') return null
    return { target: destination.target, consumesNext: false }
  }
  const titled = next === undefined ? -1 : skipTitle(next.trim(), 0)
  const consumesNext = titled > 0 && next.trim().slice(titled).trim() === ''
  return { target: destination.target, consumesNext }
}

/**
 * Extract every Markdown link target from a document.
 *
 * Inline links and images contribute their destination, and every link
 * reference definition contributes its own: a reference-style link resolves to
 * a definition, so checking the definitions checks every reference. Code spans,
 * fenced and indented code, frontmatter, raw HTML lines, and autolinks are
 * skipped.
 *
 * @param source - The Markdown document.
 * @returns Targets in source order, with the 1-based line of each.
 */
export function extractLinkTargets(source) {
  const lines = splitLines(source)
  const blocks = classifyLines(lines)
  const targets = []
  let unit = null

  const flush = () => {
    if (unit === null) return
    const found = []
    scanInline(unit.text, found)
    for (const { target, offset } of found) {
      const line = unit.starts.findLastIndex(start => start <= offset)
      targets.push({ target, line: unit.lines[line] })
    }
    unit = null
  }

  for (let index = 0; index < blocks.length; index++) {
    const block = blocks[index]
    if (block.kind === 'definition') {
      flush()
      const definition = parseDefinition(block.content, lines[index + 1])
      if (definition !== null) {
        targets.push({ target: definition.target, line: index + 1 })
        if (definition.consumesNext) index++
        continue
      }
    }
    const continues = block.kind === 'text' && !block.listItem && unit !== null && unit.paragraph
    if (!continues) flush()
    if (!['text', 'heading', 'table', 'definition'].includes(block.kind)) continue
    if (unit === null) unit = { text: '', starts: [], lines: [], paragraph: block.kind === 'text' || block.kind === 'definition' }
    else unit.text += '\n'
    unit.starts.push(unit.text.length)
    unit.lines.push(index + 1)
    unit.text += block.content
    if (!unit.paragraph) flush()
  }
  flush()

  return targets.sort((a, b) => a.line - b.line)
}
