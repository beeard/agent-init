/**
 * Gate behaviour, proved by negative control.
 *
 * A gate that only ever runs green is untested. Every test here scaffolds a
 * repository, breaks exactly one thing a gate claims to catch, and asserts that
 * the gate rejects it with a message naming the file.
 */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { removeSandbox, runGate, runSuite, scaffold, PACKAGE_ROOT } from './helpers.mjs'

/**
 * How many gates the shipped manifest registers in one group.
 *
 * Derived rather than written down: a copied number turns every new gate into a
 * failing test that has nothing to say about the gate.
 *
 * @param group - `commit` or `full`.
 * @returns The number of gates in that group.
 */
function registeredGates(group) {
  const manifest = JSON.parse(
    readFileSync(join(PACKAGE_ROOT, 'templates', 'base', 'scripts', 'gates', 'gates.json'), 'utf8'),
  )
  return Object.values(manifest).filter(entry => entry.groups.includes(group)).length
}

/** Whether an interpreter the python gate would find is on `PATH`. */
const HAS_PYTHON = ['python3', 'python'].some(candidate =>
  spawnSync(candidate, ['-c', 'import ast'], { encoding: 'utf8' }).status === 0)

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
    assert.match(result.output, new RegExp(`\\b${registeredGates('full')} gate\\(s\\) passed`, 'u'))
  })
})

test('the commit group runs a strict subset', () => {
  withRepo({}, (repo) => {
    const result = runSuite(repo, 'commit')
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, new RegExp(`\\b${registeredGates('commit')} gate\\(s\\) passed`, 'u'))
    assert.ok(registeredGates('commit') < registeredGates('full'), 'the commit group must not be the whole suite')
    assert.doesNotMatch(result.output, /verify-doc-budgets/u)
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

/** A documented Python module, the baseline every Python mutation breaks. */
const GOOD_PYTHON = `"""A documented module."""


class Store:
    """Holds items."""

    def load(self, path):
        """Load items from path."""
        return {}


def _private_helper():
    pass
`

/**
 * Scaffold a repository with the Python stack applied.
 * @returns Absolute path to the scaffolded repository.
 */
function scaffoldPython() {
  return scaffold(['--name', 'demo', '--stack', 'python'])
}

/**
 * Write a Python file into a scaffolded repository.
 * @param repo - Absolute repository path.
 * @param relPath - Path below the repository root.
 * @param content - File contents.
 */
function writePython(repo, relPath, content) {
  const abs = join(repo, relPath)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, content, 'utf8')
}

test('the python stack adds its gate, config, and testing guide', () => {
  const repo = scaffoldPython()
  try {
    assert.ok(existsSync(join(repo, 'docs/testing-python.md')))
    assert.ok(existsSync(join(repo, 'scripts/gates/verify-python-docstrings.mjs')))
    const gates = JSON.parse(readFileSync(join(repo, 'scripts/gates/gates.json'), 'utf8'))
    assert.ok(Object.hasOwn(gates, 'verify-python-docstrings.mjs'))
    // The base gates survive the merge rather than being replaced by it.
    assert.ok(Object.hasOwn(gates, 'agent-note-tree.mjs'))
    assert.equal(gates['verify-python-docstrings.mjs'].advisory, true)
    assert.equal(gates['agent-note-tree.mjs'].advisory, undefined)
    const config = JSON.parse(readFileSync(join(repo, 'scripts/gates/config.json'), 'utf8'))
    assert.deepEqual(config.pythonGlobs, ['**/*.py'])
    assert.ok(Array.isArray(config.markdownGlobs), 'the python layer must not drop the base config')
  } finally {
    removeSandbox(repo)
  }
})

test('a documented python module passes the docstring gate', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffoldPython()
  try {
    writePython(repo, 'pkg/good.py', GOOD_PYTHON)
    const result = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(result.code, 0, result.output)
  } finally {
    removeSandbox(repo)
  }
})

test('an undocumented module, class, function, and method are each reported', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffoldPython()
  try {
    writePython(repo, 'pkg/bare.py', 'def top():\n    pass\n\n\nclass Bare:\n    def method(self):\n        pass\n')
    const result = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /pkg\/bare\.py:5\s+class Bare/u)
    assert.match(result.output, /pkg\/bare\.py:6\s+method method/u)
    assert.match(result.output, /pkg\/bare\.py:1\s+function top/u)
    assert.match(result.output, /module <module>/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a leading underscore makes a definition private', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffoldPython()
  try {
    writePython(repo, 'pkg/private.py', '"""Doc."""\n\n\ndef _hidden():\n    pass\n\n\nclass _AlsoHidden:\n    pass\n')
    assert.equal(runGate(repo, 'verify-python-docstrings.mjs').code, 0)
  } finally {
    removeSandbox(repo)
  }
})

test('an overload stub without a docstring is exempt', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffoldPython()
  try {
    writePython(repo, 'pkg/over.py',
      '"""Doc."""\n\nfrom typing import overload\n\n\n@overload\ndef parse(value: int) -> int: ...\n\n\ndef parse(value):\n    """Parse."""\n    return value\n')
    assert.equal(runGate(repo, 'verify-python-docstrings.mjs').code, 0)
  } finally {
    removeSandbox(repo)
  }
})

