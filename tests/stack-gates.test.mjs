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
import { mkdirSync, readFileSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { HAS_CARGO, HAS_GO, HAS_PYTHON, TYPESCRIPT, removeSandbox, runGate, scaffold, PACKAGE_ROOT } from './helpers.mjs'

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
    for (const args of [
      ['build', './...'],
      ['vet', './...'],
    ]) {
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

test('go: test files are not public API and are not analyzed', { skip: !HAS_GO && 'go is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'go', '--no-hooks'])
  try {
    write(repo, 'go.mod', 'module example.com/demo\n\ngo 1.22\n')
    write(repo, 'demo/demo.go', '// Package demo holds code.\npackage demo\n\n// Add adds.\nfunc Add() int { return 1 }\n')
    write(repo, 'demo/demo_test.go', 'package demo\n\nimport "testing"\n\nfunc TestAdd(t *testing.T) {}\n')
    // An external test package has no package comment by convention.
    write(repo, 'demo/external_test.go', 'package demo_test\n\nimport "testing"\n\nfunc TestExternal(t *testing.T) {}\n')
    const result = runGate(repo, 'verify-go-docstrings.mjs')
    assert.equal(result.code, 0, result.output)
  } finally {
    removeSandbox(repo)
  }
})

test('go: a skipped region is outside the corpus', { skip: !HAS_GO && 'go is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'go', '--no-hooks'])
  try {
    write(repo, 'go.mod', 'module example.com/demo\n\ngo 1.22\n')
    write(repo, 'node_modules/tool/tool.go', 'package tool\n\nfunc Exported() {}\n')
    write(repo, 'generated/gen.go', 'package generated\n\nfunc Generated() {}\n')
    const configPath = join(repo, 'scripts', 'gates', 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.skipGlobs = [...config.skipGlobs, 'generated/**']
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    const passed = runGate(repo, 'verify-go-docstrings.mjs')
    assert.equal(passed.code, 0, passed.output)

    // The same file outside those regions is judged, so the pass above is the
    // skip list at work rather than a gate that saw nothing.
    write(repo, 'tool/tool.go', 'package tool\n\nfunc Exported() {}\n')
    const failed = runGate(repo, 'verify-go-docstrings.mjs')
    assert.equal(failed.code, 1)
    assert.match(failed.output, /tool\/tool\.go.*function Exported/u)
    assert.doesNotMatch(failed.output, /node_modules|generated/u)
  } finally {
    removeSandbox(repo)
  }
})

test('python: the members of a private class are private with it', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--no-hooks'])
  try {
    write(repo, 'mod.py', '"""Module."""\n\nclass _Hidden:\n    def helper(self):\n        pass\n')
    assert.equal(runGate(repo, 'verify-python-docstrings.mjs').code, 0)

    write(repo, 'mod.py', '"""Module."""\n\nclass Shown:\n    """Shown."""\n\n    def helper(self):\n        pass\n')
    const result = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /method helper/u)
  } finally {
    removeSandbox(repo)
  }
})

test('python: pytest test files are not analysed', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--no-hooks'])
  try {
    write(repo, 'tests/test_mod.py', 'def test_adds():\n    pass\n')
    write(repo, 'mod_test.py', 'def test_adds():\n    pass\n')
    write(repo, 'tests/conftest.py', 'def fixture():\n    pass\n')
    const passed = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(passed.code, 0, passed.output)

    // A module that only resembles a test name is still judged.
    write(repo, 'testing_utils.py', 'def helper():\n    pass\n')
    const failed = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(failed.code, 1)
    assert.match(failed.output, /testing_utils\.py/u)
    assert.doesNotMatch(failed.output, /test_mod|mod_test|conftest/u)
  } finally {
    removeSandbox(repo)
  }
})

test('python: a skipped region is outside the corpus', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--no-hooks'])
  try {
    write(repo, 'node_modules/tool/tool.py', 'def exported():\n    pass\n')
    write(repo, 'generated/gen.py', 'def generated():\n    pass\n')
    const configPath = join(repo, 'scripts', 'gates', 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.skipGlobs = [...config.skipGlobs, 'generated/**']
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    const passed = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(passed.code, 0, passed.output)

    write(repo, 'tool/tool.py', 'def exported():\n    pass\n')
    const failed = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(failed.code, 1)
    assert.match(failed.output, /tool\/tool\.py.*function exported/u)
    assert.doesNotMatch(failed.output, /node_modules|generated/u)
  } finally {
    removeSandbox(repo)
  }
})

