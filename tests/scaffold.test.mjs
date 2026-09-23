/** Behaviour of the scaffolder itself: what it writes, and what it refuses. */

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, statSync, symlinkSync, unlinkSync, writeFileSync, chmodSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { STACKS, buildPlan } from '../src/plan.mjs'
import { collectFiles, skipPredicate } from '../templates/base/scripts/gates/lib/repo-files.mjs'
import { makeSandbox, removeSandbox, runCli, scaffold, gitConfigEnv, PACKAGE_ROOT } from './helpers.mjs'

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

test('links each skill under the name the repository refers to it by', () => {
  const repo = scaffold(['--name', 'demo', '--skills', 'agent-notes,prose-standard'])
  try {
    for (const skill of ['agent-notes', 'prose-standard']) {
      const name = `demo-${skill}`
      const link = join(repo, '.claude', 'skills', name)
      assert.ok(existsSync(link), `expected .claude/skills/${name} to exist`)
      if (lstatSync(link).isSymbolicLink()) {
        // Relative, so the receiving repository can move or be cloned: the
        // target is resolved against the link's own directory, not this machine.
        assert.equal(readlinkSync(link), `../../.agents/skills/${name}`)
      }
      // Claude Code registers a skill under its directory name, so that name and
      // the `name:` it declares have to agree; a mismatch is what made every
      // reference in AGENTS.md point at a skill that was not registered.
      const declared = /^name: (.+)$/mu.exec(readFileSync(join(link, 'SKILL.md'), 'utf8'))
      assert.equal(declared?.[1], name, `${name} must declare the name it is registered under`)
    }
    // A skill the run did not select is linked no more than it is written.
    assert.ok(!existsSync(join(repo, '.claude', 'skills', 'demo-code-review')))
  } finally {
    removeSandbox(repo)
  }
})

test('every skill AGENTS.md names is one the run registered', () => {
  const repo = scaffold(['--name', 'demo'])
  try {
    // The check the defect needed: a skill table that names an unregistered
    // skill is a reference no agent can follow, and nothing compared the two.
    const referenced = new Set()
    for (const doc of ['AGENTS.md', join('docs', 'AGENTS.md')]) {
      const text = readFileSync(join(repo, doc), 'utf8')
      for (const found of text.matchAll(/`(demo-[a-z-]+)`/gu)) referenced.add(found[1])
    }
    assert.ok(referenced.size > 0, 'expected the standing orders to name at least one skill')
    for (const name of referenced) {
      assert.ok(existsSync(join(repo, '.claude', 'skills', name)), `${name} is named but not registered`)
    }
  } finally {
    removeSandbox(repo)
  }
})

