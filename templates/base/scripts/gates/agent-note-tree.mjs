/**
 * The structural source of truth for the decision-record tree.
 *
 * Imported by the format gate and runnable on its own as
 * `node scripts/gates/agent-note-tree.mjs`. Lifecycle and class sets are closed:
 * a folder outside them is an error, because a record filed under a folder the
 * walker does not know would be invisible to every gate.
 */

import { readdirSync, statSync } from 'node:fs'
import { resolve } from 'node:path'
import { isMain } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** Active lifecycles: the top-level folders under the notes directory. */
export const LIFECYCLES = ['proposed', 'implemented', 'rejected']

/** Closed set of record classes. Adding one is deliberate: update this list and the README. */
export const CLASSES = ['feature', 'bug-fix', 'simplification', 'architecture', 'process', 'testing']

/** Implemented records that have served their purpose live here, frozen. */
export const ARCHIVE = 'archived'

/** Non-record Markdown permitted directly at a lifecycle root. */
const ROOT_ALLOWLIST = new Set(['AGENTS.md', 'CLAUDE.md'])

/**
 * Absolute path to the decision-record tree.
 * @param root - Absolute repository root.
 * @returns Absolute path to the notes directory.
 */
export function notesRoot(root) {
  return resolve(root, '.agents', 'notes')
}

/**
 * Walk the record tree and enforce its structure.
 * @param root - Absolute repository root.
 * @returns Every valid record plus one message per structural violation.
 */
export function walkAgentNoteTree(root) {
  const base = notesRoot(root)
  const notes = []
  const errors = []

  let topLevel
  try {
    topLevel = readdirSync(base, { withFileTypes: true })
  } catch {
    return { notes, errors: [`structure: ${base} does not exist`] }
  }

  for (const entry of topLevel) {
    if (entry.name === 'INDEX.md') {
      errors.push('structure: INDEX.md — a centralized index is a second place to update; browse the tree or search instead')
      continue
    }
    if (!entry.isDirectory()) continue
    if (entry.name !== ARCHIVE && !LIFECYCLES.includes(entry.name)) {
      errors.push(`structure: ${entry.name}/ — unknown lifecycle folder (allowed: ${LIFECYCLES.join(', ')}, plus ${ARCHIVE}/)`)
    }
  }

  for (const lifecycle of LIFECYCLES) {
    for (const rel of listMarkdown(base, lifecycle)) {
      // `rel` is relative to the notes root, so it still carries the lifecycle.
      const segments = rel.split('/').slice(1)
      if (segments.length === 1 && ROOT_ALLOWLIST.has(segments[0])) continue
      if (segments.length !== 2) {
        errors.push(`structure: ${rel} — expected {lifecycle}/{class}/file.md (got depth ${segments.length + 1})`)
        continue
      }
      const [klass, filename] = segments
      if (!CLASSES.includes(klass)) {
        errors.push(`structure: ${rel} — unknown class folder "${klass}" (allowed: ${CLASSES.join(', ')})`)
        continue
      }
      if (!/^\d{4}-\d{2}-\d{2}-.+\.md$/u.test(filename)) {
        errors.push(`structure: ${rel} — filename must be yyyy-mm-dd-topic.md`)
        continue
      }
      notes.push({ lifecycle, rel, date: filename.slice(0, 10), klass })
    }
  }

  return { notes, errors }
}

/**
 * List Markdown paths below one directory, relative to it.
 * @param base - Absolute path to the notes directory.
 * @param sub - Directory path relative to `base`.
 * @returns Slash-separated relative paths, sorted.
 */
function listMarkdown(base, sub) {
  const out = []
  const visit = rel => {
    let entries
    try {
      entries = readdirSync(resolve(base, rel), { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const child = `${rel}/${entry.name}`
      const abs = resolve(base, child)
      if (entry.isDirectory()) {
        visit(child)
        continue
      }
      // A symlinked record is a record; following the link keeps the corpus
      // from shrinking silently when a file is linked rather than copied.
      if (!entry.name.endsWith('.md')) continue
      let isFile = entry.isFile()
      if (!isFile && entry.isSymbolicLink()) {
        try {
          isFile = statSync(abs).isFile()
        } catch {
          isFile = false
        }
      }
      if (isFile) out.push(child)
    }
  }
  visit(sub)
  return out.sort()
}

/**
 * Run the structural gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { notes, errors } = walkAgentNoteTree(ROOT)
  if (errors.length === 0) {
    console.log(`verify-agent-note-tree: ${notes.length} record(s) in a valid lifecycle/class layout.`)
    return 0
  }
  console.error('verify-agent-note-tree: violations found:')
  for (const error of errors) console.error(`  ${error}`)
  console.error('\nThe layout rule is in .agents/notes/README.md.')
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
