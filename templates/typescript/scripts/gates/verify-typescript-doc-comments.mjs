/**
 * Require a JSDoc comment on every exported declaration.
 *
 * The analysis walks the syntax tree produced by the `typescript` package
 * resolved from the target repository's own `node_modules`, never a
 * regular-expression scan over `export` lines. A hand-rolled parser does not
 * fail loudly: it reports findings that are wrong rather than merely
 * incomplete, and it misreads a declaration wrapped over several lines, a
 * re-export, and a comment that only looks attached.
 *
 * Resolving the compiler from the target repository is that repository's
 * dependency, not this package's: agent-init itself ships with no dependencies,
 * and a project that writes TypeScript has `typescript` installed already.
 *
 * "Exported" means a top-level declaration carrying an `export` or `default`
 * modifier, a declaration inside a `declare module` block (where members are
 * exported implicitly), and a declaration named by a local `export { ... }`
 * with no module specifier. A name re-exported from another module is that
 * module's declaration, and this gate reads one file at a time.
 *
 * Every one of those forms carries a contract the name alone does not, so all
 * of them are reported: a function's parameters and failure modes, a class's
 * lifetime, an interface's meaning, an enum's values, an exported value's
 * ownership, and the role that `export default` and `export =` assignments play
 * as a module's entry point.
 *
 * One exemption, stated so it is a decision rather than an oversight: a type
 * alias whose aliased type is a primitive keyword or a union of literals is not
 * reported. `type Mode = 'read' | 'write'` publishes its own members, and a
 * JSDoc above it repeats them. Every other type alias — an object type, a
 * function type, a generic, a union of named types — hides its contract behind
 * the name and is reported.
 *
 * An overloaded function is judged once, by its first declaration: the JSDoc
 * there is the one an editor shows for every signature, and it covers the
 * implementation. A namespace declared with a dotted name, `namespace A.B {}`,
 * is walked to its innermost body like any other namespace.
 *
 * Class, interface, and object-literal members are not walked: the class's
 * contract belongs in the JSDoc above the class, and requiring a comment per
 * getter would produce findings nobody reads.
 *
 * `--staged` checks only the TypeScript files staged for commit, which is how
 * the pre-commit hook uses it.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, resolve } from 'node:path'
import {
  REPOSITORY_SKIP_DIRECTORIES, collectFiles, corpusSkipPredicate, isMain, readConfig, stagedSources, stagedSubset,
} from './lib/repo-files.mjs'

const ROOT = resolve(import.meta.dirname, '..', '..')

/** The extensions this gate analyzes. */
const EXTENSIONS = ['.ts', '.tsx', '.mts', '.cts']

/**
 * Load the TypeScript compiler the target repository depends on.
 * @param root - Absolute repository root.
 * @returns The compiler module, or an error message describing why it is absent.
 */
