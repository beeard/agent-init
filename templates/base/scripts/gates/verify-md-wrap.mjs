/**
 * Reject Markdown prose paragraphs that span more than one physical line.
 *
 * The rule is in `docs/AGENTS.md`: one physical line per paragraph, with the
 * editor soft-wrapping. Fenced code, tables, and list structure keep their own
 * formatting. Frozen archived records are skipped.
 *
 * `--staged` checks the staged Markdown files within the configured corpus. The
 * pre-commit hook uses it: the rule is the one most often broken by accident,
 * so catching it at the moment it is introduced is worth more than the
 * whole-repository scan, and the staged subset stays fast on a repository of
 * any size while never judging a file the full run would not.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { findWrappedParagraphs } from './lib/markdown.mjs'
import { collectFiles, isMain, readConfig, skipPredicate, stagedSources, stagedSubset } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/**
 * Resolve which documents to inspect.
 *
 * A staged run is the whole-repository corpus intersected with the staged
 * paths, never the staged paths alone: a file the suite does not judge must not
 * fail a commit.
 *
 * @param root - Absolute repository root.
 * @param stagedOnly - Whether to restrict the run to staged files.
 * @returns Matched files with both their matched and canonical relative paths.
 */
function selectFiles(root, stagedOnly) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const skip = skipPredicate(root, config.skipGlobs ?? [])
  const corpus = collectFiles(root, config.markdownGlobs, skip)
  if (!stagedOnly) return corpus

  const staged = stagedSources(root)
  if (staged === null) {
    console.error('verify-md-wrap: --staged needs a Git worktree; falling back to the whole repository')
    return corpus
  }
  return stagedSubset(corpus, staged)
}

/**
 * Find every hard-wrapped paragraph in the selected documents.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` restricts the run to staged Markdown files.
 * @returns Violations plus the number of files inspected.
 */
export function checkMarkdownWrap(root, { stagedOnly = false } = {}) {
  const files = selectFiles(root, stagedOnly)
  const violations = []

  for (const file of files) {
    const source = readFileSync(file.abs, 'utf8')
    for (const found of findWrappedParagraphs(source)) {
      violations.push({ relPath: file.realPath ?? file.relPath, line: found.line, text: found.text })
    }
  }

  return { violations, checked: files.length }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { violations, checked } = checkMarkdownWrap(ROOT, { stagedOnly: process.argv.includes('--staged') })
  if (violations.length === 0) {
    console.log(`verify-md-wrap: ${checked} file(s) checked, no hard-wrapped prose paragraphs.`)
    return 0
  }
  console.error('verify-md-wrap: hard-wrapped prose paragraphs found (write one physical line per paragraph):')
  for (const violation of violations) {
    const preview = violation.text.length > 80 ? `${violation.text.slice(0, 80)}…` : violation.text
    console.error(`  ${violation.relPath}:${violation.line}  ${preview}`)
  }
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
