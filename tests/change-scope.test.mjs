/**
 * `change-scope`, proved against a throwaway repository.
 *
 * The tool exists so an agent can pick the evidence a change needs, and its one
 * real failure mode is a base nobody can detect for it — so the refusal paths
 * and the resolved SHAs are what these tests pin.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { removeSandbox, scaffold } from './helpers.mjs'

/**
 * Run Git in a sandbox and require success.
 * @param repo - Absolute repository path.
 * @param args - Git arguments.
 * @returns Trimmed stdout.
 */
function git(repo, args) {
  const result = spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8' })
  assert.equal(result.status, 0, `git ${args.join(' ')} failed: ${result.stderr}`)
  return result.stdout.trim()
}

/**
 * Commit everything currently in the working tree.
 * @param repo - Absolute repository path.
 * @param message - Commit message.
 */
function commit(repo, message) {
  git(repo, ['add', '-A'])
  // `--no-verify` keeps the scaffolded hook from running the suite inside the
  // fixture repository; this test is about the report, not the gates.
  git(repo, ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '--no-verify', '-q', '-m', message])
}

/**
 * Run `change-scope` inside a repository.
 * @param repo - Absolute repository path.
 * @param args - Arguments after the script path.
 * @returns Exit code, combined output, and stdout.
 */
function runScope(repo, args) {
  const result = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'change-scope.mjs'), ...args], {
    cwd: repo,
    encoding: 'utf8',
  })
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}`, stdout: result.stdout }
}

test('refuses to run without a base', () => {
  const repo = scaffold()
  try {
    const result = runScope(repo, [])
    assert.equal(result.code, 1)
    assert.match(result.output, /missing required --base/u)
  } finally {
    removeSandbox(repo)
  }
})

test('refuses a base that does not resolve to a commit', () => {
  const repo = scaffold()
  try {
    const result = runScope(repo, ['--base', 'no-such-ref'])
    assert.equal(result.code, 1)
    assert.match(result.output, /does not resolve to a commit/u)
  } finally {
    removeSandbox(repo)
  }
})

test('reports committed, staged, unstaged, and untracked paths against the merge base', () => {
  const repo = scaffold()
  try {
    commit(repo, 'base')
    const base = git(repo, ['rev-parse', 'HEAD'])
    git(repo, ['checkout', '-q', '-b', 'feature'])

    writeFileSync(join(repo, 'docs', 'committed.md'), '# Committed\n', 'utf8')
    commit(repo, 'change')

    writeFileSync(join(repo, 'docs', 'staged.md'), '# Staged\n', 'utf8')
    git(repo, ['add', 'docs/staged.md'])
    // A tracked file edited in place is unstaged; a new file would be untracked.
    writeFileSync(join(repo, 'AGENTS.md'), '# Edited\n', 'utf8')
    writeFileSync(join(repo, 'docs', 'untracked.md'), '# Untracked\n', 'utf8')

    const result = runScope(repo, ['--base', base])
    assert.equal(result.code, 0, result.output)
    const report = JSON.parse(result.stdout)
    assert.equal(report.formatVersion, 1)
    assert.equal(report.resolved.baseSha, base)
    assert.deepEqual(report.paths.committed, ['docs/committed.md'])
    assert.deepEqual(report.paths.staged, ['docs/staged.md'])
    assert.deepEqual(report.paths.unstaged, ['AGENTS.md'])
    assert.deepEqual(report.paths.untracked, ['docs/untracked.md'])
  } finally {
    removeSandbox(repo)
  }
})
