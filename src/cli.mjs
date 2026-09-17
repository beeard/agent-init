#!/usr/bin/env node
/**
 * agent-init: scaffold an agent-operating structure into a repository.
 *
 * The tool writes a self-contained tree — standing orders, decision records,
 * skills, and the gates that enforce them. Nothing it writes refers back to
 * this package, so the receiving repository owns the result outright.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { basename, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { BASE_SKILLS, STACKS, buildPlan } from './plan.mjs'
import { applyPlan } from './apply.mjs'
import { installSetupSkill } from './skill-install.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEMPLATES_ROOT = resolve(HERE, '..', 'templates')
const SETUP_SKILL_DIR = resolve(HERE, '..', 'skills', 'agent-init-setup')

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
  --stack <name>       Add a language profile (available: ${STACKS.join(', ')}).
                       Repeat for more than one.
  --with-architecture  Also install the software-architecture layer: the
                       system map, glossary, and composition rules
  --lenient            Mark every gate advisory, so adopting on an existing
                       repository does not fail on its first run. Tighten the
                       gates in scripts/gates/gates.json as you fix findings.
  --no-hooks           Do not install the pre-commit hook
  --force              Overwrite files that already exist
  --dry-run            Print the plan without writing anything
  --allow-non-git      Scaffold outside a Git worktree
  --install-skill      Install this package's setup skill into the agent's skills
                       directory instead of scaffolding, so later sessions can run
                       the tool without this prompt. Combine with --dry-run to
                       only report.
  --link               With --install-skill: symlink instead of copying. Only
                       right when this package will not move; npm may prune the
                       directory it is fetched into.
  --skill-dir <path>   With --install-skill: the skills directory to install into
                       (default: $CLAUDE_CONFIG_DIR/skills, or ~/.claude/skills)
  --help               Show this message
`

/**
 * Options that only mean something for a scaffold run.
 *
 * `--install-skill` is a different operation, not a variant of one, so these
 * are refused beside it rather than ignored: a run that quietly dropped
 * `--stack python` and installed a skill would report success for work it never
 * did.
 */
