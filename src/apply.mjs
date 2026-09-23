/**
 * Execute a scaffold plan against a target repository.
 *
 * Every action is reported with an outcome, so a caller can tell an added file
 * from one deliberately kept. An existing file is never overwritten unless the
 * run asked for it: re-running the scaffolder must be safe.
 */

import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { dirname, isAbsolute, join, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { MANIFEST_PATH, PACKAGE_SCRIPTS } from './plan.mjs'
import { isPlainObject, readJson, toJson, writeText } from './util.mjs'

/** Marker bounding a section this tool appends, so re-runs stay idempotent. */
const beginMarker = layer => `<!-- agent-init:begin ${layer} -->`
const endMarker = layer => `<!-- agent-init:end ${layer} -->`

/**
 * What to say when a bundler builds the project.
 *
 * The template's module settings describe a program Node runs directly, and
 * the standing orders read that way too. A bundler app is the other case, and
 * its module settings are not gaps to close but choices the framework made:
 * `moduleResolution: "bundler"` permits the extensionless relative imports a
 * Next.js or Vite project writes, while `NodeNext` requires `.js` extensions
 * on every one of them. Following the recommendation would stop the project
 * building, so the plan withholds those findings and this note is the only
 * thing the run says about the module system.
 */
const BUNDLER_NOTE =
  'tsconfig.json: a bundler builds this project, so the module and target settings are the framework\'s to choose. "NodeNext" and "type": "module" describe a Node program; apply the strictness options if they help, and leave the module and target values alone.'

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
  const notes = []
  const root = realpathSync(plan.targetDir)
  // Read before anything is written: the manifest is what distinguishes a file
  // this structure wrote from one the repository already had.
  const adopted = existsSync(resolve(plan.targetDir, MANIFEST_PATH))

  // The whole file phase runs first against an in-memory overlay. A dry run
  // reports exactly that pass, and a real run starts writing only once it has
  // completed, so every refusal a merge can raise leaves the target untouched.
  let simulated
  try {
    simulated = applyFiles(plan, { force, adopted, view: makeView(root, true) })
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { written: false })
  }
  const results = dryRun ? simulated : applyFiles(plan, { force, adopted, view: makeView(root, false) })

  const entry = applyPackage(plan.package, { dryRun, notes, root })
  if (entry !== null) results.push(entry)

  if (plan.typescriptConfig !== null) reportTypescriptConfig(plan.typescriptConfig, notes)
  if (plan.typescriptConfig !== null && plan.package.exists && plan.package.moduleType !== 'module' && plan.typescriptConfig.bundler !== true) {
    // Node reads a `.ts` file as ESM only when the package says so, so the ESM
    // standing orders cannot hold while this value does not. A bundler resolves
    // the imports itself, so for that project the value is not a gap.
    notes.push(
      `package.json "type" is ${plan.package.moduleType === null ? 'unset' : JSON.stringify(plan.package.moduleType)}; the TypeScript orders assume ESM. Set "type": "module", or name the files .mts. Left as is — ask the user.`,
    )
  }

  if (hooks) results.push(installHook(plan.targetDir, { force, dryRun, notes, root }))

  if (results.some(result => result.outcome === 'refused')) {
    notes.push(
      'a path marked refused is a symlink that dangles or leads out of the repository, and nothing was written through it. Replace it with a regular file, or remove it, and re-run.',
    )
  }
  return { results, notes }
}

/**
 * Apply the plan's files, links, and adoption manifest through a view.
 * @param plan - Plan produced by `buildPlan`.
 * @param options - Overwrite flag, whether the structure is already adopted, and the view to act through.
 * @returns One outcome entry per action.
 */
function applyFiles(plan, { force, adopted, view }) {
  const results = []
  for (const file of plan.files) {
    if (file.kind === 'append') results.push(appendFile(file, { force, view }))
    else if (file.kind === 'merge') results.push(mergeJson(file, { force, view }))
    else if (file.kind === 'compose') results.push(composeFile(file, { force, view, adopted }))
    else results.push(writeFile(file, { force, view }))
  }
  for (const link of plan.symlinks) results.push(createSymlink(link, { view }))
  results.push(recordManifest(plan, { view }))
  return results
}

