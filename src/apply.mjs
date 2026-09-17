/**
 * Execute a scaffold plan against a target repository.
 *
 * Every action is reported with an outcome, so a caller can tell an added file
 * from one deliberately kept. An existing file is never overwritten unless the
 * run asked for it: re-running the scaffolder must be safe.
 */

import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
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
  // Read before anything is written: the manifest is what distinguishes a file
  // this structure wrote from one the repository already had.
  const adopted = existsSync(resolve(plan.targetDir, MANIFEST_PATH))

  for (const file of plan.files) {
    if (file.kind === 'append') {
      results.push(appendFile(file, { force, dryRun }))
      continue
    }
    if (file.kind === 'merge') {
      results.push(mergeJson(file, { force, dryRun }))
      continue
    }
    if (file.kind === 'compose') {
      results.push(composeFile(file, { force, dryRun, adopted }))
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

  const entry = applyPackage(plan.package, { dryRun, notes })
  if (entry !== null) results.push(entry)

  if (plan.typescriptConfig !== null) reportTypescriptConfig(plan.typescriptConfig, notes)
  if (plan.typescriptConfig !== null && plan.package.exists && plan.package.moduleType !== 'module') {
    // Node reads a `.ts` file as ESM only when the package says so, so the ESM
    // standing orders cannot hold while this value does not.
    notes.push(`package.json "type" is ${plan.package.moduleType === null ? 'unset' : JSON.stringify(plan.package.moduleType)}; the TypeScript orders assume ESM. Set "type": "module", or name the files .mts. Left as is — ask the user.`)
  }

  if (hooks) results.push(installHook(plan.targetDir, { force, dryRun, notes }))

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
 * Write a composing template, or add it as a marked section to a file the
 * repository already had.
 *
 * Three cases, and the adoption marker is what separates the last two. No file
 * → written as-is, so a fresh repository gets the document and not a wrapper.
 * A file, and this structure was never adopted here → the content is appended
 * as a named section, because the repository's own file is not ours to replace
 * but the orders still have to exist. A file in a repository that did adopt →
 * left alone, so a hand-edited document survives every later run.
 *
 * @param file - A `compose` action.
 * @param options - Overwrite flag, dry-run flag, and whether the structure is already adopted.
 * @returns Outcome entry.
 */
function composeFile(file, { force, dryRun, adopted }) {
  const begin = beginMarker(file.layer)
  const end = endMarker(file.layer)
  if (force || !existsSync(file.path)) {
    return writeFile({ ...file, kind: 'write' }, { force, dryRun })
  }
  const current = readFileSync(file.path, 'utf8')
  if (current.includes(begin)) return { relPath: file.relPath, outcome: 'kept', detail: 'section already present' }
  if (adopted) return { relPath: file.relPath, outcome: 'kept', detail: 'exists' }
  if (!dryRun) {
    const separator = current.endsWith('\n') ? '\n' : '\n\n'
    writeText(file.path, `${current}${separator}${begin}\n${file.content.trimEnd()}\n${end}\n`)
  }
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
 * The reported detail names what the merge actually did to the file, so a
 * contribution to a shared value reads as a change rather than as a no-op.
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
        `${file.relPath}: "${key}" is ${shapeOf(held)} in the file and ${shapeOf(value)} in the template, `
        + 'and neither form can be merged into the other. Convert the entry by hand, or delete the file '
        + 'and re-run to rebuild it from the templates; an entry they do not declare is lost with it.',
      )
    }
    if (!Object.hasOwn(base, key)) {
      changes.push(`+ ${key}`)
    } else if (!heldIsObject) {
      // A parsed template and a parsed file never share an array, so identity
      // would report every list as changed on a re-run that wrote exactly what
      // the file already held.
      if (toJson(held) !== toJson(value)) changes.push(`changed ${key}`)
    } else {
      // The shape check above has already refused a mismatch, so both sides are
      // objects and the change is in the entries this layer sets.
      const fresh = Object.keys(value).filter(entry => !Object.hasOwn(held, entry))
      const rewritten = Object.keys(value).filter(entry => Object.hasOwn(held, entry) && toJson(held[entry]) !== toJson(value[entry]))
      if (fresh.length > 0) changes.push(`+ ${fresh.join(', ')} in ${key}`)
      if (rewritten.length > 0) changes.push(`changed ${rewritten.join(', ')} in ${key}`)
    }
    merged[key] = heldIsObject && valueIsObject ? { ...held, ...value } : value
  }
  if (!dryRun) {
    mkdirSync(dirname(file.path), { recursive: true })
    writeText(file.path, toJson(merged))
  }
  return { relPath: file.relPath, outcome: 'merged', detail: changes.join(', ') || 'already present' }
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
 * @param link - A `symlink` action.
 * @param options - Dry-run flag.
 * @returns Outcome entry.
 */
