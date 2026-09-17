/**
 * Type-check the project with the project's own compiler.
 *
 * The analysis is `tsc --noEmit` run against the repository's own
 * `tsconfig.json`, so the check is the compiler's rather than a reimplementation
 * of it. The compiler is resolved from the repository's dependencies, not this
 * package's: a TypeScript project already has it.
 *
 * A missing `tsconfig.json` or an unresolvable compiler is named rather than
 * reported as a clean run. `--staged` is accepted and ignored: a type error is
 * a property of the whole program, not of one file, so there is no honest
 * per-file subset to check.
 */

import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { collectFiles, isMain, readConfig } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/**
 * Resolve which files the project holds.
 *
 * The corpus answers whether there is anything to type-check at all; the
 * compiler still reads its own `tsconfig.json` to decide what the program is.
 *
 * @param root - Absolute repository root.
 * @returns Matched files.
 */
function selectFiles(root) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const globs = config.typescriptGlobs ?? ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts']
  const excluded = new Set(config.typescriptSkipDirectories ?? [])
  const isSkipped = relPath => relPath.split('/').some(segment => excluded.has(segment))
  return collectFiles(root, globs, isSkipped)
}

/**
 * Find the compiler's command-line entry beside the resolved package.
 * @param root - Absolute repository root.
 * @returns Absolute path to the CLI, or an error message.
 */
function compilerCli(root) {
  try {
    const entry = createRequire(join(root, 'package.json')).resolve('typescript')
    const cli = join(dirname(entry), 'tsc.js')
    if (existsSync(cli)) return { cli, error: null }
    const bin = join(dirname(dirname(entry)), 'bin', 'tsc')
    if (existsSync(bin)) return { cli: bin, error: null }
    return { cli: null, error: `resolved typescript at ${entry} but found no tsc entry beside it` }
  } catch (error) {
    return { cli: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Type-check the repository.
 * @param root - Absolute repository root.
 * @returns The file count, the compiler output, and any fatal error message.
 */
export function checkTypes(root) {
  const files = selectFiles(root)
  if (files.length === 0) return { checked: 0, output: '', fatal: null }

  const configPath = resolve(root, 'tsconfig.json')
  if (!existsSync(configPath)) {
    return {
      checked: files.length,
      output: '',
      fatal: 'no tsconfig.json at the repository root; scaffold with --stack typescript, or add one',
    }
  }

  const { cli, error } = compilerCli(root)
  if (cli === null) {
    return {
      checked: files.length,
      output: '',
      fatal: `cannot load the TypeScript compiler (${error}); install it with "npm install --save-dev typescript", or remove this gate from scripts/gates/gates.json`,
    }
  }

  const result = spawnSync(process.execPath, [cli, '--noEmit', '--pretty', 'false', '-p', configPath], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  })
  // A spawn failure, a kill signal, or output past `maxBuffer` leaves no status
  // to read, so it is named as the failure it is rather than reported as a type
  // error the compiler never produced.
  if (result.error !== undefined || typeof result.status !== 'number') {
    const reason = result.error?.message ?? `terminated by ${String(result.signal)}`
    return { checked: files.length, output: '', fatal: `cannot run the TypeScript compiler: ${reason}` }
  }
  if (result.status === 0) return { checked: files.length, output: '', fatal: null }
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() || `tsc exited with status ${String(result.status)}`
  return { checked: files.length, output, fatal: null }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { checked, output, fatal } = checkTypes(ROOT)
  if (fatal !== null) {
    console.error(`verify-typescript-types: ${fatal}`)
    return 1
  }
  if (output === '') {
    console.log(`verify-typescript-types: ${checked} file(s) checked, the project type-checks.`)
    return 0
  }
  console.error('verify-typescript-types: the project does not type-check:')
  for (const line of output.split('\n')) console.error(`  ${line}`)
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}