/**
 * The filesystem as one pass of a run sees it.
 *
 * A dry view keeps every write in memory and reads it back, so a later layer
 * sees an earlier layer's result exactly as it would on disk. Either view
 * remembers what each path held before the run first touched it: that, not an
 * earlier layer's output, is what the repository owns.
 *
 * @param root - Real path of the target repository.
 * @param dryRun - Keep writes in memory instead of writing them.
 * @returns The view.
 */
function makeView(root, dryRun) {
  const overlay = new Map()
  const originals = new Map()
  const view = {
    dryRun,
    exists: path => overlay.has(path) || lstatOrNull(path) !== null,
    read: path => (overlay.has(path) ? overlay.get(path) : readFileSync(path, 'utf8')),
    original(path) {
      if (!originals.has(path)) originals.set(path, diskText(path))
      return originals.get(path)
    },
    write(path, content) {
      view.original(path)
      if (dryRun) {
        overlay.set(path, content)
        return
      }
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content, 'utf8')
    },
    unsafe: path => unsafeTarget(root, path),
  }
  return view
}

/**
 * Stat a path without following a final symlink.
 * @param path - Absolute path.
 * @returns The stats, or null when nothing is there at all.
 */
function lstatOrNull(path) {
  try {
    return lstatSync(path)
  } catch {
    return null
  }
}

/**
 * A file's text as it is on disk.
 * @param path - Absolute path.
 * @returns The contents, or null when it cannot be read.
 */
