/** Shared helpers for the scaffolder's own tests. */

import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
export const CLI = join(PACKAGE_ROOT, 'src', 'cli.mjs')

/**
 * Environment that keeps a Git invocation off the developer's real config.
 *
 * `GIT_CONFIG_GLOBAL` takes precedence over `HOME` and `XDG_CONFIG_HOME`, so a
 * test that isolates only those still reads the caller's global configuration —
 * and a global `commit.gpgsign`, `core.hooksPath`, or user identity changes what
 * the test does. Every Git spawn in the suite goes through here.
 *
 * @param configPath - Absolute path to the sandbox's global config file.
 * @param extra - Additional environment variables to set.
 * @returns Environment variables for a sandboxed Git invocation.
 */
export function gitConfigEnv(configPath, extra = {}) {
  return { ...process.env, ...extra, GIT_CONFIG_GLOBAL: configPath, GIT_CONFIG_NOSYSTEM: '1' }
}

/**
 * Create a throwaway directory containing an empty Git repository.
 * @returns Absolute path to the sandbox.
 */
export function makeSandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'agent-init-test-'))
  spawnSync('git', ['init', '-q'], { cwd: dir })
  return dir
}

/**
 * Remove a sandbox created by `makeSandbox`.
 * @param dir - Absolute sandbox path.
 */
export function removeSandbox(dir) {
  rmSync(dir, { recursive: true, force: true })
}

/**
 * Run the scaffold CLI.
 * @param args - Arguments after the script path.
 * @param cwd - Working directory for the child process.
 * @param env - Extra environment variables, for a run that must not read the real `$HOME`.
 * @returns Exit code and combined output.
 */
export function runCli(args, cwd = PACKAGE_ROOT, env = {}) {
  const result = spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env: { ...process.env, ...env } })
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/**
 * Run one gate inside a scaffolded repository.
 * @param repo - Absolute path to the scaffolded repository.
 * @param script - Gate filename under `scripts/gates`.
 * @returns Exit code and combined output.
 */
export function runGate(repo, script) {
  const result = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', script)], {
    cwd: repo,
    encoding: 'utf8',
  })
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/**
 * Run the whole gate suite inside a scaffolded repository.
 * @param repo - Absolute path to the scaffolded repository.
 * @param group - `commit` or `full`.
 * @returns Exit code and combined output.
 */
export function runSuite(repo, group = 'full') {
  const result = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'run.mjs'), '--group', group], {
    cwd: repo,
    encoding: 'utf8',
  })
  return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}` }
}

/**
 * Scaffold a repository into a fresh sandbox.
 * @param args - Extra CLI arguments.
 * @returns Absolute path to the scaffolded repository.
 */
export function scaffold(args = []) {
  const repo = makeSandbox()
  const result = runCli(['.', ...args], repo)
  if (result.code !== 0) {
    removeSandbox(repo)
    throw new Error(`scaffold failed (${result.code}):\n${result.output}`)
  }
  return repo
}

/**
 * Whether a command runs.
 * @param command - Executable name.
 * @param args - Arguments that make it exit successfully when present.
 * @returns True when the command is available.
 */
export function available(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return result.status === 0
}

export const HAS_GO = available('go', ['version'])
export const HAS_CARGO = available('cargo', ['--version'])
export const HAS_PYTHON = ['python3', 'python'].some(candidate => available(candidate, ['-c', 'import ast']))

/**
 * The TypeScript compiler's package directory, when one is installed where a
 * test can reach it.
 *
 * `verify-typescript-doc-comments` reads the compiler from the repository it
 * judges, so a sandbox needs a real one linked into its `node_modules`; a stub
 * cannot parse a syntax tree. Continuous integration installs TypeScript
 * globally for exactly that reason, and a developer machine may have it in this
 * package's own `node_modules` instead. Neither is required, so a test that
 * needs it skips rather than failing where both are absent.
 *
 * @returns Absolute path to a `typescript` package directory, or null.
 */
function typescriptPackage() {
  const globalRoot = spawnSync('npm', ['root', '--global'], { encoding: 'utf8' })
  // `npm root --global` already names a `node_modules` directory, so only the
  // package-local candidate needs that segment appended.
  const candidates = [join(PACKAGE_ROOT, 'node_modules', 'typescript')]
  if (globalRoot.status === 0 && globalRoot.stdout.trim() !== '') candidates.push(join(globalRoot.stdout.trim(), 'typescript'))
  const require = createRequire(import.meta.url)
  for (const dir of candidates) {
    if (!existsSync(join(dir, 'package.json'))) continue
    try {
      // TypeScript 7 exports only its version from the package root, so a
      // package without the compiler API is not one the gate can analyze with;
      // keep looking rather than linking a compiler it will refuse.
      if (typeof require(dir).createSourceFile === 'function') return dir
    } catch {
      // Unreadable or unusable: the next candidate may still work.
    }
  }
  return null
}

/** The TypeScript compiler a test can link into a sandbox, or null. */
export const TYPESCRIPT = typescriptPackage()
