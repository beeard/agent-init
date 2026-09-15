/**
 * Build the list of filesystem actions a scaffold run performs.
 *
 * Planning is pure: it reads templates and the target's current state and
 * returns actions. Nothing is written until `apply.mjs` executes the plan, so
 * `--dry-run` prints exactly what a real run would do.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { readJson, readText, slugify, substitute, today } from './util.mjs'

/** Template layers, applied in order. `base` is required; the rest are opt-in. */
export const LAYERS = ['base', 'python', 'architecture']

/** Stack layers, selected by `--stack`. */
export const STACKS = ['go', 'python', 'rust', 'typescript']

/** Skills shipped with the base layer, as template directory names. */
export const BASE_SKILLS = ['agent-notes', 'pre-push-checks', 'prose-standard', 'code-review']

/** Scripts merged into an existing `package.json`, without overwriting an entry. */
export const PACKAGE_SCRIPTS = {
  'check:agents': 'node scripts/gates/run.mjs',
  'check:agents:commit': 'node scripts/gates/run.mjs --group commit',
  'change-scope': 'node scripts/gates/change-scope.mjs',
}

/** The marker that records which version of the structure a repository adopted. */
export const MANIFEST_PATH = '.agents/manifest.json'

/** A suffix marking a template appended to the file named by the rest of the path. */
const APPEND_SUFFIX = '.append'

/**
 * A suffix marking a template merged into the file named by the rest of the
 * path. Merging is a shallow object merge, later keys winning, so a layer adds
 * its own entries to a manifest without having to restate the ones below it —
 * and without breaking when a lower layer's entries change.
 */
const MERGE_SUFFIX = '.merge'

/**
 * Recursively list every file under a directory.
 * @param root - Absolute directory path.
 * @returns Absolute paths, sorted, excluding directories themselves.
 */
function walk(root, current = root) {
  const out = []
  for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(current, entry.name)
    if (entry.isDirectory()) out.push(...walk(root, abs))
    else if (entry.isFile()) out.push(abs)
  }
  return out
}

/**
 * Collect the template files one layer contributes.
 * @param templatesRoot - Absolute path to the package's `templates/` directory.
 * @param layer - Layer directory name.
 * @returns Absolute template paths, or an empty list when the layer is absent.
 */
function layerFiles(templatesRoot, layer) {
  const dir = join(templatesRoot, layer)
  return existsSync(dir) ? walk(dir) : []
}

/**
 * Build every action for one scaffold run.
 * @param options - Run options.
 * @param options.targetDir - Absolute path to the repository being scaffolded.
 * @param options.templatesRoot - Absolute path to the package's `templates/` directory.
 * @param options.projectName - Human-readable project name for the root documents.
 * @param options.skills - Skill directory names to include from the base layer.
 * @param options.stack - Stack layer names to apply, in addition to `base`.
 * @param options.architecture - Whether to apply the opt-in architecture layer.
 * @param options.lenient - Mark every gate advisory, for adoption on an existing repository.
 * @returns Plan with `files` (write, append, or merge), `symlinks`, and `manifest`.
 */