function diskText(path) {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

/**
 * Why writing to a path would reach something other than the repository.
 *
 * Every write follows a symlink at the path or at any directory above it. One
 * that dangles, or that resolves outside the repository, would have the run
 * create or change a file it was never pointed at, so the write is refused.
 *
 * @param root - Real path of the repository.
 * @param path - Absolute path about to be written.
 * @returns A short reason, or null when the write stays inside the repository.
 */
function unsafeTarget(root, path) {
  let at = path
  let stats = lstatOrNull(at)
  while (stats === null && dirname(at) !== at) {
    at = dirname(at)
    stats = lstatOrNull(at)
  }
  if (stats === null) return null
  const where = at === path ? '' : ` at ${at}`
  let real
  try {
    real = realpathSync(at)
  } catch {
    return stats.isSymbolicLink() ? `a dangling symlink${where} (-> ${readlinkSync(at)})` : `an unresolvable path${where}`
  }
  const inside = real === root || real.startsWith(root.endsWith(sep) ? root : `${root}${sep}`)
  return inside ? null : `a symlink${where} leading out of the repository (-> ${real})`
}

/**
 * Outcome for a write the run refused to make through a symlink.
 * @param relPath - Repository-relative path.
 * @param reason - Why, from `unsafeTarget`.
 * @returns Outcome entry.
 */
function refused(relPath, reason) {
  return { relPath, outcome: 'refused', detail: `${reason}; not written through` }
}

/**
 * Write one planned file, creating parent directories.
 * @param file - A `write` action.
 * @param options - Overwrite flag and the view to write through.
 * @returns Outcome entry.
 */
function writeFile(file, { force, view }) {
  const exists = view.exists(file.path)
  const reason = view.unsafe(file.path)
  if (exists && !force) return { relPath: file.relPath, outcome: 'kept', detail: reason === null ? 'exists' : `${reason}; left alone` }
  if (reason !== null) return refused(file.relPath, reason)
  view.write(file.path, file.content)
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
 * @param options - Overwrite flag and the view to write through.
 * @returns Outcome entry.
 */
function appendFile(file, { force, view }) {
  const begin = beginMarker(file.layer)
  const end = endMarker(file.layer)
  if (!view.exists(file.path)) {
    // Keep the markers even on a fresh file so a later re-run recognises the
    // section instead of appending a second copy.
    const wrapped = `${begin}\n${file.content.trimEnd()}\n${end}\n`
    return writeFile({ ...file, kind: 'write', content: wrapped }, { force, view })
  }
  const reason = view.unsafe(file.path)
  if (reason !== null) return refused(file.relPath, reason)
  const current = view.read(file.path)
  if (current.includes(begin)) return { relPath: file.relPath, outcome: 'kept', detail: 'section already present' }
  const separator = current.endsWith('\n') ? '\n' : '\n\n'
  view.write(file.path, `${current}${separator}${begin}\n${file.content.trimEnd()}\n${end}\n`)
  return { relPath: file.relPath, outcome: 'appended' }
}

/**
 * Whether a document already carries a composing template's content.
 *
 * A fresh write carries no markers, so without this a repository whose
 * manifest is gone would receive the orders a second time. The document
 * carries them when at least half of the template's substantive lines — twenty
 * characters or more — appear in it verbatim.
 *
 * @param current - The document as it stands.
 * @param content - The template's substituted content.
 * @returns True when the content is already there.
 */
function carriesContent(current, content) {
  const lines = [
    ...new Set(
      content
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length >= 20),
    ),
  ]
  if (lines.length === 0) return current.includes(content.trim())
  const held = new Set(current.split(/\r?\n/u).map(line => line.trim()))
  return lines.filter(line => held.has(line)).length * 2 >= lines.length
}

/**
 * Write a composing template, or add it as a marked section to a file the
 * repository already had.
 *
 * No file → written as-is, so a fresh repository gets the document and not a
 * wrapper. A file that holds the layer's markers, a file in a repository whose
 * adoption manifest is present, or a file that already carries the template's
 * content → left alone, so a hand-edited document survives every later run,
 * with or without the manifest. Any other file → the content is appended as a
 * named section, because the repository's own file is not ours to replace but
 * the orders still have to exist.
 *
 * @param file - A `compose` action.
 * @param options - Overwrite flag, the view to write through, and whether the structure is already adopted.
 * @returns Outcome entry.
 */
function composeFile(file, { force, view, adopted }) {
  const begin = beginMarker(file.layer)
  const end = endMarker(file.layer)
  if (force || !view.exists(file.path)) {
    return writeFile({ ...file, kind: 'write' }, { force, view })
  }
  const reason = view.unsafe(file.path)
  if (reason !== null) return refused(file.relPath, reason)
  const current = view.read(file.path)
  if (current.includes(begin)) return { relPath: file.relPath, outcome: 'kept', detail: 'section already present' }
  if (adopted) return { relPath: file.relPath, outcome: 'kept', detail: 'exists' }
  if (carriesContent(current, file.content)) return { relPath: file.relPath, outcome: 'kept', detail: 'exists; already carries these orders' }
  const separator = current.endsWith('\n') ? '\n' : '\n\n'
  view.write(file.path, `${current}${separator}${begin}\n${file.content.trimEnd()}\n${end}\n`)
  return { relPath: file.relPath, outcome: 'composed', detail: 'appended; the file was already here' }
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
 * An entry the file held before this run started is the repository's: without
 * `--force` its value is kept even where the template's differs, and only the
 * entries it lacks are added. That holds at both levels the merge reaches — a
 * top-level key, and an entry inside a key that is an object on both sides.
 * Entries an earlier layer of the same run set are not the repository's, so a
 * later layer still replaces them.
 *
 * The reported detail names what the merge actually did to the file, so a
 * contribution to a shared value reads as a change rather than as a no-op, and
 * a value kept against the template is named rather than passed over.
 *
 * @param file - A `merge` action whose content parses as a JSON object.
 * @param options - Overwrite flag and the view to write through.
 * @returns Outcome entry.
 */
function mergeJson(file, { force, view }) {
  const incoming = JSON.parse(file.content)
  if (!isPlainObject(incoming)) {
    throw new Error(`${file.relPath}: a merged template must be a JSON object`)
  }
  const reason = view.unsafe(file.path)
  if (reason !== null) return refused(file.relPath, reason)
  const current = view.exists(file.path) ? view.read(file.path) : null
  const base = current === null ? {} : parseObject(file.relPath, current)
  const originalText = force ? null : view.original(file.path)
  const original = originalText === null ? {} : parseObject(file.relPath, originalText)
  const kept = []
  // A key holding an object on both sides merges one level deeper, so a layer
  // contributes its own entry to a shared value instead of replacing it. The
  // document budgets rely on this: several layers append to the same document,
  // and each declares the share of the ceiling it needs.
  //
  // The report is derived here rather than from the top-level keys alone. A
  // layer that contributes a share to a shared value changes the file without
  // adding a key, and calling that a no-op would be the only account anyone
  // gets of a ceiling that just moved — it is what `--dry-run` prints.
  const merged = { ...base }
  const changes = []
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
        `${file.relPath}: "${key}" is ${shapeOf(held)} in the file and ${shapeOf(value)} in the template, ` +
          'and neither form can be merged into the other. Convert the entry by hand, or delete the file ' +
          'and re-run to rebuild it from the templates; an entry they do not declare is lost with it.',
      )
    }
    if (!Object.hasOwn(base, key)) {
      changes.push(`+ ${key}`)
      merged[key] = value
    } else if (!heldIsObject) {
      // A parsed template and a parsed file never share an array, so identity
      // would report every list as changed on a re-run that wrote exactly what
      // the file already held.
      const owned = Object.hasOwn(original, key)
      if (toJson(held) !== toJson(value)) {
        if (owned) kept.push(key)
        else changes.push(`changed ${key}`)
      }
      merged[key] = owned ? held : value
    } else {
      // The shape check above has already refused a mismatch, so both sides are
      // objects and the change is in the entries this layer sets.
      const owned = isPlainObject(original[key]) ? original[key] : {}
      const fresh = Object.keys(value).filter(entry => !Object.hasOwn(held, entry))
      const differing = Object.keys(value).filter(entry => Object.hasOwn(held, entry) && toJson(held[entry]) !== toJson(value[entry]))
      const rewritten = differing.filter(entry => !Object.hasOwn(owned, entry))
      if (fresh.length > 0) changes.push(`+ ${fresh.join(', ')} in ${key}`)
      if (rewritten.length > 0) changes.push(`changed ${rewritten.join(', ')} in ${key}`)
      for (const entry of differing.filter(name => Object.hasOwn(owned, name))) kept.push(`${entry} in ${key}`)
      merged[key] = { ...held }
      for (const entry of [...fresh, ...rewritten]) merged[key][entry] = value[entry]
    }
  }
  const text = toJson(merged)
  if (text !== current) view.write(file.path, text)
  const detail = [...changes, ...(kept.length > 0 ? [`kept ${kept.join(', ')} as the file has them (--force to replace)`] : [])].join(', ')
  const outcome = changes.length === 0 && kept.length > 0 ? 'kept' : 'merged'
  return { relPath: file.relPath, outcome, detail: detail || 'already present' }
}

