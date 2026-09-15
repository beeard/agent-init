/**
 * Run the gates registered in `gates.json`.
 *
 * Every gate runs as a child process, so one crashing does not hide the results
 * of the others. A gate marked `advisory` reports its findings without failing
 * the run.
 *
 * Usage:
 *   node scripts/gates/run.mjs                 # the whole-repository suite
 *   node scripts/gates/run.mjs --group commit  # what the pre-commit hook runs
 *   node scripts/gates/run.mjs --group full    # the same as the default
 *   node scripts/gates/run.mjs --list          # what would run, and when
 *
 * Gates in the `commit` group receive `--staged`, which restricts them to the
 * files staged for commit. A gate that does not support the flag ignores it.
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isMain } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')
const MANIFEST = resolve(ROOT, 'scripts', 'gates', 'gates.json')

/** The groups a caller may select, in the order the default run applies them. */
export const GROUPS = ['commit', 'full']

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
 * @param root - Absolute repository root.
 * @param script - Gate filename.
 * @param args - Extra arguments, such as `--staged`.
 * @returns Exit code and combined output.
 */
function runGate(root, script, args) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', 'gates', script), ...args], {
    cwd: root,
    encoding: 'utf8',
  })
  return {
    code: result.status ?? 1,
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd(),
    error: result.error,
  }
}

/**
 * Run every gate in one group.
 * @param root - Absolute repository root.
 * @param group - `commit` or `full`.
 * @returns The number of enforcing failures and the number of advisories.
 */
export function runGates(root, group) {
  const gates = readGates(root)
  const selected = selectGates(gates, group)
  const args = group === 'commit' ? ['--staged'] : []
  let failures = 0
  let advisories = 0

  for (const [script, entry] of selected) {
    const label = script.replace(/\.mjs$/u, '')
    const result = runGate(root, script, args)
    if (result.error !== undefined) {
      failures++
      console.error(`FAIL  ${label.padEnd(28)} ${result.error.message}`)
      continue
    }
    if (result.code === 0) {
      console.log(`ok    ${label.padEnd(28)} ${result.output.split('\n').at(-1) ?? ''}`)
      continue
    }
    const mark = entry.advisory === true ? 'WARN' : 'FAIL'
    if (entry.advisory === true) advisories++
    else failures++
    console.error(`${mark}  ${label.padEnd(28)} ${entry.description}`)
    for (const line of result.output.split('\n')) console.error(line === '' ? '' : `      ${line}`)
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

  const { failures, advisories, total } = runGates(ROOT, group)

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