const SCAFFOLD_ONLY = [
  'name', 'skills', 'stack', 'with-architecture', 'lenient', 'no-hooks',
  'force', 'allow-non-git',
]

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
      stack: { type: 'string', multiple: true },
      'with-architecture': { type: 'boolean', default: false },
      lenient: { type: 'boolean', default: false },
      'no-hooks': { type: 'boolean', default: false },
      force: { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'allow-non-git': { type: 'boolean', default: false },
      'install-skill': { type: 'boolean', default: false },
      link: { type: 'boolean', default: false },
      'skill-dir': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    strict: true,
  })
  if (values.help) return { help: true }

  if (values['install-skill']) {
    // `name` and `force` carry defaults, so their presence in `values` is not
    // evidence the caller passed them; the other listed options have none.
    const given = SCAFFOLD_ONLY.filter(key => givenOption(key, values, positionals))
    if (given.length > 0) {
      throw new Error(`--install-skill installs a skill and scaffolds nothing, so ${given.map(key => `--${key}`).join(', ')} cannot be combined with it`)
    }
    if (positionals.length > 0) {
      throw new Error(`--install-skill takes no target directory, got "${positionals[0]}"`)
    }
    return {
      installSkill: true,
      link: values.link,
      skillDir: values['skill-dir'],
      dryRun: values['dry-run'],
    }
  }
  if (values.link || values['skill-dir'] !== undefined) {
    throw new Error('--link and --skill-dir only apply to --install-skill')
  }

  if (positionals.length > 1) throw new Error(`expected at most one target directory, got ${positionals.length}`)
  const target = resolve(positionals[0] ?? process.cwd())
  const chosen = values.skills === undefined
    ? BASE_SKILLS
    : values.skills.split(',').map(part => part.trim()).filter(Boolean)
  const skills = chosen.includes('all') ? BASE_SKILLS : chosen
  if (skills.length === 0) {
    throw new Error(`no skills selected; available: ${BASE_SKILLS.join(', ')}, all`)
  }
  for (const skill of skills) {
    if (!BASE_SKILLS.includes(skill)) {
      throw new Error(`unknown skill "${skill}"; available: ${BASE_SKILLS.join(', ')}, all`)
    }
  }
  const stack = [...new Set(values.stack ?? [])]
  for (const name of stack) {
    if (!STACKS.includes(name)) {
      throw new Error(`unknown stack "${name}"; available: ${STACKS.join(', ')}`)
    }
  }
  return {
    target,
    name: values.name ?? basename(target),
    skills,
    stack,
    architecture: values['with-architecture'],
    lenient: values.lenient,
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
 * Whether an option only means something for a scaffold run.
 *
 * `name`, `force`, and the rest carry defaults, so a key that is merely present
 * says nothing; only an explicit value does. A caller that set one of the
 * boolean flags without a default did pass it. The target positional counts as
 * the `name` option does, because both name a repository to scaffold.
 *
 * @param key - Option name.
 * @param values - Parsed values.
 * @param positionals - Parsed positional arguments.
 * @returns True when the caller supplied it.
 */
function givenOption(key, values, positionals) {
  if (key === 'name') return values.name !== undefined || positionals.length > 0
  if (key === 'skills' || key === 'stack') return values[key] !== undefined
  return values[key] === true
}

/**
 * Render the outcome of an `--install-skill` run.
 * @param report - Report from `installSetupSkill`.
 * @param dryRun - Whether the run only simulated.
 * @returns Human-readable lines.
 */
function renderSkillReport(report, dryRun) {
  const detail = report.outcome === 'linked' || report.outcome === 'relinked'
    ? ` -> ${report.linkTarget}`
    : ''
  const lines = [`  ${report.outcome.padEnd(9)} ${report.target}${detail}`]
  if (report.backup !== null) lines.push(`  ${'backed up'.padEnd(9)} ${report.backup}`)
  if (report.coordinate.path !== null) {
    lines.push(`  ${(report.coordinate.changed ? 'recorded' : 'ok').padEnd(9)} ${report.coordinate.path}  ${report.coordinate.specifier}`)
  }
  lines.push('')
  if (dryRun) {
    lines.push('  dry run: nothing was written.')
    return lines.join('\n')
  }
  lines.push(`  mode: ${report.mode}. A copy survives npm pruning the directory this package was fetched into.`)
  lines.push('')
  lines.push('Next: a session started in any repository can now use the agent-init-setup skill.')
  return lines.join('\n')
}

/**
 * This package's own name and version, as an agent needs them to run it again.
 * @returns `{ name, version }`, or null when the manifest cannot be read.
 */
function ownCoordinate() {
  try {
    const manifest = JSON.parse(readFileSync(resolve(HERE, '..', 'package.json'), 'utf8'))
    if (typeof manifest.name !== 'string' || typeof manifest.version !== 'string') return null
    return { name: manifest.name, version: manifest.version }
  } catch {
    // Without it the skill still works from a clone, so this is reported rather
    // than fatal.
    return null
  }
}

/**
 * Install this package's setup skill, and nothing else.
 * @param options - Parsed `--install-skill` options.
 * @returns Process exit code.
 */
function installSkill(options) {
  const report = installSetupSkill(SETUP_SKILL_DIR, {
    ...(options.skillDir === undefined ? {} : { dir: resolve(options.skillDir) }),
    link: options.link,
    dryRun: options.dryRun,
    coordinate: ownCoordinate(),
  })
  process.stdout.write(`agent-init: ${options.dryRun ? 'plan for' : 'installed'} the setup skill\n\n`)
  process.stdout.write(`${renderSkillReport(report, options.dryRun)}\n`)
  if (report.coordinate.path === null) {
    process.stdout.write("\n  note: this package's manifest could not be read, so the skill records no package to run.\n")
  }
  return 0
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
  if (options.installSkill) return installSkill(options)

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

  let plan
  let report
  try {
    plan = buildPlan({
      targetDir: options.target,
      templatesRoot: TEMPLATES_ROOT,
      projectName: options.name,
      skills: options.skills,
      stack: options.stack,
      architecture: options.architecture,
      lenient: options.lenient,
    })
    report = applyPlan(plan, options)
  } catch (error) {
    // A plan this tool cannot lay down, or a merge that cannot compose the
    // file's form with the template's, stops the run. Report it as a refusal
    // rather than as a crash, and say what survived: once the plan is being
    // applied, the actions before the failure have already been written, and a
    // target described as untouched would be a second false report on top of
    // the first.
    process.stderr.write(`agent-init: ${error instanceof Error ? error.message : String(error)}\n`)
    process.stderr.write(plan === undefined
      ? `  Nothing was written to ${options.target}.\n`
      : `  Nothing further was written to ${options.target}; files written before the conflict are kept.\n`)
    return 2
  }

  process.stdout.write(`agent-init: ${options.dryRun ? 'plan for' : 'scaffolded'} ${options.target}\n\n`)
  process.stdout.write(`${renderReport(report, options.dryRun)}\n\n`)
  if (!options.dryRun) {
    const layers = ['base', ...options.stack, ...(options.architecture ? ['architecture'] : [])]
    process.stdout.write(`Layers: ${layers.join(' + ')}\n\n`)
    if (options.lenient) {
      process.stdout.write('Every gate is advisory: findings are reported but do not fail the run.\n')
      process.stdout.write('Clear them, then remove "advisory": true in scripts/gates/gates.json.\n\n')
    }
    process.stdout.write('Next:\n')
    process.stdout.write('  1. Edit AGENTS.md — it is deliberately generic; make it yours.\n')
    process.stdout.write('  2. Run: node scripts/gates/run.mjs\n')
    process.stdout.write('  3. Commit the whole tree in one change.\n')
  }
  return 0
}

process.exitCode = main(process.argv.slice(2))