export function buildPlan({ targetDir, templatesRoot, projectName, skills, stack = [], architecture, lenient = false }) {
  const variables = {
    PROJECT: projectName,
    SLUG: slugify(projectName),
    DATE: today(),
  }
  const files = []
  const symlinks = []
  const layers = ['base', ...stack, ...(architecture ? ['architecture'] : [])]

  // A layer with no template directory contributes nothing and reports success.
  // That is the silent-skip failure the shipped rules forbid, so a declared
  // layer that contributes no files is an error rather than an empty layer.
  const empty = layers.filter(layer => layerFiles(templatesRoot, layer).length === 0)
  if (empty.length > 0) {
    throw new Error(`no templates found for layer(s): ${empty.join(', ')} (looked under ${templatesRoot})`)
  }

  for (const layer of layers) {
    for (const abs of layerFiles(templatesRoot, layer)) {
      if (layer === 'base' && abs.includes(`${sep}skills${sep}`)) {
        const dir = relative(join(templatesRoot, 'base', '.agents', 'skills'), abs).split(sep)[0] ?? ''
        // Template skill directories carry the project slug as a prefix; the
        // caller selects them by their bare name.
        const skillName = dir.startsWith('{{SLUG}}-') ? dir.slice('{{SLUG}}-'.length) : dir
        if (!skills.includes(skillName)) continue
      }
      const relTemplate = relative(join(templatesRoot, layer), abs).split(sep).join('/')
      const kind = relTemplate.endsWith(APPEND_SUFFIX) ? 'append'
        : relTemplate.endsWith(MERGE_SUFFIX) ? 'merge'
          : 'write'
      const suffix = kind === 'append' ? APPEND_SUFFIX : kind === 'merge' ? MERGE_SUFFIX : ''
      const relPath = substitute(suffix === '' ? relTemplate : relTemplate.slice(0, -suffix.length), variables)
      const path = resolve(targetDir, relPath)
      const content = substitute(readText(abs), variables)
      files.push({ kind, layer, path, relPath, content, template: abs })
    }
  }

  symlinks.push({
    kind: 'symlink',
    path: resolve(targetDir, 'CLAUDE.md'),
    relPath: 'CLAUDE.md',
    target: 'AGENTS.md',
    fallback: '@AGENTS.md\n',
  })

  return {
    targetDir,
    variables,
    files: lenient ? markAdvisory(dedupe(files)) : dedupe(files),
    symlinks,
    mergedScripts: mergePackageScripts(targetDir),
    manifest: { version: 1, adopted: variables.DATE, layers, skills, stack, architecture, lenient },
  }
}

/**
 * Mark every gate advisory in a planned `gates.json`.
 *
 * Adoption on an existing repository would otherwise greet the first run with
 * the complete backlog of rules the repository has not followed yet. Advisory
 * reports the same findings without failing, so a repository can adopt, read
 * its actual state, and tighten one gate at a time.
 *
 * @param files - Planned file actions.
 * @returns The same actions, with any `gates.json` entry marked advisory.
 */
function markAdvisory(files) {
  return files.map((file) => {
    if (!file.relPath.endsWith('gates.json') || file.kind === 'append') return file
    const gates = JSON.parse(file.content)
    for (const gate of Object.values(gates)) gate.advisory = true
    return { ...file, content: `${JSON.stringify(gates, null, 2)}\n` }
  })
}

/**
 * Keep the last `write` for each path so a later layer overrides an earlier
 * one, while `append` and `merge` actions always accumulate: they add to what
 * is already there rather than replacing it.
 * @param files - Planned file actions in layer order.
 * @returns Deduplicated actions preserving first-seen order.
 */
function dedupe(files) {
  const lastWrite = new Map()
  for (const file of files) {
    if (file.kind === 'write') lastWrite.set(file.relPath, file)
  }
  const kept = []
  const seenWrite = new Set()
  for (const file of files) {
    if (file.kind !== 'write') {
      kept.push(file)
      continue
    }
    if (seenWrite.has(file.relPath)) continue
    if (lastWrite.get(file.relPath) !== file) continue
    seenWrite.add(file.relPath)
    kept.push(file)
  }
  return kept
}

/**
 * Work out which package.json scripts the run would add.
 * @param targetDir - Absolute path to the target repository.
 * @returns Scripts to add, or `null` when the repository has no `package.json`.
 */
function mergePackageScripts(targetDir) {
  const path = resolve(targetDir, 'package.json')
  if (!existsSync(path) || !statSync(path).isFile()) return null
  const pkg = readJson(path)
  const existing = pkg.scripts ?? {}
  const additions = {}
  for (const [name, command] of Object.entries(PACKAGE_SCRIPTS)) {
    if (!Object.hasOwn(existing, name)) additions[name] = command
  }
  return { path, additions }
}
