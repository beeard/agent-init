/**
 * Claude Code PostToolUse hook: check the file an agent just wrote.
 *
 * Reads the hook payload on stdin and runs every check in `post-edit.json`
 * whose `extensions` name the edited file's extension (`*` names every file):
 * the required checks first, then the optional ones, each in manifest order. A
 * check is an argument vector in `run`:
 *
 * - `{file}` is the edited file, `{hooks}` this directory, `{node}` this Node.
 * - The first element may be a list of candidates; the first one that starts is used.
 * - `optional: true` skips the check silently when its program is not installed,
 *   which is how a formatter the repository may or may not use is declared.
 * - `exclude` lists paths or basenames, with `*`, the check never judges.
 *
 * Every check runs with the project root as its working directory.
 *
 * Exit codes follow the hook contract. 0 is clean. 2 is a check that rejected
 * the file: the agent broke it, and stderr, which Claude Code hands back to the
 * agent, says how. 1 is a check that could not run, such as a toolchain that is
 * not installed, or one that exits 127: the edit is not blocked, and the user
 * is told what is missing. A hook that cannot check a file never reports it clean.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, extname, isAbsolute, relative, resolve, sep } from 'node:path'

const HOOKS = import.meta.dirname
const MANIFEST = resolve(HOOKS, 'post-edit.json')

/** A check that runs longer than this is stopped and reported as unable to run. */
const TIMEOUT_MS = 60_000

/**
 * Whether a repository-relative path matches one `exclude` pattern.
 * @param rel - Slash-separated path relative to the project root.
 * @param pattern - A path, or a basename when it has no slash; `*` matches within a segment.
 * @returns True on a match.
 */
function excluded(rel, pattern) {
  const expression = new RegExp(`^${pattern.replace(/[.+?^${}()|[\]\\]/gu, '\\$&').replace(/\*/gu, '[^/]*')}$`, 'u')
  return pattern.includes('/') ? expression.test(rel) || rel.startsWith(`${pattern.replace(/\/\*$/u, '')}/`) : expression.test(basename(rel))
}

/**
 * Start one check against the file.
 * @param check - The manifest entry.
 * @param tokens - Values for `{file}`, `{hooks}`, and `{node}`.
 * @param projectDir - Absolute project root.
 * @returns `{ status, output }`, or `{ missing }` when no candidate program could be started.
 */
function runCheck(check, tokens, projectDir) {
  const fill = value => value.replace(/\{(file|hooks|node)\}/gu, (_, name) => tokens[name])
  const [head, ...rest] = check.run
  const args = rest.map(fill)
  const candidates = (Array.isArray(head) ? head : [head]).map(fill)
  for (const candidate of candidates) {
    // A relative program path names a file in the project, such as a local install.
    const program = candidate.includes('/') && !isAbsolute(candidate) ? resolve(projectDir, candidate) : candidate
    if (program !== candidate && !existsSync(program)) continue
    const result = spawnSync(program, args, {
      cwd: projectDir,
      encoding: 'utf8',
      timeout: TIMEOUT_MS,
      shell: process.platform === 'win32' && program.endsWith('.cmd'),
    })
    if (result.error?.code === 'ENOENT') continue
    if (result.error !== undefined) return { status: 127, output: result.error.message }
    return { status: result.status ?? 127, output: `${result.stderr ?? ''}${result.stdout ?? ''}`.trim() }
  }
  return { missing: candidates.join(' or ') }
}

/**
 * Check one edited file.
 * @param payload - The parsed hook payload.
 * @param projectDir - Absolute project root; files outside it are left alone.
 * @returns Exit code and the message for it.
 */
function postEdit(payload, projectDir) {
  const named = payload?.tool_input?.file_path ?? payload?.tool_response?.filePath
  if (typeof named !== 'string' || named === '') return { code: 0, message: '' }
  const file = resolve(projectDir, named)
  const rel = relative(projectDir, file).split(sep).join('/')
  if (rel === '' || rel === '..' || rel.startsWith('../') || isAbsolute(rel) || !existsSync(file)) return { code: 0, message: '' }

  let manifest
  try {
    manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'))
  } catch (error) {
    return { code: 1, message: `post-edit: cannot read ${relative(projectDir, MANIFEST)} — ${error instanceof Error ? error.message : String(error)}` }
  }

  const ext = extname(file).toLowerCase()
  const tokens = { file, hooks: HOOKS, node: process.execPath }
  const unable = []
  const checks = Object.entries(manifest.checks ?? {}).sort(([, a], [, b]) => Number(a.optional === true) - Number(b.optional === true))
  for (const [name, check] of checks) {
    const extensions = check.extensions ?? []
    if (!extensions.includes('*') && !extensions.includes(ext)) continue
    if ((check.exclude ?? []).some(pattern => excluded(rel, pattern))) continue
    const result = runCheck(check, tokens, projectDir)
    if (result.missing !== undefined) {
      if (check.optional !== true) unable.push(`${name}: ${result.missing} is not installed`)
      continue
    }
    if (result.status === 127) {
      unable.push(`${name}: could not run${result.output === '' ? '' : ` — ${result.output}`}`)
      continue
    }
    if (result.status !== 0) return { code: 2, message: `${rel}: rejected by ${name}${result.output === '' ? '' : `\n${result.output}`}` }
  }
  if (unable.length > 0) {
    return { code: 1, message: `post-edit: ${rel} was not fully checked\n${unable.map(line => `  ${line}`).join('\n')}` }
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
  const { code, message } = postEdit(payload, resolve(process.env.CLAUDE_PROJECT_DIR ?? resolve(HOOKS, '..', '..')))
  if (message !== '') process.stderr.write(`${message}\n`)
  return code
}

process.exitCode = main()
