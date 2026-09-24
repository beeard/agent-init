/**
 * The shipped Claude Code edit hook, proved by negative control.
 *
 * Registration: a scaffold adds the hook to `.claude/settings.json` without
 * disturbing hooks the repository already has, and never twice.
 *
 * Checks: each test breaks one file a check claims to reject and asserts the
 * hook exits 2 naming it; a stack check skips where its toolchain is absent.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { HAS_CARGO, HAS_GO, HAS_PYTHON, TYPESCRIPT, makeSandbox, removeSandbox, runCli, scaffold } from './helpers.mjs'

const COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/post-edit.mjs"'

/**
 * Every hook command registered under `hooks.PostToolUse`.
 * @param repo - Absolute repository path.
 * @returns The commands, in order.
 */
function registeredCommands(repo) {
  const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'))
  return settings.hooks.PostToolUse.flatMap(group => group.hooks.map(entry => entry.command))
}

/**
 * Write a file into a repository and run the edit hook on it.
 * @param repo - Absolute repository path.
 * @param relPath - Path below the repository root.
 * @param content - File contents.
 * @returns Exit code, stderr, and the file's contents afterwards.
 */
function edit(repo, relPath, content) {
  const file = join(repo, relPath)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content, 'utf8')
  const result = spawnSync(process.execPath, [join(repo, '.claude', 'hooks', 'post-edit.mjs')], {
    input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: file } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  })
  return { code: result.status, stderr: result.stderr, after: readFileSync(file, 'utf8') }
}

/**
 * Run a body against a scaffolded repository, then delete it.
 * @param args - Extra scaffold arguments.
 * @param body - Receives the repository path.
 */
function withRepo(args, body) {
  const repo = scaffold(args)
  try {
    body(repo)
  } finally {
    removeSandbox(repo)
  }
}

// Registration.

test('a scaffold registers the edit hook in a new settings file', () => {
  withRepo([], repo => {
    assert.deepEqual(registeredCommands(repo), [COMMAND])
  })
})

