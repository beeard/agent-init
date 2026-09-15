/** Behaviour of the scaffolder itself: what it writes, and what it refuses. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, lstatSync, readFileSync, readlinkSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { makeSandbox, removeSandbox, runCli, scaffold } from './helpers.mjs'

test('writes the full base tree', () => {
  const repo = scaffold()
  try {
    for (const rel of [
      'AGENTS.md',
      'CLAUDE.md',
      'docs/AGENTS.md',
      'docs/architecture.md',
      '.agents/notes/README.md',
      '.agents/notes/AGENTS.md',
      '.agents/notes/implemented/AGENTS.md',
      '.agents/notes/archived/AGENTS.md',
      '.agents/notes/proposed/.gitkeep',
      '.agents/notes/rejected/.gitkeep',
      '.agents/manifest.json',
      '.githooks/pre-commit',
      'scripts/gates/run.mjs',
      'scripts/gates/change-scope.mjs',
      'scripts/gates/config.json',
      'scripts/gates/doc-budgets.manifest.json',
    ]) {
      assert.ok(existsSync(join(repo, rel)), `expected ${rel} to exist`)
    }
  } finally {
    removeSandbox(repo)
  }
})

test('links CLAUDE.md to AGENTS.md', () => {
  const repo = scaffold()
  try {
    const link = join(repo, 'CLAUDE.md')
    if (lstatSync(link).isSymbolicLink()) {
      assert.equal(readlinkSync(link), 'AGENTS.md')
    } else {
      assert.equal(readFileSync(link, 'utf8').trim(), '@AGENTS.md')
    }
  } finally {
    removeSandbox(repo)
  }
})

test('substitutes the project slug into skill directory names', () => {
  const repo = scaffold(['--name', 'My Great Project'])
  try {
    assert.ok(existsSync(join(repo, '.agents/skills/my-great-project-agent-notes/SKILL.md')))
    const skill = readFileSync(join(repo, '.agents/skills/my-great-project-agent-notes/SKILL.md'), 'utf8')
    assert.match(skill, /^name: my-great-project-agent-notes$/mu)
    assert.doesNotMatch(skill, /\{\{[A-Z_]+\}\}/u)
  } finally {
    removeSandbox(repo)
  }
})

test('includes only the requested skills', () => {
  const repo = scaffold(['--name', 'demo', '--skills', 'agent-notes,prose-standard'])
  try {
    assert.ok(existsSync(join(repo, '.agents/skills/demo-agent-notes/SKILL.md')))
    assert.ok(existsSync(join(repo, '.agents/skills/demo-prose-standard/SKILL.md')))
    assert.ok(!existsSync(join(repo, '.agents/skills/demo-code-review')))
    assert.ok(!existsSync(join(repo, '.agents/skills/demo-pre-push-checks')))
  } finally {
    removeSandbox(repo)
  }
})

test('refuses an unknown skill name', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--skills', 'nope'], repo)
    assert.equal(result.code, 2)
    assert.match(result.output, /unknown skill "nope"/u)
  } finally {
    removeSandbox(repo)
  }
})

test('refuses an unknown stack name', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--stack', 'cobol'], repo)
    assert.equal(result.code, 2)
    assert.match(result.output, /unknown stack "cobol"/u)
    assert.match(result.output, /available: python/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a repeated --stack value is applied once', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--stack', 'python'])
  try {
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    assert.equal(agents.match(/Public means no leading underscore/gu)?.length, 1)
  } finally {
    removeSandbox(repo)
  }
})

test('the manifest records the layers applied', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--with-architecture'])
  try {
    const manifest = JSON.parse(readFileSync(join(repo, '.agents/manifest.json'), 'utf8'))
    assert.deepEqual(manifest.layers, ['base', 'python', 'architecture'])
    assert.deepEqual(manifest.stack, ['python'])
    assert.equal(manifest.architecture, true)
  } finally {
    removeSandbox(repo)
  }
})

test('refuses to scaffold outside a Git worktree', () => {
  const dir = makeSandbox()
  try {
    rmSync(join(dir, '.git'), { recursive: true, force: true })
    const result = runCli(['.'], dir)
    assert.equal(result.code, 2)
    assert.match(result.output, /not inside a Git worktree/u)
    assert.equal(runCli(['.', '--allow-non-git'], dir).code, 0)
  } finally {
    removeSandbox(dir)
  }
})

test('dry run writes nothing', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--dry-run'], repo)
    assert.equal(result.code, 0)
    assert.match(result.output, /nothing was written/u)
    assert.ok(!existsSync(join(repo, 'AGENTS.md')))
  } finally {
    removeSandbox(repo)
  }
})

test('re-running keeps existing files', () => {
  const repo = scaffold()
  try {
    const agents = join(repo, 'AGENTS.md')
    writeFileSync(agents, '# edited by hand\n', 'utf8')
    const again = runCli(['.'], repo)
    assert.equal(again.code, 0)
    assert.match(again.output, /kept\s+AGENTS\.md/u)
    assert.equal(readFileSync(agents, 'utf8'), '# edited by hand\n')
  } finally {
    removeSandbox(repo)
  }
})

test('--force overwrites existing files', () => {
  const repo = scaffold()
  try {
    const agents = join(repo, 'AGENTS.md')
    writeFileSync(agents, '# edited by hand\n', 'utf8')
    assert.equal(runCli(['.', '--force'], repo).code, 0)
    assert.doesNotMatch(readFileSync(agents, 'utf8'), /edited by hand/u)
  } finally {
    removeSandbox(repo)
  }
})

test('installs an executable pre-commit hook', () => {
  const repo = scaffold()
  try {
    const mode = statSync(join(repo, '.githooks/pre-commit')).mode & 0o777
    assert.ok((mode & 0o100) !== 0, `pre-commit should be executable, mode was ${mode.toString(8)}`)
  } finally {
    removeSandbox(repo)
  }
})

test('the architecture layer adds the glossary and composition rules', () => {
  const repo = scaffold(['--with-architecture'])
  try {
    assert.ok(existsSync(join(repo, 'docs/glossary.md')))
    assert.ok(existsSync(join(repo, 'docs/composition.md')))
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    assert.match(agents, /agent-init:begin/u)
    assert.equal(agents.match(/agent-init:begin/gu)?.length, 1)
  } finally {
    removeSandbox(repo)
  }
})

test('the architecture layer is not applied by default', () => {
  const repo = scaffold()
  try {
    assert.ok(!existsSync(join(repo, 'docs/glossary.md')))
    assert.doesNotMatch(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /agent-init:begin/u)
  } finally {
    removeSandbox(repo)
  }
})

test('adds gate scripts to an existing package.json without clobbering', () => {
  const repo = makeSandbox()
  try {
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({
      name: 'demo',
      scripts: { 'check:agents': 'echo mine' },
    }, null, 2)}\n`, 'utf8')
    assert.equal(runCli(['.'], repo).code, 0)
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['check:agents'], 'echo mine')
    assert.equal(pkg.scripts['change-scope'], 'node scripts/gates/change-scope.mjs')
  } finally {
    removeSandbox(repo)
  }
})