test('keeps a .claude/skills entry the repository already had', () => {
  const repo = makeSandbox()
  try {
    // The negative control for the link above: a path this tool does not own is
    // kept, so the run cannot be reported as having linked over someone's work.
    const held = join(repo, '.claude', 'skills', 'demo-agent-notes')
    mkdirSync(held, { recursive: true })
    writeFileSync(join(held, 'SKILL.md'), 'the repository put this here\n')

    const result = runCli(['.', '--name', 'demo'], repo)
    assert.equal(result.code, 0)
    assert.equal(readFileSync(join(held, 'SKILL.md'), 'utf8'), 'the repository put this here\n')
    assert.ok(!lstatSync(held).isSymbolicLink(), 'an existing directory must not be replaced by a link')
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

    // Entries the file already had, edited to a different value: one inside a
    // shared value, one a plain number. A re-run keeps both and names them.
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest['AGENTS.md'].go = 999
    manifest['docs/testing-go.md'] = 500
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
    const kept = runCli(['.', '--stack', 'go'], repo)
    assert.match(kept.output,
      /kept\s+scripts\/gates\/doc-budgets\.manifest\.json\s+kept go in AGENTS\.md, docs\/testing-go\.md as the file has them/u)
    assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8'))['AGENTS.md'].go, 999)

    // --force is what replaces them.
    assert.equal(runCli(['.', '--stack', 'go', '--force'], repo).code, 0)
    assert.equal(JSON.parse(readFileSync(manifestPath, 'utf8'))['AGENTS.md'].go, 260)
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
      env: gitConfigEnv(emptyConfig),
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

test('keeps a pre-commit hook the repository already had', () => {
  const repo = makeSandbox()
  try {
    const hook = join(repo, '.githooks', 'pre-commit')
    mkdirSync(dirname(hook), { recursive: true })
    writeFileSync(hook, '#!/bin/sh\necho mine >&2\n', 'utf8')
    chmodSync(hook, 0o755)
    const result = runCli(['.', '--name', 'demo'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /kept\s+\.githooks\/pre-commit/u)
    assert.match(result.output, /already exists and was kept/u)
    assert.equal(readFileSync(hook, 'utf8'), '#!/bin/sh\necho mine >&2\n')
    // The gates are not wired into someone else's hook, so the path is not
    // claimed either.
    const local = spawnSync('git', ['-C', repo, 'config', '--local', '--get', 'core.hooksPath'], { encoding: 'utf8' })
    assert.equal(local.stdout.trim(), '')
  } finally {
    removeSandbox(repo)
  }
})

test('--force replaces a hook the repository already had', () => {
  const repo = makeSandbox()
  try {
    const hook = join(repo, '.githooks', 'pre-commit')
    mkdirSync(dirname(hook), { recursive: true })
    writeFileSync(hook, '#!/bin/sh\necho mine >&2\n', 'utf8')
    chmodSync(hook, 0o755)
    const result = runCli(['.', '--name', 'demo', '--force'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(readFileSync(hook, 'utf8'), /scripts\/gates\/run\.mjs --group commit/u)
  } finally {
    removeSandbox(repo)
  }
})

test('re-running leaves the hook it already wrote alone', () => {
  const repo = scaffold()
  try {
    const hook = join(repo, '.githooks', 'pre-commit')
    const before = statSync(hook).mtimeMs
    const again = runCli(['.', '--name', 'demo'], repo)
    assert.equal(again.code, 0, again.output)
    assert.match(again.output, /kept\s+\.githooks\/pre-commit/u)
    assert.equal(statSync(hook).mtimeMs, before, 'an identical re-run must not rewrite the hook')
  } finally {
    removeSandbox(repo)
  }
})

test('does not point core.hooksPath over an existing $GIT_DIR hook', () => {
  const repo = makeSandbox()
  // A global core.hooksPath would decide this branch instead, so it is emptied.
  const emptyConfig = join(repo, 'no-global-config')
  writeFileSync(emptyConfig, '', 'utf8')
  const env = gitConfigEnv(emptyConfig)
  try {
    const gitHook = join(repo, '.git', 'hooks', 'pre-commit')
    writeFileSync(gitHook, '#!/bin/sh\necho old >&2\n', 'utf8')
    chmodSync(gitHook, 0o755)
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src', 'cli.mjs'), '.', '--name', 'demo'], {
      cwd: repo,
      encoding: 'utf8',
      env,
    })
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.match(`${result.stdout}${result.stderr}`, /not activated/u)
    // Git reads `core.hooksPath` or `$GIT_DIR/hooks`, never both, so the
    // existing hook is left reachable rather than silently replaced.
    const local = key => spawnSync('git', ['-C', repo, 'config', '--local', '--get', key], { encoding: 'utf8', env }).stdout.trim()
    assert.equal(local('core.hooksPath'), '')
    assert.equal(local('agent-init.githooks'), 'true')
    assert.ok(existsSync(gitHook))
  } finally {
    removeSandbox(repo)
  }
})

test('a global core.hooksPath is left in place rather than overridden locally', () => {
  const repo = makeSandbox()
  const globalConfig = join(repo, 'global-gitconfig')
  writeFileSync(globalConfig, `[core]\n\thooksPath = ${join(repo, 'global-hooks')}\n`, 'utf8')
  const env = gitConfigEnv(globalConfig)
  try {
    const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src', 'cli.mjs'), '.', '--name', 'demo'], {
      cwd: repo,
      encoding: 'utf8',
      env,
    })
    assert.equal(result.status, 0, `${result.stdout}${result.stderr}`)
    assert.match(`${result.stdout}${result.stderr}`, /core\.hooksPath is already/u)
    const local = key => spawnSync('git', ['-C', repo, 'config', '--local', '--get', key], { encoding: 'utf8', env }).stdout.trim()
    assert.equal(local('core.hooksPath'), '', 'a local value would hide the global hooks')
    assert.equal(local('agent-init.githooks'), 'true')
  } finally {
    removeSandbox(repo)
  }
})

test('refuses a skill name that matches no template', () => {
  assert.throws(
    () => buildPlan({
      targetDir: PACKAGE_ROOT,
      templatesRoot: join(PACKAGE_ROOT, 'templates'),
      projectName: 'demo',
      skills: ['not-a-skill'],
      stack: [],
      architecture: false,
    }),
    /unknown skill\(s\): not-a-skill/u,
  )
})

test('refuses an empty --skills value', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--skills', ''], repo)
    assert.equal(result.code, 2)
    assert.match(result.output, /no skills selected/u)
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

test('creates a TypeScript config and manifest for a new project', () => {
  const repo = scaffold(['--name', 'demo', '--stack', 'typescript', '--no-hooks'])
  try {
    const tsconfig = JSON.parse(readFileSync(join(repo, 'tsconfig.json'), 'utf8'))
    assert.equal(tsconfig.compilerOptions.strict, true)
    assert.equal(tsconfig.compilerOptions.module, 'NodeNext')

    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    assert.equal(pkg.type, 'module')
    assert.equal(pkg.scripts.typecheck, 'tsc --noEmit')
    assert.ok(pkg.devDependencies.typescript, 'the compiler must be declared, not assumed')
  } finally {
    removeSandbox(repo)
  }
})

test('reports the install command when it declares the compiler', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--name', 'demo', '--stack', 'typescript', '--no-hooks'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /npm install/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a non-TypeScript scaffold creates no package.json', () => {
  const repo = scaffold(['--no-hooks'])
  try {
    assert.ok(!existsSync(join(repo, 'package.json')), 'the base layer has no manifest to justify')
  } finally {
    removeSandbox(repo)
  }
})

test('a TypeScript dry run writes neither the config nor the manifest', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--name', 'demo', '--stack', 'typescript', '--dry-run'], repo)
    assert.equal(result.code, 0, result.output)
    assert.ok(!existsSync(join(repo, 'tsconfig.json')))
    assert.ok(!existsSync(join(repo, 'package.json')))
  } finally {
    removeSandbox(repo)
  }
})

test('keeps an existing tsconfig and reports what it does not set', () => {
  const repo = makeSandbox()
  try {
    const tsconfig = join(repo, 'tsconfig.json')
    // JSONC, because that is what tsconfig is: the comments must survive a run
    // that only reads the file.
    const source = `{
  // chosen for the old runtime
  "compilerOptions": {
    "target": "ES2019",
    "strict": true,
    "module": "CommonJS"
  }
}
`
    writeFileSync(tsconfig, source, 'utf8')
    const result = runCli(['.', '--name', 'demo', '--stack', 'typescript', '--no-hooks'], repo)
    assert.equal(result.code, 0, result.output)
    assert.equal(readFileSync(tsconfig, 'utf8'), source, 'the existing config must not be rewritten')
    assert.match(result.output, /"compilerOptions\.moduleResolution" is not set/u)
    assert.match(result.output, /"compilerOptions\.target" is "ES2019"/u)
    assert.match(result.output, /left as it is/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a bundler project is told to keep its module settings', () => {
  const repo = makeSandbox()
  try {
    // create-next-app's shape. `moduleResolution: "bundler"` is what lets the
    // extensionless relative imports a Next.js project writes resolve, and
    // `NodeNext` requires `.js` on every one of them, so the recommendation
    // would stop the project building.
    const tsconfig = join(repo, 'tsconfig.json')
    const source = `{
  "compilerOptions": {
    "target": "ES2017",
    "lib": ["dom", "dom.iterable", "esnext"],
    "module": "esnext",
    "moduleResolution": "bundler",
    "strict": true,
    "noEmit": true,
    "jsx": "preserve"
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx"]
}
`
    writeFileSync(tsconfig, source, 'utf8')
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'app', dependencies: { next: '16.3.5' } }, null, 2)}\n`)

    const result = runCli(['.', '--name', 'demo', '--stack', 'typescript', '--no-hooks'], repo)
    assert.equal(result.code, 0, result.output)
    assert.equal(readFileSync(tsconfig, 'utf8'), source, 'the framework config must not be rewritten')
    assert.match(result.output, /a bundler builds this project/u)
    assert.match(result.output, /leave the module and target settings to the framework/u)
    // The module and target settings must not be findings at all: an agent
    // reading them as defects would rewrite the framework's config and stop
    // the project building. Only the strictness options may be reported.
    assert.doesNotMatch(result.output, /"compilerOptions\.(module|moduleResolution|target|lib)"/u)
    assert.match(result.output, /noUncheckedIndexedAccess/u)
    // The report may still list what differs — it is a report — but it must not
    // close by telling the reader to apply it, and it must not raise the ESM
    // note for a project that resolves its own imports.
    assert.doesNotMatch(result.output, /the TypeScript orders assume ESM/u)
    assert.doesNotMatch(result.output, /Ask the user whether to apply the options above/u)
  } finally {
    removeSandbox(repo)
  }
})

test('a Node project still gets the ESM and module recommendations', () => {
  const repo = makeSandbox()
  try {
    // The negative control: without a bundler the same options are gaps, and a
    // fix that silenced them everywhere would pass the test above and fail this
    // one.
    writeFileSync(join(repo, 'tsconfig.json'), `${JSON.stringify({ compilerOptions: { target: 'ES2019', module: 'CommonJS' } }, null, 2)}\n`)
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'server', dependencies: {} }, null, 2)}\n`)

    const result = runCli(['.', '--name', 'demo', '--stack', 'typescript', '--no-hooks'], repo)
    assert.equal(result.code, 0, result.output)
    assert.doesNotMatch(result.output, /a bundler builds this project/u)
    assert.match(result.output, /"compilerOptions\.moduleResolution" is not set/u)
    assert.match(result.output, /the TypeScript orders assume ESM/u)
    assert.match(result.output, /Ask the user whether to apply the options above/u)
  } finally {
    removeSandbox(repo)
  }
})

