/**
 * A line-oriented Markdown block scanner, enough to enforce the
 * one-physical-line-per-paragraph rule without a parser dependency.
 *
 * The scanner is deliberately conservative: it identifies block starts
 * (headings, fences, tables, thematic breaks, setext underlines, raw HTML,
 * containers, list markers, indented code) and reports any line that continues
 * a paragraph begun on an earlier line. It never rewrites, and it does not
 * model link reference definitions or deeply nested list indentation — a
 * document using those forms may need a manual exception.
 */

const FENCE = /^\s*(`{3,}|~{3,})/u
const HEADING = /^\s*#{1,6}(?:\s|$)/u
const TABLE_ROW = /^\s*\|/u
const THEMATIC_BREAK = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/u
const SETEXT_UNDERLINE = /^\s*(?:=+|-+)\s*$/u
const HTML_BLOCK = /^\s*</u
const CONTAINER = /^\s*:::/u
const BLOCKQUOTE_PREFIX = /^\s*>\s?/u
const LIST_MARKER = /^(\s*)(?:[-*+]|\d{1,9}[.)])(\s+)/u
const INDENTED_CODE = /^ {4,}\S/u

/**
 * Split source into lines, dropping a trailing empty element.
 * @param source - File contents.
 * @returns The lines.
 */
function toLines(source) {
  const lines = source.split('\n')
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
  const lines = toLines(source)
  const bodyStart = frontmatterEnd(lines)
  const violations = []
  let inFence = false
  let fenceMarker = ''
  let previousWasProse = false
  let previousWasBlank = true

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const lineNumber = index + 1

    if (index < bodyStart) {
      previousWasProse = false
      previousWasBlank = false
      continue
    }

    if (inFence) {
      const closing = FENCE.exec(line)
      if (closing !== null && closing[1].startsWith(fenceMarker[0])) {
        inFence = false
        fenceMarker = ''
      }
      previousWasProse = false
      previousWasBlank = false
      continue
    }

    const opening = FENCE.exec(line)
    if (opening !== null) {
      inFence = true
      fenceMarker = opening[1]
      previousWasProse = false
      previousWasBlank = false
      continue
    }

    if (line.trim() === '') {
      previousWasProse = false
      previousWasBlank = true
      continue
    }

    if (INDENTED_CODE.test(line) && previousWasBlank) {
      previousWasProse = false
      previousWasBlank = false
      continue
    }

    if (HEADING.test(line)
      || TABLE_ROW.test(line)
      || THEMATIC_BREAK.test(line)
      || SETEXT_UNDERLINE.test(line)
      || HTML_BLOCK.test(line)
      || CONTAINER.test(line)) {
      previousWasProse = false
      previousWasBlank = false
      continue
    }

    const unquoted = stripBlockquote(line)
    const marker = LIST_MARKER.exec(unquoted)
    const content = marker === null ? unquoted : unquoted.slice(marker[0].length)

    if (content.trim() === '') {
      previousWasProse = false
      previousWasBlank = false
      continue
    }

    // A list marker opens a new block; anything else that follows prose on a
    // later line is a continuation of the same paragraph.
    if (previousWasProse && marker === null) {
      violations.push({ line: lineNumber, text: line.trim() })
    }

    previousWasProse = true
    previousWasBlank = false
  }

  return violations
}

/**
 * Extract every Markdown link target from a document.
 * @param source - The Markdown document.
 * @returns Targets in source order, with the 1-based line of each. Targets
 * inside fenced code blocks are skipped.
 */
export function extractLinkTargets(source) {
  const lines = toLines(source)
  const targets = []
  let inFence = false
  let fenceMarker = ''

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? ''
    const fence = FENCE.exec(line)
    if (fence !== null) {
      if (!inFence) {
        inFence = true
        fenceMarker = fence[1]
      } else if (fence[1].startsWith(fenceMarker[0])) {
        inFence = false
        fenceMarker = ''
      }
      continue
    }
    if (inFence) continue
    for (const match of line.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/gu)) {
      targets.push({ target: match[1], line: index + 1 })
    }
  }

  return targets
}
