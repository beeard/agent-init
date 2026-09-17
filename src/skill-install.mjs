/**
 * Put this package's setup skill where an agent looks for skills.
 *
 * Two callers need it and they install it differently. `install-local.mjs` runs
 * from a clone, which does not move, so a symlink there cannot dangle and
 * cannot drift from the versioned file. The CLI may be running from npm's
 * `_npx` cache, which npm is free to prune, so it copies — a copy is the only
 * form that survives the package being re-fetched or removed.
 *
 * The path arithmetic and the outcome vocabulary live here rather than in both
 * callers, so the two cannot disagree about where the skill goes or what a run
 * is called when a directory is already in the way. Rendering is left to the
 * caller: the clone installer shortens `$HOME` to `~` and the CLI does not.
 */

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Directory name this package's setup skill is installed under. */
export const SETUP_SKILL = 'agent-init-setup'

/**
 * Where an agent looks for a user-scope skill.
 * @returns Absolute path to the skills directory.
 */
export function userSkillsDir() {
  return join(homedir(), '.claude', 'skills')
}

/**
 * Whether a path is a symlink, whether or not its destination exists.
 * @param path - Absolute path to test.
 * @returns True for any symlink.
 */
export function isSymlink(path) {
  try {
    return lstatSync(path).isSymbolicLink()
  } catch {
    return false
  }
}

/**
 * Move whatever is at `target` aside, under a unique name.
 *
 * Nothing is deleted: a target this package did not write is the user's, so it
 * is kept beside itself. The name is made unique rather than taken from the
 * clock alone, because `rename` replaces its destination silently and two runs
 * inside one second would otherwise destroy the first backup.
 *
 * @param target - Absolute path to move aside.
 * @returns Absolute path the previous entry now has.
 */
function backup(target) {
  const stamp = Math.floor(Date.now() / 1000)
  let kept = `${target}.bak.${stamp}`
  for (let attempt = 1; existsSync(kept); attempt += 1) kept = `${target}.bak.${stamp}-${attempt}`
  renameSync(target, kept)
  return kept
}

/**
 * Point `target` at `source` with a symlink.
 *
 * A link already pointing at `source` is left alone. Any other link is
 * replaced without a backup: a link holds a path rather than content, so
 * renaming it moves the path it holds, and the "backup" would point at whatever
 * the link named and dangle the moment that stopped existing.
 *
 * @param source - Absolute path the link should name.
 * @param target - Absolute path to create the link at.
 * @param dryRun - Report without touching the filesystem.
 * @returns Outcome with `outcome`, `linkTarget`, and `backup`.
 */
export function linkPath(source, target, dryRun = false) {
  if (existsSync(target) || isSymlink(target)) {
    if (isSymlink(target) && readlinkSync(target) === source) return { outcome: 'ok', linkTarget: null, backup: null }
    if (isSymlink(target)) {
      if (!dryRun) {
        unlinkSync(target)
        symlinkSync(source, target)
      }
      return { outcome: 'relinked', linkTarget: source, backup: null }
    }
    if (!dryRun) {
      const kept = backup(target)
      symlinkSync(source, target)
      return { outcome: 'replaced', linkTarget: source, backup: kept }
    }
    return { outcome: 'replaced', linkTarget: source, backup: null }
  }

  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true })
    symlinkSync(source, target)
  }
  return { outcome: 'linked', linkTarget: source, backup: null }
}

/**
 * Copy a directory to `target`, keeping whatever was there.
 * @param source - Absolute source directory.
 * @param target - Absolute destination path.
 * @param dryRun - Report without touching the filesystem.
 * @returns Outcome of `fresh`, `current`, or `replaced`, with `backup`.
 */
export function copyPath(source, target, dryRun = false) {
  const skillFile = join(target, 'SKILL.md')
  if (existsSync(skillFile)) {
    // A copy that already matches is the common second run, and rewriting it
    // would report a change that did not happen.
    if (readFileSync(skillFile, 'utf8') === readFileSync(join(source, 'SKILL.md'), 'utf8')) {
      return { outcome: 'current', backup: null }
    }
    if (!dryRun) {
      const kept = backup(target)
      rmSync(target, { recursive: true, force: true })
      mkdirSync(dirname(target), { recursive: true })
      cpSync(source, target, { recursive: true })
      return { outcome: 'replaced', backup: kept }
    }
    return { outcome: 'replaced', backup: null }
  }

  if (!dryRun) {
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
  }
  return { outcome: 'fresh', backup: null }
}

/**
 * Install the setup skill into an agent's skills directory.
 * @param source - Absolute path to the skill directory in this package.
 * @param options - `dir` overrides the destination; `link` symlinks instead of copying; `dryRun` writes nothing.
 * @returns Outcome with `target`, `mode`, `outcome`, `linkTarget`, and `backup`.
 */
export function installSetupSkill(source, { dir = userSkillsDir(), link = false, dryRun = false } = {}) {
  const target = resolve(dir, SETUP_SKILL)
  if (link) return { target, mode: 'link', ...linkPath(source, target, dryRun) }
  const result = copyPath(source, target, dryRun)
  // One vocabulary for both modes, so a caller renders a link and a copy the
  // same way: `linked` and `copied` are the same event with different means.
  const outcome = result.outcome === 'fresh' ? 'copied' : result.outcome === 'current' ? 'ok' : result.outcome
  return { target, mode: 'copy', linkTarget: null, ...result, outcome }
}
