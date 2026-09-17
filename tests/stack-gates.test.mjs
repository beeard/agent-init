/**
 * The stack gates, proved by negative control.
 *
 * Each gate delegates to a language's own tooling, so each test skips when that
 * toolchain is absent rather than failing on a machine that cannot run it. A
 * skipped test is reported as skipped, never as a pass.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { removeSandbox, runGate, scaffold, PACKAGE_ROOT } from './helpers.mjs'

/**
 * Whether a command runs.
 * @param command - Executable name.
 * @param args - Arguments that make it exit successfully when present.
 * @returns True when the command is available.
 */
function available(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8' })
  return result.status === 0
}

const HAS_GO = available('go', ['version'])
const HAS_CARGO = available('cargo', ['--version'])

/**
 * Write a file into a scaffolded repository.
 * @param repo - Absolute repository path.
 * @param relPath - Path below the repository root.
 * @param content - File contents.
 */
function write(repo, relPath, content) {
  const abs = join(repo, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

test('go: a documented declaration passes and an undocumented one is reported', { skip: !HAS_GO && 'go is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'go', '--no-hooks'])
  try {
    write(repo, 'go.mod', 'module example.com/demo\n\ngo 1.22\n')
    write(repo, 'demo/documented.go', '// Package demo holds code.\npackage demo\n\n// Total sums.\nfunc Total() int { return 0 }\n\nfunc private() {}\n')
    assert.equal(runGate(repo, 'verify-go-docstrings.mjs').code, 0)

    write(repo, 'demo/bare.go', 'package demo\n\nfunc Exported() {}\n\nfunc (s Store) Method() {}\n')
    const result = runGate(repo, 'verify-go-docstrings.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /function Exported/u)
    // A method on an unexported receiver is reachable through a constructor.
    assert.match(result.output, /method Store\.Method/u)
    assert.doesNotMatch(result.output, /private/u)
  } finally {
    removeSandbox(repo)
  }
})

test('go: the analysis program stays out of the module build', { skip: !HAS_GO && 'go is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'go', '--no-hooks'])
  try {
    write(repo, 'go.mod', 'module example.com/demo\n\ngo 1.22\n')
    write(repo, 'demo/demo.go', '// Package demo holds code.\npackage demo\n\n// Nothing does nothing.\nfunc Nothing() {}\n')
    for (const args of [['build', './...'], ['vet', './...']]) {
      const result = spawnSync('go', args, { cwd: repo, encoding: 'utf8' })
      assert.equal(result.status, 0, `go ${args.join(' ')} failed: ${result.stderr}`)
    }
    // The build tag is what keeps the analysis program out of the module. Both
    // commands above exit 0 whether or not it is present, so `go list` is the
    // only one that shows the package appearing.
    const list = spawnSync('go', ['list', './...'], { cwd: repo, encoding: 'utf8' })
    assert.equal(list.status, 0, list.stderr)
    assert.doesNotMatch(list.stdout, /scripts\/gates/u)
  } finally {
    removeSandbox(repo)
  }
})

test('go: a missing toolchain fails loud with the way out', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'go', '--no-hooks'])
  try {
    write(repo, 'go.mod', 'module example.com/demo\n\ngo 1.22\n')
    write(repo, 'demo/demo.go', 'package demo\n')
    const result = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-go-docstrings.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/nonexistent' },
    })
    assert.equal(result.status, 1)
    assert.match(`${result.stdout}${result.stderr}`, /no Go toolchain found/u)
  } finally {
    removeSandbox(repo)
  }
})

test('rust: an unenabled lint fails loud rather than reporting a clean run', { skip: !HAS_CARGO && 'cargo is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'rust', '--no-hooks'])
  try {
    write(repo, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
    write(repo, 'src/lib.rs', '//! Demo.\n\npub fn undocumented() {}\n')
    const result = runGate(repo, 'verify-rust-doc-comments.mjs')
    assert.equal(result.code, 1)
    // Without the attribute the lint produces nothing, and an empty report
    // would read as a pass.
    assert.match(result.output, /missing_docs lint is not enabled/u)
    assert.match(result.output, /src\/lib\.rs/u)
  } finally {
    removeSandbox(repo)
  }
})

test('rust: documented items pass and undocumented public items are reported', { skip: !HAS_CARGO && 'cargo is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'rust', '--no-hooks'])
  try {
    write(repo, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
    write(repo, 'src/lib.rs', '//! Demo.\n#![warn(missing_docs)]\n\n/// Documented.\npub fn documented() {}\n\nfn private() {}\n')
    assert.equal(runGate(repo, 'verify-rust-doc-comments.mjs').code, 0)

    // A module only enters the crate once it is declared, which is Rust's own
    // rule rather than a limitation of the gate.
    write(repo, 'src/lib.rs', '//! Demo.\n#![warn(missing_docs)]\n\n/// Documented.\npub fn documented() {}\n\n/// The bare module.\npub mod bare;\n\nfn private() {}\n')
    write(repo, 'src/bare.rs', '//! Bare.\n\npub fn bare() {}\n')
    const result = runGate(repo, 'verify-rust-doc-comments.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /pub fn bare\(\)/u)
    // The lint reports only public items.
    assert.doesNotMatch(result.output, /private/u)
  } finally {
    removeSandbox(repo)
  }
})

test('typescript: a missing compiler fails loud with the install command', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    write(repo, 'package.json', '{"name":"demo"}\n')
    write(repo, 'src/index.ts', 'export function undocumented(): void {}\n')
    const result = runGate(repo, 'verify-typescript-doc-comments.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /cannot load the TypeScript compiler/u)
    assert.match(result.output, /npm install --save-dev typescript/u)
  } finally {
    removeSandbox(repo)
  }
})

test('every stack layer registers its gate without replacing the base inventory', () => {
  // The groups are the README's table: rust compiles a crate and the typecheck
  // reads the whole program, so both stay out of the commit hook, while the
  // rest run on every commit.
  const expectedGates = {
    go: { 'verify-go-docstrings.mjs': ['commit', 'full'] },
    python: { 'verify-python-docstrings.mjs': ['commit', 'full'] },
    rust: { 'verify-rust-doc-comments.mjs': ['full'] },
    typescript: {
      'verify-typescript-doc-comments.mjs': ['commit', 'full'],
      'verify-typescript-types.mjs': ['full'],
    },
  }
  // Derived from the base manifest rather than a copied list, so adding a base
  // gate does not require editing this test.
  const baseGates = Object.keys(JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'templates', 'base', 'scripts', 'gates', 'gates.json'), 'utf8'),
  ))
  for (const stack of Object.keys(expectedGates)) {
    const repo = scaffold(['--name', 'demo', '--stack', stack, '--no-hooks'])
    try {
      const gates = JSON.parse(readFileSync(join(repo, 'scripts', 'gates', 'gates.json'), 'utf8'))
      for (const name of baseGates) assert.ok(Object.hasOwn(gates, name), `${stack} dropped the base gate ${name}`)
      const added = Object.keys(gates).filter(name => !baseGates.includes(name)).sort()
      assert.deepEqual(added, Object.keys(expectedGates[stack]).sort(), `${stack} registered the wrong gates`)
      for (const [name, groups] of Object.entries(expectedGates[stack])) {
        assert.equal(gates[name].advisory, true, `${name} must ship advisory`)
        assert.deepEqual(gates[name].groups, groups, `${name} is in the wrong groups`)
      }
    } finally {
      removeSandbox(repo)
    }
  }
})