function createSymlink(link, { dryRun }) {
  if (existsSync(link.path)) return { relPath: link.relPath, outcome: 'kept', detail: 'exists' }
  if (dryRun) return { relPath: link.relPath, outcome: 'linked', detail: `-> ${link.target}` }
  // A nested link's parent directory is the tool's own to create; the plan's
  // own paths are the only ones this ever touches.
  if (link.dir === true) mkdirSync(dirname(link.path), { recursive: true })
  try {
    symlinkSync(link.target, link.path, link.dir === true ? 'dir' : 'file')
    return { relPath: link.relPath, outcome: 'linked', detail: `-> ${link.target}` }
  } catch {
    if (link.dir === true) {
      return {
        relPath: link.relPath,
        outcome: 'skipped',
        detail: `this platform refused a directory link; the skill is at ${link.target}`,
      }
    }
    // Windows without developer mode rejects symlinks; an `@`-import reaches the
    // same file through Claude Code's own resolution.
    writeText(link.path, link.fallback)
    return { relPath: link.relPath, outcome: 'added', detail: 'symlink unavailable; wrote an @-import' }
  }
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
 * @param options - Dry-run flag and a note sink.
 * @returns Outcome entry, or `null` when there is nothing to do.
 */
function applyPackage(contribution, { dryRun, notes }) {
  if (!contribution.exists) {
    if (contribution.create === null) return null
    const created = contribution.create
    if (!dryRun) {
      writeText(contribution.path, toJson(created))
      notes.push('package.json was created; review it before committing, and run `npm install` to fetch '
        + `${Object.keys(created.devDependencies).join(', ')}.`)
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
  const detail = [
    scripts.length > 0 ? `+ ${scripts.join(', ')}` : null,
    dependencies.length > 0 ? `+ ${dependencies.join(', ')} in devDependencies` : null,
  ].filter(part => part !== null).join(', ')
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
  if (report.required.length > 0 || report.conflicts.length > 0 || report.suggested.length > 0) {
    notes.push('tsconfig.json was left as it is, so its comments and values survive. Ask the user whether to apply the options above.')
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
 * @param options - Overwrite flag, dry-run flag, and a note sink.
 * @returns Outcome entry.
 */
function installHook(targetDir, { force, dryRun, notes }) {
  const hookPath = resolve(targetDir, '.githooks', 'pre-commit')
  let present = null
  if (existsSync(hookPath)) {
    // A directory, a symlink to nothing, or an unreadable file at this path is
    // a layout this tool does not own. It is reported rather than allowed to
    // abort the run or be overwritten.
    try {
      if (!statSync(hookPath).isFile()) throw new Error('not a regular file')
      present = readFileSync(hookPath, 'utf8')
    } catch (error) {
      notes.push(`.githooks/pre-commit exists but could not be read (${error instanceof Error ? error.message : String(error)}); `
        + 'left it alone and did not install the gates hook.')
      return { relPath: '.githooks/pre-commit', outcome: 'kept', detail: 'not a readable file' }
    }
  }
  if (present !== null && present !== PRE_COMMIT && !force) {
    notes.push('.githooks/pre-commit already exists and was kept; the gates are not wired into it. '
      + 'Add `node scripts/gates/run.mjs --group commit` to it, or re-run with --force to replace it.')
    return { relPath: '.githooks/pre-commit', outcome: 'kept', detail: 'exists; gates not installed' }
  }
  const unchanged = present === PRE_COMMIT
  if (!dryRun) {
    mkdirSync(dirname(hookPath), { recursive: true })
    // A re-run leaves the file it already wrote alone, so its mtime and mode
    // survive a run that changed nothing.
    if (!unchanged) writeFileSync(hookPath, PRE_COMMIT, 'utf8')
    chmodSync(hookPath, 0o755)
  }
  const current = spawnSync('git', ['-C', targetDir, 'config', '--get', 'core.hooksPath'], { encoding: 'utf8' })
  const configured = (current.stdout ?? '').trim()
  if (configured !== '' && configured !== '.githooks') {
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
    notes.push(`core.hooksPath is already ${configured}; left as is. These hooks run where that directory chains to them, and otherwise with: git config core.hooksPath .githooks`)
    return { relPath: '.githooks/pre-commit', outcome: unchanged ? 'kept' : 'added', detail: 'not activated' }
  }
  if (configured === '') {
    const displaced = executableGitHooks(targetDir)
    if (displaced.length > 0) {
      // Git reads `core.hooksPath` or `$GIT_DIR/hooks`, never both, so pointing
      // the path at `.githooks` would stop these from running without a word.
      if (!dryRun) setLocalConfig(targetDir, 'agent-init.githooks', 'true', notes)
      notes.push(`core.hooksPath is unset and $GIT_DIR/hooks already holds ${displaced.join(', ')}; left unset so they keep running. `
        + 'Point it at .githooks yourself to run the gates on every commit, or call this hook from the existing one.')
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
    .filter((entry) => {
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