/**
 * Parse a merge target, which must hold a JSON object.
 * @param relPath - Repository-relative path, for the refusal.
 * @param text - The file's contents.
 * @returns The parsed object.
 */
function parseObject(relPath, text) {
  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    throw new Error(
      `${relPath}: the file is not valid JSON (${error instanceof Error ? error.message : String(error)}), so the template cannot be merged into it. Fix or delete the file, and re-run.`,
    )
  }
  if (!isPlainObject(value)) {
    throw new Error(
      `${relPath}: the file holds ${shapeOf(value)}, not a JSON object, so the template's entries cannot be merged into it. Convert it by hand, or delete the file and re-run to rebuild it from the templates.`,
    )
  }
  return value
}

/**
 * Create a link the plan owns, falling back where the platform refuses
 * symlinks.
 *
 * A link to a file falls back to an `@`-import, which reaches the same content
 * through Claude Code's own resolution. A link to a directory has no such
 * fallback: a written file there would occupy the skill directory and shadow
 * the skill rather than expose it, and copying the tree would leave two copies
 * to drift. So it is reported as skipped, which is true — the copy is still at
 * the path the link names.
 *
 * Anything already at the path — a dangling symlink included — is kept and
 * never written through.
 *
 * @param link - A `symlink` action.
 * @param options - The view to act through.
 * @returns Outcome entry.
 */
