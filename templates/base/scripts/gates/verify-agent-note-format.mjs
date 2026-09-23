/**
 * Enforce the record header, the lifecycle-specific sections, and the mandatory
 * alternatives section. Structure and filenames belong to the sibling tree gate;
 * the exact format is documented in `.agents/notes/README.md`.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { notesRoot, walkAgentNoteTree } from './agent-note-tree.mjs'
import { classifyLines, isCode, splitLines } from './lib/markdown.mjs'
import { isMain } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** The status-line grammar each lifecycle folder requires. */
const STATUS = {
  proposed: /^Status: proposed$/u,
  implemented: /^Status: implemented$/u,
  rejected: /^Status: rejected — .+$/u,
}

/** Sections every record of a lifecycle must carry, beyond `## Problem`. */
const REQUIRED = {
  proposed: ['## Proposal', '## Acceptance criteria', '## Risks'],
  implemented: ['## Decision', '## Consequences'],
  rejected: ['## Proposal'],
}

/** Headings that are proposal-era spec-speak and may not appear in an implemented record. */
const BANNED_IN_IMPLEMENTED = /^## (?:Proposal|Plan|Migration plan|Acceptance criteria)\b/iu

/**
 * Check every record against the format rules.
 * @param root - Absolute repository root.
 * @returns One message per violation.
 */
export function checkAgentNoteFormat(root) {
  const { notes, errors } = walkAgentNoteTree(root)
  const base = notesRoot(root)

  for (const note of notes) {
    const fail = message => errors.push(`format: ${note.rel} — ${message}`)
    // Code is dropped so format tokens shown as examples are not read as structure.
    const lines = splitLines(readFileSync(resolve(base, note.rel), 'utf8'))
    const blocks = classifyLines(lines)
    const prose = lines.filter((_, index) => !isCode(blocks[index]))

    if (!/^# Decision Record: \S/u.test(lines[0] ?? '')) fail('line 1 must be `# Decision Record: <title>`')
    if (lines[1] !== '') fail('line 2 must be blank')
    const status = STATUS[note.lifecycle]
    if (!status.test(lines[2] ?? '')) {
      fail(`line 3 must match the ${note.lifecycle} status grammar (${String(status)})`)
    }
    if (lines[3] !== '') fail('line 4 must be blank')
    if (prose.filter(line => line.startsWith('Status:')).length !== 1) {
      fail('the line-3 `Status:` line must be the only `Status:` line in the file')
    }

    const headings = prose.filter(line => line.startsWith('## ')).map(line => line.trimEnd())
    if (headings[0] !== '## Problem') {
      fail(`the first section must be \`## Problem\` (got ${JSON.stringify(headings[0] ?? '<none>')})`)
    }
    for (const required of REQUIRED[note.lifecycle] ?? []) {
      if (!headings.includes(required)) fail(`missing the required \`${required}\` section`)
    }
    if (note.lifecycle === 'implemented') {
      for (const heading of headings.filter(h => BANNED_IN_IMPLEMENTED.test(h))) {
        fail(`\`${heading}\` is a proposal-era heading; an implemented record states what is`)
      }
    }
    if (!headings.includes('## Alternatives considered')) {
      fail('missing `## Alternatives considered` — a decision recorded without what it beat invites re-litigation')
    }
  }

  return errors
}

/**
 * Run the format gate as a command.
 * @returns Process exit code.
 */
function main() {
  const errors = checkAgentNoteFormat(ROOT)
  if (errors.length === 0) {
    const { notes } = walkAgentNoteTree(ROOT)
    console.log(`verify-agent-note-format: ${notes.length} record(s) conform to .agents/notes/README.md.`)
    return 0
  }
  console.error('verify-agent-note-format: violations found:')
  for (const error of errors) console.error(`  ${error}`)
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
