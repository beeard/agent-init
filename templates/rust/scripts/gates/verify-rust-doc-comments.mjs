/**
 * Require documentation on every public Rust item.
 *
 * Rust already has this check: `missing_docs` is a built-in rustc lint, so the
 * analysis is the compiler's rather than a reimplementation of it. A
 * regular-expression scan over `pub fn` lines would misread generics, trait
 * implementations, and macro-generated items, and would report findings that
 * are wrong rather than merely incomplete.
 *
 * The lint fires only for a crate that enables it, so this gate verifies the
 * attribute is present and fails loud when it is not. A gate that reports a
 * clean run because its own check was silently disabled is worse than no gate.
 *
 * Diagnostics come from `cargo check --message-format=json`, filtered to the
 * `missing_docs` code. `missing_docs` is a rustc lint rather than a Clippy one,
 * so `cargo check` suffices and no Clippy install is required.
 *
 * `--staged` filters the diagnostics to the staged paths. Cargo has no
 * lint-one-file mode — a lint runs per crate, and a crate cannot be checked
 * without compiling what it depends on — so the compile is repository-wide even
 * when the report is not. That limitation is deliberate and stated here rather
 * than hidden behind a flag that appears to narrow the work.
 */

import { existsSync, readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { isMain, readConfig } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** The lint whose diagnostics this gate reports. */
const LINT = 'missing_docs'

/** Attributes that enable the lint, as they appear in a crate root. */
const ENABLING_ATTRIBUTE = /#!\[(?:warn|deny|forbid)\(\s*(?:clippy::)?missing_docs\s*\)\]/u

/**
 * Find the cargo toolchain.
 * @returns The executable name, or null when `cargo` does not run.
 */
function toolchain() {
  const probe = spawnSync('cargo', ['--version'], { encoding: 'utf8' })
  return probe.status === 0 ? 'cargo' : null
}

/**
 * List a crate's root source files through cargo's own metadata.
 *
 * Reading `Cargo.toml` by hand would have to model workspace inheritance and
 * the default target paths; cargo already resolves both.
 *
 * @param root - Absolute repository root.
 * @returns Crate root paths, or an error message describing why they are unavailable.
 */
function crateRoots(root) {
  const result = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}`.trim() || `cargo metadata exited with status ${String(result.status)}`
    return { paths: [], error: detail }
  }
  let metadata
  try {
    metadata = JSON.parse(result.stdout)
  } catch (error) {
    return { paths: [], error: `cargo metadata produced invalid JSON: ${error.message}` }
  }
  const paths = []
  for (const package_ of metadata.packages ?? []) {
    for (const target of package_.targets ?? []) {
      // Declarations are reported against the library or binary root; test and
      // example targets reuse the same items and would double-report them.
      if (target.kind?.includes('lib') || target.kind?.includes('bin')) {
        if (typeof target.src_path === 'string') paths.push(target.src_path)
      }
    }
  }
  return { paths: [...new Set(paths)], error: null }
}

/**
 * Whether a crate root enables the lint.
 * @param path - Absolute path to a crate root source file.
 * @returns True when the file carries an enabling attribute.
 */
function enablesLint(path) {
  if (!existsSync(path)) return false
  try {
    return ENABLING_ATTRIBUTE.test(readFileSync(path, 'utf8'))
  } catch {
    return false
  }
}

/**
 * List the Rust files staged for commit.
 * @param root - Absolute repository root.
 * @returns Staged paths, or null when Git cannot answer.
 */
function stagedSources(root) {
  const result = spawnSync('git', [
    '-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z', '--',
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) return null
  return result.stdout.toString('utf8').split('\0').filter(path => path.endsWith('.rs'))
}

/**
 * Turn one cargo diagnostic into a finding.
 * @param root - Absolute repository root.
 * @param diagnostic - A `compiler-message` cargo message.
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
 * Analyze the crate for undocumented public items.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` filters the report to staged Rust files.
 * @returns Findings, the number of files inspected, and any fatal error message.
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

  const { paths: roots, error } = crateRoots(root)
  if (error !== null) {
    return { findings: [], checked: roots.length, fatal: `cannot resolve crate roots: ${error}` }
  }
  if (roots.length === 0) {
    return { findings: [], checked: 0, fatal: 'no library or binary target found to check' }
  }

  // Without the attribute the lint produces nothing, and an empty report would
  // read as a pass. That is the silent-skip failure this gate exists to avoid.
  const undocumented = roots.filter(path => !enablesLint(path))
  if (undocumented.length > 0) {
    const list = undocumented.map(path => (path.startsWith(root) ? path.slice(root.length + 1) : path)).join(', ')
    return {
      findings: [],
      checked: roots.length,
      fatal: `the ${LINT} lint is not enabled in: ${list}`
        + `\n  Add #![warn(${LINT})] to each crate root, so the compiler enforces this rather than this gate guessing.`,
    }
  }

  const result = spawnSync(cargo, ['check', '--message-format=json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  })
  // A crate that does not compile produces diagnostics for the compile errors
  // instead; reporting those as documentation findings would name the wrong
  // problem, so the failure is surfaced as-is.
  if (result.status !== 0 && `${result.stdout ?? ''}`.trim() === '') {
    const detail = `${result.stderr ?? ''}`.trim() || `cargo check exited with status ${String(result.status)}`
    return { findings: [], checked: roots.length, fatal: `cargo check failed: ${detail}` }
  }

  const findings = []
  const seen = new Set()
  for (const line of `${result.stdout ?? ''}`.split('\n')) {
    if (line.trim() === '') continue
    let message
    try {
      message = JSON.parse(line)
    } catch {
      continue
    }
    if (message.reason !== 'compiler-message') continue
    if (message.message?.code?.code !== LINT) continue
    const finding = toFinding(root, message.message)
    if (finding === null) continue
    const key = `${finding.relPath}:${finding.line}:${finding.kind}`
    if (seen.has(key)) continue
    seen.add(key)
    findings.push(finding)
  }

  let selected = findings
  if (stagedOnly) {
    const staged = stagedSources(root)
    if (staged === null) {
      console.error('verify-rust-doc-comments: --staged needs a Git worktree; reporting the whole crate')
    } else {
      const wanted = new Set(staged)
      selected = findings.filter(finding => wanted.has(finding.relPath))
    }
  }

  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const excluded = new Set(config.rustSkipDirectories ?? [])
  const kept = selected.filter(finding => !finding.relPath.split('/').some(segment => excluded.has(segment)))
  return { findings: kept, checked: roots.length, fatal: null }
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
    console.log(`verify-rust-doc-comments: ${checked} crate root(s) checked, every public item is documented.`)
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
