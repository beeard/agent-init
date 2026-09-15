/**
 * Enforce the word ceilings in `doc-budgets.manifest.json`.
 *
 * A ceiling is either a number, for a document one layer owns outright, or an
 * object of per-layer contributions, for a document several layers add to. The
 * contributions are summed, because each layer needs its own share of the room
 * and a layer that replaced the shared value would silently cut off the layers
 * below it.
 *
 * A listed document that no longer exists fails too: a budgeted file that was
 * renamed or deleted must have its entry updated in the same change, or the
 * budget silently stops covering anything.
 *
 * `--list` prints current usage without failing.
 */

import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { isMain } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/**
 * Count whitespace-delimited tokens, matching `wc -w`.
 * @param text - File contents.
 * @returns The word count.
 */
function countWords(text) {
  return text.split(/\s+/u).filter(Boolean).length
}

/**
 * Resolve one manifest entry to a ceiling and its contributors.
 * @param value - A number, or an object of per-layer contributions.
 * @returns The total ceiling and the contributing entries, or an error message.
 */
function resolveCeiling(value) {
  if (Number.isInteger(value) && value > 0) return { ceiling: value, contributions: null, error: null }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ceiling: null, contributions: null, error: `ceiling must be a positive integer or an object of contributions, got ${JSON.stringify(value)}` }
  }
  const entries = Object.entries(value)
  if (entries.length === 0) return { ceiling: null, contributions: null, error: 'a contribution object needs at least one entry' }
  for (const [layer, amount] of entries) {
    if (!Number.isInteger(amount) || amount <= 0) {
      return { ceiling: null, contributions: null, error: `contribution "${layer}" must be a positive integer, got ${JSON.stringify(amount)}` }
    }
  }
  return { ceiling: entries.reduce((sum, [, amount]) => sum + amount, 0), contributions: entries, error: null }
}

/**
 * Compare every budgeted document against its ceiling.
 * @param root - Absolute repository root.
 * @returns Rows for display, one message per failure, and the entry count.
 */
export function checkDocBudgets(root) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'scripts', 'gates', 'doc-budgets.manifest.json'), 'utf8'))
  const rows = []
  const failures = []

  for (const [relPath, value] of Object.entries(manifest)) {
    const { ceiling, contributions, error } = resolveCeiling(value)
    if (error !== null) {
      rows.push(`BAD   ${'—'.padStart(6)} / ${'—'.padEnd(6)} ${relPath}`)
      failures.push(`${relPath}: ${error}`)
      continue
    }
    const detail = contributions === null ? '' : `  (${contributions.map(([layer, amount]) => `${layer} ${amount}`).join(' + ')})`
    const abs = resolve(root, relPath)
    if (!existsSync(abs)) {
      rows.push(`MISS  ${'—'.padStart(6)} / ${String(ceiling).padEnd(6)} ${relPath}${detail}`)
      failures.push(`${relPath}: budgeted document does not exist (update doc-budgets.manifest.json in the same change)`)
      continue
    }
    const words = countWords(readFileSync(abs, 'utf8'))
    rows.push(`${words <= ceiling ? 'ok  ' : 'OVER'}  ${String(words).padStart(6)} / ${String(ceiling).padEnd(6)} ${relPath}${detail}`)
    if (words > ceiling) {
      failures.push(`${relPath}: ${words} words exceeds the ${ceiling}-word ceiling${detail} — relocate, then condense, then justify a new ceiling`)
    }
  }

  return { rows, failures, count: Object.keys(manifest).length }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  if (process.argv.includes('--list')) {
    console.log(checkDocBudgets(ROOT).rows.join('\n'))
    return 0
  }
  const { failures, count } = checkDocBudgets(ROOT)
  if (failures.length > 0) {
    console.error('verify-doc-budgets failed:\n')
    for (const failure of failures) console.error(`  ${failure}`)
    console.error('\nSee docs/AGENTS.md for the relocation-first rule.')
    return 1
  }
  console.log(`verify-doc-budgets: ${count} budgeted document(s) within ceiling.`)
  return 0
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
