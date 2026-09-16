/** Behaviour of the scaffolder itself: what it writes, and what it refuses. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { STACKS, buildPlan } from '../src/plan.mjs'
import { collectFiles, skipPredicate } from '../templates/base/scripts/gates/lib/repo-files.mjs'
import { makeSandbox, removeSandbox, runCli, scaffold, PACKAGE_ROOT } from './helpers.mjs'

/**
 * List every Markdown file in the package, excluding what the composed runs cover.
 * @param root - Absolute package root.
 * @param current - Directory being read.
 * @param prefix - Repository-relative prefix for `current`.
 * @returns Repository-relative slash paths.
 */
function shippedMarkdown(root, current = root, prefix = '') {
  const out = []
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    // `templates/` is product rather than package prose, and the dogfood runs
    // check it as the composed tree a receiving repository gets. The rest is
    // the package's own writing, which no composed run ever sees.
    if (entry.name === 'node_modules' || entry.name === '.git' || (prefix === '' && entry.name === 'templates')) continue
    const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
    if (entry.isDirectory()) out.push(...shippedMarkdown(root, join(current, entry.name), rel))
    else if (entry.name.endsWith('.md')) out.push(rel)
  }
  return out
}

test('writes the full base tree', () => {
  const repo = scaffold()
  try {
    for (const rel of [
      'AGENTS.md',
      'CLAUDE.md',
      'docs/AGENTS.md',
      'docs/architecture.md',
      '.agents/notes/README.md',
      '.agents/notes/AGENTS.md',
      '.agents/notes/implemented/AGENTS.md',
      '.agents/notes/archived/AGENTS.md',
      '.agents/notes/proposed/.gitkeep',
      '.agents/notes/rejected/.gitkeep',
      '.agents/manifest.json',
      '.githooks/pre-commit',
      'scripts/gates/run.mjs',
      'scripts/gates/change-scope.mjs',
      'scripts/gates/config.json',
      'scripts/gates/doc-budgets.manifest.json',
    ]) {
      assert.ok(existsSync(join(repo, rel)), `expected ${rel} to exist`)
    }
  } finally {
    removeSandbox(repo)
  }
})

test('links CLAUDE.md to AGENTS.md', () => {
  const repo = scaffold()
  try {
    const link = join(repo, 'CLAUDE.md')
    if (lstatSync(link).isSymbolicLink()) {
      assert.equal(readlinkSync(link), 'AGENTS.md')
    } else {
      assert.equal(readFileSync(link, 'utf8').trim(), '@AGENTS.md')
    }
  } finally {
    removeSandbox(repo)
  }
})

test('substitutes the project slug into skill directory names', () => {
  const repo = scaffold(['--name', 'My Great Project'])
  try {
    assert.ok(existsSync(join(repo, '.agents/skills/my-great-project-agent-notes/SKILL.md')))
    const skill = readFileSync(join(repo, '.agents/skills/my-great-project-agent-notes/SKILL.md'), 'utf8')
    assert.match(skill, /^name: my-great-project-agent-notes$/mu)
    assert.doesNotMatch(skill, /\{\{[A-Z_]+\}\}/u)
  } finally {
    removeSandbox(repo)
  }
})

test('includes only the requested skills', () => {
  const repo = scaffold(['--name', 'demo', '--skills', 'agent-notes,prose-standard'])
  try {
    assert.ok(existsSync(join(repo, '.agents/skills/demo-agent-notes/SKILL.md')))
    assert.ok(existsSync(join(repo, '.agents/skills/demo-prose-standard/SKILL.md')))
    assert.ok(!existsSync(join(repo, '.agents/skills/demo-code-review')))
    assert.ok(!existsSync(join(repo, '.agents/skills/demo-pre-push-checks')))
  } finally {
    removeSandbox(repo)
  }
})

test('refuses an unknown skill name', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--skills', 'nope'], repo)
    assert.equal(result.code, 2)
    assert.match(result.output, /unknown skill "nope"/u)
  } finally {
    removeSandbox(repo)
  }
})

test('refuses an unknown stack name', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--stack', 'cobol'], repo)
    assert.equal(result.code, 2)
    assert.match(result.output, /unknown stack "cobol"/u)
    assert.match(result.output, /available: go, python, rust, typescript/u)
  } finally {
    removeSandbox(repo)
  }
})

