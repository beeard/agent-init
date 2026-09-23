/**
 * Require a doc comment on every exported Go declaration.
 *
 * The analysis runs through go/parser and go/ast in `go-docstrings.go`, driven
 * by the target repository's own toolchain, rather than a regular-expression
 * scan over `func` and `type` lines. A hand-rolled scan does not fail loudly:
 * it misreads grouped declarations, type parameters, and comments detached from
 * the declaration they document, and reports findings that are wrong rather
 * than merely incomplete.
 *
 * "Exported" is Go's own rule — an identifier beginning with an uppercase
 * letter — applied to packages, types, constants, variables, functions, and
 * methods. A method on an unexported receiver is reported too, because a
 * constructor can return that type and the method is then callable from outside
 * the package.
 *
 * A `_test.go` file is not analyzed. Go compiles it only into the test binary,
 * so nothing in it is part of the package another package imports.
 *
 * `--staged` checks only the Go files staged for commit, which is how the
 * pre-commit hook uses it. The package-comment rule is answered from the whole
 * directory rather than the staged subset, since a package comment
 * conventionally lives in a `doc.go` that a change rarely touches.
 *
 * The gate needs the Go toolchain on PATH. It states that dependency in its
 * failure message rather than reporting a clean run it did not perform.
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import {
  REPOSITORY_SKIP_DIRECTORIES, collectFiles, corpusSkipPredicate, isMain, readConfig, stagedSources, stagedSubset,
} from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** The analysis program, compiled and run by the target repository's toolchain. */
const ANALYSIS = resolve(import.meta.dirname, 'go-docstrings.go')

/**
 * Find the Go toolchain.
 * @returns The executable name, or null when `go` does not run.
 */
function toolchain() {
  const probe = spawnSync('go', ['version'], { encoding: 'utf8' })
  return probe.status === 0 ? 'go' : null
}

/**
 * Resolve which files to analyze.
 *
 * A staged run is the whole-repository corpus intersected with the staged
 * paths, never the staged paths alone: a file the suite does not judge must not
 * fail a commit. The package-comment question is still answered from the whole
 * directory, because `go-docstrings.go` reads sibling files itself.
 *
 * @param root - Absolute repository root.
 * @param stagedOnly - Whether to restrict the run to staged files.
 * @returns Absolute paths plus the repository-relative path used in messages.
 */
function selectFiles(root, stagedOnly) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const globs = config.goGlobs ?? ['**/*.go']
  const inSkippedRegion = corpusSkipPredicate(root, config, REPOSITORY_SKIP_DIRECTORIES)
  const isSkipped = relPath => relPath.endsWith('_test.go') || inSkippedRegion(relPath)
  const corpus = collectFiles(root, globs, isSkipped)
  const entry = file => ({ abs: file.abs, relPath: file.realPath ?? file.relPath })

  if (!stagedOnly) return corpus.map(entry)

  const staged = stagedSources(root)
  if (staged === null) {
    console.error('verify-go-docstrings: --staged needs a Git worktree; falling back to the whole repository')
    return corpus.map(entry)
  }
  return stagedSubset(corpus, staged).map(entry)
}

/**
 * Analyze the selected files for missing doc comments.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` restricts the run to staged Go files.
 * @returns Findings, the number of files inspected, and any fatal error message.
 */
export function checkDocComments(root, { stagedOnly = false } = {}) {
  const files = selectFiles(root, stagedOnly)
  if (files.length === 0) return { findings: [], checked: 0, fatal: null }

  const go = toolchain()
  if (go === null) {
    return {
      findings: [],
      checked: 0,
      fatal: 'no Go toolchain found (tried "go version"); install Go, or remove this gate from scripts/gates/gates.json',
    }
  }

  // The program is named explicitly, so its `//go:build ignore` tag keeps it
  // out of `go build ./...` while `go run` still compiles it.
  const result = spawnSync(go, ['run', ANALYSIS, '--', ...files.map(file => file.abs)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    const detail = `${result.stderr ?? ''}`.trim() || `go run exited with status ${String(result.status)}`
    return { findings: [], checked: files.length, fatal: `analysis failed: ${detail}` }
  }

  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    return { findings: [], checked: files.length, fatal: `analysis produced invalid JSON: ${error.message}` }
  }

  const byAbsolute = new Map(files.map(file => [file.abs, file.relPath]))
  const findings = parsed.map(finding => ({
    relPath: byAbsolute.get(finding.file) ?? finding.file,
    line: finding.line,
    kind: finding.kind,
    name: finding.name,
    detail: finding.detail,
  }))
  return { findings, checked: files.length, fatal: null }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { findings, checked, fatal } = checkDocComments(ROOT, { stagedOnly: process.argv.includes('--staged') })
  if (fatal !== null) {
    console.error(`verify-go-docstrings: ${fatal}`)
    return 1
  }
  if (findings.length === 0) {
    console.log(`verify-go-docstrings: ${checked} file(s) checked, every exported declaration is documented.`)
    return 0
  }
  console.error(`verify-go-docstrings: ${findings.length} undocumented exported declaration(s) in ${checked} file(s):`)
  for (const finding of findings) {
    console.error(`  ${finding.relPath}:${finding.line}  ${finding.kind} ${finding.name} — ${finding.detail}`)
  }
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
