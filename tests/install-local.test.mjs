/**
 * The machine-local installer, proved against a throwaway `$HOME`.
 *
 * The script writes outside the repository, so every case here runs it in a
 * sandbox home rather than the real one. It reads `$HOME` and, as Git does,
 * `$XDG_CONFIG_HOME` — a run that overrides only the former still reads the
 * real global configuration, which is how the first version of this test
 * silently passed while pointing at the developer's own machine.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, lstatSync, mkdirSync, readFileSync, readlinkSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PACKAGE_ROOT, makeSandbox, removeSandbox } from './helpers.mjs'

/**
 * Run the installer against a sandbox home.
 * @param home - Absolute sandbox path used as `$HOME` and `$XDG_CONFIG_HOME`.
 * @param args - Arguments after the script path.
 * @returns Exit code and combined output.
 */
function install(home, args = []) {
  const result = spawnSync(
    process.execPath,
    [join(PACKAGE_ROOT, 'scripts', 'install-local.mjs'), ...args],
    { encoding: 'utf8', env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') } },
  )
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/**
 * Create a sandbox home with a global hooks path configured.
 * @returns Absolute sandbox path.
 */
function makeHome() {
  const home = makeSandbox()
  mkdirSync(join(home, '.config', 'git', 'hooks'), { recursive: true })
  mkdirSync(join(home, '.claude', 'skills'), { recursive: true })
  spawnSync('git', ['config', '--global', 'core.hooksPath', join(home, '.config', 'git', 'hooks')], {
    env: { ...process.env, HOME: home, XDG_CONFIG_HOME: join(home, '.config') },
  })
  return home
}

const HOOK = join(PACKAGE_ROOT, 'scripts', 'local', 'pre-commit.sh')
const SKILL = join(PACKAGE_ROOT, 'skills', 'agent-init-setup')

/**
 * Run the hook chain with a repository as its working directory.
 * @param repo - Absolute repository path.
 * @param options - Optional spawn options, such as a timeout.
 * @returns Exit code and combined output.
 */
function runChain(repo, options = {}) {
  const result = spawnSync(HOOK, [], { cwd: repo, encoding: 'utf8', ...options })
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/**
 * Write an executable script into a repository.
 * @param repo - Absolute repository path.
 * @param relPath - Path below the repository root.
 * @param content - Script contents.
 */
function writeScript(repo, relPath, content) {
  const abs = join(repo, relPath)
  mkdirSync(join(abs, '..'), { recursive: true })
  writeFileSync(abs, content, 'utf8')
  chmodSync(abs, 0o755)
}

/**
 * Set one value in a repository's own config, which a clone does not carry.
 * @param repo - Absolute repository path.
 * @param key - Config key.
 * @param value - Config value.
 */
function setLocal(repo, key, value) {
  spawnSync('git', ['-C', repo, 'config', '--local', key, value])
}

test('installs both links into a fresh home', () => {
  const home = makeHome()
  try {
    const result = install(home)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /linked\s+~\/\.config\/git\/hooks\/pre-commit/u)
    assert.match(result.output, /linked\s+~\/\.claude\/skills\/agent-init-setup/u)
    assert.equal(readlinkSync(join(home, '.config', 'git', 'hooks', 'pre-commit')), HOOK)
    assert.equal(readlinkSync(join(home, '.claude', 'skills', 'agent-init-setup')), SKILL)
  } finally {
    removeSandbox(home)
  }
})

test('re-running changes nothing', () => {
  const home = makeHome()
  try {
    install(home)
    const again = install(home)
    assert.equal(again.code, 0, again.output)
    assert.doesNotMatch(again.output, /replaced|relinked/u)
    assert.match(again.output, /ok\s+~\/\.config\/git\/hooks\/pre-commit/u)
  } finally {
    removeSandbox(home)
  }
})

test('an existing hook is kept beside itself, not deleted', () => {
  const home = makeHome()
  try {
    const target = join(home, '.config', 'git', 'hooks', 'pre-commit')
    writeFileSync(target, '#!/bin/sh\necho mine\n', 'utf8')
    const result = install(home)
    assert.match(result.output, /replaced\s+~\/\.config\/git\/hooks\/pre-commit/u)
    const backups = readdirSync(join(home, '.config', 'git', 'hooks')).filter(name => name.includes('.bak.'))
    assert.equal(backups.length, 1, 'the replaced file must be kept as one backup')
    assert.equal(readFileSync(join(home, '.config', 'git', 'hooks', backups[0]), 'utf8'), '#!/bin/sh\necho mine\n')
    assert.equal(readlinkSync(target), HOOK)
  } finally {
    removeSandbox(home)
  }
})

test('an existing link is relinked without leaving a backup behind', () => {
  const home = makeHome()
  try {
    const target = join(home, '.claude', 'skills', 'agent-init-setup')
    // Renaming a link moves the path it holds, not the file it names, so a
    // backup made that way points at whatever the link said and dangles as soon
    // as that stops existing. A link carries no content to preserve.
    spawnSync('ln', ['-sfn', '/tmp/elsewhere', target])
    const result = install(home)
    assert.match(result.output, /relinked\s+~\/\.claude\/skills\/agent-init-setup/u)
    assert.equal(readlinkSync(target), SKILL)
    const strays = readdirSync(join(home, '.claude', 'skills')).filter(name => name.includes('.bak.'))
    assert.deepEqual(strays, [], 'a replaced link must not leave a backup')
  } finally {
    removeSandbox(home)
  }
})

test('a dangling link is replaced rather than mistaken for a backup', () => {
  const home = makeHome()
  try {
    const target = join(home, '.config', 'git', 'hooks', 'pre-commit')
    spawnSync('ln', ['-sfn', join(home, 'gone'), target])
    assert.ok(!existsSync(target), 'a dangling link is what existsSync cannot see')
    assert.ok(lstatSync(target).isSymbolicLink())
    const result = install(home)
    assert.match(result.output, /relinked/u)
    assert.equal(readlinkSync(target), HOOK)
  } finally {
    removeSandbox(home)
  }
})

test('without a global hooks path the chain is skipped, not guessed at', () => {
  const home = makeSandbox()
  try {
    const result = install(home)
    assert.equal(result.code, 0, result.output)
    // Each repository's own .githooks/ is what Git reads when the value is
    // unset, so there is nothing to chain and nowhere to put it.
    assert.match(result.output, /skipped\s+the hook chain/u)
    assert.ok(!existsSync(join(home, '.config', 'git', 'hooks', 'pre-commit')))
    assert.ok(existsSync(join(home, '.claude', 'skills', 'agent-init-setup')), 'the skill is still linked')
  } finally {
    removeSandbox(home)
  }
})

test('the chain does not run a working-tree hook without an opt-in', () => {
  const repo = makeSandbox()
  try {
    const marker = join(repo, 'ran')
    // `.githooks/` follows from `git clone`, so anyone can write the file. Git
    // never runs it on its own; the chain is what would turn repository content
    // into code, machine-wide, in every repository the user clones.
    writeScript(repo, '.githooks/pre-commit', `#!/bin/sh\necho ran > ${marker}\n`)
    assert.equal(runChain(repo).code, 0)
    assert.ok(!existsSync(marker), 'a cloned .githooks/pre-commit must not run on its own')
  } finally {
    removeSandbox(repo)
  }
})

test('the chain runs a working-tree hook once the repository opts in', () => {
  const repo = makeSandbox()
  try {
    const marker = join(repo, 'ran')
    writeScript(repo, '.githooks/pre-commit', `#!/bin/sh\necho ran > ${marker}\n`)
    // The marker lives in .git/config, which a clone does not carry, so the
    // repository cannot opt itself in by shipping a file.
    setLocal(repo, 'agent-init.githooks', 'true')
    assert.equal(runChain(repo).code, 0)
    assert.ok(existsSync(marker), 'an opted-in repository must have its hook run')
  } finally {
    removeSandbox(repo)
  }
})

test('only an exact true opts a repository in', () => {
  const repo = makeSandbox()
  try {
    const marker = join(repo, 'ran')
    writeScript(repo, '.githooks/pre-commit', `#!/bin/sh\necho ran > ${marker}\n`)
    for (const value of ['ja', '1', 'TRUE', '']) {
      setLocal(repo, 'agent-init.githooks', value)
      runChain(repo)
      assert.ok(!existsSync(marker), `"${value}" must not be read as an opt-in`)
    }
  } finally {
    removeSandbox(repo)
  }
})

test('a hook inside .git is run without an opt-in', () => {
  const repo = makeSandbox()
  try {
    const marker = join(repo, 'ran')
    // `$GIT_DIR/hooks/` is not cloned content, so running it grants nothing an
    // attacker could deliver.
    writeScript(repo, '.git/hooks/pre-commit', `#!/bin/sh\necho ran > ${marker}\n`)
    assert.equal(runChain(repo).code, 0)
    assert.ok(existsSync(marker), 'the repository-local hook is the safe case')
  } finally {
    removeSandbox(repo)
  }
})

test('the chain stops a commit when the repository hook fails', () => {
  const repo = makeSandbox()
  try {
    writeScript(repo, '.githooks/pre-commit', '#!/bin/sh\nexit 1\n')
    setLocal(repo, 'agent-init.githooks', 'true')
    const result = runChain(repo)
    assert.equal(result.code, 1, 'a failing repository hook must fail the commit')
    assert.match(result.output, /stoppet commiten/u)
  } finally {
    removeSandbox(repo)
  }
})

test('the chain does not recurse when a hook calls back into it', () => {
  const repo = makeSandbox()
  try {
    // A repository hook that runs the chain again would loop forever without
    // the guard; the child sets KROK_KJEDE, and the second entry returns.
    const chain = join(PACKAGE_ROOT, 'scripts', 'local', 'pre-commit.sh')
    writeScript(repo, '.githooks/pre-commit', `#!/bin/sh\n"${chain}"\necho reached >> ${join(repo, 'reached')}\n`)
    setLocal(repo, 'agent-init.githooks', 'true')
    const result = runChain(repo, { timeout: 10_000 })
    assert.equal(result.code, 0, result.output)
    assert.ok(existsSync(join(repo, 'reached')), 'the hook must run once and return')
  } finally {
    removeSandbox(repo)
  }
})

test('a dry run writes nothing', () => {
  const home = makeHome()
  try {
    const result = install(home, ['--dry-run'])
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /nothing was written/u)
    assert.ok(!existsSync(join(home, '.config', 'git', 'hooks', 'pre-commit')))
    assert.ok(!existsSync(join(home, '.claude', 'skills', 'agent-init-setup')))
  } finally {
    removeSandbox(home)
  }
})
