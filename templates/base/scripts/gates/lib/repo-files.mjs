/**
 * Repository file discovery shared by the documentation gates.
 *
 * The walker is repository-owned rather than built on an experimental runtime
 * glob, so the same tree enumerates identically on every supported Node
 * version. It supports `*`, `?`, and `**`, and rejects every other glob form
 * loudly: silently expanding a form it does not model would quietly shrink a
 * gate's corpus, which is worse than failing.
 */

import { readFileSync, readdirSync, realpathSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Build and dependency directories every gate skips, named or not. */
export const REPOSITORY_SKIP_DIRECTORIES = [
  'node_modules', 'dist', 'build', 'target', 'vendor', 'coverage', '.git',
]

/**
 * Whether a gate module is the process entry point rather than an import.
 * @param importMetaUrl - The module's `import.meta.url`.
 * @returns True when the module was launched directly.
 */
export function isMain(importMetaUrl) {
  const entry = process.argv[1]
  return entry !== undefined && resolve(entry) === fileURLToPath(importMetaUrl)
}

/** Glob syntax this walker does not model, rejected instead of misread. */
const UNSUPPORTED_GLOB = /[[\]{}()!+@\\]/u

/**
 * Whether one pattern segment matches one entry name.
 * @param pattern - A single path segment, possibly containing `*` or `?`.
 * @param name - The entry name to test.
 * @returns True on a match. A leading wildcard never matches a dot name.
 */
function segmentMatches(pattern, name) {
  if (name.startsWith('.') && (pattern.startsWith('*') || pattern.startsWith('?'))) return false
  let expression = ''
  for (const character of pattern) {
    if (character === '*') expression += '.*'
    else if (character === '?') expression += '.'
    else expression += character.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  }
  return new RegExp(`^${expression}$`, 'u').test(name)
}

/**
 * Validate and split a glob pattern into segments.
 * @param pattern - A repository-relative glob.
 * @returns Pattern segments, with `.` segments folded away.
 */
function splitPattern(pattern) {
  const segments = pattern.split('/').filter(segment => segment !== '.')
  if (segments.length === 0) throw new TypeError(`glob pattern has no segments: ${pattern}`)
  for (const segment of segments) {
    if (segment === '') throw new TypeError(`glob pattern has an empty segment: ${pattern}`)
    if (segment === '..') throw new TypeError(`glob pattern escapes the repository root: ${pattern}`)
    if (segment !== '**' && UNSUPPORTED_GLOB.test(segment)) {
      throw new TypeError(`unsupported glob syntax in segment "${segment}" of: ${pattern}`)
    }
  }
  return segments
}

/**
 * Collect every file below a directory, skipping dot entries.
 * @param dirAbs - Absolute directory path.
 * @param dirRel - Repository-relative form of `dirAbs`, prefixed with `./`.
 * @param out - Sink for repository-relative slash paths.
 */
function collectAll(dirAbs, dirRel, out) {
  for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const childAbs = join(dirAbs, entry.name)
    const childRel = `${dirRel}/${entry.name}`
    if (entry.isDirectory()) collectAll(childAbs, childRel, out)
    else if (entry.isFile() || entry.isSymbolicLink()) out.push(childRel.slice(2))
  }
}

/**
 * Expand one repository-relative glob to repository-relative slash paths.
 * @param root - Absolute repository root.
 * @param pattern - A repository-relative glob.
 * @returns Matching paths, sorted.
 */
export function expandGlob(root, pattern) {
  const segments = splitPattern(pattern)
  const out = []

  const visit = (dirAbs, dirRel, index) => {
    if (index >= segments.length) return
    const segment = segments[index]
    const last = index === segments.length - 1
    if (segment === '**') {
      // A trailing `**` selects every file below, at any depth.
      if (last) {
        collectAll(dirAbs, dirRel, out)
        return
      }
      // Otherwise it consumes zero directories, then one per recursion.
      // Symlinked directories are never entered, so the traversal terminates.
      visit(dirAbs, dirRel, index + 1)
      for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
        if (entry.name.startsWith('.') || !entry.isDirectory()) continue
        visit(join(dirAbs, entry.name), `${dirRel}/${entry.name}`, index)
      }
      return
    }
    for (const entry of readdirSync(dirAbs, { withFileTypes: true })) {
      if (!segmentMatches(segment, entry.name)) continue
      const childAbs = join(dirAbs, entry.name)
      const childRel = `${dirRel}/${entry.name}`
      if (last) {
        if (entry.isFile() || entry.isSymbolicLink()) out.push(childRel.slice(2))
        continue
      }
      if (entry.isDirectory()) visit(childAbs, childRel, index + 1)
    }
  }

  visit(root, '.', 0)
  return out.sort()
}

/**
 * Expand several globs and deduplicate symlinked targets.
 *
 * The physical file is the unit of checking: `real` is the canonical path, and
 * a document reached through a symlink is inspected once, as the file it is.
 * `relPath` is the path the glob matched, which is what a reader browsing the
 * repository sees; `realPath` is where the content lives, and is the correct
 * base for resolving that document's own relative links.
 *
 * @param root - Absolute repository root.
 * @param patterns - Repository-relative globs, processed in order.
 * @param isSkipped - Optional predicate over each matched repository-relative path.
 * @returns Matched files with both their matched and canonical relative paths.
 */