test('every shipped Markdown file is read by the package gates, or deliberately skipped', () => {
  // A new directory of prose at the top level is read by no gate until someone
  // widens the configuration, and nothing said so: `skills/` shipped blind to
  // the link, wrap, and newline checks until a check happened to fail on it.
  // Silence is the failure mode this guard closes, so it compares the files on
  // disk against the corpus the configured globs actually select.
  //
  // Two kinds of file are legitimately absent from that corpus. `skipGlobs`
  // names what a repository excludes on purpose, and a symlink is the same file
  // as its target, which the corpus already holds under the target's path.
  const config = JSON.parse(readFileSync(join(PACKAGE_ROOT, 'scripts', 'gates', 'config.json'), 'utf8'))
  const skip = skipPredicate(PACKAGE_ROOT, config.skipGlobs ?? [])
  const corpus = collectFiles(PACKAGE_ROOT, config.markdownGlobs, skip)
  const covered = new Set(corpus.map(file => file.relPath))
  const coveredReal = new Set(corpus.map(file => file.real))
  assert.ok(covered.size > 0, 'the package globs must select something')

  const uncovered = shippedMarkdown(PACKAGE_ROOT).filter((rel) => {
    if (covered.has(rel) || skip(rel)) return false
    return !coveredReal.has(realpathSync(join(PACKAGE_ROOT, rel)))
  })
  assert.deepEqual(uncovered, [], `these shipped documents are read by no gate: ${uncovered.join(', ')}`)
})

test('every declared stack has a template directory', () => {
  // A name in STACKS with no templates would scaffold a base-only tree and
  // report success, which is the silent-skip failure the rules forbid.
  for (const name of STACKS) {
    const dir = join(PACKAGE_ROOT, 'templates', name)
    assert.ok(existsSync(dir), `templates/${name}/ is missing but ${name} is in STACKS`)
  }
})

test('a repeated --stack value is applied once', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--stack', 'python'])
  try {
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    assert.equal(agents.match(/Public means no leading underscore/gu)?.length, 1)
  } finally {
    removeSandbox(repo)
  }
})

test('the manifest records the layers applied', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python', '--with-architecture'])
  try {
    const manifest = JSON.parse(readFileSync(join(repo, '.agents/manifest.json'), 'utf8'))
    assert.deepEqual(manifest.layers, ['base', 'python', 'architecture'])
    assert.deepEqual(manifest.stack, ['python'])
    assert.equal(manifest.architecture, true)
  } finally {
    removeSandbox(repo)
  }
})

test('refuses to scaffold outside a Git worktree', () => {
  const dir = makeSandbox()
  try {
    rmSync(join(dir, '.git'), { recursive: true, force: true })
    const result = runCli(['.'], dir)
    assert.equal(result.code, 2)
    assert.match(result.output, /not inside a Git worktree/u)
    assert.equal(runCli(['.', '--allow-non-git'], dir).code, 0)
  } finally {
    removeSandbox(dir)
  }
})

test('dry run writes nothing', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--dry-run'], repo)
    assert.equal(result.code, 0)
    assert.match(result.output, /nothing was written/u)
    assert.ok(!existsSync(join(repo, 'AGENTS.md')))
  } finally {
    removeSandbox(repo)
  }
})

test('re-running keeps existing files', () => {
  const repo = scaffold()
  try {
    const agents = join(repo, 'AGENTS.md')
    writeFileSync(agents, '# edited by hand\n', 'utf8')
    const again = runCli(['.'], repo)
    assert.equal(again.code, 0)
    assert.match(again.output, /kept\s+AGENTS\.md/u)
    assert.equal(readFileSync(agents, 'utf8'), '# edited by hand\n')
  } finally {
    removeSandbox(repo)
  }
})

test('--force overwrites existing files', () => {
  const repo = scaffold()
  try {
    const agents = join(repo, 'AGENTS.md')
    writeFileSync(agents, '# edited by hand\n', 'utf8')
    assert.equal(runCli(['.', '--force'], repo).code, 0)
    assert.doesNotMatch(readFileSync(agents, 'utf8'), /edited by hand/u)
  } finally {
    removeSandbox(repo)
  }
})