test('a syntax error is reported rather than crashing the gate', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffoldPython()
  try {
    writePython(repo, 'pkg/broken.py', 'def (:\n')
    const result = runGate(repo, 'verify-python-docstrings.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /syntax error/u)
  } finally {
    removeSandbox(repo)
  }
})

test('virtualenv and cache directories are not scanned', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffoldPython()
  try {
    for (const dir of ['venv', '__pycache__', 'build', 'site-packages']) {
      writePython(repo, `${dir}/mod.py`, 'def undocumented():\n    pass\n')
    }
    assert.equal(runGate(repo, 'verify-python-docstrings.mjs').code, 0)
  } finally {
    removeSandbox(repo)
  }
})

test('an advisory gate reports without failing the run', () => {
  const repo = scaffoldPython()
  try {
    writePython(repo, 'pkg/bare.py', 'def top():\n    pass\n')
    const result = runSuite(repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /WARN\s+verify-python-docstrings/u)
    assert.match(result.output, /advisory finding/u)
  } finally {
    removeSandbox(repo)
  }
})

test('--lenient marks every gate advisory', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--lenient'])
  try {
    const gates = JSON.parse(readFileSync(join(repo, 'scripts/gates/gates.json'), 'utf8'))
    assert.equal(Object.values(gates).every(gate => gate.advisory === true), true)
  } finally {
    removeSandbox(repo)
  }
})

test('a missing interpreter fails loud with the way out', () => {
  const repo = scaffoldPython()
  try {
    writePython(repo, 'pkg/good.py', GOOD_PYTHON)
    // An empty PATH is how a machine without Python looks to the gate.
    const result = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-python-docstrings.mjs')], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, PATH: '/nonexistent' },
    })
    assert.equal(result.status, 1)
    assert.match(`${result.stdout}${result.stderr}`, /no Python interpreter found/u)
    assert.match(`${result.stdout}${result.stderr}`, /gates\.json/u)
  } finally {
    removeSandbox(repo)
  }
})

test('the python and architecture layers both reach AGENTS.md', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--with-architecture'])
  try {
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    // A single shared marker would make the second layer's section vanish.
    assert.equal(agents.match(/agent-init:begin/gu)?.length, 2)
    assert.match(agents, /Public means no leading underscore/u)
    assert.match(agents, /Compose; do not patch a core/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a file without a trailing newline is rejected', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'bare.md'), '# Title\n\nno newline at the end', 'utf8')
    const result = runGate(repo, 'verify-final-newline.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /docs\/bare\.md\s+no trailing newline/u)
  })
})

test('a file with more than one trailing newline is rejected', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'extra.md'), '# Title\n\nbody\n\n', 'utf8')
    const result = runGate(repo, 'verify-final-newline.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /docs\/extra\.md\s+more than one trailing newline/u)
  })
})

test('a file ending in exactly one newline is accepted', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'fine.md'), '# Title\n\nbody\n', 'utf8')
    assert.equal(runGate(repo, 'verify-final-newline.mjs').code, 0)
  })
})

test('an empty file is not a newline violation', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'empty.md'), '', 'utf8')
    assert.equal(runGate(repo, 'verify-final-newline.mjs').code, 0)
  })
})

test('build and dependency directories are not walked', () => {
  withRepo({}, (repo) => {
    for (const dir of ['node_modules', 'dist', 'build', 'target', 'vendor', 'coverage']) {
      mkdirSync(join(repo, dir), { recursive: true })
      writeFileSync(join(repo, dir, 'x.md'), '# no newline', 'utf8')
    }
    assert.equal(runGate(repo, 'verify-final-newline.mjs').code, 0)
  })
})

// The fixtures below are themselves findings: the gate reads position, and a
// string holding a comment-looking tag is indistinguishable from a comment to a
// line-based scan. The package's own run counts them, which is the cost the
// record for this gate states.