test('rust: a crate that never enables the lint is still checked', { skip: !HAS_CARGO && 'cargo is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'rust', '--no-hooks'])
  try {
    write(repo, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
    // A commented-out attribute enables nothing; the gate passes the lint to
    // the compiler itself, so the crate is judged anyway.
    write(repo, 'src/lib.rs', '//! Demo.\n// #![warn(missing_docs)]\n\npub fn undocumented() {}\n')
    const result = runGate(repo, 'verify-rust-doc-comments.mjs')
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, /pub fn undocumented\(\)/u)

    // An attribute that enables the lint alongside another is not misread.
    write(repo, 'src/lib.rs', '//! Demo.\n#![warn(missing_docs, unused)]\n\n/// Documented.\npub fn documented() {}\n')
    const passed = runGate(repo, 'verify-rust-doc-comments.mjs')
    assert.equal(passed.code, 0, passed.output)
  } finally {
    removeSandbox(repo)
  }
})

test('rust: a crate that does not compile fails loud with the compiler error', { skip: !HAS_CARGO && 'cargo is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'rust', '--no-hooks'])
  try {
    write(repo, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
    write(repo, 'src/lib.rs', '//! Demo.\n\n/// Documented.\npub fn documented() -> u32 { "not a number" }\n')
    const result = runGate(repo, 'verify-rust-doc-comments.mjs')
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, /does not compile/u)
    assert.match(result.output, /E0308/u)
  } finally {
    removeSandbox(repo)
  }
})

test('rust: a denied lint is reported as findings, not as a compile failure', { skip: !HAS_CARGO && 'cargo is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'rust', '--no-hooks'])
  try {
    write(repo, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n')
    write(repo, 'src/lib.rs', '//! Demo.\n#![deny(missing_docs)]\n\npub fn undocumented() {}\n')
    const result = runGate(repo, 'verify-rust-doc-comments.mjs')
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, /pub fn undocumented\(\)/u)
    assert.doesNotMatch(result.output, /does not compile/u)
  } finally {
    removeSandbox(repo)
  }
})

test('rust: every workspace member is checked, not only the root package', { skip: !HAS_CARGO && 'cargo is not installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'rust', '--no-hooks'])
  try {
    write(repo, 'Cargo.toml', '[package]\nname = "demo"\nversion = "0.1.0"\nedition = "2021"\n\n[workspace]\nmembers = ["member"]\n')
    write(repo, 'src/lib.rs', '//! Demo.\n\n/// Documented.\npub fn documented() {}\n')
    write(repo, 'member/Cargo.toml', '[package]\nname = "member"\nversion = "0.1.0"\nedition = "2021"\n')
    write(repo, 'member/src/lib.rs', '//! Member.\n\npub fn hidden() {}\n')
    const result = runGate(repo, 'verify-rust-doc-comments.mjs')
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, /member\/src\/lib\.rs:3/u)
    assert.match(result.output, /pub fn hidden\(\)/u)
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
    write(
      repo,
      'src/lib.rs',
      '//! Demo.\n#![warn(missing_docs)]\n\n/// Documented.\npub fn documented() {}\n\n/// The bare module.\npub mod bare;\n\nfn private() {}\n',
    )
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

test('typescript: an export assignment is reported, not a crash', { skip: TYPESCRIPT === null && 'no typescript with the compiler API is installed' }, () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    mkdirSync(join(repo, 'node_modules'), { recursive: true })
    symlinkSync(TYPESCRIPT, join(repo, 'node_modules', 'typescript'), 'dir')

    // `export default` and `export =` reach the same branch; before the fix the
    // gate called a `ts.isExportEquals` that does not exist and died with a
    // TypeError instead of reporting either.
    write(repo, 'src/provider.ts', 'const provider = { id: "demo" }\n\nexport default provider\n')
    const reported = runGate(repo, 'verify-typescript-doc-comments.mjs')
    assert.equal(reported.code, 1, reported.output)
    assert.match(reported.output, /default provider/u)
    assert.doesNotMatch(reported.output, /TypeError/u)

    write(repo, 'src/provider.ts', 'const provider = { id: "demo" }\n\n/** The provider this module exports. */\nexport default provider\n')
    assert.equal(runGate(repo, 'verify-typescript-doc-comments.mjs').code, 0)
  } finally {
    removeSandbox(repo)
  }
})

/**
 * Scaffold a TypeScript repository whose `node_modules` links a real compiler.
 * @returns Absolute repository path.
 */
function typescriptRepo() {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  mkdirSync(join(repo, 'node_modules'), { recursive: true })
  symlinkSync(TYPESCRIPT, join(repo, 'node_modules', 'typescript'), 'dir')
  return repo
}