function createSymlink(link, { view }) {
  const reason = view.unsafe(link.path)
  if (view.exists(link.path)) {
    return { relPath: link.relPath, outcome: 'kept', detail: reason === null ? 'exists' : `${reason}; left alone` }
  }
  if (reason !== null) return refused(link.relPath, reason)
  if (view.dryRun) return { relPath: link.relPath, outcome: 'linked', detail: `-> ${link.target}` }
  // A nested link's parent directory is the tool's own to create; the plan's
  // own paths are the only ones this ever touches.
  if (link.dir === true) mkdirSync(dirname(link.path), { recursive: true })
  try {
    symlinkSync(link.target, link.path, link.dir === true ? 'dir' : 'file')
    return { relPath: link.relPath, outcome: 'linked', detail: `-> ${link.target}` }
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? ` (${error.code})` : ''
    if (link.dir === true) {
      return {
        relPath: link.relPath,
        outcome: 'skipped',
        detail: `this platform refused a directory link${code}; the skill is at ${link.target}`,
      }
    }
    // Windows without developer mode rejects symlinks; an `@`-import reaches the
    // same file through Claude Code's own resolution.
    view.write(link.path, link.fallback)
    return { relPath: link.relPath, outcome: 'added', detail: `symlink unavailable${code}; wrote an @-import` }
  }
}

/**
 * Record what this run adopted in the manifest.
 *
 * An absent manifest is written. A present one keeps its adoption date and
 * gains any layer, stack, or skill this run adds, so a layer applied on a later
 * run is recorded rather than lost; nothing a previous run recorded is removed.
 *
 * @param plan - Plan produced by `buildPlan`.
 * @param options - The view to write through.
 * @returns Outcome entry.
 */
function recordManifest(plan, { view }) {
  const path = resolve(plan.targetDir, MANIFEST_PATH)
  const fresh = plan.manifest
  if (!view.exists(path)) return writeFile({ kind: 'write', relPath: MANIFEST_PATH, path, content: toJson(fresh) }, { force: false, view })
  const reason = view.unsafe(path)
  if (reason !== null) return refused(MANIFEST_PATH, reason)
  const current = view.read(path)
  let held
  try {
    held = JSON.parse(current)
  } catch {
    held = null
  }
  if (!isPlainObject(held)) return { relPath: MANIFEST_PATH, outcome: 'kept', detail: 'not a JSON object; left as is' }
  const union = (a, b) => [...new Set([...(Array.isArray(a) ? a : []), ...b])]
  const stack = union(held.stack, fresh.stack)
  const architecture = held.architecture === true || fresh.architecture
  const merged = {
    ...fresh,
    ...held,
    layers: union(['base', ...stack, ...(architecture ? ['architecture'] : [])], Array.isArray(held.layers) ? held.layers : []),
    skills: union(held.skills, fresh.skills),
    stack,
    architecture,
  }
  const text = toJson(merged)
  if (text === current) return { relPath: MANIFEST_PATH, outcome: 'kept', detail: 'already adopted' }
  view.write(path, text)
  const added = ['layers', 'skills']
    .map(key => [key, merged[key].filter(entry => !(Array.isArray(held[key]) && held[key].includes(entry)))])
    .filter(([, entries]) => entries.length > 0)
    .map(([key, entries]) => `+ ${entries.join(', ')} in ${key}`)
  return { relPath: MANIFEST_PATH, outcome: 'merged', detail: added.join(', ') || 'rewritten in the current form' }
}

/**
 * Whether a package resolves from the target repository.
 * @param root - Absolute repository root.
 * @param specifier - Package name to resolve.
 * @returns True when Node can resolve it.
 */
function resolves(root, specifier) {
  try {
    createRequire(join(root, 'package.json')).resolve(specifier)
    return true
  } catch {
    return false
  }
}

/**
 * Create or extend `package.json` with the entries this run contributes.
 *
 * A key the repository already defines is left alone, in `scripts` and in every
 * dependency section alike. A repository with no `package.json` gets one only
 * when a selected stack declares a dependency, and the created manifest carries
 * exactly what this run owns.
 *
 * @param contribution - The plan's `package` contribution.
 * @param options - Dry-run flag, a note sink, and the repository's real path.
 * @returns Outcome entry, or `null` when there is nothing to do.
 */