function loadCompiler(root) {
  // Resolution starts at the repository root, so a workspace root's hoisted
  // install and a package-local one both resolve.
  const require = createRequire(join(root, 'package.json'))
  try {
    const ts = require('typescript')
    // TypeScript 7's package root exports only its version — the compiler API
    // moved behind `unstable/*` subpaths — so a module without `createSourceFile`
    // is one this gate cannot analyze with. Reporting it here keeps the failure
    // at the load, where it names the problem, instead of deep inside the walk,
    // where it surfaced as a TypeError on the first file.
    if (ts === null || typeof ts !== 'object' || typeof ts.createSourceFile !== 'function') {
      return { ts: null, error: 'the typescript package does not expose the compiler API' }
    }
    return { ts, error: null }
  } catch (error) {
    // A missing install and a broken one leave the gate equally unable to
    // analyze a file, so both are reported rather than distinguished.
    return { ts: null, error: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Resolve which files to analyze.
 *
 * A staged run is the whole-repository corpus intersected with the staged
 * paths, never the staged paths alone: a file the suite does not judge must not
 * fail a commit.
 *
 * @param root - Absolute repository root.
 * @param stagedOnly - Whether to restrict the run to staged files.
 * @returns Absolute paths plus the repository-relative path used in messages.
 */
function selectFiles(root, stagedOnly) {
  const config = readConfig(resolve(root, 'scripts', 'gates', 'config.json'))
  const globs = config.typescriptGlobs ?? ['**/*.ts', '**/*.tsx']
  const isSkipped = corpusSkipPredicate(root, config, REPOSITORY_SKIP_DIRECTORIES)
  const corpus = collectFiles(root, globs, isSkipped)
  const entry = file => ({ abs: file.abs, relPath: file.realPath ?? file.relPath })

  if (!stagedOnly) return corpus.map(entry)

  const staged = stagedSources(root)
  if (staged === null) {
    console.error('verify-typescript-doc-comments: --staged needs a Git worktree; falling back to the whole repository')
    return corpus.map(entry)
  }
  return stagedSubset(corpus, staged).map(entry)
}

/**
 * Whether a declaration carries a given modifier.
 * @param ts - The TypeScript compiler module.
 * @param node - A declaration node.
 * @param kind - A `SyntaxKind` modifier kind.
 * @returns True when the modifier is present.
 */
function hasModifier(ts, node, kind) {
  return (node.modifiers ?? []).some(modifier => modifier.kind === kind)
}

/**
 * Whether a statement publishes its declarations.
 * @param ts - The TypeScript compiler module.
 * @param node - A statement node.
 * @param ambient - Whether the statement sits in a `declare module` body, where members are exported implicitly.
 * @returns True when the declaration is part of the module's public surface.
 */
function isExported(ts, node, ambient) {
  return ambient || hasModifier(ts, node, ts.SyntaxKind.ExportKeyword) || hasModifier(ts, node, ts.SyntaxKind.DefaultKeyword)
}

/**
 * The names a binding pattern introduces.
 * @param ts - The TypeScript compiler module.
 * @param name - A binding name: an identifier, an object pattern, or an array pattern.
 * @returns Every bound identifier, in source order.
 */
function bindingNames(ts, name) {
  if (ts.isIdentifier(name)) return [name.text]
  if (ts.isObjectBindingPattern(name) || ts.isArrayBindingPattern(name)) {
    return name.elements.flatMap(element =>
      ts.isOmittedExpression(element) || element.name === undefined ? [] : bindingNames(ts, element.name))
  }
  return []
}

/**
 * The keyword a variable statement declares with.
 * @param ts - The TypeScript compiler module.
 * @param node - A variable statement.
 * @returns `using`, `const`, `let`, or `var`.
 */
function variableKind(ts, node) {
  const { flags } = node.declarationList
  if (flags & ts.NodeFlags.Using) return 'using'
  if (flags & ts.NodeFlags.Const) return 'const'
  if (flags & ts.NodeFlags.Let) return 'let'
  return 'var'
}

/**
 * The kind name reported for a declaration.
 * @param ts - The TypeScript compiler module.
 * @param node - A declaration node.
 * @returns The kind, or null for a statement this gate does not report.
 */
function declarationKind(ts, node) {
  if (ts.isFunctionDeclaration(node)) return 'function'
  if (ts.isClassDeclaration(node)) return 'class'
  if (ts.isInterfaceDeclaration(node)) return 'interface'
  if (ts.isTypeAliasDeclaration(node)) return 'type'
  if (ts.isEnumDeclaration(node)) return 'enum'
  if (ts.isModuleDeclaration(node)) return 'namespace'
  return null
}

/**
 * Whether a type alias publishes its own contract.
 * @param ts - The TypeScript compiler module.
 * @param node - A type alias declaration.
 * @returns True when the aliased type is a primitive keyword or a union of literals.
 */
function selfDocumenting(ts, node) {
  const keywords = new Set([
    ts.SyntaxKind.StringKeyword,
    ts.SyntaxKind.NumberKeyword,
    ts.SyntaxKind.BooleanKeyword,
    ts.SyntaxKind.BigIntKeyword,
    ts.SyntaxKind.SymbolKeyword,
  ])
  const transparent = type =>
    (ts.isLiteralTypeNode(type) && ts.isLiteralExpression(type.literal)) || keywords.has(type.kind)
  return transparent(node.type) || (ts.isUnionTypeNode(node.type) && node.type.types.every(transparent))
}

/**
 * Whether a declaration carries a JSDoc block.
 *
 * The compiler attaches the leading comment blocks to the declaration it
 * precedes, which is the same attachment an editor reads, so decorators, blank
 * lines, and intervening line comments are already accounted for.
 *
 * @param ts - The TypeScript compiler module.
 * @param node - A declaration node.
 * @returns True when at least one JSDoc block documents the declaration.
 */
function documented(ts, node) {
  return ts.getJSDocCommentsAndTags(node).length > 0
}

/**
 * The name an export assignment publishes.
 * @param ts - The TypeScript compiler module.
 * @param node - An export assignment.
 * @returns The exported identifier or named function or class, else `<default>` or `<export=>`.
 */
function exportAssignmentName(ts, node) {
  if (ts.isIdentifier(node.expression)) return node.expression.text
  if ((ts.isFunctionExpression(node.expression) || ts.isClassExpression(node.expression)) && node.expression.name !== undefined) {
    return node.expression.name.text
  }
  return node.isExportEquals === true ? '<export=>' : '<default>'
}

/**
 * Index the declarations of a statement list by name.
 * @param ts - The TypeScript compiler module.
 * @param statements - Top-level statements.
 * @returns Declarations keyed by the name that would be re-exported.
 */
function indexDeclarations(ts, statements) {
  const byName = new Map()
  for (const statement of statements) {
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(ts, declaration.name)) {
          if (!byName.has(name)) byName.set(name, statement)
        }
      }
      continue
    }
    if (statement.name !== undefined && ts.isIdentifier(statement.name) && !byName.has(statement.name.text)) {
      byName.set(statement.name.text, statement)
    }
  }
  return byName
}

