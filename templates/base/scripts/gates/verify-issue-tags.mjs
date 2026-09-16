/**
 * List the known-issue markers a repository carries, by urgency.
 *
 * `FIXME` blocks a release, `TODO` is soon, and `XXX` is someday, so the tag is
 * what lets a reader sort an unplanned backlog at a glance. That only holds if
 * the scan finds every marker and if each one says what it is waiting for — a
 * bare `TODO` tells a reader the problem was noticed and nothing else, which is
 * the one thing the tag was supposed to fix.
 *
 * The scan is what the tags are for. It lists every marker with its location so
 * a reader can see the whole backlog without grepping, and it fails only on the
 * case that makes the list useless.
 *
 * A marker is recognised by its position, not by the word alone: the tag opens
 * a comment, and a reason follows it. Any word-based rule reports the places
 * that *name* the vocabulary — this file's own source among them — as findings,
 * and a scan that reports its own rule is worth less than no scan. The form is
 * therefore the comment opener, the tag, and the reason, as in a line comment
 * reading `TODO(owner): reason`; the standing orders state it.
 *
 * The scan is line-based and parses nothing, and it states both consequences
 * rather than pretending they are not there. A tag that is not the first thing
 * a comment says — a note appended after a line of prose — goes unreported,
 * because the rule reads position. And a string that reads like a comment is
 * reported as one, because telling a string from a comment takes a parser per
 * language: a test fixture containing a bare tag is a finding, and giving it a
 * reason is the fix.
 *
 * `--staged` checks the staged files, which is how the pre-commit hook uses it.
 * It judges only files the whole-repository run would judge as well.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  REPOSITORY_SKIP_DIRECTORIES, collectFiles, corpusSkipPredicate,
  isMain, readConfig, stagedSources, stagedSubset,
} from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/**
 * Code formats scanned for markers: one per language the package profiles, plus
 * the JavaScript family and shell. A repository working in a language this list
 * does not name adds its extension here; it owns this file.
 */
const CODE_GLOBS = [
  '**/*.mjs', '**/*.js', '**/*.cjs', '**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts',
  '**/*.py', '**/*.go', '**/*.rs', '**/*.sh',
]

/** Urgency order, most urgent first, which is the order the report uses. */
const URGENCY = ['FIXME', 'TODO', 'XXX']

/**
 * A comment opener, then a marker, its optional owner, and the reason.
 *
 * The opener is part of the match rather than a check beside it, so the tag has
 * to be the first thing the comment says. That is what a reader scans for, and
 * it is what keeps a sentence about the vocabulary from reading as a marker.
 * `*` covers the continuation lines of a block comment.
 */
const MARKER = /(?:\/\/|#|\/\*|<!--|\*)[ \t]*(FIXME|TODO|XXX)\b(?:[ \t]*\(([^)]*)\))?[ \t]*:?[ \t]*(.*)$/u

/** Punctuation that separates a marker from its reason, and carries none itself. */
const SEPARATOR = /^[\s:.\-–—]+|[\s:.\-–—]+$/gu

/**
 * Resolve which files to read.
 * @param root - Absolute repository root.
 * @param stagedOnly - Whether to restrict the run to staged files.
 * @returns Absolute paths plus the repository-relative path used in messages.
 */
function selectFiles(root, stagedOnly) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const isSkipped = corpusSkipPredicate(root, config, REPOSITORY_SKIP_DIRECTORIES)
  const corpus = collectFiles(root, CODE_GLOBS, isSkipped)
  const entry = file => ({ abs: file.abs, relPath: file.realPath ?? file.relPath })

  if (!stagedOnly) return corpus.map(entry)

  const staged = stagedSources(root)
  if (staged === null) {
    console.error('verify-issue-tags: --staged needs a Git worktree; falling back to the whole repository')
    return corpus.map(entry)
  }
  return stagedSubset(corpus, staged).map(entry)
}

/**
 * Find every known-issue marker in the selected files.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` restricts the run to staged files.
 * @returns Markers in file order, the ones that name nothing, and the file count.
 */
export function checkIssueTags(root, { stagedOnly = false } = {}) {
  const files = selectFiles(root, stagedOnly)
  const markers = []
  const nameless = []

  for (const file of files) {
    let text
    try {
      text = readFileSync(file.abs, 'utf8')
    } catch {
      // An unreadable file is not this gate's subject; another gate reports it.
      continue
    }
    for (const [index, line] of text.split('\n').entries()) {
      const found = MARKER.exec(line)
      if (found === null) continue
      const [, tag, owner, rest] = found
      const marker = {
        relPath: file.relPath,
        line: index + 1,
        tag,
        owner: (owner ?? '').trim(),
        reason: rest.replace(SEPARATOR, ''),
      }
      markers.push(marker)
      if (marker.reason === '') nameless.push(marker)
    }
  }

  return { markers, nameless, checked: files.length }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { markers, nameless, checked } = checkIssueTags(ROOT, { stagedOnly: process.argv.includes('--staged') })

  for (const tag of URGENCY) {
    for (const marker of markers.filter(found => found.tag === tag)) {
      const owner = marker.owner === '' ? '' : ` (${marker.owner})`
      console.log(`  ${tag.padEnd(5)} ${marker.relPath}:${marker.line}${owner}  ${marker.reason}`)
    }
  }

  if (nameless.length > 0) {
    console.error(`verify-issue-tags: ${nameless.length} marker(s) name nothing:`)
    for (const marker of nameless) console.error(`  ${marker.relPath}:${marker.line}  ${marker.tag}`)
    console.error('Say what the marker is waiting for, or delete it: a bare tag tells a reader it was noticed and nothing else.')
    return 1
  }

  const counts = URGENCY.map(tag => `${tag} ${markers.filter(found => found.tag === tag).length}`).join(', ')
  const summary = markers.length === 0
    ? `no known-issue markers.`
    : `${markers.length} marker(s) — ${counts}.`
  console.log(`verify-issue-tags: ${checked} file(s) checked, ${summary}`)
  return 0
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
