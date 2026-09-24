/**
 * Require documentation on every public Rust item.
 *
 * Rust already has this check: `missing_docs` is a built-in rustc lint, so the
 * analysis is the compiler's rather than a reimplementation of it. A
 * regular-expression scan over `pub fn` lines would misread generics, trait
 * implementations, and macro-generated items, and would report findings that
 * are wrong rather than merely incomplete.
 *
 * The gate hands the lint to the compiler itself: `-W missing_docs` on every
 * library and binary target of every workspace member, through
 * `cargo rustc --profile check`. The check therefore runs whether or not a crate
 * enables the lint, so no crate passes by never having opted in. The flag
 * reaches only the target being judged; dependencies, `RUSTFLAGS`, and
 * `build.rustflags` are untouched. A crate that writes `allow(missing_docs)` in
 * its own source has made a visible decision, and the compiler honors it.
 *
 * A crate that does not compile fails the gate with the compiler's errors,
 * because its lint output is incomplete and an empty report would read as a
 * pass. A `missing_docs` error from a crate that denies the lint is a finding,
 * not a compile failure.
 *
 * `--staged` filters the diagnostics to the staged paths. Cargo has no
 * lint-one-file mode — a lint runs per crate, and a crate cannot be checked
 * without compiling what it depends on — so the compile is repository-wide even
 * when the report is not. That limitation is deliberate and stated here rather
 * than hidden behind a flag that appears to narrow the work.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { isMain, readConfig, stagedSources } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** The lint whose diagnostics this gate reports. */
const LINT = 'missing_docs'

/** Target kinds cargo selects with `--lib`. */
const LIBRARY_KINDS = new Set(['lib', 'rlib', 'dylib', 'cdylib', 'staticlib', 'proc-macro'])

/** Compile errors quoted in a failure message before the rest are counted. */
const QUOTED_ERRORS = 5

/**
 * Find the cargo toolchain.
 * @returns The executable name, or null when `cargo` does not run.
 */
function toolchain() {
  const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
  return probe.status === 0 ? 'cargo' : null
}

/**
 * Describe why a spawned command did not complete successfully.
 * @param command - The command, as named in the message.
 * @param result - The `spawnSync` result.
 * @returns The failure message, or null when the command exited with status 0.
 */
function spawnFailure(command, result) {
  if (result.error !== undefined) return `${command} could not run: ${result.error.message}`
  if (result.signal !== null) return `${command} was killed by ${result.signal}`
  if (result.status !== 0) {
    return `${result.stderr ?? ''}`.trim() || `${command} exited with status ${String(result.status)}`
  }
  return null
}

/**
 * List the library and binary targets of every workspace member through cargo's
 * own metadata.
 *
 * Reading `Cargo.toml` by hand would have to model workspace membership,
 * inheritance, and the default target paths; cargo already resolves all three.
 *
 * @param root - Absolute repository root.
 * @returns Targets as `{ package, selector }`, or an error message describing why they are unavailable.
 */
function workspaceTargets(root) {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  const failure = spawnFailure('cargo metadata', result)
  if (failure !== null) return { targets: [], error: failure }
  let metadata
  try {
    metadata = JSON.parse(result.stdout)
  } catch (error) {
    return { targets: [], error: `cargo metadata produced invalid JSON: ${error.message}` }
  }
  const members = new Set(metadata.workspace_members ?? [])
  const targets = []
  for (const package_ of metadata.packages ?? []) {
    if (!members.has(package_.id)) continue
    for (const target of package_.targets ?? []) {
      // Declarations are reported against the library or binary root; test and
      // example targets reuse the same items and would double-report them.
      const kinds = target.kind ?? []
      if (kinds.some(kind => LIBRARY_KINDS.has(kind))) {
        targets.push({ package: package_.name, selector: ['--lib'] })
      } else if (kinds.includes('bin')) {
        targets.push({ package: package_.name, selector: ['--bin', target.name] })
      }
    }
  }
  return { targets, error: null }
}

/**
 * Turn one cargo diagnostic into a finding.
 * @param root - Absolute repository root.
 * @param diagnostic - The `message` of a `compiler-message` cargo message.
 * @returns The finding, or null when it carries no usable location.
 */
function toFinding(root, diagnostic) {
  const spans = diagnostic.spans ?? []
  const span = spans.find(candidate => candidate.is_primary) ?? spans[0]
  if (span === undefined) return null
  const relPath = span.file_name.startsWith(root) ? span.file_name.slice(root.length + 1) : span.file_name
  // Rust states the item kind in the message and points the primary span at the
  // declaration. It does not report the item name, and recovering one would
  // mean re-parsing the source line -- so the declaration text is reported
  // instead, which locates the item without guessing at its name.
  const kind = /missing documentation for (?:an? )?(.+)$/u.exec(diagnostic.message ?? '')?.[1] ?? 'item'
  const declaration = span.text?.[0]?.text?.trim() ?? `<${kind}>`
  return { relPath, line: span.line_start, kind, name: declaration, detail: 'no doc comment' }
}

