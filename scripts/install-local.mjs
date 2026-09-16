#!/usr/bin/env node
/**
 * Link this clone's machine-local pieces into place.
 *
 * Two things this package needs cannot live in a repository it scaffolds, and
 * cannot be delivered by a clone either:
 *
 * 1. **The hook chain.** Git has one `core.hooksPath`, so a global value hides
 *    every repository's own `.githooks/`. `scripts/local/pre-commit.sh` runs
 *    the repository's hook when it has one, which is what makes the gates run
 *    on commit without taking the value over. It carries an extension because
 *    the newline gate reads `**\/*.sh` and a hook named `pre-commit` would have
 *    been the one shipped file no check could see; Git takes the name from the
 *    link, not from the source.
 * 2. **The setup skill.** `skills/agent-init-setup` tells an agent how to run
 *    this tool. It has to be reachable where the agent looks for skills, which
 *    is outside any repository.
 *
 * Both are symlinked rather than copied, so editing the clone changes what runs
 * and the installed state cannot drift from the versioned one.
 *
 * A target that already exists and is not the link we want is backed up beside
 * itself as `<name>.bak.<unix-time>` before being replaced. Nothing is deleted.
 *
 * Usage:
 *   node scripts/install-local.mjs [--dry-run]
 */

import { existsSync, lstatSync, mkdirSync, readlinkSync, renameSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { parseArgs } from 'node:util'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const HOME = homedir()

/**
 * Ask Git where hooks live, so the chain lands where Git will look for it.
 * @returns The absolute hooks directory, or null when the chain is not needed.
 */
function hooksPath() {
  // `--path` makes Git expand `~` and `~user` the way it does when it resolves
  // the setting itself. Reading the raw value would reject the common
  // `~/.config/git/hooks` as relative and skip the chain in exactly the case it
  // exists for.
  const result = spawnSync('git', ['config', '--global', '--path', '--get', 'core.hooksPath'], { encoding: 'utf8' })
  const value = (result.stdout ?? '').trim()
  // Unset means each repository's own .githooks/ is what Git reads, and a
  // relative value is resolved per repository for the same effect. Neither
  // hides a repository's hook, so neither needs a chain.
  if (value === '' || !value.startsWith('/')) return null
  return value
}

/**
 * Link one path to one target, backing up whatever else is there.
 * @param source - Absolute path the link should point at.
 * @param target - Absolute path to create the link at.
 * @param dryRun - Report without touching the filesystem.
 * @returns One outcome line.
 */
function link(source, target, dryRun) {
  const rel = display(target)

  if (existsSync(target) || isDanglingLink(target)) {
    if (isLinkTo(target, source)) return `ok        ${rel}`

    // A link holds a path, not content, so there is nothing to preserve and
    // renaming it would only move the path — the "backup" would point at
    // whatever the link named, and dangle the moment that stopped existing.
    // Any symlink is this case, dangling or not.
    if (isSymlink(target)) {
      if (!dryRun) {
        unlinkSync(target)
        symlinkSync(source, target)
      }
      return `relinked  ${rel}`
    }

    // A real file or directory is kept beside itself. rename never deletes and
    // works for a directory, where a copy would have to recurse.
    //
    // The name is made unique rather than taken from the clock alone: rename
    // replaces its destination silently, so two runs inside one second would
    // destroy the first backup, which is the one guarantee this makes.
    const stamp = Math.floor(Date.now() / 1000)
    let backup = `${target}.bak.${stamp}`
    for (let attempt = 1; existsSync(backup); attempt += 1) backup = `${target}.bak.${stamp}-${attempt}`
    if (!dryRun) {
      renameSync(target, backup)
      symlinkSync(source, target)
    }
    return `replaced  ${rel}  (the previous file is at ${display(backup)})`
  }

  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(source, target)
  }
  return `linked    ${rel}`
}

/**
 * Shorten an absolute path under the home directory for display.
 * @param path - Absolute path.
 * @returns The path with `$HOME` written as `~`, or the path unchanged.
 */
function display(path) {
  return path.startsWith(`${HOME}/`) ? `~/${path.slice(HOME.length + 1)}` : path
}

/**
 * Whether a path is a symlink, whether or not its destination exists.
 * @param path - Absolute path to test.
 * @returns True for any symlink.
 */
function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Whether a path is a symlink whose destination does not exist.
 * @param path - Absolute path to test.
 * @returns True for a dangling link, which `existsSync` reports as absent.
 */
function isDanglingLink(path) {
  return isSymlink(path) && !existsSync(path)
}

/**
 * Whether a path is already a link to the expected target.
 * @param path - Absolute path to test.
 * @param source - Absolute path the link should point at.
 * @returns True when the link is already correct.
 */
function isLinkTo(path, source) {
  try {
    return readlinkSync(path) === source
  } catch {
    return false
  }
}

const { values } = parseArgs({
  args: process.argv.slice(2),
  options: { 'dry-run': { type: 'boolean', default: false } },
  strict: true,
})
const dryRun = values['dry-run']

const hooks = hooksPath()
const outcomes = []

if (hooks === null) {
  outcomes.push('skipped   the hook chain: core.hooksPath is unset, so each repository')
  outcomes.push('          already runs its own .githooks/pre-commit')
} else {
  outcomes.push(link(join(ROOT, 'scripts', 'local', 'pre-commit.sh'), join(hooks, 'pre-commit'), dryRun))
}

outcomes.push(link(join(ROOT, 'skills', 'agent-init-setup'), join(HOME, '.claude', 'skills', 'agent-init-setup'), dryRun))

process.stdout.write(`agent-init: ${dryRun ? 'plan for' : 'installed'} machine-local links from ${ROOT}\n\n`)
for (const line of outcomes) process.stdout.write(`  ${line}\n`)
process.stdout.write('\n')
if (dryRun) process.stdout.write('  dry run: nothing was written.\n\n')
else {
  process.stdout.write('Next:\n')
  process.stdout.write('  1. A repository whose .githooks/pre-commit is unreachable runs it only\n')
  process.stdout.write('     once it carries agent-init.githooks=true; the scaffolder sets that for\n')
  process.stdout.write('     you, and `git config --local agent-init.githooks true` does it by hand.\n')
  process.stdout.write('  2. An agent session can now use the agent-init-setup skill.\n\n')
}
