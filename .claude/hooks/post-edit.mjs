/**
 * Claude Code PostToolUse hook: check and format a file right after an agent edits it.
 *
 * Reads the hook payload on stdin and acts on the one file it names:
 *
 * - `.mjs`, `.js`, `.cjs` — `node --check`, then Prettier.
 * - `.yml`, `.yaml` — Prettier, which also rejects invalid YAML.
 * - `.json` — `JSON.parse`. Not formatted: `JSON.stringify` and npm own that layout.
 *
 * Exit codes follow the hook contract. 0 is clean or not this hook's file. 2 is
 * an error the agent must fix, with the reason on stderr, which Claude Code
 * hands back to the agent. 1 is a problem with the tooling rather than the
 * file, such as Prettier being unreachable offline, which is shown to the user
 * and does not block.
 *
 * The Prettier version is `config.prettier` in this repository's package.json,
 * the same pin `npm run format` uses.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { extname, isAbsolute, relative, resolve } from 'node:path'

const PACKAGE_ROOT = resolve(import.meta.dirname, '..', '..')

const SYNTAX_CHECKED = new Set(['.mjs', '.js', '.cjs'])
const FORMATTED = new Set(['.mjs', '.js', '.cjs', '.yml', '.yaml'])

/**
 * Decide what to do with one edited file.
 * @param payload - The parsed hook payload.
 * @param projectDir - Absolute project root; files outside it are left alone.
 * @returns Exit code and the message for it.
 */
function postEdit(payload, projectDir) {
  const named = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath
  if (typeof named !== 'string' || named === '') return { code: 0, message: '' }
  const file = resolve(projectDir, named)
  const rel = relative(projectDir, file)
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return { code: 0, message: '' }
  const ext = extname(file).toLowerCase()

  if (ext === '.json') {
    try {
      JSON.parse(readFileSync(file, 'utf8'))
    } catch (error) {
      return { code: 2, message: `${rel}: invalid JSON — ${error instanceof Error ? error.message : String(error)}` }
    }
    return { code: 0, message: '' }
  }

  if (SYNTAX_CHECKED.has(ext)) {
    const checked = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' })
    if (checked.status !== 0) return { code: 2, message: `${rel}: syntax error\n${`${checked.stderr}${checked.stdout}`.trim()}` }
  }

  if (!FORMATTED.has(ext)) return { code: 0, message: '' }
  const version = JSON.parse(readFileSync(resolve(PACKAGE_ROOT, 'package.json'), 'utf8')).config?.prettier
  if (typeof version !== 'string') return { code: 1, message: 'post-edit: package.json has no config.prettier version to run' }
  const formatted = spawnSync('npx', ['--yes', `prettier@${version}`, '--write', '--log-level', 'warn', file], {
    cwd: projectDir,
    encoding: 'utf8',
    shell: process.platform === 'win32',
  })
  if (formatted.error !== undefined) return { code: 1, message: `post-edit: cannot run npx — ${formatted.error.message}` }
  if (formatted.status !== 0) {
    const output = `${formatted.stderr}${formatted.stdout}`.trim()
    // A file Prettier cannot parse is the agent's to fix; anything else is the tooling's.
    return { code: /SyntaxError/u.test(output) ? 2 : 1, message: `${rel}: Prettier failed\n${output}` }
  }
  return { code: 0, message: '' }
}

/**
 * Read the payload from stdin and run the hook.
 * @returns Process exit code.
 */
function main() {
  let payload
  try {
    payload = JSON.parse(readFileSync(0, 'utf8'))
  } catch {
    return 0
  }
  const { code, message } = postEdit(payload, resolve(process.env.CLAUDE_PROJECT_DIR ?? PACKAGE_ROOT))
  if (message !== '') process.stderr.write(`${message}\n`)
  return code
}

process.exitCode = main()
