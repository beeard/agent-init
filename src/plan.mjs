/**
 * Build the list of filesystem actions a scaffold run performs.
 *
 * Planning is pure: it reads templates and the target's current state and
 * returns actions. Nothing is written until `apply.mjs` executes the plan, so
 * `--dry-run` prints exactly what a real run would do.
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { isPlainObject, readJson, readJsonc, readText, slugify, substitute, today } from './util.mjs'

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

/**
 * `package.json` entries a stack layer contributes, added only where the key is
 * absent. This is not a `.merge` template because a merge replaces a key both
 * sides hold, and a project's own `typecheck` script or pinned compiler version
 * is a choice this tool must not overwrite.
 */
const STACK_PACKAGE_CONTRIBUTIONS = {
  typescript: {
    scripts: { typecheck: 'tsc --noEmit' },
    devDependencies: { typescript: '^5.6.0' },
  },
}

/**
 * Compiler options the TypeScript standing orders assert, as opposed to the
 * ones the template merely recommends. A missing entry here is reported as a
 * broken order; a differing value is always reported, never rewritten.
 */
const TYPESCRIPT_REQUIRED = ['strict', 'module', 'moduleResolution', 'target']

/** The marker that records which version of the structure a repository adopted. */
export const MANIFEST_PATH = '.agents/manifest.json'

/** A suffix marking a template appended to the file named by the rest of the path. */
const APPEND_SUFFIX = '.append'

/**
 * A suffix marking a template merged into the file named by the rest of the
 * path. A layer adds its own entries to a manifest without having to restate
 * the ones below it — and without breaking when a lower layer's entries change.
 *
 * A key holding an object on both sides merges one level deeper, so several
 * layers can contribute to one shared value; every other key is replaced. A key
 * whose shape the two sides disagree about is refused rather than resolved —
 * see `mergeJson` in `apply.mjs`.
 */
const MERGE_SUFFIX = '.merge'

/**
 * A suffix marking a template that composes with the target: written as-is when
 * the file is absent, appended as a marked section when the repository already
 * had a file of its own and had not adopted this structure yet, and left alone
 * once adopted.
 *
 * A plain `write` cannot do this. The root `AGENTS.md` may already exist — a
 * Next.js project ships one — and keeping it leaves the base standing orders
 * unwritten, while appending unconditionally would re-inject them after every
 * hand-edit. The adoption marker is what tells "a file we wrote" from "a file
 * the repository already had".
 */
const COMPOSE_SUFFIX = '.compose'

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
 * The skills the base layer offers, named as the caller selects them.
 * @param templatesRoot - Absolute path to the package's `templates/` directory.
 * @returns Bare skill names, sorted.
 */
