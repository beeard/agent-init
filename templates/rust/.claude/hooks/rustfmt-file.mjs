/**
 * Format one Rust file with rustfmt, at the edition of the crate that owns it.
 *
 * `cargo fmt` formats every file in the crate, and a bare `rustfmt` parses at
 * its own default edition, so neither checks just the file an agent edited.
 * This asks `cargo metadata` which package the file belongs to and hands its
 * edition to `rustfmt`. A file in no package is formatted at rustfmt's default,
 * which `rustfmt.toml` can set.
 *
 * Exits with rustfmt's status: 0 formatted, nonzero when the file does not
 * parse. Exits 127 when rustfmt is not installed.
 */

import { spawnSync } from 'node:child_process'
import { dirname, resolve, sep } from 'node:path'

/**
 * The edition of the package whose directory holds the file.
 * @param file - Absolute path to the Rust file.
 * @returns The edition, or null when no package claims the file.
 */
function editionOf(file) {
  const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1'], {
    cwd: dirname(file),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (metadata.status !== 0) return null
  let owner = null
  for (const pkg of JSON.parse(metadata.stdout).packages ?? []) {
    const root = dirname(pkg.manifest_path)
    // The deepest package directory above the file owns it, so a nested member wins over the workspace root.
    if (file.startsWith(`${root}${sep}`) && (owner === null || root.length > dirname(owner.manifest_path).length)) owner = pkg
  }
  return owner?.edition ?? null
}

const file = resolve(process.argv[2])
const edition = editionOf(file)
const result = spawnSync('rustfmt', [...(edition === null ? [] : ['--edition', edition]), file], { encoding: 'utf8' })
if (result.error !== undefined) {
  console.error(`rustfmt could not run: ${result.error.message}`)
  process.exitCode = 127
} else {
  process.stderr.write(`${result.stderr}${result.stdout}`)
  process.exitCode = result.status ?? 127
}