/**
 * Collect the undocumented exports of one statement list.
 * @param ts - The TypeScript compiler module.
 * @param statements - A statement list, at the file top level or inside a module body.
 * @param ambient - Whether these statements sit in a `declare module` body.
 * @param local - Declarations of the enclosing file, keyed by name.
 * @param report - Receives one entry per undocumented export.
 */
function walkStatements(ts, statements, ambient, local, report) {
  let overloaded = null
  for (const statement of statements) {
    // Consecutive declarations of one function name are its overload signatures
    // and implementation. The JSDoc on the first is the one an editor shows for
    // every signature, so the group is judged once, by its first declaration.
    const functionName = ts.isFunctionDeclaration(statement) ? statement.name?.text ?? '<default>' : null
    const continuesGroup = functionName !== null && functionName === overloaded
    overloaded = functionName
    if (continuesGroup) continue

    if (ts.isModuleDeclaration(statement) && statement.body !== undefined) {
      // `namespace A.B {}` nests a declaration for `B` as the body of `A`; the
      // members live in the innermost block.
      let body = statement.body
      let flags = statement.flags
      const names = [statement.name.getText()]
      while (ts.isModuleDeclaration(body) && body.body !== undefined) {
        names.push(body.name.getText())
        flags |= body.flags
        body = body.body
      }
      if (!ts.isModuleBlock(body)) continue
      if (isExported(ts, statement, ambient) && !documented(ts, statement)) {
        report(statement, 'namespace', names.join('.'))
      }
      // Ambient members are exported without a modifier; a namespace member
      // needs the modifier, exactly as a module's own export does.
      const nested = ambient || (flags & ts.NodeFlags.Ambient) !== 0
      walkStatements(ts, body.statements, nested, local, report)
      continue
    }

    if (ts.isExportDeclaration(statement)) {
      if (statement.moduleSpecifier !== undefined) continue
      if (statement.exportClause === undefined || !ts.isNamedExports(statement.exportClause)) continue
      for (const element of statement.exportClause.elements) {
        const declaration = local.get((element.propertyName ?? element.name).text)
        if (declaration === undefined || documented(ts, declaration)) continue
        const kind = declarationKind(ts, declaration) ?? variableKind(ts, declaration)
        report(declaration, kind, (element.propertyName ?? element.name).text)
      }
      continue
    }

    if (ts.isExportAssignment(statement)) {
      if (documented(ts, statement)) continue
      const kind = statement.isExportEquals === true ? 'export=' : 'default'
      report(statement, kind, exportAssignmentName(ts, statement))
      continue
    }

    if (!isExported(ts, statement, ambient)) continue
    if (documented(ts, statement)) continue

    if (ts.isVariableStatement(statement)) {
      const kind = variableKind(ts, statement)
      for (const declaration of statement.declarationList.declarations) {
        for (const name of bindingNames(ts, declaration.name)) report(declaration, kind, name)
      }
      continue
    }

    const kind = declarationKind(ts, statement)
    if (kind === null) continue
    if (kind === 'type' && selfDocumenting(ts, statement)) continue
    report(statement, kind, statement.name?.getText() ?? `<${kind}>`)
  }
}

