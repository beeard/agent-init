/**
 * Verify that relative Markdown links point at files that exist.
 *
 * External URLs, mail links, and bare `#anchor` references are skipped. A link
 * with a `#fragment` has its fragment stripped before the path is resolved:
 * heading-anchor checking is not attempted, because heading slugs are
 * host-specific and a false failure there trains readers to ignore the gate.
 *
 * Frozen archived records are skipped, including their outbound links.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { extractLinkTargets } from './lib/markdown.mjs'
import { collectFiles, isMain, readConfig, skipPredicate } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** Targets that are not repository paths. */
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/iu

/**
 * Find every relative link target that does not resolve to a file.
 * @param root - Absolute repository root.
 * @returns Violations plus the number of files inspected.
 */
export function checkMarkdownLinks(root) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const skip = skipPredicate(root, config.skipGlobs ?? [])
  const files = collectFiles(root, config.linkGlobs ?? config.markdownGlobs, skip)
  const violations = []

  for (const file of files) {
    const source = readFileSync(file.abs, 'utf8')
    for (const { target, line } of extractLinkTargets(source)) {
      if (EXTERNAL.test(target) || target === '') continue
      const withoutFragment = target.split('#')[0].split('?')[0]
      if (withoutFragment === '') continue
      let decoded
      try {
        decoded = decodeURIComponent(withoutFragment)
      } catch {
        violations.push({ relPath: file.realPath, line, target, reason: 'not valid percent-encoding' })
        continue
      }
      if (!existsSync(resolve(dirname(file.real), decoded))) {
        violations.push({ relPath: file.realPath, line, target, reason: 'target does not exist' })
      }
    }
  }

  return { violations, checked: files.length }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { violations, checked } = checkMarkdownLinks(ROOT)
  if (violations.length === 0) {
    console.log(`verify-md-links: ${checked} file(s) checked, every relative link resolves.`)
    return 0
  }
  console.error('verify-md-links: broken relative links:')
  for (const violation of violations) {
    console.error(`  ${violation.relPath}:${violation.line}  ${violation.target} — ${violation.reason}`)
  }
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
