#!/usr/bin/env node
/**
 * agent-init: scaffold an agent-operating structure into a repository.
 *
 * The tool writes a self-contained tree — standing orders, decision records,
 * skills, and the gates that enforce them. Nothing it writes refers back to
 * this package, so the receiving repository owns the result outright.
 */

import { existsSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { BASE_SKILLS, buildPlan } from './plan.mjs'
import { applyPlan } from './apply.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_ROOT = resolve(HERE, '..', 'templates')

const USAGE = `agent-init — adopt the agent-operating structure in a repository

Usage
  agent-init [target] [options]

The target defaults to the current directory. The tool refuses to run outside a
Git worktree unless --allow-non-git is given.

Options
  --name <name>        Project name for the generated documents (default: the
                       target directory name)
  --skills <a,b,c>     Skills to include; "all" for every one
                       (default: ${BASE_SKILLS.join(',')})
  --with-architecture  Also install the software-architecture layer: the
                       system map, glossary, and composition rules
  --no-hooks           Do not install the pre-commit hook
  --force              Overwrite files that already exist
  --dry-run            Print the plan without writing anything
  --allow-non-git      Scaffold outside a Git worktree
  --help               Show this message
`

/**
 * Parse command-line arguments.
 * @param argv - Arguments after the script path.
 * @returns Parsed options, or `{ help: true }`.
 */
function parseCli(argv) {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      name: { type: 'string' },
      skills: { type: 'string' },
      'with-architecture': { type: 'boolean', default: false },
      'no-hooks': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'allow-non-git': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) return { help: true }
  if (positionals.length > 1) throw new Error(`expected at most one target directory, got ${positionals.length}`)
  const target = resolve(positionals[0] ?? process.cwd())
  const chosen = values.skills === undefined
    ? BASE_SKILLS
    : values.skills.split(',').map(part => part.trim()).filter(Boolean)
  const skills = chosen.includes('all') ? BASE_SKILLS : chosen
  for (const skill of skills) {
    if (!BASE_SKILLS.includes(skill)) {
      throw new Error(`unknown skill "${skill}"; available: ${BASE_SKILLS.join(', ')}, all`)
    }
  }
  return {
    target,
    name: values.name ?? basename(target),
    skills,
    architecture: values['with-architecture'],
    hooks: !values['no-hooks'],
    force: values.force,
    dryRun: values['dry-run'],
    allowNonGit: values['allow-non-git'],
  }
}

/**
 * Whether a directory sits inside a Git worktree.
 * @param dir - Absolute directory path.
 * @returns True when `git rev-parse` resolves a worktree root.
 */
function isGitWorktree(dir) {
  const result = spawnSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' })
  return result.status === 0
}

/**
 * Render the outcome of an applied plan.
 * @param report - Report from `applyPlan`.
 * @param dryRun - Whether the run only simulated.
 * @returns Human-readable lines, one per result.
 */
function renderReport(report, dryRun) {
  const width = Math.max(...report.results.map(r => r.relPath.length), 8)
  const lines = report.results.map((r) =>
    `  ${r.outcome.padEnd(9)} ${r.relPath.padEnd(width)}${r.detail ? `  ${r.detail}` : ''}`)
  if (report.notes.length > 0) lines.push('', ...report.notes.map(n => `  note: ${n}`))
  if (dryRun) lines.push('', '  dry run: nothing was written.')
  return lines.join('\n')
}

/**
 * Run the CLI.
 * @param argv - Arguments after the script path.
 * @returns Process exit code.
 */
function main(argv) {
  let options
  try {
    options = parseCli(argv)
  } catch (error) {
    process.stderr.write(`agent-init: ${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`)
    return 2
  }
  if (options.help) {
    process.stdout.write(USAGE)
    return 0
  }

  if (!existsSync(options.target) || !statSync(options.target).isDirectory()) {
    process.stderr.write(`agent-init: ${options.target} is not a directory\n`)
    return 2
  }
  if (!options.allowNonGit && !isGitWorktree(options.target)) {
    process.stderr.write(
      `agent-init: ${options.target} is not inside a Git worktree.\n`
      + '  Run `git init` first, or pass --allow-non-git to scaffold anyway.\n')
    return 2
  }

  const plan = buildPlan({
    targetDir: options.target,
    templatesRoot: TEMPLATES_ROOT,
    projectName: options.name,
    skills: options.skills,
    architecture: options.architecture,
  })
  const report = applyPlan(plan, options)

  process.stdout.write(`agent-init: ${options.dryRun ? 'plan for' : 'scaffolded'} ${options.target}\n\n`)
  process.stdout.write(`${renderReport(report, options.dryRun)}\n\n`)
  if (!options.dryRun) {
    process.stdout.write('Next:\n')
    process.stdout.write('  1. Edit AGENTS.md — it is deliberately generic; make it yours.\n')
    process.stdout.write('  2. Run: node scripts/gates/run.mjs\n')
    process.stdout.write('  3. Commit the whole tree in one change.\n')
  }
  return 0
}

process.exitCode = main(process.argv.slice(2))