function applyPackage(contribution, { dryRun, notes, root }) {
  const wouldWrite = contribution.exists
    ? Object.keys(contribution.additions.scripts).length > 0 || Object.keys(contribution.additions.devDependencies).length > 0
    : contribution.create !== null
  const reason = wouldWrite ? unsafeTarget(root, contribution.path) : null
  if (reason !== null) return refused('package.json', reason)
  if (!contribution.exists) {
    if (contribution.create === null) return null
    const created = contribution.create
    if (!dryRun) {
      writeText(contribution.path, toJson(created))
      notes.push(
        'package.json was created; review it before committing, and run `npm install` to fetch ' + `${Object.keys(created.devDependencies).join(', ')}.`,
      )
    }
    const entries = [...Object.keys(created.scripts), ...Object.keys(created.devDependencies)]
    return { relPath: 'package.json', outcome: 'added', detail: `+ ${entries.join(', ')}` }
  }

  const pkg = readJson(contribution.path)
  if (!isPlainObject(pkg)) return { relPath: 'package.json', outcome: 'kept', detail: 'not a JSON object' }
  const scripts = Object.keys(contribution.additions.scripts)
  const dependencies = Object.keys(contribution.additions.devDependencies)
  if (scripts.length === 0 && dependencies.length === 0) return null

  if (!dryRun) {
    pkg.scripts = { ...contribution.additions.scripts, ...(isPlainObject(pkg.scripts) ? pkg.scripts : {}) }
    // Only when there is something to contribute: a run that adds scripts alone
    // must not leave an empty `devDependencies` object behind.
    if (dependencies.length > 0) {
      pkg.devDependencies = { ...contribution.additions.devDependencies, ...(isPlainObject(pkg.devDependencies) ? pkg.devDependencies : {}) }
    }
    writeText(contribution.path, toJson(pkg))
  }
  const detail = [scripts.length > 0 ? `+ ${scripts.join(', ')}` : null, dependencies.length > 0 ? `+ ${dependencies.join(', ')} in devDependencies` : null]
    .filter(part => part !== null)
    .join(', ')
  if (!dryRun && dependencies.some(name => !resolves(dirname(contribution.path), name))) {
    notes.push(`${dependencies.join(', ')} was added to devDependencies; run \`npm install\` so the stack's gates can find it.`)
  }
  return { relPath: 'package.json', outcome: 'merged', detail }
}

/**
 * Report what an existing `tsconfig.json` does not set, without editing it.
 *
 * The file is left exactly as it is: it may hold comments and deliberate values
 * that a rewrite would lose. The notes name each gap and the recommended value,
 * which is the point at which a caller asks the user before changing anything.
 *
 * @param report - The plan's TypeScript config report.
 * @param notes - Note sink.
 */
function reportTypescriptConfig(report, notes) {
  if (!report.exists) return
  if (report.error !== null) {
    notes.push(`tsconfig.json could not be read (${report.error}); the TypeScript gates may not run.`)
    return
  }
  for (const { key, value } of report.required) {
    notes.push(`tsconfig.json: "compilerOptions.${key}" is not set; the TypeScript orders assume ${JSON.stringify(value)}.`)
  }
  for (const { key, found, recommended } of report.conflicts) {
    // One line per finding: a multi-line JSON dump would break the report rows.
    notes.push(`tsconfig.json: "compilerOptions.${key}" is ${JSON.stringify(found)}, recommended ${JSON.stringify(recommended)}.`)
  }
  if (report.suggested.length > 0) {
    notes.push(`tsconfig.json: ${report.suggested.length} recommended option(s) are not set (${report.suggested.map(option => option.key).join(', ')}).`)
  }
  if (report.bundler) notes.push(BUNDLER_NOTE)
  if (report.required.length > 0 || report.conflicts.length > 0 || report.suggested.length > 0) {
    notes.push(
      report.bundler
        ? 'tsconfig.json was left as it is. Apply the strictness options if the user wants them; leave the module and target settings to the framework.'
        : 'tsconfig.json was left as it is, so its comments and values survive. Ask the user whether to apply the options above.',
    )
  }
}