test('a marker that names nothing is rejected', () => {
  withRepo({}, (repo) => {
    // A bare tag is the case the scan exists to prevent: it tells a reader the
    // problem was noticed and nothing about what is missing.
    writeFileSync(join(repo, 'tool.mjs'), '// TODO\nexport const x = 1\n', 'utf8')
    const result = runGate(repo, 'verify-issue-tags.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /tool\.mjs:1\s+TODO/u)
    assert.match(result.output, /name nothing/u)
  })
})

test('a marker with a reason is listed and accepted', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'tool.mjs'),
      '// FIXME(release): the parser drops the last field\nexport const x = 1\n// TODO: rename this\n', 'utf8')
    const result = runGate(repo, 'verify-issue-tags.mjs')
    assert.equal(result.code, 0, result.output)
    // The report is the scan the standing orders promise: location, tag, owner,
    // and the reason, so a reader sorts the backlog without grepping.
    assert.match(result.output, /FIXME\s+tool\.mjs:1 \(release\)\s+the parser drops the last field/u)
    assert.match(result.output, /TODO\s+tool\.mjs:3\s+rename this/u)
    assert.match(result.output, /2 marker\(s\) — FIXME 1, TODO 1, XXX 0\./u)
  })
})

test('prose that names the vocabulary is not a marker', () => {
  withRepo({}, (repo) => {
    // The rule is about what a marker is, not about the word. A word-based scan
    // reports the file that defines the vocabulary — including this gate's own
    // source — and a scan that reports its own rule is worse than none.
    writeFileSync(join(repo, 'tool.mjs'),
      "const TAGS = ['FIXME', 'TODO', 'XXX']\n// the tags are FIXME, TODO, and XXX\n", 'utf8')
    const result = runGate(repo, 'verify-issue-tags.mjs')
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /no known-issue markers/u)
  })
})

test('--staged leaves a marker outside the commit alone', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'old.mjs'), '// TODO\n', 'utf8')
    writeFileSync(join(repo, 'tool.mjs'), 'export const x = 1\n', 'utf8')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'tool.mjs'], { encoding: 'utf8' }).status, 0)
    const staged = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-issue-tags.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(staged.status, 0, staged.stdout + staged.stderr)
    assert.match(staged.stdout, /1 file\(s\) checked/u)
  })
})

test('a file inside a dot-directory is judged like any other', () => {
  withRepo({}, (repo) => {
    // The rule is stated over every file the repository owns, and `.agents/` is
    // named by `markdownGlobs`. A walker that does not descend into dot
    // directories is not a reason for the rule to stop applying there.
    writeFileSync(join(repo, '.agents', 'notes', 'proposed', 'bare.md'), '# no newline', 'utf8')
    const result = runGate(repo, 'verify-final-newline.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /\.agents\/notes\/proposed\/bare\.md\s+no trailing newline/u)
  })
})

test('an archived record is skipped through the shared skip list', () => {
  withRepo({}, (repo) => {
    // The frozen archive is named once, in `skipGlobs`, for every gate at once.
    // A gate that skips it by its own rule drifts from the gates that do not.
    writeRecord(repo, 'archived/architecture/2020-01-01-old.md', '# Old\n\nfrozen, no newline')
    assert.equal(runGate(repo, 'verify-final-newline.mjs').code, 0)
  })
})

test('a declaration cannot narrow the newline corpus away', () => {
  withRepo({}, (repo) => {
    // The built-in globs are a floor rather than a default, so emptying every
    // list the configuration declares cannot reduce the gate to a clean run
    // over no files at all.
    const configPath = join(repo, 'scripts', 'gates', 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    for (const key of Object.keys(config)) {
      if (key.endsWith('Globs')) config[key] = []
    }
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    writeFileSync(join(repo, 'docs', 'bare.md'), '# Title\n\nno newline at the end', 'utf8')
    const result = runGate(repo, 'verify-final-newline.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /docs\/bare\.md\s+no trailing newline/u)
  })
})

test('a language layer\'s skip directories are honoured by the newline gate', () => {
  const repo = scaffoldPython()
  try {
    // The layer declares `venv/` as output it does not own, so its language
    // gates never read those files. The newline rule has no more claim on them
    // than the gate that owns the language does.
    writePython(repo, 'venv/lib/vendored.py', 'vendored = 1')
    writePython(repo, 'pkg/mod.py', 'value = 1')
    const result = runGate(repo, 'verify-final-newline.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /pkg\/mod\.py\s+no trailing newline/u)
    assert.doesNotMatch(result.output, /venv\//u)
  } finally {
    removeSandbox(repo)
  }
})

test('--staged still rejects a staged file the rule covers', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'bare.md'), '# Title\n\nno newline at the end', 'utf8')
    writeFileSync(join(repo, 'docs', 'fine.md'), '# Title\n\nbody\n', 'utf8')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'docs/bare.md', 'docs/fine.md'], { encoding: 'utf8' }).status, 0)
    const result = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-final-newline.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /docs\/bare\.md\s+no trailing newline/u)
  })
})