/**
 * Analyze one file for undocumented exports.
 * @param ts - The TypeScript compiler module.
 * @param file - Absolute path plus the repository-relative path used in messages.
 * @returns Findings for this file, in source order.
 */
function analyzeFile(ts, file) {
  const findings = []
  const report = (node, kind, name, detail = 'no JSDoc comment') => {
    const { line } = ts.getLineAndCharacterOfPosition(node.getSourceFile(), node.getStart())
    findings.push({ relPath: file.relPath, line: line + 1, kind, name, detail })
  }

  let text
  try {
    text = readFileSync(file.abs, 'utf8')
  } catch (error) {
    return [{ relPath: file.relPath, line: 1, name: '<unreadable>', kind: 'io', detail: error.message }]
  }

  const scriptKind = file.relPath.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const sourceFile = ts.createSourceFile(file.abs, text, ts.ScriptTarget.Latest, true, scriptKind)

  // The parser recovers and produces a tree from a malformed file. Reporting
  // its diagnostics instead of the tree keeps a file that does not compile from
  // silently shrinking the corpus.
  const syntax = sourceFile.parseDiagnostics ?? []
  if (syntax.length > 0) {
    return syntax.map((diagnostic) => {
      const { line } = ts.getLineAndCharacterOfPosition(sourceFile, diagnostic.start)
      return {
        relPath: file.relPath,
        line: line + 1,
        name: '<syntax error>',
        kind: 'syntax',
        detail: ts.flattenDiagnosticMessageText(diagnostic.messageText, ' '),
      }
    })
  }

  walkStatements(ts, sourceFile.statements, false, indexDeclarations(ts, sourceFile.statements), report)
  return findings
}

/**
 * Analyze the selected files for exports without a JSDoc comment.
 * @param root - Absolute repository root.
 * @param options - `stagedOnly` restricts the run to staged TypeScript files.
 * @returns Findings, the number of files inspected, and any fatal error message.
 */
export function checkDocComments(root, { stagedOnly = false } = {}) {
  const files = selectFiles(root, stagedOnly)
  if (files.length === 0) return { findings: [], checked: 0, fatal: null }

  const { ts, error } = loadCompiler(root)
  if (ts === null) {
    return {
      findings: [],
      checked: 0,
      fatal: `cannot load the TypeScript compiler (${error}); install it with "npm install --save-dev typescript", or remove this gate from scripts/gates/gates.json`,
    }
  }

  const findings = files.flatMap(file => analyzeFile(ts, file))
  return { findings, checked: files.length, fatal: null }
}

/**
 * Run the gate as a command.
 * @returns Process exit code.
 */
function main() {
  const { findings, checked, fatal } = checkDocComments(ROOT, { stagedOnly: process.argv.includes('--staged') })
  if (fatal !== null) {
    console.error(`verify-typescript-doc-comments: ${fatal}`)
    return 1
  }
  if (findings.length === 0) {
    console.log(`verify-typescript-doc-comments: ${checked} file(s) checked, every exported declaration is documented.`)
    return 0
  }
  console.error(`verify-typescript-doc-comments: ${findings.length} undocumented exported declaration(s) in ${checked} file(s):`)
  for (const finding of findings) {
    console.error(`  ${finding.relPath}:${finding.line}  ${finding.kind} ${finding.name} — ${finding.detail}`)
  }
  return 1
}

if (isMain(import.meta.url)) {
  process.exitCode = main()
}

/** Exported for tests, so the file selection can be inspected without the compiler. */
export { EXTENSIONS }
