/**
 * The release procedure: what `prepublishOnly` refuses, and where the release
 * skill must never appear.
 *
 * The skill is for publishing this package. A copy of it in the tarball, or in
 * a scaffolded repository, would hand that repository a procedure for a
 * package it does not publish.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { releaseProblems } from '../scripts/prepublish.mjs'
import { gitConfigEnv, makeSandbox, removeSandbox, scaffold, PACKAGE_ROOT } from './helpers.mjs'

const SKILL = 'agent-init-release'

/**
 * Create a committed, tagged package in a throwaway repository.
 * @returns Sandbox path and a Git runner scoped to it.
 */
function makeRelease() {
  const repo = makeSandbox()
  const env = gitConfigEnv(join(repo, '.git', 'test-global-config'), {
    GIT_AUTHOR_NAME: 't',
    GIT_AUTHOR_EMAIL: 't@example.com',
    GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.com',
  })
  const git = (...args) => spawnSync('git', ['-C', repo, ...args], { encoding: 'utf8', env })
  writeFileSync(join(repo, 'package.json'), JSON.stringify({ name: 'probe', version: '1.2.3', files: ['src'] }, null, 2), 'utf8')
  mkdirSync(join(repo, 'src'))
  writeFileSync(join(repo, 'src', 'index.mjs'), 'export {}\n', 'utf8')
  git('add', '-A')
  git('commit', '-q', '-m', 'chore: 1.2.3')
  git('tag', 'v1.2.3')
  return { repo, git }
}

test('a committed tree tagged with its version may be published', () => {
  const { repo } = makeRelease()
  try {
    assert.deepEqual(releaseProblems(repo), [])
  } finally {
    removeSandbox(repo)
  }
})

test('a HEAD without the version tag is refused', () => {
  const { repo, git } = makeRelease()
  try {
    git('tag', '-d', 'v1.2.3')
    assert.match(releaseProblems(repo).join('\n'), /not tagged v1\.2\.3/u)
  } finally {
    removeSandbox(repo)
  }
})

test('an uncommitted change to a shipped path is refused', () => {
  const { repo } = makeRelease()
  try {
    writeFileSync(join(repo, 'src', 'index.mjs'), 'export const changed = 1\n', 'utf8')
    assert.match(releaseProblems(repo).join('\n'), /uncommitted changes in shipped paths[\s\S]*src\/index\.mjs/u)
  } finally {
    removeSandbox(repo)
  }
})

test('an untracked file under a shipped path is refused', () => {
  const { repo } = makeRelease()
  try {
    writeFileSync(join(repo, 'src', 'extra.mjs'), 'export {}\n', 'utf8')
    assert.match(releaseProblems(repo).join('\n'), /src\/extra\.mjs/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a change outside the shipped paths does not block a publish', () => {
  const { repo } = makeRelease()
  try {
    writeFileSync(join(repo, 'notes.md'), 'local\n', 'utf8')
    assert.deepEqual(releaseProblems(repo), [])
  } finally {
    removeSandbox(repo)
  }
})

test('npm publish runs the release gate', () => {
  const pkg = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8'))
  assert.equal(pkg.scripts.prepublishOnly, 'node scripts/prepublish.mjs')
})

test('the release skill exists and is reachable where the agent reads skills', () => {
  assert.ok(existsSync(join(PACKAGE_ROOT, '.agents', 'skills', SKILL, 'SKILL.md')))
  assert.ok(existsSync(join(PACKAGE_ROOT, '.claude', 'skills', SKILL, 'SKILL.md')))
})

test('the release skill is not in the published package', () => {
  const result = spawnSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { cwd: PACKAGE_ROOT, encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
  const paths = JSON.parse(result.stdout)[0].files.map(file => file.path)
  assert.ok(paths.includes('package.json'), 'the listing must hold the package')
  assert.deepEqual(
    paths.filter(path => path.includes(SKILL)),
    [],
  )
})

test('the release skill is not scaffolded into a receiving repository', () => {
  const repo = scaffold(['--name', 'Probe', '--skills', 'all'])
  try {
    const listed = spawnSync('git', ['-C', repo, 'ls-files', '--others', '--cached'], { encoding: 'utf8' }).stdout
    assert.ok(listed.includes('AGENTS.md'), 'the scaffold must have written its tree')
    assert.doesNotMatch(listed, new RegExp(SKILL, 'u'))
    assert.equal(existsSync(join(repo, '.agents', 'skills', SKILL)), false)
    assert.equal(existsSync(join(repo, '.claude', 'skills', SKILL)), false)
  } finally {
    removeSandbox(repo)
  }
})
