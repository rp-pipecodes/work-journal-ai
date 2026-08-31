/**
 * The names `desktop.ts` shares with the Rust side, checked. A window label, a
 * section name or an event name that stops matching its counterpart in
 * `src-tauri/src/lib.rs` is silent: no error, no failed build, and no symptom
 * except a window that never hears something. This reads the Rust source as
 * text, because that is enough — there is no build step and no generated file
 * in the Rust tree.
 *
 * The geometry constants are deliberately not here: the Rust numbers are only
 * the size a resident window is built at before its webview boots, and
 * `fitCapture` / `fitTaskCreation` set the real size from a mount effect. Drift
 * there costs one frame and then corrects itself.
 */

import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  CAPTURE_SHOWN_EVENT,
  CAPTURE_WINDOW,
  COPY_YESTERDAY_DIGEST_EVENT,
  DATABASE_URL,
  HISTORY_SECTION,
  MAIN_WINDOW,
  SECTION_REQUESTED_EVENT,
  SETTINGS_FILE,
  SETTINGS_SECTION,
  START_AT_LOGIN_KEY,
  SYSTEM_WOKE_EVENT,
  TASK_ALERT_OPENED_EVENT,
  TASK_CREATION_SHOWN_EVENT,
  TASK_CREATION_WINDOW,
  TASKS_SECTION,
  THEME_KEY,
} from './desktop'

const TEST_FILE = 'src/platform/desktop-rust.test.ts'
const RUST_FILE = 'src-tauri/src/lib.rs'
const DESKTOP_FILE = 'src/platform/desktop.ts'

function read(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
}

/**
 * What the `MainSection` union is made of: the constants it refers to, and any
 * member written as a bare string instead. Read from the source rather than
 * imported, because `MainSection` is a type — a fourth section spelled out in
 * the union has no name to be checked under, and `vitest run` compiles nothing
 * that would say so.
 */
function sectionMembers(source: string): {
  names: string[]
  literals: string[]
} {
  const union = source.match(/export type MainSection =([\s\S]*?)\n\n/)?.[1] ?? ''

  return {
    names: [...union.matchAll(/typeof ([A-Z][A-Z0-9_]*)/g)].map(
      ([, name]) => name,
    ),
    literals: [...union.matchAll(/'([^']*)'/g)].map(([, member]) => member),
  }
}

const desktop = read(DESKTOP_FILE)

/** Every shared string, under the name the Rust side declares it by. */
const shared: Record<string, string> = {
  CAPTURE_WINDOW,
  TASK_CREATION_WINDOW,
  MAIN_WINDOW,
  HISTORY_SECTION,
  TASKS_SECTION,
  SETTINGS_SECTION,
  CAPTURE_SHOWN_EVENT,
  TASK_CREATION_SHOWN_EVENT,
  COPY_YESTERDAY_DIGEST_EVENT,
  SYSTEM_WOKE_EVENT,
  SECTION_REQUESTED_EVENT,
  TASK_ALERT_OPENED_EVENT,
  SETTINGS_FILE,
  THEME_KEY,
  START_AT_LOGIN_KEY,
  DATABASE_URL,
}

/**
 * The strings `desktop.ts` declares, which is the list the checked ones are
 * drawn from: whatever is not checked against Rust has to be accounted for as
 * this side's own, so that a new one lands in neither by accident.
 */
function desktopStrings(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/^export const ([A-Z][A-Z0-9_]*) = '(.*)'$/gm)].map(
      ([, name, value]) => [name, value],
    ),
  )
}

/**
 * The announcements spoken and heard only in TypeScript. They sit in
 * `desktop.ts` so that every event name in the app is in one place, and they
 * are named here so that a name arriving there is either checked against the
 * Rust side or deliberately one of these — never neither because a comment
 * happened to be worded in a way this file did not recognise.
 */
const typeScriptOnly = new Set([
  'NOTE_CAPTURED_EVENT',
  'THEME_CHANGED_EVENT',
  'IMPORT_CHANGED_EVENT',
  'JOURNAL_CHANGED_EVENT',
  'TASKS_CHANGED_EVENT',
  'TASK_ALERTS_RECONCILED_EVENT',
])

/** `const NAME: &str = "value";`, which is how every shared name is declared. */
function rustStrings(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/^const ([A-Z][A-Z0-9_]*): &str = "(.*)";$/gm)].map(
      ([, name, value]) => [name, value],
    ),
  )
}