/**
 * Whether a diagnostic is a compile error rather than a documentation finding.
 * @param diagnostic - The `message` of a `compiler-message` cargo message.
 * @returns True for an error-level diagnostic other than the lint and rustc's closing summary.
 */
function isCompileError(diagnostic) {
  if (diagnostic.level !== 'error' && diagnostic.level !== 'error: internal compiler error') return false
  if (diagnostic.code?.code === LINT) return false
  return !/^aborting due to /u.test(diagnostic.message ?? '')
}

/**
 * Check one target with the lint enabled on the command line.
 * @param root - Absolute repository root.
 * @param cargo - The cargo executable.
 * @param target - A target from `workspaceTargets`.
 * @returns The lint diagnostics, the compile errors, and a failure message when cargo itself failed.
 */
function checkTarget(root, cargo, target) {
  const args = ['rustc', '--package', target.package, ...target.selector, '--profile', 'check', '--message-format=json', '--', '-W', LINT]
  const result = spawnSync(cargo, args, { cwd: root, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024 })
  const lints = []
  const errors = []
  for (const line of `${result.stdout ?? ''}`.split('\n')) {
    if (line.trim() === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.reason !== 'compiler-message' || message.message === undefined) continue
    if (message.message.code?.code === LINT) lints.push(message.message)
    else if (isCompileError(message.message)) errors.push(message.message)
  }
  return { lints, errors, failure: spawnFailure(`cargo ${args.slice(0, 5).join(' ')}`, result) }
}

/**
 * Analyze every workspace member for undocumented public items.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` filters the report to staged Rust files.
 * @returns Findings, the number of targets checked, and any fatal error message.
 */
export function checkDocComments(root, { stagedOnly = false } = {}) {
  if (!existsSync(resolve(root, 'Cargo.toml'))) {
    return { findings: [], checked: 0, fatal: 'no Cargo.toml found at the repository root' }
  }

  const cargo = toolchain()
  if (cargo === null) {
    return {
      findings: [],
      checked: 0,
      fatal: 'no Rust toolchain found (tried "cargo --version"); install Rust, or remove this gate from scripts/gates/gates.json',
    }
  }

  const { targets, error } = workspaceTargets(root)
  if (error !== null) {
    return { findings: [], checked: 0, fatal: `cannot resolve the workspace targets: ${error}` }
  }
  if (targets.length === 0) {
    return { findings: [], checked: 0, fatal: 'no library or binary target found to check' }
  }

  const findings = []
  const seen = new Set()
  for (const target of targets) {
    const { lints, errors, failure } = checkTarget(root, cargo, target)
    // A crate that does not compile has not been fully linted, so its findings
    // would be a partial report presented as a whole one.
    if (errors.length > 0) {
      const quoted = errors.slice(0, QUOTED_ERRORS).map(diagnostic => `${diagnostic.rendered ?? diagnostic.message}`.trimEnd())
      const more = errors.length > QUOTED_ERRORS ? `\n  ...and ${errors.length - QUOTED_ERRORS} more` : ''
      return {
        findings: [],
        checked: targets.length,
        fatal: `${target.package} does not compile, so its documentation cannot be checked:\n${quoted.join('\n')}${more}`,
      }
    }
    // A denied lint fails the compile with nothing but findings; any other
    // failure is one this gate cannot interpret, so it is surfaced as-is.
    if (failure !== null && lints.length === 0) {
      return { findings: [], checked: targets.length, fatal: `cargo failed on ${target.package}: ${failure}` }
    }
    for (const diagnostic of lints) {
      const finding = toFinding(root, diagnostic)
      if (finding === null) continue
      const key = `${finding.relPath}:${finding.line}:${finding.kind}`
      if (seen.has(key)) continue
      seen.add(key)
      findings.push(finding)
    }
  }

  let selected = findings
  if (stagedOnly) {
    const staged = stagedSources(root)
    if (staged === null) {
      console.error('verify-rust-doc-comments: --staged needs a Git worktree; reporting the whole workspace')
    } else {
      const wanted = new Set(staged.filter(path => path.endsWith('.rs')))
      selected = findings.filter(finding => wanted.has(finding.relPath))
    }
  }

  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const excluded = new Set(config.rustSkipDirectories ?? [])
  const kept = selected.filter(finding => !finding.relPath.split('/').some(segment => excluded.has(segment)))
  return { findings: kept, checked: targets.length, fatal: null }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { findings, checked, fatal } = checkDocComments(ROOT, { stagedOnly: process.argv.includes('--staged') })
  if (fatal !== null) {
    console.error(`verify-rust-doc-comments: ${fatal}`)
    return 1
  }
  if (findings.length === 0) {
    console.log(`verify-rust-doc-comments: ${checked} target(s) checked, every public item is documented.`)
    return 0
  }
  console.error(`verify-rust-doc-comments: ${findings.length} undocumented public item(s):`)
  for (const finding of findings) {
    console.error(`  ${finding.relPath}:${finding.line}  ${finding.kind} ${finding.name} — ${finding.detail}`)
  }
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