test('--staged never judges a file the repository run would not', () => {
  withRepo({}, (repo) => {
    // Staged files this rule was never written for: no glob matches either, and
    // a trailing newline cannot be added to a PNG. Failing a commit over one
    // leaves the author no remedy inside the gate, only --no-verify.
    writeFileSync(join(repo, 'Makefile'), 'all:\n\techo hi', 'utf8')
    writeFileSync(join(repo, 'logo.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]))
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'Makefile', 'logo.png'], { encoding: 'utf8' }).status, 0)
    const staged = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-final-newline.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(staged.status, 0, staged.stdout + staged.stderr)
    assert.match(staged.stdout, /0 file\(s\) checked/u)
    // The suite the hook runs must therefore pass on the same working tree.
    assert.equal(runSuite(repo, 'commit').code, 0)
  })
})

test('--staged restricts the newline check to staged files', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'old.md'), '# pre-existing', 'utf8')
    writeFileSync(join(repo, 'docs', 'new.md'), 'clean\n', 'utf8')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'docs/new.md'], { encoding: 'utf8' }).status, 0)
    const result = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-final-newline.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stdout + result.stderr)
    assert.match(result.stdout, /1 file\(s\) checked/u)
  })
})

test('the budget gate sums per-layer contributions', () => {
  withRepo({}, (repo) => {
    const manifestPath = join(repo, 'scripts', 'gates', 'doc-budgets.manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    // A shared document is budgeted by contribution, because a layer that
    // replaced the value would cut off every layer below it.
    manifest['docs/AGENTS.md'] = { base: 500, extra: 400 }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const result = runGate(repo, 'verify-doc-budgets.mjs')
    assert.equal(result.code, 0, result.output)
    const listed = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-doc-budgets.mjs'), '--list'],
      { cwd: repo, encoding: 'utf8' })
    assert.match(listed.stdout, /base 500 \+ extra 400/u)
  })
})

test('a contribution entry that is not a positive integer is rejected', () => {
  withRepo({}, (repo) => {
    const manifestPath = join(repo, 'scripts', 'gates', 'doc-budgets.manifest.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest['docs/AGENTS.md'] = { base: 0 }
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const result = runGate(repo, 'verify-doc-budgets.mjs')
    assert.equal(result.code, 1)
    assert.match(result.output, /contribution "base" must be a positive integer/u)
  })
})

test('--staged judges only the files the whole-repository run judges', () => {
  withRepo({}, (repo) => {
    // `notes/` is outside `markdownGlobs`, so the suite never reads this file.
    // Reading it in the hook anyway would fail a commit over a paragraph no
    // gate was pointed at, with no remedy but amending a file no gate owns.
    mkdirSync(join(repo, 'notes'), { recursive: true })
    writeFileSync(join(repo, 'notes', 'loose.md'), 'A paragraph that is\nhard wrapped across lines.\n', 'utf8')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'notes/loose.md'], { encoding: 'utf8' }).status, 0)
    const staged = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-md-wrap.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(staged.status, 0, staged.stdout + staged.stderr)
    assert.equal(runSuite(repo, 'commit').code, 0)
  })
})

test('--staged still rejects a hard-wrapped file inside the corpus', () => {
  withRepo({}, (repo) => {
    writeFileSync(join(repo, 'docs', 'wrapped.md'), 'A paragraph that is\nhard wrapped across lines.\n', 'utf8')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'docs/wrapped.md'], { encoding: 'utf8' }).status, 0)
    const staged = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-md-wrap.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(staged.status, 1)
    assert.match(staged.stderr, /docs\/wrapped\.md:2/u)
  })
})

test('the python gate bounds a staged run to its configured corpus', { skip: !HAS_PYTHON && 'python is not installed' }, () => {
  const repo = scaffoldPython()
  try {
    const configPath = join(repo, 'scripts', 'gates', 'config.json')
    const config = JSON.parse(readFileSync(configPath, 'utf8'))
    config.pythonGlobs = ['src/**/*.py']
    writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
    writePython(repo, 'other/bare.py', 'def bare():\n    return 1\n')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'other/bare.py', 'scripts/gates/config.json'], { encoding: 'utf8' }).status, 0)
    const staged = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-python-docstrings.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(staged.status, 0, staged.stdout + staged.stderr)
    assert.match(staged.stdout, /0 file\(s\) checked/u)

    // An in-corpus file is still judged, so the bound is not a blanket skip.
    writePython(repo, 'src/bare.py', 'def bare():\n    return 1\n')
    assert.equal(spawnSync('git', ['-C', repo, 'add', 'src/bare.py'], { encoding: 'utf8' }).status, 0)
    const caught = spawnSync(process.execPath, [join(repo, 'scripts', 'gates', 'verify-python-docstrings.mjs'), '--staged'],
      { cwd: repo, encoding: 'utf8' })
    assert.equal(caught.status, 1)
    assert.match(caught.stderr, /src\/bare\.py/u)
  } finally {
    removeSandbox(repo)
  }
})
