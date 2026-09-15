/**
 * Execute a scaffold plan against a target repository.
 *
 * Every action is reported with an outcome, so a caller can tell an added file
 * from one deliberately kept. An existing file is never overwritten unless the
 * run asked for it: re-running the scaffolder must be safe.
 */

import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { MANIFEST_PATH, PACKAGE_SCRIPTS } from './plan.mjs'
import { isPlainObject, readJson, toJson, writeText } from './util.mjs'

/** Markers bounding a section this tool appends, so re-runs stay idempotent. */
const BEGIN = '<!-- agent-init:begin -->'
const END = '<!-- agent-init:end -->'

/** The pre-commit hook, kept to checks that stay fast on every commit. */
const PRE_COMMIT = `#!/bin/sh
# Fast pre-commit gate, installed by agent-init.
# Full suite: node scripts/gates/run.mjs
set -e
node scripts/gates/run.mjs --group fast
node scripts/gates/verify-md-wrap.mjs --staged
git diff --cached --check
`

/**
 * Apply a plan to the filesystem.
 * @param plan - Plan produced by `buildPlan`.
 * @param options - Run options.
 * @param options.force - Overwrite files that already exist.
 * @param options.dryRun - Report actions without touching the filesystem.
 * @param options.hooks - Install the pre-commit hook and point Git at it.
 * @returns Report with one entry per action plus notes.
 */
export function applyPlan(plan, { force = false, dryRun = false, hooks = true } = {}) {
  const results = []
  const notes = []

  for (const file of plan.files) {
    if (file.kind === 'append') {
      results.push(appendFile(file, { force, dryRun }))
      continue
    }
    results.push(writeFile(file, { force, dryRun }))
  }

  for (const link of plan.symlinks) {
    results.push(createSymlink(link, { dryRun }))
  }

  const manifestFile = {
    kind: 'write',
    relPath: MANIFEST_PATH,
    path: resolve(plan.targetDir, MANIFEST_PATH),
    content: toJson(plan.manifest),
  }
  if (existsSync(manifestFile.path) && !force) {
    results.push({ relPath: MANIFEST_PATH, outcome: 'kept', detail: 'already adopted; delete it to re-adopt' })
  } else {
    results.push(writeFile(manifestFile, { force, dryRun }))
  }

  if (plan.mergedScripts && Object.keys(plan.mergedScripts.additions).length > 0) {
    results.push(mergeScripts(plan.mergedScripts, { dryRun }))
  }

  if (hooks) results.push(installHook(plan.targetDir, { dryRun, notes }))

  return { results, notes }
}

/**
 * Write one planned file, creating parent directories.
 * @param file - A `write` action.
 * @param options - Overwrite and dry-run flags.
 * @returns Outcome entry.
 */
function writeFile(file, { force, dryRun }) {
  const exists = existsSync(file.path)
  if (exists && !force) return { relPath: file.relPath, outcome: 'kept', detail: 'exists' }
  if (!dryRun) {
    mkdirSync(dirname(file.path), { recursive: true })
    writeFileSync(file.path, file.content, 'utf8')
  }
  return { relPath: file.relPath, outcome: exists ? 'replaced' : 'added' }
}

/**
 * Append a marked section, or write the file when it does not exist yet.
 * @param file - An `append` action.
 * @param options - Overwrite and dry-run flags.
 * @returns Outcome entry.
 */
function appendFile(file, { force, dryRun }) {
  if (!existsSync(file.path)) {
    // Keep the markers even on a fresh file so a later re-run recognises the
    // section instead of appending a second copy.
    const wrapped = `${BEGIN}\n${file.content.trimEnd()}\n${END}\n`
    return writeFile({ ...file, kind: 'write', content: wrapped }, { force, dryRun })
  }
  const current = readFileSync(file.path, 'utf8')
  if (current.includes(BEGIN)) return { relPath: file.relPath, outcome: 'kept', detail: 'section already present' }
  if (!dryRun) {
    const separator = current.endsWith('\n') ? '\n' : '\n\n'
    writeText(file.path, `${current}${separator}${BEGIN}\n${file.content.trimEnd()}\n${END}\n`)
  }
  return { relPath: file.relPath, outcome: 'appended' }
}

/**
 * Create the `CLAUDE.md` link, falling back to an import statement when the
 * platform refuses symlinks.
 * @param link - A `symlink` action.
 * @param options - Dry-run flag.
 * @returns Outcome entry.
 */
function createSymlink(link, { dryRun }) {
  if (existsSync(link.path)) return { relPath: link.relPath, outcome: 'kept', detail: 'exists' }
  if (dryRun) return { relPath: link.relPath, outcome: 'linked', detail: `-> ${link.target}` }
  try {
    symlinkSync(link.target, link.path)
    return { relPath: link.relPath, outcome: 'linked', detail: `-> ${link.target}` }
  } catch {
    // Windows without developer mode rejects symlinks; an `@`-import reaches the
    // same file through Claude Code's own resolution.
    writeText(link.path, link.fallback)
    return { relPath: link.relPath, outcome: 'added', detail: 'symlink unavailable; wrote an @-import' }
  }
}

/**
 * Add the gate scripts to an existing `package.json` without touching entries
 * the repository already defines.
 * @param merged - Target path plus the scripts to add.
 * @param options - Dry-run flag.
 * @returns Outcome entry.
 */
function mergeScripts(merged, { dryRun }) {
  const pkg = readJson(merged.path)
  if (!isPlainObject(pkg)) return { relPath: 'package.json', outcome: 'kept', detail: 'not a JSON object' }
  const added = Object.keys(merged.additions)
  if (!dryRun) {
    pkg.scripts = { ...merged.additions, ...(isPlainObject(pkg.scripts) ? pkg.scripts : {}) }
    writeText(merged.path, toJson(pkg))
  }
  return { relPath: 'package.json', outcome: 'merged', detail: `+ ${added.join(', ')}` }
}

/**
 * Install the fast pre-commit hook and point Git at the hook directory, unless
 * the repository already configured a different one.
 * @param targetDir - Absolute path to the target repository.
 * @param options - Dry-run flag and a note sink.
 * @returns Outcome entry.
 */
function installHook(targetDir, { dryRun, notes }) {
  const hookPath = resolve(targetDir, '.githooks', 'pre-commit')
  if (!dryRun) {
    mkdirSync(dirname(hookPath), { recursive: true })
    writeFileSync(hookPath, PRE_COMMIT, 'utf8')
    chmodSync(hookPath, 0o755)
  }
  const current = spawnSync('git', ['-C', targetDir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' })
  const configured = (current.stdout ?? '').trim()
  if (configured !== '' && configured !== '.githooks') {
    notes.push(`core.hooksPath is already ${configured}; left as is. Enable these hooks with: git config core.hooksPath .githooks`)
    return { relPath: '.githooks/pre-commit', outcome: 'added', detail: 'not activated' }
  }
  if (!dryRun) spawnSync('git', ['-C', targetDir, 'config', 'core.hooksPath', '.githooks'], { encoding: 'utf8' })
  return { relPath: '.githooks/pre-commit', outcome: 'added', detail: 'activated' }
}

/** Every script name this tool may add, for documentation and tests. */
export const MANAGED_SCRIPTS = Object.keys(PACKAGE_SCRIPTS)
