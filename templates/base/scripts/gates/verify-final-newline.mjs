/**
 * Require every text file to end with exactly one newline.
 *
 * A file without a trailing newline makes the next appended line join the last
 * one, and diff tools report the change as modifying that line rather than
 * adding one. A file with two shows up as a trailing blank line in every diff
 * that follows it.
 *
 * The check is byte-level and does not parse anything, so it applies to every
 * text format the repository holds rather than to one language.
 *
 * `--staged` checks the staged files, which is how the pre-commit hook uses it.
 * It judges only files the whole-repository run would judge as well, so the
 * hook stays a subset of the suite rather than a stricter one.
 */

import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { collectFiles, isMain, readConfig } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** Extensions checked when the configuration names none. */
const DEFAULT_GLOBS = [
  '**/*.md', '**/*.mjs', '**/*.js', '**/*.ts', '**/*.tsx',
  '**/*.json', '**/*.yml', '**/*.yaml', '**/*.toml',
  '**/*.py', '**/*.go', '**/*.rs', '**/*.sh',
]

/** Directories never walked when the configuration names none. */
const DEFAULT_SKIP_DIRECTORIES = [
  'node_modules', 'dist', 'build', 'target', 'vendor', 'coverage', '.git',
]

/**
 * List the files staged for commit.
 * @param root - Absolute repository root.
 * @returns Staged paths, or null when Git cannot answer.
 */
function stagedSources(root) {
  const result = spawnSync('git', [
    '-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z', '--',
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) return null
  return result.stdout.toString('utf8').split('\0').filter(Boolean)
}

/**
 * Resolve which files to check.
 * @param root - Absolute repository root.
 * @param stagedOnly - Whether to restrict the run to staged files.
 * @returns Absolute paths plus the repository-relative path used in messages.
 */
function selectFiles(root, stagedOnly) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const globs = config.finalNewlineGlobs ?? DEFAULT_GLOBS
  const excluded = new Set(config.finalNewlineSkipDirectories ?? DEFAULT_SKIP_DIRECTORIES)
  const isSkipped = relPath => relPath.split('/').some(segment => excluded.has(segment))
  const corpus = collectFiles(root, globs, isSkipped)
  const entry = file => ({ abs: file.abs, relPath: file.realPath ?? file.relPath })

  if (!stagedOnly) return corpus.map(entry)

  const staged = stagedSources(root)
  if (staged === null) {
    console.error('verify-final-newline: --staged needs a Git worktree; falling back to the whole repository')
    return corpus.map(entry)
  }
  // The staged run is the repository run restricted to the staged subset, never
  // a wider one. Both take their corpus from the same globs, so the hook cannot
  // fail a commit over a file this rule was never written for — a binary, an
  // extensionless build file — and demand a fix that does not exist: no edit
  // adds a trailing newline to a PNG.
  const byPath = new Map()
  for (const file of corpus) {
    const found = entry(file)
    byPath.set(file.relPath, found)
    byPath.set(found.relPath, found)
  }
  return staged.flatMap(relPath => {
    const file = byPath.get(relPath)
    return file === undefined ? [] : [file]
  })
}

/**
 * Check one file's ending.
 * @param file - Absolute path plus the repository-relative path used in messages.
 * @returns A violation, or null when the ending is correct.
 */
function checkFile(file) {
  let text
  try {
    text = readFileSync(file.abs, 'utf8')
  } catch {
    // An unreadable file is not this gate's subject; another gate reports it.
    return null
  }
  if (text === '') return null
  if (!text.endsWith('\n')) {
    return { relPath: file.relPath, reason: 'no trailing newline' }
  }
  if (text.endsWith('\n\n')) {
    return { relPath: file.relPath, reason: 'more than one trailing newline' }
  }
  return null
}

/**
 * Check every selected file's ending.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` restricts the run to staged files.
 * @returns Violations plus the number of files inspected.
 */
export function checkFinalNewline(root, { stagedOnly = false } = {}) {
  const files = selectFiles(root, stagedOnly)
  const violations = []
  for (const file of files) {
    // A symlink is checked as its target; a broken one has nothing to read.
    try {
      if (statSync(file.abs).isDirectory()) continue
    } catch {
      continue
    }
    const violation = checkFile(file)
    if (violation !== null) violations.push(violation)
  }
  return { violations, checked: files.length }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { violations, checked } = checkFinalNewline(ROOT, { stagedOnly: process.argv.includes('--staged') })
  if (violations.length === 0) {
    console.log(`verify-final-newline: ${checked} file(s) checked, every file ends with exactly one newline.`)
    return 0
  }
  console.error(`verify-final-newline: ${violations.length} file(s) with a wrong ending:`)
  for (const violation of violations) console.error(`  ${violation.relPath}  ${violation.reason}`)
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
