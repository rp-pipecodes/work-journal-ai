import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const contractTestPath = 'src/platform/desktop-rust.test.ts'
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const desktopSource = readFileSync(
  resolve(repositoryRoot, 'src/platform/desktop.ts'),
  'utf8',
)
const rustSource = readFileSync(
  resolve(repositoryRoot, 'src-tauri/src/lib.rs'),
  'utf8',
)

function comments(source: string): string[] {
  return source.match(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g) ?? []
}

function desktopConstantNames(source: string): Set<string> {
  const names = new Set(
    [...source.matchAll(/^\s*export const ([A-Z][A-Z0-9_]*)\b/gm)].map(
      ([, name]) => name,
    ),
  )
  const sections = source.match(/export type MainSection\s*=\s*([^\n]+)/)?.[1]
  for (const [, section] of sections?.matchAll(/'([^']+)'/g) ?? []) {
    names.add(`${section.toUpperCase()}_SECTION`)
  }
  return names
}

function mustMatchComments(
  source: string,
  knownNames: Set<string>,
): string[] {
  return comments(source).filter(
    (comment) =>
      /must match/i.test(comment) &&
      [...comment.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)].some(([, name]) =>
        knownNames.has(name),
      ),
  )
}

function mustMatchNames(
  source: string,
  knownNames: Set<string>,
): string[] {
  return [
    ...new Set(
      mustMatchComments(source, knownNames).flatMap((comment) =>
        [...comment.matchAll(/\b([A-Z][A-Z0-9_]*)\b/g)]
          .map(([, name]) => name)
          .filter((name) => knownNames.has(name)),
      ),
    ),
  ]
}

function typeScriptStringConstants(source: string): Map<string, string> {
  const values = new Map<string, string>()

  for (const [, name, , value] of source.matchAll(
    /^\s*export const ([A-Z][A-Z0-9_]*)\s*=\s*(['"])([^'"\r\n]*)\2\s*$/gm,
  )) {
    values.set(name, value)
  }

  const sections = source.match(/export type MainSection\s*=\s*([^\n]+)/)?.[1]
  for (const [, section] of sections?.matchAll(/'([^']+)'/g) ?? []) {
    values.set(`${section.toUpperCase()}_SECTION`, section)
  }

  return values
}

function rustStringConstants(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(
      /^\s*(?:pub\s+)?const ([A-Z][A-Z0-9_]*)\s*:\s*&str\s*=\s*"([^"\r\n]*)"\s*;/gm,
    )].map(([, name, value]) => [name, value]),
  )
}

const knownDesktopNames = desktopConstantNames(desktopSource)
const sharedNames = mustMatchNames(desktopSource, knownDesktopNames)
const typeScriptStrings = typeScriptStringConstants(desktopSource)
const rustStrings = rustStringConstants(rustSource)

describe('the Rust/TypeScript shared string contract', () => {
  it('keeps every must-match comment pointed at this test', () => {
    for (const comment of mustMatchComments(desktopSource, knownDesktopNames)) {
      expect(comment).toContain(contractTestPath)
    }
  })

  it('keeps every shared literal equal on both sides', () => {
    expect(sharedNames.length).toBeGreaterThan(0)

    for (const name of sharedNames) {
      const desktopValue = typeScriptStrings.get(name)
      const rustValue = rustStrings.get(name)
      const mismatch =
        `${name}: desktop.ts=${JSON.stringify(desktopValue)}; ` +
        `src-tauri/src/lib.rs=${JSON.stringify(rustValue)}`

      expect(desktopValue, mismatch).not.toBeUndefined()
      expect(rustValue, mismatch).toBe(desktopValue)
    }
  })
})
