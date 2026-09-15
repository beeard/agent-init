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

/** Marker bounding a section this tool appends, so re-runs stay idempotent. */
const beginMarker = layer => `<!-- agent-init:begin ${layer} -->`
const endMarker = layer => `<!-- agent-init:end ${layer} -->`

/** The pre-commit hook, kept to checks that stay fast on every commit. */
const PRE_COMMIT = `#!/bin/sh
# Fast pre-commit gate, installed by agent-init.
# Full suite: node scripts/gates/run.mjs
set -e
node scripts/gates/run.mjs --group commit
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
    if (file.kind === 'merge') {
      results.push(mergeJson(file, { force, dryRun }))
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
 *
 * The markers name the contributing layer. Without that, a second layer
 * appending to the same file would find the first layer's marker already
 * present and silently skip its own section.
 *
 * @param file - An `append` action.
 * @param options - Overwrite and dry-run flags.
 * @returns Outcome entry.
 */
function appendFile(file, { force, dryRun }) {
  const begin = beginMarker(file.layer)
  const end = endMarker(file.layer)
  if (!existsSync(file.path)) {
    // Keep the markers even on a fresh file so a later re-run recognises the
    // section instead of appending a second copy.
    const wrapped = `${begin}\n${file.content.trimEnd()}\n${end}\n`
    return writeFile({ ...file, kind: 'write', content: wrapped }, { force, dryRun })
  }
  const current = readFileSync(file.path, 'utf8')
  if (current.includes(begin)) return { relPath: file.relPath, outcome: 'kept', detail: 'section already present' }
  if (!dryRun) {
    const separator = current.endsWith('\n') ? '\n' : '\n\n'
    writeText(file.path, `${current}${separator}${begin}\n${file.content.trimEnd()}\n${end}\n`)
  }
  return { relPath: file.relPath, outcome: 'appended' }
}

/**
 * Name a JSON value's shape, so a refusal can say what clashed.
 * @param value - Any parsed JSON value.
 * @returns A short noun phrase.
 */
function shapeOf(value) {
  if (isPlainObject(value)) return 'an object'
  if (Array.isArray(value)) return 'an array'
  if (value === null) return 'null'
  return `a ${typeof value}`
}

/**
 * Merge a JSON object into an existing one. A layer uses this to add its own
 * entries to a manifest without restating the entries below it, so a change to
 * a lower layer's list cannot leave the higher layer's copy stale.
 *
 * A key whose value is an object on both sides merges one level deeper, so
 * several layers can each contribute to one shared value. Every other key is
 * replaced by the incoming value. A key the two sides disagree about the shape
 * of — one object, the other not — is refused rather than resolved: composing
 * and replacing are different intents, and the shapes are what tell them apart.
 *
 * @param file - A `merge` action whose content parses as a JSON object.
 * @param options - Overwrite and dry-run flags.
 * @returns Outcome entry.
 */
function mergeJson(file, { force, dryRun }) {
  const incoming = JSON.parse(file.content)
  if (!isPlainObject(incoming)) {
    throw new Error(`${file.relPath}: a merged template must be a JSON object`)
  }
  const existing = existsSync(file.path) ? readJson(file.path) : {}
  const base = isPlainObject(existing) ? existing : {}
  const added = Object.keys(incoming).filter(key => !Object.hasOwn(base, key))
  // A key holding an object on both sides merges one level deeper, so a layer
  // contributes its own entry to a shared value instead of replacing it. The
  // document budgets rely on this: several layers append to the same document,
  // and each declares the share of the ceiling it needs.
  const merged = { ...base }
  for (const [key, value] of Object.entries(incoming)) {
    const held = base[key]
    const heldIsObject = isPlainObject(held)
    const valueIsObject = isPlainObject(value)
    if (Object.hasOwn(base, key) && heldIsObject !== valueIsObject) {
      // Guessing here loses data in silence. Writing the template's shape over
      // a scalar on disk drops what the file held, and reading a scalar as a
      // shared value sums it into entries no layer declared. A repository that
      // adopted an older form of the same file is exactly the case the merge
      // cannot resolve, because only the file's author knows which form won.
      throw new Error(
        `${file.relPath}: "${key}" is ${shapeOf(held)} in the file and ${shapeOf(value)} in the template, `
        + 'and neither form can be merged into the other. Convert the entry by hand, or delete the file '
        + 'and re-run to rebuild it from the templates; an entry they do not declare is lost with it.',
      )
    }
    merged[key] = heldIsObject && valueIsObject ? { ...held, ...value } : value
  }
  if (!dryRun) {
    mkdirSync(dirname(file.path), { recursive: true })
    writeText(file.path, toJson(merged))
  }
  const detail = added.length > 0 ? `+ ${added.join(', ')}` : 'no new keys'
  return { relPath: file.relPath, outcome: 'merged', detail }
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
