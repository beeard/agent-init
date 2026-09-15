/**
 * Gate behaviour, proved by negative control.
 *
 * A gate that only ever runs green is untested. Every test here scaffolds a
 * repository, breaks exactly one thing a gate claims to catch, and asserts that
 * the gate rejects it with a message naming the file.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { removeSandbox, runGate, runSuite, scaffold } from './helpers.mjs'

/** A well-formed implemented record, used as the baseline every mutation breaks. */
const GOOD_RECORD = `# Decision Record: A settled question

Status: implemented

## Problem

Something needed deciding, and the reason it needed deciding stands on its own.

## Decision

It was decided, stated in the present tense.

## Alternatives considered

**Do nothing.** Rejected because the problem did not go away on its own.

## Consequences

It cost a little and bought a lot.
`

/**
 * Run a body against a scaffolded repository, then delete it.
 * @param options - `args` for the scaffolder and `mutate`, a function receiving the repo path.
 * @param body - Receives the scaffolded repository path.
 */
function withRepo({ args = [], mutate = () => {} }, body) {
  const repo = scaffold(args)
  try {
    mutate(repo)
    body(repo)
  } finally {
    removeSandbox(repo)
  }
}

/**
 * Write a decision record into a scaffolded repository.
 * @param repo - Absolute repository path.
 * @param relPath - Path under `.agents/notes`.
 * @param content - File contents.
 */
function writeRecord(repo, relPath, content) {
  const abs = join(repo, '.agents', 'notes', relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

test('a freshly scaffolded repository passes every gate', () => {
  withRepo({ args: ['--with-architecture'] }, (repo) => {
    const result = runSuite(repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /5 gate\(s\) passed/u)
  })
})

test('the fast group runs a strict subset', () => {
  withRepo({}, (repo) => {
    const result = runSuite(repo, 'fast')
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /3 gate\(s\) passed/u)
    assert.doesNotMatch(result.output, /verify-md-wrap/u)
  })
})

test('a well-formed implemented record passes', () => {
  withRepo({ mutate: repo => writeRecord(repo, 'implemented/architecture/2026-01-01-good.md', GOOD_RECORD) },
    (repo) => {
      assert.equal(runGate(repo, 'verify-agent-note-format.mjs').code, 0)
      assert.equal(runGate(repo, 'agent-note-tree.mjs').code, 0)
    })
})

test('a record in an unknown class folder is rejected', () => {
  withRepo({ mutate: repo => writeRecord(repo, 'implemented/bogus/2026-01-01-x.md', GOOD_RECORD) }, (repo) => {
    const result = runGate(repo, 'agent-note-tree.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /unknown class folder "bogus"/u)
  })
})

test('a record with a bad filename is rejected', () => {
  withRepo({ mutate: repo => writeRecord(repo, 'implemented/architecture/no-date.md', GOOD_RECORD) }, (repo) => {
    const result = runGate(repo, 'agent-note-tree.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /filename must be yyyy-mm-dd-topic\.md/u)
  })
})

test('a record outside a lifecycle/class layout is rejected', () => {
  withRepo({ mutate: repo => writeRecord(repo, 'implemented/2026-01-01-flat.md', GOOD_RECORD) }, (repo) => {
    const result = runGate(repo, 'agent-note-tree.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /expected \{lifecycle\}\/\{class\}\/file\.md/u)
  })
})

test('a record with no alternatives section is rejected', () => {
  const withoutAlternatives = GOOD_RECORD.replace(/## Alternatives considered\n\n\*\*Do nothing\.\*\*[^\n]*\n\n/u, '')
  withRepo({ mutate: repo => writeRecord(repo, 'implemented/architecture/2026-01-01-good.md', withoutAlternatives) },
    (repo) => {
      const result = runGate(repo, 'verify-agent-note-format.mjs')
      assert.equal(result.code, 1)
      assert.match(result.output, /missing `## Alternatives considered`/u)
    })
})

test('a proposal-era heading in an implemented record is rejected', () => {
  const withProposal = GOOD_RECORD.replace('## Decision', '## Proposal')
  withRepo({ mutate: repo => writeRecord(repo, 'implemented/architecture/2026-01-01-good.md', withProposal) },
    (repo) => {
      const result = runGate(repo, 'verify-agent-note-format.mjs')
      assert.equal(result.code, 1)
      assert.match(result.output, /proposal-era heading/u)
    })
})

test('a status that disagrees with its folder is rejected', () => {
  const wrongStatus = GOOD_RECORD.replace('Status: implemented', 'Status: proposed')
  withRepo({ mutate: repo => writeRecord(repo, 'implemented/architecture/2026-01-01-good.md', wrongStatus) },
    (repo) => {
      const result = runGate(repo, 'verify-agent-note-format.mjs')
      assert.equal(result.code, 1)
      assert.match(result.output, /line 3 must match the implemented status grammar/u)
    })
})

test('a rejected record without a reason is rejected', () => {
  withRepo({ mutate: repo => writeRecord(repo, 'rejected/architecture/2026-01-01-x.md', GOOD_RECORD) }, (repo) => {
    const result = runGate(repo, 'verify-agent-note-format.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /line 3 must match the rejected status grammar/u)
  })
})

test('a hard-wrapped paragraph is rejected', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'wrapped.md'), '# Title\n\nFirst line\nsecond line of the same paragraph.\n', 'utf8')
    const result = runGate(repo, 'verify-md-wrap.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /docs\/wrapped\.md:4/u)
  })
})

test('a multi-line list item is rejected', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'list.md'), '# Title\n\n- an item that wraps\n  onto a continuation line\n', 'utf8')
    const result = runGate(repo, 'verify-md-wrap.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /docs\/list\.md:4/u)
  })
})

