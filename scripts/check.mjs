#!/usr/bin/env node
/**
 * Verify this package against its own product.
 *
 * Two runs, deliberately:
 *
 * 1. **The package's own documents** — its standing orders, README, design
 *    note, and decision records.
 * 2. **Composed scaffolds** — the templates are applied through the real
 *    scaffolder into throwaway directories, and the gates that a receiving
 *    repository would run are run there. This checks the artifact rather than
 *    the source: `templates/architecture/` is a partial overlay whose relative
 *    links are written for the composed tree, so checking it in place would
 *    report failures that no receiving repository would ever see.
 *
 * The second run is the one that matters. A template that would fail in a fresh
 * repository fails here first.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkAgentNoteTree } from '../templates/base/scripts/gates/agent-note-tree.mjs'
import { checkAgentNoteFormat } from '../templates/base/scripts/gates/verify-agent-note-format.mjs'
import { checkDocBudgets } from '../templates/base/scripts/gates/verify-doc-budgets.mjs'
import { checkMarkdownLinks } from '../templates/base/scripts/gates/verify-md-links.mjs'
import { checkMarkdownWrap } from '../templates/base/scripts/gates/verify-md-wrap.mjs'
import { applyPlan } from '../src/apply.mjs'
import { buildPlan } from '../src/plan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TEMPLATES = resolve(ROOT, 'templates')

/**
 * Run every gate for one root and normalise the results.
 * @param root - Absolute repository root to check.
 * @param label - Prefix for a failure message, so the two runs stay distinct.
 * @returns One entry per gate.
 */
function runGates(root, label) {
  const tree = walkAgentNoteTree(root)
  const wrap = checkMarkdownWrap(root)
  const links = checkMarkdownLinks(root)
  const budgets = checkDocBudgets(root)
  const tag = message => `${label}${message}`

  return [
    { name: 'agent-note-tree', checked: `${tree.notes.length} record(s)`, failures: tree.errors.map(tag) },
    { name: 'verify-agent-note-format', checked: `${tree.notes.length} record(s)`, failures: checkAgentNoteFormat(root).map(tag) },
    {
      name: 'verify-md-wrap',
      checked: `${wrap.checked} file(s)`,
      failures: wrap.violations.map(v => tag(`${v.relPath}:${v.line}  ${v.text.slice(0, 70)}`)),
    },
    {
      name: 'verify-md-links',
      checked: `${links.checked} file(s)`,
      failures: links.violations.map(v => tag(`${v.relPath}:${v.line}  ${v.target} — ${v.reason}`)),
    },
    { name: 'verify-doc-budgets', checked: `${budgets.count} document(s)`, failures: budgets.failures.map(tag) },
  ]
}

/**
 * Apply a scaffold into a throwaway directory, without Git.
 *
 * The composed tree is what a receiving repository gets, and it is the only
 * correct thing to check: a layer directory is a partial overlay whose relative
 * links are written for the composed result, and whose manifests deliberately
 * list only the entries that layer contributes. Checking a layer in place would
 * report failures no receiving repository would ever see.
 *
 * @param options - Options for `buildPlan`.
 * @returns The absolute path to the scaffolded tree.
 */
function composeScaffold(options) {
  const dir = mkdtempSync(join(tmpdir(), 'agent-init-check-'))
  const plan = buildPlan({
    targetDir: dir,
    templatesRoot: TEMPLATES,
    projectName: 'check',
    skills: ['agent-notes', 'pre-push-checks', 'prose-standard', 'code-review'],
    ...options,
  })
  applyPlan(plan, { hooks: false })
  return dir
}

/**
 * The composed scaffolds to verify, as `{ label, options }`.
 * @returns The scaffold matrix.
 */
function scaffolds() {
  return [
    { label: '[base] ', options: { stack: [], architecture: false } },
    { label: '[python] ', options: { stack: ['python'], architecture: false } },
    { label: '[architecture] ', options: { stack: [], architecture: true } },
    { label: '[python+arch] ', options: { stack: ['python'], architecture: true } },
  ]
}

/**
 * Restore the package's own gate configuration, which the composed runs read
 * from the scaffold and the package run reads from the package.
 * @param root - Absolute package root.
 * @returns The configuration the package run needs.
 */
function packageConfig(root) {
  return JSON.parse(readFileSync(resolve(root, 'scripts', 'gates', 'config.json'), 'utf8'))
}

let failed = 0
let total = 0

const packageRootConfig = packageConfig(ROOT)
if (packageRootConfig.markdownGlobs.some(glob => glob.startsWith('templates/'))) {
  console.error('scripts/gates/config.json must not scan templates/ directly; the composed runs cover them.')
  process.exitCode = 1
} else {
  for (const result of runGates(ROOT, '[package] ')) {
    total++
    if (result.failures.length === 0) {
      console.log(`ok    ${result.name.padEnd(26)} ${result.checked}`)
      continue
    }
    failed++
    console.error(`FAIL  ${result.name.padEnd(26)} ${result.checked}`)
    for (const failure of result.failures) console.error(`      ${failure}`)
  }
}

for (const { label, options } of scaffolds()) {
  const dir = composeScaffold(options)
  try {
    const results = runGates(dir, label)
    total += results.length
    const failures = results.flatMap(result => result.failures)
    if (failures.length === 0) {
      console.log(`ok    ${label.trim().padEnd(26)} composed scaffold passes every gate`)
      continue
    }
    failed += results.length
    console.error(`FAIL  ${label.trim().padEnd(26)} composed scaffold`)
    for (const failure of failures) console.error(`      ${failure}`)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (failed > 0) {
  console.error(`\n${failed} check group(s) failed.`)
  process.exitCode = 1
} else {
  console.log(`\n${total} check group(s) passed.`)
}
