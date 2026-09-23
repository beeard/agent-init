/**
 * Report the explicit scope of a change: what is committed relative to a merge
 * base, and what is still sitting in the worktree.
 *
 * The base is never guessed and never fetched. Supplying the wrong base is the
 * one failure this tool cannot detect for you, so it reports the exact SHAs it
 * resolved and lets the caller verify them.
 *
 * Usage: node scripts/gates/change-scope.mjs --base origin/main [--head HEAD]
 */

import { spawnSync } from 'node:child_process'
import { parseArgs, TextDecoder } from 'node:util'
import { isMain } from './lib/repo-files.mjs'

const FORMAT_VERSION = 1
const MAX_GIT_OUTPUT = 64 * 1024 * 1024
const UTF8 = new TextDecoder('utf-8', { fatal: true })

/**
 * Run Git and return decoded output.
 * @param cwd - Directory inside the worktree.
 * @param args - Git arguments.
 * @returns Status, stdout, and stderr.
 */
function git(cwd, args) {
  const result = spawnSync('git', ['-C', cwd, '-c', 'core.fsmonitor=false', ...args], {
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0', LANG: 'C', LC_ALL: 'C' },
    maxBuffer: MAX_GIT_OUTPUT,
  })
  return {
    status: result.status,
    stdout: result.stdout ?? Buffer.alloc(0),
    stderr: (result.stderr ?? Buffer.alloc(0)).toString('utf8').trim(),
    error: result.error,
  }
}

/**
 * Run Git and require success, returning decoded UTF-8 text.
 * @param cwd - Directory inside the worktree.
 * @param args - Git arguments.
 * @param context - Failure description.
 * @returns Decoded stdout.
 */
function requireText(cwd, args, context) {
  const result = git(cwd, args)
  if (result.status !== 0) throw new Error(`${context}: ${result.error?.message ?? (result.stderr || `git exited ${String(result.status)}`)}`)
  try {
    return UTF8.decode(result.stdout)
  } catch {
    throw new Error(`${context}: Git output is not valid UTF-8`)
  }
}

/**
 * Run Git and require success, returning raw bytes.
 * @param cwd - Directory inside the worktree.
 * @param args - Git arguments.
 * @param context - Failure description.
 * @returns Raw stdout.
 */
function requireBytes(cwd, args, context) {
  const result = git(cwd, args)
  if (result.status !== 0) throw new Error(`${context}: ${result.error?.message ?? (result.stderr || `git exited ${String(result.status)}`)}`)
  return result.stdout
}

/**
 * Split NUL-delimited Git output into a sorted, deduplicated path list.
 * @param output - Raw Git output.
 * @param context - Failure description.
 * @returns Repository-relative paths.
 */
function parsePathSet(output, context) {
  const paths = []
  let start = 0
  let record = 0
  for (let index = 0; index < output.length; index++) {
    if (output[index] !== 0) continue
    if (index > start) {
      record++
      try {
        paths.push(UTF8.decode(output.subarray(start, index)))
      } catch {
        throw new Error(`${context}: Git path ${record} is not valid UTF-8`)
      }
    }
    start = index + 1
  }
  return [...new Set(paths)].sort()
}

/**
 * List the paths a diff touches.
 * @param root - Absolute worktree root.
 * @param args - Revision arguments for `git diff`.
 * @param context - Failure description.
 * @returns Repository-relative paths.
 */
function diffPaths(root, args, context) {
  return parsePathSet(
    requireBytes(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--ignore-submodules=none', '--name-only', '-z', ...args, '--'], context),
    context,
  )
}

/**
 * Resolve one ref to exactly one commit, rejecting ambiguity.
 * @param root - Absolute worktree root.
 * @param label - `base` or `head`, for messages.
 * @param ref - The ref to resolve.
 * @returns The commit SHA.
 */
function resolveCommit(root, label, ref) {
  const result = git(root, ['-c', 'core.warnAmbiguousRefs=true', 'rev-parse', '--verify', '--end-of-options', `${ref}^{commit}`])
  if (/\bambiguous\b/iu.test(result.stderr)) {
    throw new Error(`${label} ref ${JSON.stringify(ref)} is ambiguous; qualify it or use a commit ID`)
  }
  if (result.status !== 0) throw new Error(`${label} ref ${JSON.stringify(ref)} does not resolve to a commit`)
  const commits = result.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean)
  if (commits.length !== 1) throw new Error(`${label} ref ${JSON.stringify(ref)} did not resolve to exactly one commit`)
  return commits[0]
}

/**
 * Collect the complete change-scope report.
 * @param options - `base` and `head` refs.
 * @param cwd - Directory whose worktree is inspected.
 * @returns The versioned report object.
 */
function collectReport(options, cwd) {
  const root = requireText(cwd, ['rev-parse', '--show-toplevel'], 'cannot locate a Git worktree').trim()
  const baseSha = resolveCommit(root, 'base', options.base)
  const headSha = resolveCommit(root, 'head', options.head)

  const mergeBase = git(root, ['merge-base', '--all', baseSha, headSha])
  if (mergeBase.status !== 0) throw new Error('base and head do not share a merge base')
  const mergeBases = mergeBase.stdout.toString('utf8').trim().split(/\r?\n/u).filter(Boolean)
  if (mergeBases.length !== 1) throw new Error(`base and head have ${mergeBases.length} merge bases; not a unique answer`)
  const mergeBaseSha = mergeBases[0]

  return {
    formatVersion: FORMAT_VERSION,
    repositoryRoot: root,
    input: { base: options.base, head: options.head },
    resolved: { baseSha, headSha, mergeBaseSha },
    paths: {
      committed: diffPaths(root, [mergeBaseSha, headSha], 'cannot inspect committed paths'),
      staged: diffPaths(root, ['--cached'], 'cannot inspect staged paths'),
      unstaged: diffPaths(root, [], 'cannot inspect unstaged paths'),
      untracked: parsePathSet(
        requireBytes(root, ['ls-files', '--others', '--exclude-standard', '-z', '--'], 'cannot inspect untracked paths'),
        'cannot inspect untracked paths',
      ),
    },
  }
}

/**
 * Parse and validate command-line arguments.
 * @param argv - Arguments after the script path.
 * @returns The `base` and `head` refs.
 */
function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    allowPositionals: false,
    options: {
      base: { type: 'string' },
      head: { type: 'string', default: 'HEAD' },
    },
    strict: true,
  })
  if (values.base === undefined) {
    throw new Error('missing required --base <ref>; this tool never guesses a base')
  }
  return { base: values.base, head: values.head }
}

/**
 * Run the tool as a command.
 * @returns Process exit code.
 */
function main() {
  try {
    const options = parseCli(process.argv.slice(2))
    const report = collectReport(options, process.cwd())
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    return 0
  } catch (error) {
    process.stderr.write(`change-scope: ${error instanceof Error ? error.message : String(error)}\n`)
    return 1
  }
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}

/** Exported for tests. */
export { collectReport, parseCli }
