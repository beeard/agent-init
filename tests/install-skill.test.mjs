/**
 * `--install-skill`, proved against a throwaway `$HOME`.
 *
 * The install writes outside any repository, so every test here redirects
 * `$HOME` rather than trusting the CLI to stay inside a sandbox: a defect that
 * wrote to the real home directory would otherwise pass by touching the
 * machine running the suite.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeSandbox, removeSandbox, runCli, PACKAGE_ROOT } from './helpers.mjs'

const SKILL_SOURCE = join(PACKAGE_ROOT, 'skills', 'agent-init-setup')
const SKILL_MARKDOWN = readFileSync(join(SKILL_SOURCE, 'SKILL.md'), 'utf8')

/**
 * Install the setup skill into a throwaway home directory.
 * @param args - Extra CLI arguments.
 * @returns Sandbox home and the run's result.
 */
function install(args = []) {
  const home = makeSandbox()
  const result = runCli(['--install-skill', ...args], PACKAGE_ROOT, { HOME: home })
  return { home, result }
}

test('copies the setup skill into the agent skills directory', () => {
  const { home, result } = install()
  try {
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /copied\s+/u)
    const installed = join(home, '.claude', 'skills', 'agent-init-setup', 'SKILL.md')
    assert.equal(readFileSync(installed, 'utf8'), SKILL_MARKDOWN)
    // A copy, not a link: npm prunes the directory this package is fetched into,
    // and a link to a pruned path is a skill that reads as installed and works
    // never.
    assert.ok(!lstatSync(join(home, '.claude', 'skills', 'agent-init-setup')).isSymbolicLink())
  } finally {
    removeSandbox(home)
  }
})

test('records the package the skill was installed from', () => {
  const { home, result } = install()
  try {
    assert.equal(result.code, 0, result.output)
    // Without this an agent holding a skill from a registry has no package name
    // to run, and guessing one is the typosquat vector rather than a lookup.
    const coordinate = JSON.parse(readFileSync(join(home, '.claude', 'skills', 'agent-init-setup.json'), 'utf8'))
    const manifest = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
    assert.equal(coordinate.npx, `${manifest.name}@${manifest.version}`)
    assert.equal(coordinate.version, manifest.version)
  } finally {
    removeSandbox(home)
  }
})

test('records the coordinate outside a linked skill, not into the clone', () => {
  const { home, result } = install(['--link'])
  try {
    assert.equal(result.code, 0, result.output)
    const coordinate = join(home, '.claude', 'skills', 'agent-init-setup.json')
    assert.ok(existsSync(coordinate), 'the coordinate sits beside the link')
    // The link target is this package; writing into it would make a read-only
    // checkout unwritable and would not be the link's to change.
    assert.ok(!existsSync(join(SKILL_SOURCE, 'agent-init-setup.json')), 'the package must not gain the file')
  } finally {
    removeSandbox(home)
  }
})

test('a second install reports no change', () => {
  const home = makeSandbox()
  try {
    const first = runCli(['--install-skill'], PACKAGE_ROOT, { HOME: home })
    assert.equal(first.code, 0, first.output)
    const second = runCli(['--install-skill'], PACKAGE_ROOT, { HOME: home })
    assert.equal(second.code, 0, second.output)
    assert.match(second.output, /ok\s+/u)
    assert.doesNotMatch(second.output, /copied|replaced/u)
  } finally {
    removeSandbox(home)
  }
})

test('a copy the user edited is kept beside itself, not overwritten', () => {
  const home = makeSandbox()
  try {
    const target = join(home, '.claude', 'skills', 'agent-init-setup')
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'SKILL.md'), 'the user edited this\n')

    const result = runCli(['--install-skill'], PACKAGE_ROOT, { HOME: home })
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /replaced\s+/u)
    assert.match(result.output, /backed up\s+/u)

    const backups = readdirSync(join(home, '.claude', 'skills')).filter(name => name.includes('.bak.'))
    assert.equal(backups.length, 1, 'the previous copy must be kept as one backup')
    assert.equal(readFileSync(join(home, '.claude', 'skills', backups[0], 'SKILL.md'), 'utf8'), 'the user edited this\n')
    assert.equal(readFileSync(join(target, 'SKILL.md'), 'utf8'), SKILL_MARKDOWN)
  } finally {
    removeSandbox(home)
  }
})

test('a dry run writes nothing', () => {
  const { home, result } = install(['--dry-run'])
  try {
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /dry run: nothing was written/u)
    assert.ok(!existsSync(join(home, '.claude')), 'a dry run must not create the skills directory')
  } finally {
    removeSandbox(home)
  }
})

test('--link installs a symlink for a package that will not move', () => {
  const { home, result } = install(['--link'])
  try {
    assert.equal(result.code, 0, result.output)
    const target = join(home, '.claude', 'skills', 'agent-init-setup')
    assert.equal(readlinkSync(target), SKILL_SOURCE)
  } finally {
    removeSandbox(home)
  }
})

test('--skill-dir installs where it is told', () => {
  const home = makeSandbox()
  try {
    const dir = join(home, 'elsewhere', 'skills')
    const result = runCli(['--install-skill', '--skill-dir', dir], PACKAGE_ROOT, { HOME: home })
    assert.equal(result.code, 0, result.output)
    assert.ok(existsSync(join(dir, 'agent-init-setup', 'SKILL.md')))
    assert.ok(!existsSync(join(home, '.claude')), 'the default directory must not be touched')
  } finally {
    removeSandbox(home)
  }
})

test('CLAUDE_CONFIG_DIR relocates the default skills directory', () => {
  const home = makeSandbox()
  try {
    const configDir = join(home, 'claude-config')
    const result = runCli(['--install-skill'], PACKAGE_ROOT, { HOME: home, CLAUDE_CONFIG_DIR: configDir })
    assert.equal(result.code, 0, result.output)
    assert.ok(existsSync(join(configDir, 'skills', 'agent-init-setup', 'SKILL.md')))
    assert.ok(existsSync(join(configDir, 'skills', 'agent-init-setup.json')))
    assert.ok(!existsSync(join(home, '.claude')), 'the hard-coded default must not be created behind a relocated config')
  } finally {
    removeSandbox(home)
  }
})

test('refuses scaffold options beside --install-skill', () => {
  // The negative control for the guard: each of these would otherwise be
  // dropped, and the run would report success for a scaffold it never did.
  for (const args of [['--stack', 'python'], ['--lenient'], ['.'], ['--name', 'X'], ['--force']]) {
    const result = runCli(['--install-skill', ...args])
    assert.equal(result.code, 2, `expected ${args.join(' ')} to be refused`)
    assert.match(result.output, /cannot be combined with it|takes no target directory/u)
  }
})

test('refuses --link and --skill-dir without --install-skill', () => {
  for (const args of [['--link'], ['--skill-dir', '/tmp/nope']]) {
    const result = runCli(args)
    assert.equal(result.code, 2, `expected ${args.join(' ')} to be refused`)
    assert.match(result.output, /only apply to --install-skill/u)
  }
})
