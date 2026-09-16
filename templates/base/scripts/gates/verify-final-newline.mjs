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
 * The corpus is the built-in text globs plus every glob the configuration
 * declares, and a declaration can only widen it. The rule is about every file
 * the repository owns, so the gate reads the file lists the repository already
 * keeps — `.agents/` is covered because `markdownGlobs` names it — rather than
 * keeping a list of its own, which would be a second thing to hold in step and
 * would go stale the moment a layer added a file type. Unioning rather than
 * replacing is what stops an empty or careless declaration from narrowing the
 * rule down to nothing and still reporting a clean run.
 *
 * Exclusion is shared on the same terms: `skipGlobs`, which is where the frozen
 * archive is named for every gate at once, and the `*SkipDirectories` each
 * layer declares for its build and dependency output.
 *
 * `--staged` checks the staged files, which is how the pre-commit hook uses it.
 * It judges only files the whole-repository run would judge as well, so the
 * hook stays a subset of the suite rather than a stricter one.
 */

import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { collectFiles, isMain, readConfig, skipPredicate } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** Text formats checked in every repository, whatever the configuration declares. */
const DEFAULT_GLOBS = [
  '**/*.md', '**/*.mjs', '**/*.js', '**/*.ts', '**/*.tsx',
  '**/*.json', '**/*.yml', '**/*.yaml', '**/*.toml',
  '**/*.py', '**/*.go', '**/*.rs', '**/*.sh',
]

/** Build and dependency directories skipped even when no layer names them. */
const DEFAULT_SKIP_DIRECTORIES = [
  'node_modules', 'dist', 'build', 'target', 'vendor', 'coverage', '.git',
]

/**
 * Every glob the configuration declares, under any `*Globs` key but the skips.
 * @param config - The parsed gate configuration.
 * @returns Glob patterns, in declaration order.
 */
function declaredGlobs(config) {
  return Object.entries(config)
    .filter(([key, value]) => key !== 'skipGlobs' && key.endsWith('Globs') && Array.isArray(value))
    .flatMap(([, globs]) => globs)
}

/**
 * Every directory the configuration skips, under any `*SkipDirectories` key.
 * @param config - The parsed gate configuration.
 * @returns Directory names that exclude the files beneath them.
 */
function declaredSkipDirectories(config) {
  return Object.entries(config)
    .filter(([key, value]) => key.endsWith('SkipDirectories') && Array.isArray(value))
    .flatMap(([, directories]) => directories)
}

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
  const excluded = new Set([...DEFAULT_SKIP_DIRECTORIES, ...declaredSkipDirectories(config)])
  const inSharedSkip = skipPredicate(root, config.skipGlobs ?? [])
  // Only directory components exclude a file. A name in this set is a directory
  // holding generated output; a file that happens to share the name is not it.
  const isSkipped = relPath =>
    inSharedSkip(relPath) || relPath.split('/').slice(0, -1).some(segment => excluded.has(segment))
  const corpus = collectFiles(root, [...DEFAULT_GLOBS, ...declaredGlobs(config)], isSkipped)
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