export function collectFiles(root, patterns, isSkipped = () => false) {
  const seen = new Set()
  const files = []
  for (const pattern of patterns) {
    for (const relPath of expandGlob(root, pattern)) {
      if (isSkipped(relPath)) continue
      const abs = resolve(root, relPath)
      const real = realpathSync(abs)
      if (seen.has(real)) continue
      seen.add(real)
      files.push({ abs, relPath, real, realPath: toRepoPath(root, real) ?? relPath })
    }
  }
  return files
}

/**
 * Express an absolute path relative to the repository, when it is inside it.
 * @param root - Absolute repository root.
 * @param abs - Absolute path to convert.
 * @returns The slash-separated relative path, or null when it escapes the root.
 */
function toRepoPath(root, abs) {
  const rel = relative(root, abs)
  if (rel === '' || rel.startsWith('..')) return null
  return rel.split(sep).join('/')
}

/**
 * Read the gate configuration.
 * @param path - Absolute path to `config.json`.
 * @returns The parsed configuration.
 */
export function readConfig(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Build a skip predicate from the configured skip globs.
 * @param root - Absolute repository root.
 * @param skipGlobs - Repository-relative globs to exclude.
 * @returns A predicate over repository-relative paths.
 */
export function skipPredicate(root, skipGlobs) {
  const skipped = new Set()
  for (const pattern of skipGlobs) {
    for (const relPath of expandGlob(root, pattern)) skipped.add(relPath)
  }
  return relPath => skipped.has(relPath)
}

/**
 * Whether a repository-relative path is inside the frozen archive.
 * @param notesRoot - Repository-relative notes directory.
 * @param relPath - Repository-relative path.
 * @returns True when the path is archived history.
 */
export function isArchived(notesRoot, relPath) {
  return relPath.startsWith(`${notesRoot}/archived/`)
}

/**
 * Every glob the configuration declares, under any `*Globs` key but the skips.
 * @param config - The parsed gate configuration.
 * @returns Glob patterns, in declaration order.
 */
export function declaredGlobs(config) {
  return Object.entries(config)
    .filter(([key, value]) => key !== 'skipGlobs' && key.endsWith('Globs') && Array.isArray(value))
    .flatMap(([, globs]) => globs)
}

/**
 * Every directory the configuration skips, under any `*SkipDirectories` key.
 * @param config - The parsed gate configuration.
 * @returns Directory names that exclude the files beneath them.
 */
export function declaredSkipDirectories(config) {
  return Object.entries(config)
    .filter(([key, value]) => key.endsWith('SkipDirectories') && Array.isArray(value))
    .flatMap(([, directories]) => directories)
}

/**
 * Build the predicate that decides whether a path is outside a gate's corpus.
 *
 * A gate shares one answer to this question rather than keeping its own, so two
 * gates cannot disagree about what a directory name means. The shared
 * `skipGlobs` is where a repository names frozen or generated regions once for
 * every gate at once, and the `*SkipDirectories` keys are where each layer names
 * the build and dependency output it does not own.
 *
 * A name excludes a file only where it is a directory component of that file's
 * path: a file that happens to be called `build` is not a build directory.
 *
 * @param root - Absolute repository root.
 * @param config - The parsed gate configuration.
 * @param defaultDirectories - Directory names skipped even when nothing names them.
 * @returns A predicate over repository-relative paths.
 */
export function corpusSkipPredicate(root, config, defaultDirectories = []) {
  const excluded = new Set([...defaultDirectories, ...declaredSkipDirectories(config)])
  const inSharedSkip = skipPredicate(root, config.skipGlobs ?? [])
  return relPath =>
    inSharedSkip(relPath) || relPath.split('/').slice(0, -1).some(segment => excluded.has(segment))
}

/**
 * List the files staged for commit.
 * @param root - Absolute repository root.
 * @returns Staged paths, or null when Git cannot answer.
 */
export function stagedSources(root) {
  const result = spawnSync('git', [
    '-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z', '--',
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) return null
  return result.stdout.toString('utf8').split('\0').filter(Boolean)
}

/**
 * Restrict a repository corpus to the files staged for commit.
 *
 * The result is a subset of the corpus, never a wider set. A staged run that
 * reached past what the repository run covers would fail a commit over a file
 * the rule was never written for, and a rule a file cannot satisfy has no
 * remedy but to skip the gate entirely, which costs it every future run.
 *
 * @param corpus - The corpus the whole-repository run would judge.
 * @param staged - Repository-relative staged paths.
 * @returns The corpus entries whose path is staged.
 */
export function stagedSubset(corpus, staged) {
  const byPath = new Map()
  for (const file of corpus) {
    byPath.set(file.relPath, file)
    byPath.set(file.realPath ?? file.relPath, file)
  }
  return staged.flatMap((relPath) => {
    const file = byPath.get(relPath)
    return file === undefined ? [] : [file]
  })
}
