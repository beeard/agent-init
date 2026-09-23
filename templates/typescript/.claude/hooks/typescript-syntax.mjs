/**
 * Report the syntax errors in one TypeScript file, using the compiler the
 * repository depends on.
 *
 * The compiler parses the file alone, so this finds what makes the file
 * unreadable — a missing brace, a stray token — and not type errors, which
 * need the whole program and belong to `verify-typescript-types`.
 *
 * Exits 0 when the file parses, 1 with each error's line and column when it
 * does not, and 127 when the `typescript` package cannot be resolved from the
 * project root.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join, relative, resolve } from 'node:path'

const file = resolve(process.argv[2])
let ts
try {
  ts = createRequire(join(process.cwd(), 'package.json'))('typescript')
  if (typeof ts?.transpileModule !== 'function') throw new Error('the typescript package does not expose the compiler API')
} catch (error) {
  console.error(`typescript is not resolvable from the project (${error instanceof Error ? error.message : String(error)}); run npm install`)
  process.exit(127)
}

const { diagnostics = [] } = ts.transpileModule(readFileSync(file, 'utf8'), {
  fileName: file,
  reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.Preserve },
})
const errors = diagnostics.filter(diagnostic => diagnostic.category === ts.DiagnosticCategory.Error)
for (const diagnostic of errors) {
  let where = ''
  if (diagnostic.file !== undefined && diagnostic.start !== undefined) {
    const { line, character } = diagnostic.file.getLineAndCharacterOfPosition(diagnostic.start)
    where = `:${line + 1}:${character + 1}`
  }
  console.error(`${relative(process.cwd(), file)}${where}  ${ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n')}`)
}
process.exitCode = errors.length > 0 ? 1 : 0