function offeredSkills(templatesRoot) {
  const dir = join(templatesRoot, 'base', '.agents', 'skills')
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => (entry.name.startsWith('{{SLUG}}-') ? entry.name.slice('{{SLUG}}-'.length) : entry.name))
    .sort()
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
  const templatesByLayer = new Map(layers.map(layer => [layer, layerFiles(templatesRoot, layer)]))

  // A layer with no template directory contributes nothing and reports success.
  // That is the silent-skip failure the shipped rules forbid, so a declared
  // layer that contributes no files is an error rather than an empty layer.
  const empty = layers.filter(layer => templatesByLayer.get(layer).length === 0)
  if (empty.length > 0) {
    throw new Error(`no templates found for layer(s): ${empty.join(', ')} (looked under ${templatesRoot})`)
  }

  // A skill name that matches no template plans no files and reports success,
  // which is the same silent skip one level down.
  const offered = offeredSkills(templatesRoot)
  const unknown = skills.filter(skill => !offered.includes(skill))
  if (unknown.length > 0) {
    throw new Error(`unknown skill(s): ${unknown.join(', ')} (available: ${offered.join(', ')}, all)`)
  }

  for (const layer of layers) {
    for (const abs of templatesByLayer.get(layer)) {
      if (layer === 'base' && abs.includes(`${sep}skills${sep}`)) {
        const dir = relative(join(templatesRoot, 'base', '.agents', 'skills'), abs).split(sep)[0]
        // Template skill directories carry the project slug as a prefix; the
        // caller selects them by their bare name.
        const skillName = dir.startsWith('{{SLUG}}-') ? dir.slice('{{SLUG}}-'.length) : dir
        if (!skills.includes(skillName)) continue
      }
      const relTemplate = relative(join(templatesRoot, layer), abs).split(sep).join('/')
      const kind = relTemplate.endsWith(APPEND_SUFFIX) ? 'append'
        : relTemplate.endsWith(MERGE_SUFFIX) ? 'merge'
          : relTemplate.endsWith(COMPOSE_SUFFIX) ? 'compose'
            : 'write'
      const suffix = kind === 'append' ? APPEND_SUFFIX
        : kind === 'merge' ? MERGE_SUFFIX
          : kind === 'compose' ? COMPOSE_SUFFIX
            : ''
      const relPath = substitute(suffix === '' ? relTemplate : relTemplate.slice(0, -suffix.length), variables)
      const path = resolve(targetDir, relPath)
      const content = substitute(readText(abs), variables)
      files.push({ kind, layer, path, relPath, content, template: abs })
    }
  }

  assertStacksDoNotShare(files, stack)

  symlinks.push({
    kind: 'symlink',
    path: resolve(targetDir, 'CLAUDE.md'),
    relPath: 'CLAUDE.md',
    target: 'AGENTS.md',
    fallback: '@AGENTS.md\n',
  })

  // The skills are written to the agent-neutral `.agents/skills/`, which Claude
  // Code does not read, so each one is also linked into the location it does.
  //
  // The link keeps the `<slug>-` prefix, because the registered name is the
  // directory name: a bare `agent-notes` would collide with a personal skill of
  // that name, and personal skills take precedence over project ones. Every
  // reference in AGENTS.md and each skill's `name:` therefore name the prefixed
  // skill, and this link is what makes that name reachable.
  //
  // Relative, so the link resolves against its own directory and survives a
  // clone instead of carrying the scaffolding machine's path.
  for (const skill of skills) {
    const name = `${variables.SLUG}-${skill}`
    symlinks.push({
      kind: 'symlink',
      path: resolve(targetDir, '.claude', 'skills', name),
      relPath: `.claude/skills/${name}`,
      target: `../../.agents/skills/${name}`,
      dir: true,
    })
  }

  return {
    targetDir,
    variables,
    files: lenient ? markAdvisory(dedupe(files)) : dedupe(files),
    symlinks,
    package: packageContribution(targetDir, stack, variables),
    typescriptConfig: typescriptConfigReport(targetDir, templatesRoot, stack),
    manifest: { version: 1, adopted: variables.DATE, layers, skills, stack, architecture, lenient },
  }
}

/**
 * Refuse a path one stack layer owns and another stack layer also contributes to.
 *
 * Stacks are peers and the caller chooses their order, so a shared path is
 * resolved by the order the flags happened to be typed: the losing layer's
 * document is never delivered, while the standing orders that link to it are.
 * That is how four language stacks came to ship one `docs/testing.md` between
 * them, and no gate saw it — the surviving document and the surviving budget
 * agreed by construction.
 *
 * `base` and `architecture` are a different case and are deliberately allowed:
 * they are a hierarchy with a fixed order, and a later layer replacing an
 * earlier one is what a `write` template is for.
 *
 * @param files - Planned file actions in layer order.
 * @param stack - The stack layers this run applies.
 */
