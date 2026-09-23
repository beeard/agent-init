/**
 * The repository's own Claude Code edit hook, `.claude/hooks/post-edit.mjs`.
 *
 * Each test writes one file into a sandbox project, hands the hook the payload
 * Claude Code would send after an edit, and asserts the exit code the hook
 * contract gives it: 2 for an error the agent must fix, 1 for a tooling problem
 * that must not block the edit, 0 otherwise.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { makeSandbox, removeSandbox, PACKAGE_ROOT } from './helpers.mjs'

const HOOK = join(PACKAGE_ROOT, '.claude', 'hooks', 'post-edit.mjs')

/** The Prettier version the hook runs, as the package pins it. */
const PRETTIER = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'package.json'), 'utf8')).config.prettier

/** Whether npx can run that Prettier here; the formatting test needs it, and the rest do not. */
const HAS_PRETTIER = spawnSync('npx', ['--yes', `prettier@${PRETTIER}`, '--version'], { encoding: 'utf8', shell: process.platform === 'win32' }).status === 0

/**
 * Run the hook against one file in a fresh sandbox project.
 * @param name - File path inside the sandbox.
 * @param content - File contents.
 * @param body - Receives the exit code, stderr, and the file's contents afterwards.
 * @param env - Extra environment variables for the hook.
 */
function afterEdit(name, content, body, env = {}) {
  const project = makeSandbox()
  try {
    for (const config of ['.prettierrc.json', '.prettierignore']) copyFileSync(join(PACKAGE_ROOT, config), join(project, config))
    const file = join(project, name)
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, content, 'utf8')
    const result = spawnSync(process.execPath, [HOOK], {
      input: JSON.stringify({ tool_name: 'Edit', tool_input: { file_path: file } }),
      encoding: 'utf8',
      env: { ...process.env, ...env, CLAUDE_PROJECT_DIR: project },
    })
    body({ code: result.status, stderr: result.stderr, after: readFileSync(file, 'utf8') })
  } finally {
    removeSandbox(project)
  }
}

test('a JavaScript syntax error is handed back to the agent', () => {
  afterEdit('broken.mjs', 'const a = {\n', ({ code, stderr }) => {
    assert.equal(code, 2, stderr)
    assert.match(stderr, /broken\.mjs: syntax error/u)
  })
})

test('invalid JSON is handed back to the agent', () => {
  afterEdit('broken.json', '{"a": 1,}\n', ({ code, stderr }) => {
    assert.equal(code, 2, stderr)
    assert.match(stderr, /broken\.json: invalid JSON/u)
  })
})

test('valid JSON is accepted and left as written', () => {
  afterEdit('ok.json', '{"a": 1}\n', ({ code, stderr, after }) => {
    assert.equal(code, 0, stderr)
    assert.equal(after, '{"a": 1}\n')
  })
})

test('a file the hook does not handle is left alone', () => {
  afterEdit('notes.md', '# Title\n\nwide    spacing\n', ({ code, after }) => {
    assert.equal(code, 0)
    assert.equal(after, '# Title\n\nwide    spacing\n')
  })
})

test('a file outside the project is left alone', () => {
  const result = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(PACKAGE_ROOT, '..', 'elsewhere.mjs') } }),
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: PACKAGE_ROOT },
  })
  assert.equal(result.status, 0, result.stderr)
})

test('a payload that is not JSON is ignored', () => {
  const result = spawnSync(process.execPath, [HOOK], { input: 'not json', encoding: 'utf8' })
  assert.equal(result.status, 0, result.stderr)
})

test('valid JavaScript is formatted to the repository style', { skip: !HAS_PRETTIER && 'npx cannot run the pinned Prettier here' }, () => {
  afterEdit('messy.mjs', 'const a = {b:"x",\n c:2};\nexport default a;\n', ({ code, stderr, after }) => {
    assert.equal(code, 0, stderr)
    assert.equal(after, "const a = { b: 'x', c: 2 }\nexport default a\n")
  })
})

test('invalid YAML is handed back to the agent', { skip: !HAS_PRETTIER && 'npx cannot run the pinned Prettier here' }, () => {
  afterEdit('broken.yml', 'a: [1\nb: 2\n', ({ code, stderr }) => {
    assert.equal(code, 2, stderr)
    assert.match(stderr, /broken\.yml: Prettier failed/u)
  })
})

test('a directory whose name starts with two dots is inside the project', { skip: !HAS_PRETTIER && 'npx cannot run the pinned Prettier here' }, () => {
  afterEdit('..cache/messy.mjs', 'const a = {b:1}\n', ({ code, stderr, after }) => {
    assert.equal(code, 0, stderr)
    assert.equal(after, 'const a = { b: 1 }\n')
  })
})

test('an unreachable Prettier is reported without blocking the edit', () => {
  afterEdit(
    'fine.mjs',
    'export const a = 1\n',
    ({ code, stderr }) => {
      assert.equal(code, 1, stderr)
      assert.match(stderr, /cannot run npx|Prettier failed/u)
    },
    { PATH: '/nonexistent' },
  )
})
