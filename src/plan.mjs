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

/** Template layers, applied in order. `architecture` is opt-in. */
export const LAYERS = ['base', 'architecture']

/** Skills shipped with the base layer, as template directory names. */
export const BASE_SKILLS = ['agent-notes', 'pre-push-checks', 'prose-standard', 'code-review']

/** Scripts merged into an existing `package.json`, without overwriting an entry. */
export const PACKAGE_SCRIPTS = {
  'check:agents': 'node scripts/gates/run.mjs',
  'check:agents:fast': 'node scripts/gates/run.mjs --group fast',
  'change-scope': 'node scripts/gates/change-scope.mjs',
}

/** The marker that records which version of the structure a repository adopted. */
export const MANIFEST_PATH = '.agents/manifest.json'

/** A suffix marking a template appended to the file named by the rest of the path. */
const APPEND_SUFFIX = '.append'

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
 * @param options.architecture - Whether to apply the opt-in architecture layer.
 * @returns Plan with `files` (write or append), `symlinks`, and `manifest`.
 */
export function buildPlan({ targetDir, templatesRoot, projectName, skills, architecture }) {
  const variables = {
    PROJECT: projectName,
    SLUG: slugify(projectName),
    DATE: today(),
  }
  const files = []
  const symlinks = []
  const layers = architecture ? LAYERS : ['base']

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
      const append = relTemplate.endsWith(APPEND_SUFFIX)
      const relPath = substitute(append ? relTemplate.slice(0, -APPEND_SUFFIX.length) : relTemplate, variables)
      const path = resolve(targetDir, relPath)
      const content = substitute(readText(abs), variables)
      files.push(append
        ? { kind: 'append', path, relPath, content, template: abs }
        : { kind: 'write', path, relPath, content, template: abs })
    }
  }

  symlinks.push({
    kind: 'symlink',
    path: resolve(targetDir, 'CLAUDE.md'),
    relPath: 'CLAUDE.md',
    target: 'AGENTS.md',
    fallback: '@AGENTS.md\n',
  })

  const mergedScripts = mergePackageScripts(targetDir)
  return {
    targetDir,
    variables,
    files: dedupe(files),
    symlinks,
    mergedScripts,
    manifest: { version: 1, adopted: variables.DATE, layers, skills, architecture },
  }
}

/**
 * Keep the last action for each path so a later layer overrides an earlier one,
 * while append actions always accumulate.
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
    if (file.kind === 'append') {
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