function assertStacksDoNotShare(files, stack) {
  const peers = new Set(stack)
  const first = new Map()
  for (const file of files) {
    if (!peers.has(file.layer)) continue
    const held = first.get(file.relPath)
    if (held === undefined) {
      first.set(file.relPath, file)
      continue
    }
    if (held.layer === file.layer) continue
    // Two appends or two merges compose; a write or a compose among them replaces.
    const replaces = kind => kind === 'write' || kind === 'compose'
    if (!replaces(held.kind) && !replaces(file.kind)) continue
    const writer = replaces(held.kind) ? held.layer : file.layer
    const other = replaces(held.kind) ? file.layer : held.layer
    const clash = replaces(held.kind) && replaces(file.kind)
      ? `"${held.layer}" and "${file.layer}" both write ${file.relPath}`
      : `"${writer}" writes ${file.relPath} and "${other}" also contributes to it`
    throw new Error(
      `${clash}. Stack order is the caller's choice, so which layer survives would depend on the order `
      + 'the flags were typed. Give each language its own path, or contribute with .append or .merge.',
    )
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
 * Keep the last `write` or `compose` for each path so a later layer overrides
 * an earlier one, while `append` and `merge` actions always accumulate: they add
 * to what is already there rather than replacing it.
 * @param files - Planned file actions in layer order.
 * @returns Deduplicated actions preserving first-seen order.
 */
function dedupe(files) {
  const replaces = kind => kind === 'write' || kind === 'compose'
  const lastWrite = new Map()
  for (const file of files) {
    if (replaces(file.kind)) lastWrite.set(file.relPath, file)
  }
  const kept = []
  const seenWrite = new Set()
  for (const file of files) {
    if (!replaces(file.kind)) {
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
 * Work out which `package.json` entries the run would add.
 *
 * The base scripts are always offered; a stack layer adds its own. An entry is
 * added only where the key is absent, so a project's own script or its pinned
 * dependency version is never replaced. A target with no `package.json` gets
 * one only when a selected stack declares a dependency — the base scripts alone
 * do not justify creating a package manifest for a non-Node repository.
 *
 * @param targetDir - Absolute path to the target repository.
 * @param stack - Stack layers this run applies.
 * @param variables - Substitution variables, for the created package name.
 * @returns Contribution with `path`, `exists`, `additions`, and a `create` body when absent.
 */
function packageContribution(targetDir, stack, variables) {
  const scripts = { ...PACKAGE_SCRIPTS }
  const devDependencies = {}
  for (const layer of stack) {
    const contribution = STACK_PACKAGE_CONTRIBUTIONS[layer]
    if (contribution === undefined) continue
    Object.assign(scripts, contribution.scripts)
    Object.assign(devDependencies, contribution.devDependencies)
  }
  const path = resolve(targetDir, 'package.json')
  const exists = existsSync(path) && statSync(path).isFile()

  if (!exists) {
    return {
      path,
      exists: false,
      moduleType: 'module',
      additions: { scripts: {}, devDependencies: {} },
      create: Object.keys(devDependencies).length === 0 ? null : {
        name: variables.SLUG,
        private: true,
        type: 'module',
        scripts,
        devDependencies,
      },
    }
  }

  const pkg = readJson(path)
  const existingScripts = isPlainObject(pkg.scripts) ? pkg.scripts : {}
  const declared = {
    ...(isPlainObject(pkg.dependencies) ? pkg.dependencies : {}),
    ...(isPlainObject(pkg.devDependencies) ? pkg.devDependencies : {}),
    ...(isPlainObject(pkg.peerDependencies) ? pkg.peerDependencies : {}),
    ...(isPlainObject(pkg.optionalDependencies) ? pkg.optionalDependencies : {}),
  }
  return {
    path,
    exists: true,
    // Node reads a `.ts` file as ESM only when the package says so, so the
    // TypeScript layer's ESM orders depend on this value, not only on tsconfig.
    moduleType: isPlainObject(pkg) && typeof pkg.type === 'string' ? pkg.type : null,
    additions: {
      scripts: Object.fromEntries(Object.entries(scripts).filter(([name]) => !Object.hasOwn(existingScripts, name))),
      devDependencies: Object.fromEntries(Object.entries(devDependencies).filter(([name]) => !Object.hasOwn(declared, name))),
    },
    create: null,
  }
}

/**
 * A stable rendering of a JSON value, for comparing two config values.
 *
 * Object keys and array members are sorted. The order of a `lib`, `types`, or
 * `include` list carries no meaning, so comparing their written order would
 * report a conflict where the two sides already agree, and recommend a change
 * that changes nothing.
 *
 * @param value - Any JSON value.
 * @returns A canonical string.
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${[...value].map(canonicalJson).sort().join(',')}]`
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

/**
 * Whether a repository is built by a bundler rather than run by Node.
 *
 * `moduleResolution: "bundler"` is the declaration TypeScript added for this,
 * and it is the whole answer when a project has written it. The remaining
 * signals cover a project whose config does not say it yet: a framework config
 * or dependency means the same thing, and the report is more useful naming the
 * framework than naming a resolution mode.
 *
 * This decides presentation only. The tool has no bundler stack profile, and
 * this does not add one — it stops the recommendations that assume Node from
 * being handed to a project that is not Node.
 *
 * @param targetDir - Absolute path to the target repository.
 * @param actual - The existing `compilerOptions`, or `{}` when there is none.
 * @param packageJson - The parsed `package.json`, or null.
 * @returns True when a bundler builds this project.
 */
function bundlerBuild(targetDir, actual, packageJson) {
  if (typeof actual.moduleResolution === 'string' && actual.moduleResolution.toLowerCase() === 'bundler') return true
  const dependencies = { ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) }
  if (['next', 'vite', 'nuxt', 'astro', '@sveltejs/kit', 'parcel', 'webpack', 'esbuild'].some(name => Object.hasOwn(dependencies, name))) return true
  return ['next.config.js', 'next.config.mjs', 'next.config.ts', 'vite.config.js', 'vite.config.mjs', 'vite.config.ts', 'astro.config.mjs', 'svelte.config.js']
    .some(name => existsSync(resolve(targetDir, name)))
}

/**
 * Compare an existing `tsconfig.json` against the layer's own config.
 *
 * An existing file is never merged or rewritten: it may carry comments that a
 * JSON round-trip would drop, and its values are the project's choices. The
 * report says what the TypeScript standing orders assume but the file does not
 * set, so a caller can ask before changing anything.
 *
 * @param targetDir - Absolute path to the target repository.
 * @param templatesRoot - Absolute path to the package's `templates/` directory.
 * @param stack - Stack layers this run applies.
 * @returns The report, or `null` when the TypeScript layer is not applied.
 */
function typescriptConfigReport(targetDir, templatesRoot, stack) {
  if (!stack.includes('typescript')) return null
  const templatePath = join(templatesRoot, 'typescript', 'tsconfig.json')
  const path = resolve(targetDir, 'tsconfig.json')
  const empty = { path, exists: existsSync(path), error: null, required: [], suggested: [], conflicts: [], bundler: false }
  if (!existsSync(templatePath) || !empty.exists) return empty

  let recommended
  let actual
  let packageJson = null
  try {
    recommended = readJsonc(templatePath).compilerOptions ?? {}
    const file = readJsonc(path)
    actual = isPlainObject(file.compilerOptions) ? file.compilerOptions : {}
    const manifest = resolve(targetDir, 'package.json')
    packageJson = existsSync(manifest) ? readJson(manifest) : null
  } catch (error) {
    return { ...empty, error: error instanceof Error ? error.message : String(error) }
  }

  const required = []
  const suggested = []
  const conflicts = []
  for (const [key, value] of Object.entries(recommended)) {
    const demanded = TYPESCRIPT_REQUIRED.includes(key)
    if (!Object.hasOwn(actual, key)) {
      ;(demanded ? required : suggested).push({ key, value })
      continue
    }
    if (canonicalJson(actual[key]) !== canonicalJson(value)) {
      conflicts.push({ key, found: actual[key], recommended: value, required: demanded })
    }
  }
  return { ...empty, required, suggested, conflicts, bundler: bundlerBuild(targetDir, actual, packageJson) }
}