/**
 * Install the fast pre-commit hook and point Git at the hook directory, unless
 * the repository already configured a different one — or already had a hook
 * this run would displace.
 *
 * Two things are never taken over silently. A `.githooks/pre-commit` the
 * repository already holds is kept unless the run asked to replace it, and
 * `core.hooksPath` is not pointed at `.githooks` when `$GIT_DIR/hooks` already
 * holds an executable hook, because Git reads only one of the two directories
 * and setting the path would quietly stop the other from running.
 *
 * When another `core.hooksPath` is in the way, the hook file cannot be reached
 * by Git at all, and the only thing that can run it is a chain in whatever
 * directory won. `agent-init.githooks` records, in the repository's own config,
 * that this repository's `.githooks/` may be executed — the marker such a chain
 * reads. It is written to `.git/config`, which a clone does not carry, so a
 * repository cannot opt itself in by shipping a file.
 *
 * @param targetDir - Absolute path to the target repository.
 * @param options - Overwrite flag, dry-run flag, a note sink, and the repository's real path.
 * @returns Outcome entry.
 */
function installHook(targetDir, { force, dryRun, notes, root }) {
  const hookPath = resolve(targetDir, '.githooks', 'pre-commit')
  const reason = unsafeTarget(root, hookPath)
  if (reason !== null) {
    notes.push(`.githooks/pre-commit is ${reason}; left it alone and did not install the gates hook.`)
    return refused('.githooks/pre-commit', reason)
  }
  let present = null
  if (lstatOrNull(hookPath) !== null) {
    // A directory, a symlink to nothing, or an unreadable file at this path is
    // a layout this tool does not own. It is reported rather than allowed to
    // abort the run or be overwritten.
    try {
      if (!statSync(hookPath).isFile()) throw new Error('not a regular file')
      present = readFileSync(hookPath, 'utf8')
    } catch (error) {
      notes.push(
        `.githooks/pre-commit exists but could not be read (${error instanceof Error ? error.message : String(error)}); ` +
          'left it alone and did not install the gates hook.',
      )
      return { relPath: '.githooks/pre-commit', outcome: 'kept', detail: 'not a readable file' }
    }
  }
  // A checkout with `core.autocrlf` holds this hook with CRLF endings, and it is
  // still the hook this tool wrote.
  const unchanged = present !== null && present.replace(/\r\n/gu, '\n') === PRE_COMMIT
  if (present !== null && !unchanged && !force) {
    notes.push(
      '.githooks/pre-commit already exists and was kept; the gates are not wired into it. ' +
        'Add `node scripts/gates/run.mjs --group commit` to it, or re-run with --force to replace it.',
    )
    return { relPath: '.githooks/pre-commit', outcome: 'kept', detail: 'exists; gates not installed' }
  }
  if (!dryRun) {
    mkdirSync(dirname(hookPath), { recursive: true })
    // A re-run leaves the file it already wrote alone, so its mtime and mode
    // survive a run that changed nothing.
    if (!unchanged) writeFileSync(hookPath, PRE_COMMIT, 'utf8')
    chmodSync(hookPath, 0o755)
  }
  const current = spawnSync('git', ['-C', targetDir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' })
  const configured = (current.stdout ?? '').trim()
  if (configured !== '' && !sameDirectory(targetDir, configured, '.githooks')) {
    // Git will not read this hook, so say what turns it on rather than only
    // what is in the way. Both commands are needed: the marker lets a hook
    // chain run the file, and the path is what Git itself would need.
    //
    // The value is read across every scope rather than `--local` alone: a
    // global or system `core.hooksPath` is what Git actually resolves, and
    // writing a local one over it would silently stop those hooks from
    // running. The write below stays `--local`, because the marker is only
    // worth anything in the repository's own config, and a redirect through
    // `GIT_CONFIG` would otherwise put it somewhere nothing reads, silently,
    // because the result is not inspected.
    if (!dryRun) setLocalConfig(targetDir, 'agent-init.githooks', 'true', notes)
    notes.push(
      `core.hooksPath is already ${configured}; left as is. These hooks run where that directory chains to them, and otherwise with: git config core.hooksPath .githooks`,
    )
    return { relPath: '.githooks/pre-commit', outcome: unchanged ? 'kept' : 'added', detail: 'not activated' }
  }
  if (configured === '') {
    const displaced = executableGitHooks(targetDir)
    if (displaced.length > 0) {
      // Git reads `core.hooksPath` or `$GIT_DIR/hooks`, never both, so pointing
      // the path at `.githooks` would stop these from running without a word.
      if (!dryRun) setLocalConfig(targetDir, 'agent-init.githooks', 'true', notes)
      notes.push(
        `core.hooksPath is unset and $GIT_DIR/hooks already holds ${displaced.join(', ')}; left unset so they keep running. ` +
          'Point it at .githooks yourself to run the gates on every commit, or call this hook from the existing one.',
      )
      return { relPath: '.githooks/pre-commit', outcome: unchanged ? 'kept' : 'added', detail: 'not activated' }
    }
  }
  if (!dryRun) setLocalConfig(targetDir, 'core.hooksPath', '.githooks', notes)
  return {
    relPath: '.githooks/pre-commit',
    outcome: present === null ? 'added' : unchanged ? 'kept' : 'replaced',
    detail: unchanged ? 'already installed; activated' : 'activated',
  }
}

/**
 * Whether a configured directory is the same one as the repository's own.
 *
 * `./.githooks`, `.githooks/`, and an absolute path all name the directory
 * `.githooks` does, so the comparison is between resolved real paths rather
 * than spellings. A relative value resolves against the repository.
 *
 * @param targetDir - Absolute path to the target repository.
 * @param configured - The configured value.
 * @param own - The repository-relative directory this tool installs.
 * @returns True when both name one directory.
 */
function sameDirectory(targetDir, configured, own) {
  const real = path => {
    try {
      return realpathSync(path)
    } catch {
      return path
    }
  }
  return real(resolve(targetDir, configured)) === real(resolve(targetDir, own))
}

/**
 * List the executable hooks Git would read from `$GIT_DIR/hooks`.
 *
 * The directory is resolved through Git rather than assumed, because the
 * repository may be a linked worktree whose real Git directory lives
 * elsewhere. Sample hooks are inert and are ignored.
 *
 * @param targetDir - Absolute path to the target repository.
 * @returns Hook filenames, sorted.
 */
function executableGitHooks(targetDir) {
  const result = spawnSync('git', ['-C', targetDir, 'rev-parse', '--git-path', 'hooks'], { encoding: 'utf8' })
  if (result.status !== 0) return []
  const reported = (result.stdout ?? '').trim()
  if (reported === '') return []
  // `--git-path` answers relative to the repository when it is not absolute,
  // and `-C` already moved Git there, so resolve against the target.
  const dir = isAbsolute(reported) ? reported : resolve(targetDir, reported)
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter(entry => entry.isFile() && !entry.name.endsWith('.sample'))
    .filter(entry => {
      try {
        return (statSync(join(dir, entry.name)).mode & 0o111) !== 0
      } catch {
        return false
      }
    })
    .map(entry => entry.name)
    .sort()
}

/**
 * Write one value into the repository's own Git config.
 *
 * There is nowhere to put it when the target is not a repository at all, which
 * `--allow-non-git` permits. That is reported rather than ignored: the hook file
 * is written either way, and a run that says it left the repository configured
 * when it did not would be the only account anyone gets.
 *
 * @param targetDir - Absolute path to the target repository.
 * @param key - Config key to set.
 * @param value - Value to set.
 * @param notes - Note sink for a failure.
 * @returns True when Git accepted the value.
 */
function setLocalConfig(targetDir, key, value, notes) {
  const result = spawnSync('git', ['-C', targetDir, 'config', '--local', key, value], { encoding: 'utf8' })
  if (result.status !== 0) {
    const reason = (result.stderr ?? '').trim().split('\n')[0] ?? 'git config failed'
    notes.push(`could not set ${key} locally (${reason}); set it by hand where Git can read it`)
    return false
  }
  return true
}

/** Every script name this tool may add, for documentation and tests. */
export const MANAGED_SCRIPTS = Object.keys(PACKAGE_SCRIPTS)