test('does not clobber its own typecheck script or a pinned compiler', () => {
  const repo = makeSandbox()
  try {
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({
      name: 'demo',
      scripts: { typecheck: 'tsc -p tsconfig.build.json' },
      devDependencies: { typescript: '^4.9.5' },
    }, null, 2)}\n`, 'utf8')
    assert.equal(runCli(['.', '--name', 'demo', '--stack', 'typescript', '--no-hooks'], repo).code, 0)
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    assert.equal(pkg.scripts.typecheck, 'tsc -p tsconfig.build.json')
    assert.equal(pkg.devDependencies.typescript, '^4.9.5')
    assert.equal(pkg.scripts['check:agents'], 'node scripts/gates/run.mjs')
  } finally {
    removeSandbox(repo)
  }
})

test('reports a package type that is not ESM without changing it', () => {
  const repo = makeSandbox()
  try {
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'demo', type: 'commonjs' }, null, 2)}\n`, 'utf8')
    const result = runCli(['.', '--name', 'demo', '--stack', 'typescript', '--no-hooks'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /package\.json "type" is "commonjs"/u)
    assert.equal(JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8')).type, 'commonjs')
  } finally {
    removeSandbox(repo)
  }
})

test('adds scripts without inventing an empty devDependencies', () => {
  const repo = makeSandbox()
  try {
    writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'demo', scripts: { build: 'go build' } }, null, 2)}\n`, 'utf8')
    assert.equal(runCli(['.', '--name', 'demo', '--stack', 'go', '--no-hooks'], repo).code, 0)
    const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'))
    assert.ok(!Object.hasOwn(pkg, 'devDependencies'), 'a scripts-only contribution must not add the key')
    assert.equal(pkg.scripts['check:agents'], 'node scripts/gates/run.mjs')
  } finally {
    removeSandbox(repo)
  }
})

test('composes the base orders into an AGENTS.md the repository already had', () => {
  const repo = makeSandbox()
  try {
    const own = '# Our own orders\n\nKeep it short.\n'
    writeFileSync(join(repo, 'AGENTS.md'), own, 'utf8')
    const result = runCli(['.', '--name', 'demo', '--stack', 'typescript', '--no-hooks'], repo)
    assert.equal(result.code, 0, result.output)
    assert.match(result.output, /composed\s+AGENTS\.md/u)
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    // The repository's own file survives, and the base orders it did not have
    // arrive as a marked section rather than replacing it.
    assert.ok(agents.startsWith(own), 'the existing document must be preserved verbatim')
    assert.match(agents, /<!-- agent-init:begin base -->/u)
    assert.match(agents, /Read before you change/u)
    assert.match(agents, /<!-- agent-init:begin typescript -->/u)
  } finally {
    removeSandbox(repo)
  }
})

test('keeps a composed AGENTS.md, and an edit to it, on every later run', () => {
  const repo = makeSandbox()
  try {
    writeFileSync(join(repo, 'AGENTS.md'), '# Our own orders\n', 'utf8')
    assert.equal(runCli(['.', '--name', 'demo', '--no-hooks'], repo).code, 0)
    // A hand edit after adoption must not trigger a second base section.
    writeFileSync(join(repo, 'AGENTS.md'), `${readFileSync(join(repo, 'AGENTS.md'), 'utf8')}\nEdited by hand.\n`, 'utf8')
    const again = runCli(['.', '--name', 'demo', '--no-hooks'], repo)
    assert.equal(again.code, 0, again.output)
    assert.match(again.output, /kept\s+AGENTS\.md/u)
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    assert.match(agents, /Edited by hand\./u)
    assert.equal(agents.match(/agent-init:begin base/gu)?.length, 1, 'the base section must appear once')
  } finally {
    removeSandbox(repo)
  }
})

test('a fresh repository gets the base orders without markers', () => {
  const repo = scaffold(['--no-hooks'])
  try {
    const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
    assert.match(agents, /Read before you change/u)
    assert.doesNotMatch(agents, /agent-init:begin base/u, 'a written file is not wrapped')
  } finally {
    removeSandbox(repo)
  }
})

/**
 * Count the base orders in a scaffolded AGENTS.md.
 * @param repo - Absolute repository path.
 * @returns How many copies of the base orders the file holds.
 */
function baseOrderCopies(repo) {
  return readFileSync(join(repo, 'AGENTS.md'), 'utf8').match(/^## Read before you change$/gmu)?.length ?? 0
}

test('a re-run without the manifest does not compose the base orders a second time', () => {
  const repo = scaffold(['--no-hooks'])
  try {
    // The written file carries no markers, so only its content says the orders
    // are already there — edited or not.
    writeFileSync(join(repo, 'AGENTS.md'), `${readFileSync(join(repo, 'AGENTS.md'), 'utf8')}\nEdited by hand.\n`, 'utf8')
    rmSync(join(repo, '.agents', 'manifest.json'))
    const again = runCli(['.', '--no-hooks'], repo)
    assert.equal(again.code, 0, again.output)
    assert.match(again.output, /kept\s+AGENTS\.md\s+exists; already carries these orders/u)
    assert.equal(baseOrderCopies(repo), 1)
    assert.match(readFileSync(join(repo, 'AGENTS.md'), 'utf8'), /Edited by hand\./u)
    assert.ok(existsSync(join(repo, '.agents', 'manifest.json')), 'the manifest is written again')
  } finally {
    removeSandbox(repo)
  }
})

test('a run a merge refuses writes nothing, so its re-run composes once', () => {
  const repo = makeSandbox()
  try {
    const budgets = join(repo, 'scripts', 'gates', 'doc-budgets.manifest.json')
    mkdirSync(dirname(budgets), { recursive: true })
    writeFileSync(budgets, '{"AGENTS.md": 5}\n', 'utf8')
    const failed = runCli(['.', '--no-hooks', '--stack', 'go'], repo)
    assert.equal(failed.code, 2)
    assert.match(failed.output, /Nothing was written/u)
    assert.ok(!existsSync(join(repo, 'AGENTS.md')), 'the refusal comes before the first write')
    writeFileSync(budgets, '{}\n', 'utf8')
    assert.equal(runCli(['.', '--no-hooks', '--stack', 'go'], repo).code, 0)
    assert.equal(baseOrderCopies(repo), 1)
  } finally {
    removeSandbox(repo)
  }
})

test('a symlink out of the repository is never written through', () => {
  const repo = makeSandbox()
  const outside = makeSandbox()
  try {
    symlinkSync(join(outside, 'pwned.md'), join(repo, 'CLAUDE.md'))
    mkdirSync(join(repo, '.githooks'))
    symlinkSync(join(outside, 'hook'), join(repo, '.githooks', 'pre-commit'))
    symlinkSync(outside, join(repo, 'docs'))
    const result = runCli(['.', '--name', 'demo'], repo)
    assert.equal(result.code, 0, result.output)
    assert.deepEqual(readdirSync(outside).filter(name => name !== '.git'), [], 'nothing may be created outside the repository')
    // A dangling link is reported as what it is, not as a platform refusal.
    assert.match(result.output, /kept\s+CLAUDE\.md\s+a dangling symlink/u)
    assert.doesNotMatch(result.output, /symlink unavailable/u)
    assert.match(result.output, /refused\s+\.githooks\/pre-commit\s+a dangling symlink/u)
    assert.match(result.output, /refused\s+docs\/AGENTS\.md\s+a symlink at \S+ leading out of the repository/u)
  } finally {
    removeSandbox(repo)
    removeSandbox(outside)
  }
})

test('a re-run keeps a merged value edited by hand', () => {
  const repo = scaffold(['--no-hooks', '--stack', 'go'])
  try {
    const gatesPath = join(repo, 'scripts', 'gates', 'gates.json')
    const gates = JSON.parse(readFileSync(gatesPath, 'utf8'))
    gates['verify-go-docstrings.mjs'].advisory = false
    delete gates['verify-go-docstrings.mjs'].description
    writeFileSync(gatesPath, `${JSON.stringify(gates, null, 2)}\n`, 'utf8')
    const again = runCli(['.', '--no-hooks', '--stack', 'go'], repo)
    assert.equal(again.code, 0, again.output)
    assert.match(again.output, /merged\s+scripts\/gates\/gates\.json\s+\+ description in verify-go-docstrings\.mjs, kept advisory in verify-go-docstrings\.mjs as the file has them/u)
    const after = JSON.parse(readFileSync(gatesPath, 'utf8'))['verify-go-docstrings.mjs']
    assert.equal(after.advisory, false, 'a tightened gate stays tightened')
    assert.equal(typeof after.description, 'string', 'a missing entry is still added')
  } finally {
    removeSandbox(repo)
  }
})

test('the manifest records a layer added on a later run', () => {
  const repo = scaffold(['--no-hooks'])
  try {
    const manifestPath = join(repo, '.agents', 'manifest.json')
    const before = JSON.parse(readFileSync(manifestPath, 'utf8'))
    const again = runCli(['.', '--no-hooks', '--stack', 'python', '--with-architecture'], repo)
    assert.equal(again.code, 0, again.output)
    assert.match(again.output, /merged\s+\.agents\/manifest\.json\s+\+ python, architecture in layers/u)
    const after = JSON.parse(readFileSync(manifestPath, 'utf8'))
    assert.deepEqual(after.layers, ['base', 'python', 'architecture'])
    assert.deepEqual(after.stack, ['python'])
    assert.equal(after.architecture, true)
    assert.equal(after.adopted, before.adopted)
    // A later run naming fewer layers removes none of them.
    runCli(['.', '--no-hooks'], repo)
    assert.deepEqual(JSON.parse(readFileSync(manifestPath, 'utf8')).layers, ['base', 'python', 'architecture'])
  } finally {
    removeSandbox(repo)
  }
})

test('a dry run reports what the real run does', () => {
  const args = ['--name', 'demo', '--no-hooks', '--stack', 'go', '--with-architecture']
  const rows = output => output.split('\n').filter(row => /^ {2}[a-z]+ +\S/u.test(row) && !row.includes('dry run')).join('\n')
  const dryRepo = makeSandbox()
  const realRepo = makeSandbox()
  try {
    const dry = runCli(['.', ...args, '--dry-run'], dryRepo)
    const real = runCli(['.', ...args], realRepo)
    assert.equal(dry.code, 0, dry.output)
    assert.match(dry.output, /appended\s+AGENTS\.md/u)
    assert.equal(rows(dry.output), rows(real.output))
  } finally {
    removeSandbox(dryRepo)
    removeSandbox(realRepo)
  }
})

test('a merge target that is not a JSON object stops the run', () => {
  const repo = scaffold(['--no-hooks'])
  try {
    const gatesPath = join(repo, 'scripts', 'gates', 'gates.json')
    writeFileSync(gatesPath, '[]\n', 'utf8')
    for (const extra of [[], ['--dry-run']]) {
      const result = runCli(['.', '--no-hooks', '--stack', 'go', ...extra], repo)
      assert.equal(result.code, 2)
      assert.match(result.output, /gates\.json: the file holds an array, not a JSON object/u)
    }
    assert.equal(readFileSync(gatesPath, 'utf8'), '[]\n')
  } finally {
    removeSandbox(repo)
  }
})

test('its own hook with CRLF endings is still its own', () => {
  const repo = scaffold()
  try {
    const hook = join(repo, '.githooks', 'pre-commit')
    writeFileSync(hook, readFileSync(hook, 'utf8').replace(/\n/gu, '\r\n'), 'utf8')
    const again = runCli(['.'], repo)
    assert.equal(again.code, 0, again.output)
    assert.match(again.output, /kept\s+\.githooks\/pre-commit\s+already installed/u)
    assert.doesNotMatch(again.output, /gates are not wired/u)
  } finally {
    removeSandbox(repo)
  }
})

test('core.hooksPath spelled another way is still .githooks', () => {
  for (const spelling of ['./.githooks', '.githooks/', 'ABSOLUTE']) {
    const repo = makeSandbox()
    const emptyConfig = join(repo, 'no-global-config')
    writeFileSync(emptyConfig, '', 'utf8')
    const env = gitConfigEnv(emptyConfig)
    try {
      const value = spelling === 'ABSOLUTE' ? join(repo, '.githooks') : spelling
      spawnSync('git', ['-C', repo, 'config', '--local', 'core.hooksPath', value], { env })
      const result = spawnSync(process.execPath, [join(PACKAGE_ROOT, 'src', 'cli.mjs'), '.', '--name', 'demo'], { cwd: repo, encoding: 'utf8', env })
      const output = `${result.stdout}${result.stderr}`
      assert.equal(result.status, 0, output)
      assert.doesNotMatch(output, /not activated/u, `${value} names the repository's own hook directory`)
    } finally {
      removeSandbox(repo)
    }
  }
})

test('refuses an unknown skill beside all', () => {
  const repo = makeSandbox()
  try {
    const result = runCli(['.', '--skills', 'all,bogus'], repo)
    assert.equal(result.code, 2)
    assert.match(result.output, /unknown skill "bogus"/u)
  } finally {
    removeSandbox(repo)
  }
})