test('consecutive list items are accepted', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'list.md'), '# Title\n\n- first item\n- second item\n- third item\n', 'utf8')
    assert.equal(runGate(repo, 'verify-md-wrap.mjs').code, 0)
  })
})

test('a fenced code block may span lines freely', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'code.md'), '# Title\n\n```sh\nfirst\nsecond\n```\n', 'utf8')
    assert.equal(runGate(repo, 'verify-md-wrap.mjs').code, 0)
  })
})

test('--staged checks only staged files', () => {
  withRepo({}, (repo) => {
    // A pre-existing violation, committed before the hook existed, must not
    // block an unrelated staged change.
    writeFileSync(join(repo, 'docs', 'old.md'), '# Title\n\nalready wrapped\nacross two lines.\n', 'utf8')
    assert.equal(spawnSync('git', ['-C', repo, 'add', '-A'], { encoding: 'utf8' }).status, 0)
    const staged = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-md-wrap.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(staged.status, 1, 'the staged file is itself a violation')
    assert.match(`${staged.stdout}${staged.stderr}`, /docs\/old\.md:4/u)

    assert.equal(spawnSync('git', ['-C', repo, 'reset', '-q'], { encoding: 'utf8' }).status, 0)
    writeFileSync(join(repo, 'docs', 'clean.md'), '# Title\n\none line only\n', 'utf8')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'docs/clean.md'], { encoding: 'utf8' }).status, 0)
    const clean = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-md-wrap.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(clean.status, 0, clean.stdout + clean.stderr)
    assert.match(clean.stdout, /1 file\(s\) checked/u)
  })
})

test('a broken relative link is rejected', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'link.md'), '# Title\n\n[gone](nope.md)\n', 'utf8')
    const result = runGate(repo, 'verify-md-links.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /docs\/link\.md:3\s+nope\.md/u)
  })
})

test('external links and bare anchors are accepted', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'link.md'),
      '# Title\n\n[web](https://example.com/x)\n[local](#title)\n[mail](mailto:a@b.c)\n', 'utf8')
    assert.equal(runGate(repo, 'verify-md-links.mjs').code, 0)
  })
})

test('a link with a fragment resolves on its path alone', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'link.md'), '# Title\n\n[here](AGENTS.md#anything)\n', 'utf8')
    assert.equal(runGate(repo, 'verify-md-links.mjs').code, 0)
  })
})

test('a document over its ceiling is rejected', () => {
  withRepo({}, (repo) => {
    const filler = Array.from({ length: 900 }, (_, i) => `word${i}`).join(' ')
    writeFileSync(join(repo, 'docs', 'fat.md'), `# Title\n\n${filler}\n`, 'utf8')
    const manifestPath = join(repo, 'scripts', 'gates', 'doc-budgets.manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest['docs/fat.md'] = 10
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const result = runGate(repo, 'verify-doc-budgets.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /exceeds the 10-word ceiling/u)
  })
})

test('a budgeted document that vanished is rejected', () => {
  withRepo({}, (repo) => {
    unlinkSync(join(repo, 'docs', 'AGENTS.md'))
    const result = runGate(repo, 'verify-doc-budgets.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /docs\/AGENTS\.md: budgeted document does not exist/u)
  })
})

test('an archived record is skipped by every documentation gate', () => {
  withRepo({}, (repo) => {
    writeRecord(repo, 'archived/architecture/2025-01-01-old.md',
      '# Decision Record: Old\n\nStatus: implemented\n\nA wrapped line\ncontinues here, and the link [is dead](nowhere.md).\n')
    assert.equal(runGate(repo, 'verify-md-wrap.mjs').code, 0)
    assert.equal(runGate(repo, 'verify-md-links.mjs').code, 0)
    assert.equal(runSuite(repo).code, 0)
  })
})

test('a centralized index is rejected', () => {
  withRepo({ mutate: repo => writeFileSync(join(repo, '.agents', 'notes', 'INDEX.md'), '# Index\n', 'utf8') }, (repo) => {
    const result = runGate(repo, 'agent-note-tree.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /INDEX\.md/u)
  })
})

test('only the allowlisted files may sit at a lifecycle root', () => {
  withRepo({ mutate: repo => writeFileSync(join(repo, '.agents', 'notes', 'implemented', 'NOTES.md'), '# x\n', 'utf8') },
    (repo) => {
      const result = runGate(repo, 'agent-note-tree.mjs')
      assert.equal(result.code, 1)
      assert.match(result.output, /expected \{lifecycle\}\/\{class\}\/file\.md/u)
    })
})
