/**
 * Require a docstring on every public module, class, function, and method.
 *
 * The analysis runs through Python's own `ast` module in a subprocess rather
 * than a regular-expression scan. Python ships a correct parser; reimplementing
 * a partial one in JavaScript would misread decorators, nested definitions, and
 * multi-line signatures, and would report findings that are wrong rather than
 * merely incomplete.
 *
 * "Public" means a name without a leading underscore, which is the convention
 * Python itself uses. `@overload` stubs are exempt: they carry no behavior and
 * their implementation carries the docstring.
 *
 * `--staged` checks only the Python files staged for commit, which is how the
 * pre-commit hook uses it.
 */

import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'
import { collectFiles, isMain, readConfig } from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/**
 * The analysis program, run by the target repository's own interpreter.
 *
 * It reads file paths as arguments and writes one JSON array to stdout. A file
 * that fails to parse is reported as a finding rather than crashing the run,
 * because a syntax error is something the author needs to see.
 */
const ANALYSIS = `
import ast, json, sys

def is_overload(node):
    for decorator in node.decorator_list:
        if isinstance(decorator, ast.Name) and decorator.id == 'overload':
            return True
        if isinstance(decorator, ast.Attribute) and decorator.attr == 'overload':
            return True
    return False

def public_defs(body, inside_class):
    for node in body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            if is_overload(node):
                continue
            yield node, 'method' if inside_class else 'function'
        elif isinstance(node, ast.ClassDef):
            yield node, 'class'
            # Methods of a public class are public API; a nested function is
            # implementation detail and is never descended into.
            yield from public_defs(node.body, True)

findings = []
for path in sys.argv[1:]:
    try:
        with open(path, encoding='utf-8') as handle:
            source = handle.read()
    except OSError as error:
        findings.append({'file': path, 'line': 1, 'name': '<unreadable>', 'kind': 'io', 'detail': str(error)})
        continue
    try:
        tree = ast.parse(source, filename=path)
    except SyntaxError as error:
        findings.append({'file': path, 'line': error.lineno or 1, 'name': '<syntax error>', 'kind': 'syntax', 'detail': error.msg})
        continue
    if ast.get_docstring(tree) is None:
        findings.append({'file': path, 'line': 1, 'name': '<module>', 'kind': 'module', 'detail': 'no module docstring'})
    for node, kind in public_defs(tree.body, False):
        if node.name.startswith('_'):
            continue
        if ast.get_docstring(node) is not None:
            continue
        findings.append({'file': path, 'line': node.lineno, 'name': node.name, 'kind': kind, 'detail': 'no docstring'})

json.dump(findings, sys.stdout)
`

/**
 * Find the interpreter to analyze with.
 * @returns The executable name, or null when neither `python3` nor `python` runs.
 */
function interpreter() {
  for (const candidate of ['python3', 'python']) {
    const probe = spawnSync(candidate, ['-c', 'import ast'], { encoding: 'utf8' })
    if (probe.status === 0) return candidate
  }
  return null
}

/**
 * List the Python files staged for commit.
 * @param root - Absolute repository root.
 * @param relPaths - Current absolute paths mapped from their repository-relative form.
 * @returns Staged Python paths, or null when Git cannot answer.
 */
function stagedPython(root) {
  const result = spawnSync('git', [
    '-C', root, 'diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z', '--',
  ], { encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 })
  if (result.status !== 0) return null
  return result.stdout.toString('utf8').split('\0').filter(path => path.endsWith('.py'))
}

/**
 * Resolve which files to analyze.
 * @param root - Absolute repository root.
 * @param stagedOnly - Whether to restrict the run to staged files.
 * @returns Absolute paths plus the repository-relative path used in messages.
 */
function selectFiles(root, stagedOnly) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const globs = config.pythonGlobs ?? ['**/*.py']
  const excluded = new Set(config.pythonSkipDirectories ?? [])
  const isSkipped = relPath => relPath.split('/').some(segment => excluded.has(segment))

  if (!stagedOnly) {
    return collectFiles(root, globs, isSkipped)
      .map(file => ({ abs: file.abs, relPath: file.realPath ?? file.relPath }))
  }

  const staged = stagedPython(root)
  if (staged === null) {
    console.error('verify-python-docstrings: --staged needs a Git worktree; falling back to the whole repository')
    return collectFiles(root, globs, isSkipped)
      .map(file => ({ abs: file.abs, relPath: file.realPath ?? file.relPath }))
  }
  return staged.filter(relPath => !isSkipped(relPath)).map(relPath => ({ abs: resolve(root, relPath), relPath }))
}

/**
 * Analyze the selected files for missing docstrings.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` restricts the run to staged Python files.
 * @returns Findings, the number of files inspected, and any fatal error message.
 */
export function checkDocstrings(root, { stagedOnly = false } = {}) {
  const files = selectFiles(root, stagedOnly)
  if (files.length === 0) return { findings: [], checked: 0, fatal: null }

  const python = interpreter()
  if (python === null) {
    return {
      findings: [],
      checked: 0,
      fatal: 'no Python interpreter found (tried python3, python); install one or remove this gate from gates.json',
    }
  }

  const result = spawnSync(python, ['-c', ANALYSIS, ...files.map(file => file.abs)], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (result.status !== 0) {
    return { findings: [], checked: files.length, fatal: `analysis failed: ${(result.stderr ?? '').trim()}` }
  }

  let parsed
  try {
    parsed = JSON.parse(result.stdout)
  } catch (error) {
    return { findings: [], checked: files.length, fatal: `analysis produced invalid JSON: ${error.message}` }
  }

  // The analyzer reports the absolute path it was given; report the path the
  // reader would use.
  const byAbsolute = new Map(files.map(file => [file.abs, file.relPath]))
  const findings = parsed.map(finding => ({
    relPath: byAbsolute.get(finding.file) ?? finding.file,
    line: finding.line,
    name: finding.name,
    kind: finding.kind,
    detail: finding.detail,
  }))
  return { findings, checked: files.length, fatal: null }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { findings, checked, fatal } = checkDocstrings(ROOT, { stagedOnly: process.argv.includes('--staged') })
  if (fatal !== null) {
    console.error(`verify-python-docstrings: ${fatal}`)
    return 1
  }
  if (findings.length === 0) {
    console.log(`verify-python-docstrings: ${checked} file(s) checked, every public definition is documented.`)
    return 0
  }
  console.error(`verify-python-docstrings: ${findings.length} undocumented public definition(s) in ${checked} file(s):`)
  for (const finding of findings) {
    console.error(`  ${finding.relPath}:${finding.line}  ${finding.kind} ${finding.name} — ${finding.detail}`)
  }
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}

/** Exported for tests, so the analysis program can be inspected without running it. */
export { ANALYSIS }
