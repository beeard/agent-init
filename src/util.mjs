/** Shared helpers for the scaffolder: naming, dates, and JSON file I/O. */

import { readFileSync, writeFileSync } from 'node:fs'

/**
 * Convert a free-form name into a lowercase kebab-case slug usable as a skill prefix.
 * @param value - Any project name or directory basename.
 * @returns The slug, or `'project'` when nothing alphanumeric survives.
 */
export function slugify(value) {
  const slug = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
  return slug === '' ? 'project' : slug
}

/**
 * Today's date as `yyyy-mm-dd` in the local time zone.
 * @returns The local calendar date.
 */
export function today() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/**
 * Read a UTF-8 text file.
 * @param path - Absolute file path.
 * @returns File contents.
 */
export function readText(path) {
  return readFileSync(path, 'utf8')
}

/**
 * Read and parse a JSON file.
 * @param path - Absolute file path.
 * @returns The parsed value.
 */
export function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

/**
 * Serialize a value as pretty JSON with a trailing newline.
 * @param value - Any JSON-serializable value.
 * @returns Two-space-indented JSON ending in exactly one newline.
 */
export function toJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`
}

/**
 * Write a UTF-8 text file.
 * @param path - Absolute file path.
 * @param content - Text to write.
 */
export function writeText(path, content) {
  writeFileSync(path, content, 'utf8')
}

/**
 * Replace `{{TOKEN}}` placeholders in a string.
 * @param input - Text that may contain placeholders.
 * @param variables - Map of token name to replacement value.
 * @returns The substituted text; unknown tokens are left untouched.
 */
export function substitute(input, variables) {
  return input.replace(/\{\{([A-Z_]+)\}\}/gu, (match, token) =>
    Object.hasOwn(variables, token) ? variables[token] : match)
}

/**
 * Whether a value is a plain object (not null, not an array).
 * @param value - Any value.
 * @returns True for object literals.
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
