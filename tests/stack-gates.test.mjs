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
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { removeSandbox, runGate, scaffold } from './helpers.mjs'

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
  for (const stack of ['go', 'rust', 'typescript']) {
    const repo = scaffold(['--name', 'demo', '--stack', stack, '--no-hooks'])
    try {
      const gates = JSON.parse(
        spawnSync(process.execPath, ['-e', `process.stdout.write(require('node:fs').readFileSync('${join(repo, 'scripts', 'gates', 'gates.json')}','utf8'))`], { encoding: 'utf8' }).stdout,
      )
      assert.ok(Object.hasOwn(gates, 'agent-note-tree.mjs'), `${stack} dropped the base gates`)
      const added = Object.keys(gates).filter(name => name !== 'agent-note-tree.mjs'
        && name !== 'verify-agent-note-format.mjs' && name !== 'verify-md-links.mjs'
        && name !== 'verify-md-wrap.mjs' && name !== 'verify-doc-budgets.mjs')
      assert.equal(added.length, 1, `${stack} should register exactly one gate, got ${added.join(', ')}`)
      assert.equal(gates[added[0]].advisory, true, `${stack}'s gate must ship advisory`)
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
    // module resolution rather than using the compiler's.
    write(repo, 'src/orphan.rs', 'pub fn orphan() {}\n')
    assert.equal(runGate(repo, 'verify-rust-doc-comments.mjs').code, 0)
  } finally {
    removeSandbox(repo)
  }
})
