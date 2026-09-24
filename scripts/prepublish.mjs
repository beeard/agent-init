#!/usr/bin/env node
/**
 * Refuse a publish that the release procedure would not produce.
 *
 * `npm publish` runs this as `prepublishOnly`, so it holds for whoever
 * publishes, from any shell. A publish goes ahead only when:
 *
 * 1. every path the package ships, and `package.json`, is committed — the
 *    tarball is then exactly what a commit holds;
 * 2. `HEAD` carries the tag `v<version>`, so the published version names the
 *    commit it was built from;
 * 3. `npm test`, `npm run check`, and `npm run format:check` pass.
 *
 * The procedure around it is `.agents/skills/agent-init-release/SKILL.md`,
 * which is deliberately outside both `files` and `templates/`.
 *
 * Usage:
 *   node scripts/prepublish.mjs
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const CHECKS = ['test', 'check', 'format:check']

/**
 * Find what stands between a repository and a publish, without running checks.
 * @param root - Absolute repository root holding `package.json`.
 * @returns One message per problem; empty when the tree may be published.
 */
export function releaseProblems(root) {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const problems = []
  const git = args => spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' })

  const shipped = ['package.json', ...(pkg.files ?? [])]
  const status = git(['status', '--porcelain', '--untracked-files=all', '--', ...shipped])
  if (status.status !== 0) {
    problems.push(`git status failed: ${status.stderr.trim()}`)
  } else if (status.stdout.trim() !== '') {
    problems.push(`uncommitted changes in shipped paths:\n${status.stdout.trimEnd()}`)
  }

  const tag = `v${pkg.version}`
  const tags = git(['tag', '--points-at', 'HEAD'])
  const atHead = tags.status === 0 ? tags.stdout.split('\n').map(line => line.trim()) : []
  if (!atHead.includes(tag)) {
    problems.push(`HEAD is not tagged ${tag}; commit the version as "chore: ${pkg.version}" and tag it`)
  }

  return problems
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const problems = releaseProblems(ROOT)
  for (const problem of problems) console.error(`FAIL  ${problem}`)
  if (problems.length > 0) process.exit(1)

  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm'
  for (const script of CHECKS) {
    const run = spawnSync(npm, ['run', '--silent', script], { cwd: ROOT, stdio: 'inherit' })
    if (run.status !== 0) {
      console.error(`FAIL  npm run ${script} exited ${run.status ?? run.signal}`)
      process.exit(1)
    }
  }
  console.log('ok    ready to publish')
}
