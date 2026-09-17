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
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { walkAgentNoteTree } from '../templates/base/scripts/gates/agent-note-tree.mjs'
import { checkAgentNoteFormat } from '../templates/base/scripts/gates/verify-agent-note-format.mjs'
import { checkDocBudgets } from '../templates/base/scripts/gates/verify-doc-budgets.mjs'
import { checkFinalNewline } from '../templates/base/scripts/gates/verify-final-newline.mjs'
import { checkIssueTags } from '../templates/base/scripts/gates/verify-issue-tags.mjs'
import { checkMarkdownLinks } from '../templates/base/scripts/gates/verify-md-links.mjs'
import { checkMarkdownWrap } from '../templates/base/scripts/gates/verify-md-wrap.mjs'
import { applyPlan } from '../src/apply.mjs'
import { BASE_SKILLS, STACKS, buildPlan } from '../src/plan.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(HERE, '..')
const TEMPLATES = resolve(ROOT, 'templates')

/**
 * Run every base gate for one root and normalise the results.
 *
 * `count` is the size of the corpus each gate judged. A gate whose corpus is
 * empty has passed without checking anything, so a zero count is reported as a
 * failure for the gates that read files (`corpus: true`) rather than printed as
 * a clean run.
 *
 * @param root - Absolute repository root to check.
 * @param label - Prefix for a failure message, so the two runs stay distinct.
 * @returns One entry per gate.
 */
function runGates(root, label) {
  const tree = walkAgentNoteTree(root)
  const wrap = checkMarkdownWrap(root)
  const links = checkMarkdownLinks(root)
  const budgets = checkDocBudgets(root)
  const newline = checkFinalNewline(root)
  const tags = checkIssueTags(root)
  const tag = message => `${label}${message}`

  // A gate that reads files and judged none of them has passed without checking
  // anything, so each entry's own count decides whether that is a failure. A
  // new file-reading gate is covered by marking it `corpus: true`.
  const gate = ({ name, count, checked, failures, corpus = false }) => ({
    name,
    count,
    checked,
    failures: corpus && count === 0 ? [...failures, tag('corpus is empty; the gate checked nothing')] : failures,
  })

  return [
    gate({ name: 'agent-note-tree', count: tree.notes.length, checked: `${tree.notes.length} record(s)`, failures: tree.errors.map(tag) }),
    gate({
      name: 'verify-agent-note-format',
      count: tree.notes.length,
      checked: `${tree.notes.length} record(s)`,
      failures: checkAgentNoteFormat(root).map(tag),
    }),
    gate({
      name: 'verify-md-wrap',
      corpus: true,
      count: wrap.checked,
      checked: `${wrap.checked} file(s)`,
      failures: wrap.violations.map(v => tag(`${v.relPath}:${v.line}  ${v.text.slice(0, 70)}`)),
    }),
    gate({
      name: 'verify-md-links',
      corpus: true,
      count: links.checked,
      checked: `${links.checked} file(s)`,
      failures: links.violations.map(v => tag(`${v.relPath}:${v.line}  ${v.target} — ${v.reason}`)),
    }),
    gate({
      name: 'verify-final-newline',
      corpus: true,
      count: newline.checked,
      checked: `${newline.checked} file(s)`,
      failures: newline.violations.map(v => tag(`${v.relPath}  ${v.reason}`)),
    }),
    gate({
      name: 'verify-doc-budgets',
      corpus: true,
      count: budgets.count,
      checked: `${budgets.count} document(s)`,
      failures: budgets.failures.map(tag),
    }),
    gate({
      name: 'verify-issue-tags',
      corpus: true,
      count: tags.checked,
      checked: `${tags.checked} file(s), ${tags.markers.length} marker(s)`,
      failures: tags.nameless.map(m => tag(`${m.relPath}:${m.line}  ${m.tag} names nothing`)),
    }),
  ]
}

/**
 * Run a composed scaffold's own gate suite as a receiving repository would.
 *
 * The base-gate checks above import their gate modules directly, so they never
 * execute a stack gate. This runs the shipped `run.mjs` instead, which walks
 * the composed `gates.json` and so covers every registered gate — including the
 * stack layers'. Stack gates ship advisory, so a missing toolchain reports
 * without failing, which is what keeps this check portable.
 *
 * @param dir - Absolute path to the composed scaffold.
 * @returns Exit code and combined output.
 */
function runComposedSuite(dir) {
  const result = spawnSync(process.execPath, [join(dir, 'scripts', 'gates', 'run.mjs'), '--group', 'full'], {
    cwd: dir,
    encoding: 'utf8',
    timeout: 300_000,
    maxBuffer: 64 * 1024 * 1024,
  })
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd()
  // A spawn failure or a buffer overflow leaves no status, and a status of 1
  // with empty output would read as a gate finding rather than as the suite
  // never having run. Both are named.
  if (result.error !== undefined) {
    return { code: 1, output: `the composed suite did not run: ${result.error.message}\n${output}`.trimEnd() }
  }
  if (typeof result.status !== 'number') {
    return { code: 1, output: `the composed suite was terminated by ${String(result.signal)}\n${output}`.trimEnd() }
  }
  return { code: result.status, output }
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
    skills: BASE_SKILLS,
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
  const combinations = [
    { label: '[base] ', stack: [], architecture: false },
    { label: '[architecture] ', stack: [], architecture: true },
  ]
  for (const name of STACKS) {
    combinations.push({ label: `[${name}] `, stack: [name], architecture: false })
    combinations.push({ label: `[${name}+arch] `, stack: [name], architecture: true })
  }
  // Every layer at once. A layer that replaces a shared value instead of
  // contributing to it composes correctly for one layer and breaks here, which
  // is how the document budgets were found overwriting each other.
  combinations.push({ label: '[all] ', stack: [...STACKS], architecture: true })
  combinations.push({ label: '[two stacks] ', stack: [...STACKS].slice(0, 2), architecture: false })
  return combinations.map(({ label, ...options }) => ({ label, options }))
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
  // A configuration that scans templates/ judges the source rather than the
  // composed artifact, which is the one thing this script exists to avoid.
  total++
  failed++
  console.error('FAIL  package gate config        scripts/gates/config.json must not scan templates/ directly; the composed runs cover them.')
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
    } else {
      failed++
      console.error(`FAIL  ${label.trim().padEnd(26)} composed scaffold`)
      for (const failure of failures) console.error(`      ${failure}`)
    }

    // The checks above import their gate modules, so no stack gate runs there.
    // The composed suite is what proves every registered gate actually starts.
    total++
    const suite = runComposedSuite(dir)
    if (suite.code === 0) {
      console.log(`ok    ${label.trim().padEnd(26)} composed gate suite runs`)
    } else {
      failed++
      console.error(`FAIL  ${label.trim().padEnd(26)} composed gate suite`)
      for (const line of suite.output.split('\n')) console.error(`      ${line}`)
    }
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