/**
 * Both comment forms — a TypeScript `/** *\/` block and a run of Rust `///` —
 * each as one line of prose. The line breaks and the prefixes go, because a
 * "must match" that a formatter wrapped over two lines has to read the same as
 * one that fits: a claim that goes unrecognised is a claim nothing enforces.
 */
function docComments(source: string): string[] {
  return [
    ...(source.match(/\/\*\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/(?:^[ \t]*\/\/[^\n]*\n)+/gm) ?? []),
  ].map((comment) =>
    comment
      .replace(/\/\*\*|\*\/|^\s*(\*|\/\/\/?)/gm, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  )
}

/** A comment claiming some names match the other side's, and those names. */
interface Claim {
  comment: string
  names: string[]
}

/**
 * The comments in one file that claim a name matches one in the other, with
 * the names they claim it of — so that a name declared with such a comment and
 * missing from `shared` above fails rather than going unchecked.
 *
 * A comment that names no constant of its own is not one of these: the
 * `__THEME__` global is written by a Rust method rather than declared as a
 * shared string, and there is nothing here for it to be checked against.
 */
function mustMatchComments(source: string, otherFile: string): Claim[] {
  return docComments(source)
    .map((comment) => ({
      comment,
      names: [...comment.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(
        ([, name]) => name,
      ),
    }))
    .filter(
      ({ comment, names }) =>
        /[Mm]ust match/.test(comment) &&
        comment.includes(otherFile) &&
        names.length > 0,
    )
}

const rustSource = read(RUST_FILE)
const rust = rustStrings(rustSource)
const declared = desktopStrings(desktop)

/**
 * Every claim that has to be honoured here: all of `desktop.ts`'s, and the
 * Rust ones about a string the Rust side declares. Membership of that map is
 * what leaves the geometry comments out — `CAPTURE_HEIGHT` and the rest are
 * `f64`, deliberately unchecked, and a comment about one has no business
 * naming this test.
 */
const claims: Claim[] = [
  ...mustMatchComments(desktop, RUST_FILE),
  ...mustMatchComments(rustSource, DESKTOP_FILE)
    .map(({ comment, names }) => ({
      comment,
      names: names.filter((name) => rust.has(name)),
    }))
    .filter(({ names }) => names.length > 0),
]

describe('the names shared with the Rust side', () => {
  for (const [name, value] of Object.entries(shared)) {
    it(`declares ${name} the same on both sides`, () => {
      expect(
        rust.get(name),
        `${name} is ${JSON.stringify(value)} in ${DESKTOP_FILE} and ` +
          `${JSON.stringify(rust.get(name))} in ${RUST_FILE}`,
      ).toBe(value)
    })
  }

  it('builds MainSection out of names this checks', () => {
    const { names, literals } = sectionMembers(desktop)

    // A member spelled out in the union has no constant behind it, so a drift
    // in it could only ever be reported as a section that appeared and one
    // that vanished, never as one name holding two values.
    expect(literals, literals.join('; ')).toEqual([])
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => !(name in shared))).toEqual([])
  })

  it('accounts for every string desktop.ts declares', () => {
    // The comment rule below reads prose, and prose can be written a way it
    // does not recognise. This one reads the declarations themselves, so a
    // name arriving in `desktop.ts` is either checked or called this side's
    // own, whatever its comment says.
    const unaccounted = [...declared]
      .filter(([name]) => !(name in shared) && !typeScriptOnly.has(name))
      .map(([name, value]) => `${name} = ${JSON.stringify(value)}`)

    expect(declared.size).toBeGreaterThan(0)
    expect(unaccounted, unaccounted.join('; ')).toEqual([])
  })

  it('checks every name declared with a "must match" comment', () => {
    const claimed = [...new Set(claims.flatMap(({ names }) => names))]
    // Said with both sides' values: the two ways to get here are a name that
    // never had a counterpart and a name that has one under a spelling the
    // other side has since dropped, and what each holds says which.
    const unchecked = claimed
      .filter((name) => !(name in shared))
      .map(
        (name) =>
          `${name} is ${JSON.stringify(declared.get(name))} in ` +
          `${DESKTOP_FILE} and ${JSON.stringify(rust.get(name))} in ` +
          `${RUST_FILE}, and nothing checks the pair`,
      )

    expect(claimed.length).toBeGreaterThan(0)
    expect(unchecked, unchecked.join('; ')).toEqual([])
  })

  it('points every "must match" comment on either side at this test', () => {
    expect(claims.length).toBeGreaterThan(0)
    for (const { comment } of claims) {
      expect(comment, comment).toContain(TEST_FILE)
    }
  })
})
