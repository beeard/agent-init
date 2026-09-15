/**
 * Run the documentation and structure gates.
 *
 * Every gate runs as a child process, so one crashing does not hide the results
 * of the others. The exit code is non-zero if any gate failed.
 *
 * Usage: node scripts/gates/run.mjs [--group fast|all] [--list]
 *
 * `fast` is the subset the pre-commit hook runs. `all` (the default) adds the
 * whole-repository documentation checks.
 */

import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { isMain } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** Gate inventory, in run order. */
export const GATES = [
  { script: 'agent-note-tree.mjs', group: 'fast', description: 'decision-record layout' },
  { script: 'verify-agent-note-format.mjs', group: 'fast', description: 'decision-record format' },
  { script: 'verify-md-links.mjs', group: 'fast', description: 'relative Markdown links' },
  { script: 'verify-md-wrap.mjs', group: 'all', description: 'one physical line per paragraph' },
  { script: 'verify-doc-budgets.mjs', group: 'all', description: 'document word ceilings' },
]

/**
 * Run one gate as a child process.
 * @param root - Absolute repository root.
 * @param gate - Gate descriptor.
 * @returns Exit code, stdout, and stderr.
 */
function runGate(root, gate) {
  const result = spawnSync(process.execPath, [resolve(root, 'scripts', 'gates', gate.script)], {
    cwd: root,
    encoding: 'utf8',
  })
  return {
    code: result.status ?? 1,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  }
}

/**
 * Run every gate in a group.
 * @param root - Absolute repository root.
 * @param group - `fast` or `all`.
 * @returns The number of failures.
 */
export function runGates(root, group) {
  const selected = group === 'fast' ? GATES.filter(g => g.group === 'fast') : GATES
  let failures = 0

  for (const gate of selected) {
    const result = runGate(root, gate)
    const label = gate.script.replace(/\.mjs$/u, '')
    if (result.error !== undefined) {
      failures++
      console.error(`FAIL  ${label.padEnd(28)} ${result.error.message}`)
      continue
    }
    if (result.code === 0) {
      console.log(`ok    ${label.padEnd(28)} ${result.stdout.trim()}`)
      continue
    }
    failures++
    console.error(`FAIL  ${label.padEnd(28)} ${gate.description}`)
    const detail = `${result.stdout}${result.stderr}`.trimEnd()
    for (const line of detail.split('\n')) console.error(line === '' ? '' : `      ${line}`)
  }

  return failures
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
        group: { type: 'string', default: 'all' },
        list: { type: 'boolean', default: false },
      },
      strict: true,
    }))
  } catch (error) {
    console.error(`run: ${error instanceof Error ? error.message : String(error)}`)
    return 2
  }

  if (values.list) {
    for (const gate of GATES) console.log(`${gate.group.padEnd(5)} ${gate.script.padEnd(28)} ${gate.description}`)
    return 0
  }
  if (values.group !== 'fast' && values.group !== 'all') {
    console.error(`run: unknown group ${JSON.stringify(values.group)} (expected fast or all)`)
    return 2
  }

  const failures = runGates(ROOT, values.group)
  const total = values.group === 'fast' ? GATES.filter(g => g.group === 'fast').length : GATES.length
  if (failures === 0) {
    console.log(`\n${total} gate(s) passed.`)
    return 0
  }
  console.error(`\n${failures} of ${total} gate(s) failed.`)
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
