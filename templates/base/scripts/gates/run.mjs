/**
 * Run the gates registered in `gates.json`.
 *
 * Every gate runs as a child process, so one crashing does not hide the results
 * of the others. A gate marked `advisory` reports its findings without failing
 * the run, whether it exits non-zero or cannot be run at all.
 *
 * Usage:
 *   node scripts/gates/run.mjs                 # the whole-repository suite
 *   node scripts/gates/run.mjs --group commit  # what the pre-commit hook runs
 *   node scripts/gates/run.mjs --group full    # the same as the default
 *   node scripts/gates/run.mjs --list          # what would run, and when
 *
 * The `commit` group judges what the commit will contain, not the working tree.
 * The index is materialised into a temporary tree, every gate runs from that
 * tree as its repository root, and each receives `--staged`, which restricts it
 * to the files staged for commit; a gate that does not support the flag ignores
 * it. Inside that tree `GIT_DIR` and `GIT_WORK_TREE` name the real repository,
 * so a gate's own `git diff --cached` still lists the staged paths. Gate files
 * and dependency directories the index does not carry are taken from the
 * working tree, so the tooling runs before it is committed. The temporary tree
 * is removed afterwards.
 */

import { cpSync, existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, symlinkSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { REPOSITORY_SKIP_DIRECTORIES, declaredSkipDirectories, isMain, readConfig } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')
const MANIFEST = resolve(ROOT, 'scripts', 'gates', 'gates.json')

/** The groups a caller may select, in the order the default run applies them. */
export const GROUPS = ['commit', 'full']

/** Output a gate may produce before it is cut off, far beyond any report a reader scrolls. */
export const MAX_GATE_OUTPUT = 256 * 1024 * 1024

/**
 * Read the gate manifest.
 * @param root - Absolute repository root.
 * @returns Gate entries keyed by script name.
 */
export function readGates(root) {
  return JSON.parse(readFileSync(resolve(root, 'scripts', 'gates', 'gates.json'), 'utf8'))
}

/**
 * Select the gates a group runs.
 * @param gates - Gate entries keyed by script name.
 * @param group - A group name, or null for every group.
 * @returns Selected `[script, entry]` pairs in manifest order.
 */
export function selectGates(gates, group) {
  return Object.entries(gates).filter(([, entry]) => (entry.groups ?? []).includes(group))
}

/**
 * Run one gate as a child process.
 * @param root - Absolute root the gate runs against.
 * @param script - Gate filename.
 * @param args - Extra arguments, such as `--staged`.
 * @param options - `env` for the child and `maxBuffer` for its output.
 * @returns Exit code, combined output, and any spawn error.
 */
function runGate(root, script, args, { env = process.env, maxBuffer = MAX_GATE_OUTPUT } = {}) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', 'gates', script), ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
    maxBuffer,
  })
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd(),
    error: result.error,
  }
}

/**
 * Run Git and require success.
 * @param args - Git arguments.
 * @param options - Spawn options.
 * @returns Trimmed stdout.
 */
function git(args, options) {
  const result = spawnSync('git', args, { encoding: 'utf8', maxBuffer: MAX_GATE_OUTPUT, ...options })
  if (result.status !== 0) {
    throw new Error(result.error?.message ?? (result.stderr.trim() || `git ${args[0]} exited ${String(result.status)}`))
  }
  return result.stdout.trim()
}

/**
 * Materialise the index into a temporary tree the gates can run against.
 *
 * The caller removes the tree.
 *
 * @param root - Absolute repository root.
 * @returns The tree's absolute path and the environment that points Git at the real repository.
 */