test('the merge report names what changed, not just the top-level keys', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python'])
  try {
    const manifestPath = join(repo, 'scripts', 'gates', 'doc-budgets.manifest.json')
    // `AGENTS.md` is already there, so a report counting top-level keys alone
    // called this run a no-op while the file gained a layer's share.
    const contributed = runCli(['.', '--stack', 'go'], repo)
    assert.equal(contributed.code, 0)
    assert.match(contributed.output,
      /merged\s+scripts\/gates\/doc-budgets\.manifest\.json\s+\+ go in AGENTS\.md, \+ docs\/testing-go\.md/u)

    // Re-running the same layer writes what the file already holds, and says so
    // rather than reporting every list as changed on identity.
    const again = runCli(['.', '--stack', 'go'], repo)
    assert.match(again.output, /merged\s+scripts\/gates\/doc-budgets\.manifest\.json\s+already present/u)

    // Entries the file already had, written with a different value: one inside
    // a shared value, one replacing a plain number.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest['AGENTS.md'].go = 999
    manifest['docs/testing-go.md'] = 500
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const changed = runCli(['.', '--stack', 'go'], repo)
    assert.match(changed.output,
      /merged\s+scripts\/gates\/doc-budgets\.manifest\.json\s+changed go in AGENTS\.md, changed docs\/testing-go\.md/u)
  } finally {
    removeSandbox(repo)
  }
})

test('refuses to merge a key the file and the template disagree about', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python'])
  try {
    const manifestPath = join(repo, 'scripts', 'gates', 'doc-budgets.manifest.json')
    // The form a repository adopted under the previous release holds: one
    // absolute ceiling per document, with no layer to attribute it to.
    writeFileSync(manifestPath, `${JSON.stringify({ 'AGENTS.md': 890 }, null, 2)}\n`, 'utf8')
    const result = runCli(['.', '--stack', 'go'], repo)
    assert.equal(result.code, 2)
    assert.match(result.output, /"AGENTS\.md" is a number in the file and an object in the template/u)
    // The refusal is raised before the file is written, so nothing was
    // composed over the value that could not be composed with.
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')), { 'AGENTS.md': 890 })
  } finally {
    removeSandbox(repo)
  }
})

test('merges a shared value across layers instead of replacing it', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'python'])
  try {
    assert.equal(runCli(['.', '--stack', 'go'], repo).code, 0)
    const manifest = JSON.parse(readFileSync(join(repo, 'scripts', 'gates', 'doc-budgets.manifest.json'), 'utf8'))
    // Both layers' shares survive the second run; the earlier one is not the
    // value that "wins".
    assert.deepEqual(manifest['AGENTS.md'], { base: 1200, python: 290, go: 260 })
  } finally {
    removeSandbox(repo)
  }
})

test('two stacks that write one path are refused, and two that append are not', () => {
  const sandbox = makeSandbox()
  const templates = join(sandbox, 'templates')
  /** Write one template file, creating its parents. */
  const template = (rel, content) => {
    mkdirSync(dirname(join(templates, rel)), { recursive: true })
    writeFileSync(join(templates, rel), content, 'utf8')
  }
  template('base/AGENTS.md', '# Orders\n')
  template('alpha/docs/shared.md', 'alpha\n')
  template('beta/docs/shared.md', 'beta\n')
  const plan = stack => () => buildPlan({
    targetDir: sandbox,
    templatesRoot: templates,
    projectName: 'demo',
    skills: [],
    stack,
    architecture: false,
  })
  try {
    // `base` above `architecture` is a fixed order, so a replacement there is a
    // decision. Between stacks there is no order, so the survivor here would be
    // whichever flag happened to come last.
    assert.throws(plan(['alpha', 'beta']), /"alpha" and "beta" both write docs\/shared\.md/u)
    assert.throws(plan(['beta', 'alpha']), /"beta" and "alpha" both write docs\/shared\.md/u)

    // Appending from both is composition: each layer's section is delivered, so
    // the only thing the order decides is which section is read first.
    unlinkSync(join(templates, 'beta', 'docs', 'shared.md'))
    template('alpha/AGENTS.md.append', '## Alpha\n')
    template('beta/AGENTS.md.append', '## Beta\n')
    const files = plan(['alpha', 'beta'])().files
    assert.deepEqual(files.filter(file => file.kind === 'append').map(file => file.layer), ['alpha', 'beta'])
  } finally {
    removeSandbox(sandbox)
  }
})