test('a repository keeps its own hooks and settings, and a re-run adds nothing', () => {
  const repo = makeSandbox()
  try {
    mkdirSync(join(repo, '.claude'))
    const own = { permissions: { allow: ['Bash(ls)'] }, hooks: { PostToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo mine' }] }] } }
    writeFileSync(join(repo, '.claude', 'settings.json'), `${JSON.stringify(own, null, 2)}\n`, 'utf8')
    assert.equal(runCli(['.'], repo).code, 0)
    assert.equal(runCli(['.'], repo).code, 0)
    const settings = JSON.parse(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'))
    assert.deepEqual(settings.permissions, own.permissions)
    assert.deepEqual(registeredCommands(repo), ['echo mine', COMMAND])
  } finally {
    removeSandbox(repo)
  }
})

test('a settings file that is not valid JSON is left exactly as it was, and says so', () => {
  const repo = makeSandbox()
  try {
    mkdirSync(join(repo, '.claude'))
    writeFileSync(join(repo, '.claude', 'settings.json'), '{ not json', 'utf8')
    const result = runCli(['.'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /\.claude\/settings\.json\s+not valid JSON; edit hook not registered/u)
    assert.equal(readFileSync(join(repo, '.claude', 'settings.json'), 'utf8'), '{ not json')
  } finally {
    removeSandbox(repo)
  }
})

test('a settings path that is a directory is reported, and the run still completes', () => {
  const repo = makeSandbox()
  try {
    mkdirSync(join(repo, '.claude', 'settings.json'), { recursive: true })
    const result = runCli(['.'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /\.claude\/settings\.json\s+not a readable file; edit hook not registered/u)
  } finally {
    removeSandbox(repo)
  }
})

test('--no-hooks registers no edit hook, and --dry-run writes none', () => {
  for (const flag of ['--no-hooks', '--dry-run']) {
    const repo = makeSandbox()
    try {
      assert.equal(runCli(['.', flag], repo).code, 0)
      assert.equal(existsSync(join(repo, '.claude', 'settings.json')), false, flag)
    } finally {
      removeSandbox(repo)
    }
  }
})

// The base checks.

test('invalid JSON is rejected, and a config that may hold comments is not judged', () => {
  withRepo([], repo => {
    const broken = edit(repo, 'data.json', '{"a": 1,}\n')
    assert.equal(broken.code, 2, broken.stderr)
    assert.match(broken.stderr, /data\.json: rejected by json-syntax/u)
    const commented = edit(repo, 'tsconfig.json', '{\n  // strict\n  "compilerOptions": {}\n}\n')
    assert.equal(commented.code, 0, commented.stderr)
    assert.equal(edit(repo, 'data.json', '{"a": 1}\n').code, 0)
  })
})

test('a JavaScript syntax error is rejected', () => {
  withRepo([], repo => {
    const result = edit(repo, 'src/index.mjs', 'const a = {\n')
    assert.equal(result.code, 2, result.stderr)
    assert.match(result.stderr, /src\/index\.mjs: rejected by javascript-syntax/u)
    assert.equal(edit(repo, 'src/index.mjs', 'export const a = 1\n').code, 0)
  })
})

test(
  "the repository's own Prettier runs when installed, and nothing happens when it is not",
  { skip: process.platform === 'win32' && 'the stub is a POSIX script' },
  () => {
    withRepo([], repo => {
      assert.equal(edit(repo, 'notes.txt', 'x\n').code, 0)
      const bin = join(repo, 'node_modules', '.bin')
      mkdirSync(bin, { recursive: true })
      writeFileSync(join(bin, 'prettier'), '#!/bin/sh\necho "$@" > prettier-called\n', 'utf8')
      chmodSync(join(bin, 'prettier'), 0o755)
      assert.equal(edit(repo, 'notes.txt', 'x\n').code, 0)
      assert.match(readFileSync(join(repo, 'prettier-called'), 'utf8'), /--write --ignore-unknown .*notes\.txt/u)
    })
  },
)

test('a required check whose program is not installed is reported without blocking', () => {
  withRepo([], repo => {
    const manifest = join(repo, '.claude', 'hooks', 'post-edit.json')
    const checks = JSON.parse(readFileSync(manifest, 'utf8'))
    checks.checks.absent = { extensions: ['.txt'], run: ['agent-init-no-such-program', '{file}'] }
    writeFileSync(manifest, JSON.stringify(checks), 'utf8')
    const result = edit(repo, 'notes.txt', 'x\n')
    assert.equal(result.code, 1, result.stderr)
    assert.match(result.stderr, /absent: agent-init-no-such-program is not installed/u)
  })
})

test('a file outside the project, or one that no longer exists, is left alone', () => {
  withRepo([], repo => {
    for (const path of [join(dirname(repo), 'elsewhere.json'), join(repo, 'gone.json')]) {
      const result = spawnSync(process.execPath, [join(repo, '.claude', 'hooks', 'post-edit.mjs')], {
        input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: path } }),
        encoding: 'utf8',
        env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
      })
      assert.equal(result.status, 0, result.stderr)
    }
  })
})

// The stack checks.

test('python: a syntax error is rejected with its position, and nothing is compiled to disk', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  withRepo(['--stack', 'python'], repo => {
    const result = edit(repo, 'pkg/mod.py', 'def f(:\n')
    assert.equal(result.code, 2, result.stderr)
    assert.match(result.stderr, /pkg\/mod\.py: rejected by python-syntax\n1:7: /u)
    assert.equal(edit(repo, 'pkg/mod.py', 'def f():\n    return 1\n').code, 0)
    assert.equal(existsSync(join(repo, 'pkg', '__pycache__')), false)
  })
})

test('go: gofmt formats the file and rejects one that does not parse', { skip: !HAS_GO && 'go is not installed' }, () => {
  withRepo(['--stack', 'go'], repo => {
    const formatted = edit(repo, 'main.go', 'package main\nfunc main( ){ }\n')
    assert.equal(formatted.code, 0, formatted.stderr)
    assert.equal(formatted.after, 'package main\n\nfunc main() {}\n')
    const broken = edit(repo, 'main.go', 'package main\nfunc main( {\n')
    assert.equal(broken.code, 2, broken.stderr)
    assert.match(broken.stderr, /main\.go: rejected by gofmt/u)
  })
})

test(
  'rust: rustfmt formats only the edited file, at its crate edition, and rejects one that does not parse',
  { skip: !HAS_CARGO && 'cargo is not installed' },
  () => {
    withRepo(['--stack', 'rust'], repo => {
      writeFileSync(join(repo, 'Cargo.toml'), '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n', 'utf8')
      mkdirSync(join(repo, 'src'))
      writeFileSync(join(repo, 'src', 'lib.rs'), 'mod other;\npub fn a( )->i32{1}\n', 'utf8')
      // `async` is a keyword from the 2018 edition on, so this parses only at the crate's edition.
      const formatted = edit(repo, 'src/other.rs', 'pub async fn b( )->i32{2}\n')
      assert.equal(formatted.code, 0, formatted.stderr)
      assert.equal(formatted.after, 'pub async fn b() -> i32 {\n    2\n}\n')
      assert.equal(readFileSync(join(repo, 'src', 'lib.rs'), 'utf8'), 'mod other;\npub fn a( )->i32{1}\n')
      const broken = edit(repo, 'src/other.rs', 'pub fn c( ) {\n')
      assert.equal(broken.code, 2, broken.stderr)
      assert.match(broken.stderr, /src\/other\.rs: rejected by rustfmt/u)
    })
  },
)

test('typescript: a syntax error is rejected with its position', { skip: TYPESCRIPT === null && 'no typescript with the compiler API is installed' }, () => {
  withRepo(['--stack', 'typescript'], repo => {
    mkdirSync(join(repo, 'node_modules'), { recursive: true })
    symlinkSync(TYPESCRIPT, join(repo, 'node_modules', 'typescript'), 'dir')
    const result = edit(repo, 'src/index.ts', 'export const a: number = (\n')
    assert.equal(result.code, 2, result.stderr)
    assert.match(result.stderr, /src\/index\.ts:1:\d+ {2}Expression expected/u)
    const jsx = edit(repo, 'src/view.tsx', 'export const v = <div>{</div>\n')
    assert.equal(jsx.code, 2, jsx.stderr)
    assert.equal(edit(repo, 'src/index.ts', 'export const a: number = 1\n').code, 0)
  })
})

test('typescript: a project without the compiler installed is reported without blocking', () => {
  withRepo(['--stack', 'typescript'], repo => {
    const result = edit(repo, 'src/index.ts', 'export const a = 1\n')
    assert.equal(result.code, 1, result.stderr)
    assert.match(result.stderr, /typescript-syntax: could not run — typescript is not resolvable/u)
  })
})