export function materialiseIndex(root) {
  const gitDir = git(['rev-parse', '--absolute-git-dir'], { cwd: root })
  const tree = realpathSync(mkdtempSync(join(tmpdir(), 'gates-staged-')))
  try {
    // A hook may name a temporary index relative to its own working directory.
    const env = { ...process.env, GIT_DIR: gitDir, GIT_WORK_TREE: tree }
    const indexFile = process.env.GIT_INDEX_FILE
    if (indexFile !== undefined && indexFile !== '' && !isAbsolute(indexFile)) env.GIT_INDEX_FILE = resolve(indexFile)
    git(['checkout-index', '--all', '--force', `--prefix=${tree}/`], { cwd: root, env: { ...env, GIT_WORK_TREE: root } })

    // The gates are tooling: a gate file the index lacks comes from the working
    // tree, and a staged gate file runs as staged.
    cpSync(resolve(root, 'scripts', 'gates'), resolve(tree, 'scripts', 'gates'), { recursive: true, force: false })

    // Dependency directories are never committed, but a gate resolves its
    // toolchain from them, such as the `typescript` package in node_modules.
    let config = {}
    try {
      config = readConfig(resolve(tree, 'scripts', 'gates', 'config.json'))
    } catch {
      // A missing or broken configuration is reported by the gates that read it.
    }
    const dependencies = new Set([...REPOSITORY_SKIP_DIRECTORIES, ...declaredSkipDirectories(config)])
    dependencies.delete('.git')
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !dependencies.has(entry.name) || existsSync(resolve(tree, entry.name))) continue
      symlinkSync(resolve(root, entry.name), resolve(tree, entry.name), 'dir')
    }
    return { tree, env }
  } catch (error) {
    rmSync(tree, { recursive: true, force: true })
    throw error
  }
}

/**
 * Run every gate in one group.
 *
 * The `commit` group runs against the materialised index; every other group
 * runs against the repository as it is.
 *
 * @param root - Absolute repository root.
 * @param group - `commit` or `full`.
 * @param options - `maxBuffer` bounds each gate's output.
 * @returns The number of enforcing failures and the number of advisories.
 */
export function runGates(root, group, { maxBuffer = MAX_GATE_OUTPUT } = {}) {
  const gates = readGates(root)
  const selected = selectGates(gates, group)
  const staged = group === 'commit' ? materialiseIndex(root) : null
  const target = staged?.tree ?? root
  const env = staged?.env ?? process.env
  const args = staged === null ? [] : ['--staged']
  let failures = 0
  let advisories = 0

  try {
    for (const [script, entry] of selected) {
      const label = script.replace(/\.mjs$/u, '')
      const result = runGate(target, script, args, { env, maxBuffer })
      if (result.code === 0 && result.error === undefined) {
        console.log(`ok    ${label.padEnd(28)} ${result.output.split('\n').at(-1) ?? ''}`)
        continue
      }
      const mark = entry.advisory === true ? 'WARN' : 'FAIL'
      if (entry.advisory === true) advisories++
      else failures++
      console.error(`${mark}  ${label.padEnd(28)} ${result.error?.message ?? entry.description}`)
      for (const line of result.output.split('\n')) console.error(line === '' ? '' : `      ${line}`)
    }
  } finally {
    if (staged !== null) rmSync(staged.tree, { recursive: true, force: true })
  }

  return { failures, advisories, total: selected.length }
}

/**
 * Run the runner as a command.
 * @returns Process exit code.
 */
function main() {
  let values
  try {
    ({ values } = parseArgs({
      args: process.argv.slice(2),
      allowPositionals: false,
      options: {
        group: { type: 'string' },
        list: { type: 'boolean', default: false },
      },
      strict: true,
    }))
  } catch (error) {
    console.error(`run: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  let gates
  try {
    gates = readGates(ROOT)
  } catch (error) {
    console.error(`run: cannot read scripts/gates/gates.json — ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  if (values.list) {
    for (const [script, entry] of Object.entries(gates)) {
      const groups = (entry.groups ?? []).join(',')
      const note = entry.advisory === true ? '  [advisory]' : ''
      console.log(`${groups.padEnd(14)} ${script.padEnd(30)} ${entry.description}${note}`)
    }
    return 0
  }

  // The default is one whole-repository pass. Running every group in sequence
  // would execute each gate once per group it belongs to, so a gate listed in
  // both would run twice.
  const group = values.group ?? 'full'
  if (!GROUPS.includes(group)) {
    console.error(`run: unknown group ${JSON.stringify(group)} (expected ${GROUPS.join(' or ')})`)
    return 2
  }

  let outcome
  try {
    outcome = runGates(ROOT, group)
  } catch (error) {
    console.error(`run: cannot materialise the index for the ${group} group — ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }
  const { failures, advisories, total } = outcome

  const summary = []
  if (failures > 0) summary.push(`${failures} of ${total} gate(s) failed`)
  if (advisories > 0) summary.push(`${advisories} advisory finding(s)`)
  if (summary.length === 0) {
    console.log(`\n${total} gate(s) passed.`)
    return 0
  }
  console.error(`\n${summary.join(', ')}.`)
  return failures > 0 ? 1 : 0
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}

/** Exported for tests. */
export { MANIFEST }