test(
  'typescript: an undocumented exported function and class are reported',
  { skip: TYPESCRIPT === null && 'no typescript with the compiler API is installed' },
  () => {
    const repo = typescriptRepo()
    try {
      write(
        repo,
        'src/index.ts',
        '/** Adds. */\nexport function add(a: number): number { return a }\n\n/** A store. */\nexport class Store {}\n\nfunction internal(): void {}\n',
      )
      const passed = runGate(repo, 'verify-typescript-doc-comments.mjs')
      assert.equal(passed.code, 0, passed.output)

      write(repo, 'src/index.ts', 'export function add(a: number): number { return a }\n\nexport class Store {}\n\nfunction internal(): void {}\n')
      const result = runGate(repo, 'verify-typescript-doc-comments.mjs')
      assert.equal(result.code, 1, result.output)
      assert.match(result.output, /src\/index\.ts:1 {2}function add/u)
      assert.match(result.output, /src\/index\.ts:3 {2}class Store/u)
      assert.doesNotMatch(result.output, /internal/u)
    } finally {
      removeSandbox(repo)
    }
  },
)

test(
  'typescript: the JSDoc on the first overload covers the group',
  { skip: TYPESCRIPT === null && 'no typescript with the compiler API is installed' },
  () => {
    const repo = typescriptRepo()
    try {
      const signatures =
        'export function fmt(a: string): string\nexport function fmt(a: number): string\nexport function fmt(a: unknown): string { return String(a) }\n'
      write(repo, 'src/index.ts', `/** Formats a value. */\n${signatures}`)
      const passed = runGate(repo, 'verify-typescript-doc-comments.mjs')
      assert.equal(passed.code, 0, passed.output)

      // An undocumented group is one finding, not one per signature.
      write(repo, 'src/index.ts', signatures)
      const result = runGate(repo, 'verify-typescript-doc-comments.mjs')
      assert.equal(result.code, 1, result.output)
      assert.match(result.output, /1 undocumented exported declaration/u)
      assert.match(result.output, /src\/index\.ts:1 {2}function fmt/u)
    } finally {
      removeSandbox(repo)
    }
  },
)

test('typescript: a namespace with a dotted name is walked', { skip: TYPESCRIPT === null && 'no typescript with the compiler API is installed' }, () => {
  const repo = typescriptRepo()
  try {
    write(repo, 'src/index.ts', '/** Outer. */\nexport namespace A.B {\n  export function hidden(): void {}\n}\n')
    const result = runGate(repo, 'verify-typescript-doc-comments.mjs')
    assert.equal(result.code, 1, result.output)
    assert.match(result.output, /function hidden/u)
    assert.doesNotMatch(result.output, /namespace/u)

    write(repo, 'src/index.ts', 'export namespace A.B {\n  /** Documented. */\n  export function shown(): void {}\n}\n')
    const named = runGate(repo, 'verify-typescript-doc-comments.mjs')
    assert.equal(named.code, 1, named.output)
    assert.match(named.output, /namespace A\.B/u)
  } finally {
    removeSandbox(repo)
  }
})

test('typescript: the shared skip globs are outside the corpus', { skip: TYPESCRIPT === null && 'no typescript with the compiler API is installed' }, () => {
  const repo = typescriptRepo()
  try {
    write(repo, 'generated/api.ts', 'export function generated(): void {}\n')
    const configPath = join(repo, 'scripts', 'gates', 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.skipGlobs = [...config.skipGlobs, 'generated/**']
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    const passed = runGate(repo, 'verify-typescript-doc-comments.mjs')
    assert.equal(passed.code, 0, passed.output)

    write(repo, 'src/api.ts', 'export function generated(): void {}\n')
    const failed = runGate(repo, 'verify-typescript-doc-comments.mjs')
    assert.equal(failed.code, 1)
    assert.match(failed.output, /src\/api\.ts/u)
    assert.doesNotMatch(failed.output, /generated\/api\.ts/u)
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
  const baseGates = Object.keys(JSON.parse(readFileSync(join(PACKAGE_ROOT, 'templates', 'base', 'scripts', 'gates', 'gates.json'), 'utf8')))
  for (const stack of Object.keys(expectedGates)) {
    const repo = scaffold(['--name', 'demo', '--stack', stack, '--no-hooks'])
    try {
      const gates = JSON.parse(readFileSync(join(repo, 'scripts', 'gates', 'gates.json'), 'utf8'))
      for (const name of baseGates) assert.ok(Object.hasOwn(gates, name), `${stack} dropped the base gate ${name}`)
      const added = Object.keys(gates)
        .filter(name => !baseGates.includes(name))
        .sort()
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
  writeFileSync(
    join(dir, 'lib', 'tsc.js'),
    'if (process.env.FAKE_TSC_EXIT) { console.error("src/index.ts(1,14): error TS2322: stub"); process.exit(1) }\nprocess.exit(0)\n',
    'utf8',
  )
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