test('every stack ships its own testing guide', () => {
  const repo = scaffold(['--name', 'demo', ...STACKS.flatMap(name => ['--stack', name])])
  try {
    for (const name of STACKS) {
      const guide = readFileSync(join(repo, `docs/testing-${name}.md`), 'utf8')
      // The guide a language's standing orders link to must be that language's,
      // not whichever stack happened to be applied last.
      assert.match(guide, new RegExp(`specific to ${name}`, 'iu'), `docs/testing-${name}.md is another language's guide`)
    }
    assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /\[docs\/testing-python\.md\]\(docs\/testing-python\.md\)/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a repository whose hooks Git cannot reach is opted in instead', () => {
  const repo = makeSandbox()
  try {
    // Another hooksPath wins over the repository's own, so Git never reads
    // `.githooks/`. The chain a user installs for that case runs the file only
    // for a repository that opted in, and the opt-in lives in `.git/config` so
    // a clone cannot carry it.
    spawnSync('git', ['-C', repo, 'config', '--local', 'core.hooksPath', join(repo, 'elsewhere')])
    const result = runCli(['.', '--name', 'demo'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /not activated/u)
    const marker = spawnSync('git', ['-C', repo, 'config', '--local', '--get', 'agent-init.githooks'],
      { encoding: 'utf8' })
    assert.equal(marker.stdout.trim(), 'true')
  } finally {
    removeSandbox(repo)
  }
})

test('an activated repository is not opted in', () => {
  const repo = makeSandbox()
  // `git config --get` reads every scope, so a machine with a global
  // core.hooksPath never reaches the branch this test is about. Emptying the
  // global file is what isolates it — the test must not edit the real one.
  const emptyConfig = join(repo, 'no-global-config')
  writeFileSync(emptyConfig, '', 'utf8')
  try {
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src', 'cli.mjs'), '.', '--name', 'demo'], {
      cwd: repo,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_NOSYSTEM: '1' },
    })
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.match(`${result.stdout}${result.stderr}`, /activated/u)
    // With no other hooksPath, the tool points Git at `.githooks` itself, so
    // there is no chain to satisfy and the marker has no consumer.
    const local = key => spawnSync('git', ['-C', repo, 'config', '--local', '--get', key], { encoding: 'utf8' }).stdout.trim()
    assert.equal(local('core.hooksPath'), '.githooks')
    assert.equal(local('agent-init.githooks'), '')
  } finally {
    removeSandbox(repo)
  }
})

test('installs an executable pre-commit hook', () => {
  const repo = scaffold()
  try {
    const mode = statSync(join(repo, '.githooks/pre-commit')).mode & 0o777
    assert.ok((mode & 0o100) !== 0, `pre-commit should be executable, mode was ${mode.toString(8)}`)
  } finally {
    removeSandbox(repo)
  }
})

test('the architecture layer adds the glossary and composition rules', () => {
  const repo = scaffold(['--with-architecture'])
  try {
    assert.ok(existsSync(join(repo, 'docs/glossary.md')))
    assert.ok(existsSync(join(repo, 'docs/composition.md')))
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    assert.match(agents, /agent-init:begin/u)
    assert.equal(agents.match(/agent-init:begin/gu)?.length, 1)
  } finally {
    removeSandbox(repo)
  }
})

test('the architecture layer is not applied by default', () => {
  const repo = scaffold()
  try {
    assert.ok(!existsSync(join(repo, 'docs/glossary.md')))
    assert.doesNotMatch(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /agent-init:begin/u)
  } finally {
    removeSandbox(repo)
  }
})

test('adds gate scripts to an existing package.json without clobbering', () => {
  const repo = makeSandbox()
  try {
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({
      name: 'demo',
      scripts: { 'check:agents': 'echo mine' },
    }, null, 2)}\n`, 'utf8')
    assert.equal(runCli(['.'], repo).code, 0)
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts['check:agents'], 'echo mine')
    assert.equal(pkg.scripts['change-scope'], 'node scripts/gates/change-scope.mjs')
  } finally {
    removeSandbox(repo)
  }
})