test('rust: a file the crate does not declare is not reported', { skip: !HAS_CARGO && 'cargo is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'rust', '--no-hooks'])
  try {
    write(repo, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
    write(repo, 'src/lib.rs', '//! Demo.\n#![warn(missing_docs)]\n')
    // Never declared with `mod`, so it is not part of the crate and the
    // compiler cannot see it. Reporting it would mean guessing at Rust's
    // module resolution rather than using the compiler's, and the order this
    // gate takes is that the compiler decides what the crate contains.
    write(repo, 'src/orphan.rs', 'pub fn orphan() {}\n')
    assert.equal(runGate(repo, 'verify-rust-doc-comments.mjs').code, 0)
  } finally {
    removeSandbox(repo)
  }
})

/**
 * Write a stub `typescript` package into a repository.
 *
 * The gate must be tested without making this package depend on TypeScript, so
 * the stub answers the two questions the gate asks: where the CLI is, and what
 * exit code it produced.
 *
 * @param repo - Absolute repository path.
 */
function stubCompiler(repo) {
  const dir = join(repo, 'node_modules', 'typescript')
  mkdirSync(join(dir, 'lib'), { recursive: true })
  writeFileSync(join(dir, 'package.json'), '{"name":"typescript","version":"0.0.0","main":"lib/typescript.js"}\n', 'utf8')
  writeFileSync(join(dir, 'lib', 'typescript.js'), 'module.exports = {}\n', 'utf8')
  writeFileSync(join(dir, 'lib', 'tsc.js'),
    'if (process.env.FAKE_TSC_EXIT) { console.error("src/index.ts(1,14): error TS2322: stub"); process.exit(1) }\nprocess.exit(0)\n',
    'utf8')
}

test('typescript: no TypeScript file means nothing to type-check', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    const result = runGate(repo, 'verify-typescript-types.mjs')
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /0 file\(s\) checked/u)
  } finally {
    removeSandbox(repo)
  }
})

test('typescript: the typecheck gate fails loud without a tsconfig', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    write(repo, 'src/index.ts', 'export const x: number = 1\n')
    unlinkSync(join(repo, 'tsconfig.json'))
    const result = runGate(repo, 'verify-typescript-types.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /no tsconfig\.json/u)
  } finally {
    removeSandbox(repo)
  }
})

test('typescript: the typecheck gate fails loud without the compiler', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    write(repo, 'src/index.ts', 'export const x: number = 1\n')
    const result = runGate(repo, 'verify-typescript-types.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /cannot load the TypeScript compiler/u)
    assert.match(result.output, /npm install --save-dev typescript/u)
  } finally {
    removeSandbox(repo)
  }
})

test('typescript: the typecheck gate covers .mts and .cts when the config is silent', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    const configPath = join(repo, 'scripts', 'gates', 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    delete config.typescriptGlobs
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    write(repo, 'src/mod.mts', 'export const x: number = 1\n')
    stubCompiler(repo)
    const result = runGate(repo, 'verify-typescript-types.mjs')
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /1 file\(s\) checked/u)
  } finally {
    removeSandbox(repo)
  }
})

test('typescript: the typecheck gate reports the compiler it spawns', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    write(repo, 'src/index.ts', 'export const x: number = 1\n')
    stubCompiler(repo)
    const passed = runGate(repo, 'verify-typescript-types.mjs')
    assert.equal(passed.code, 0, passed.output)

    const failed = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-typescript-types.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, FAKE_TSC_EXIT: '1' },
    })
    assert.equal(failed.status, 1)
    assert.match(`${failed.stdout}${failed.stderr}`, /error TS2322/u)
  } finally {
    removeSandbox(repo)
  }
})
