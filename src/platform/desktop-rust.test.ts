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
  MAIN_WINDOW,
  SECTION_REQUESTED_EVENT,
  SETTINGS_FILE,
  START_AT_LOGIN_KEY,
  SYSTEM_WOKE_EVENT,
  TASK_ALERT_OPENED_EVENT,
  TASK_CREATION_SHOWN_EVENT,
  TASK_CREATION_WINDOW,
  THEME_KEY,
} from './desktop'

const TEST_FILE = 'src/platform/desktop-rust.test.ts'
const RUST_FILE = 'src-tauri/src/lib.rs'
const DESKTOP_FILE = 'src/platform/desktop.ts'

function read(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
}

/**
 * The members of the `MainSection` union, under the name the Rust side declares
 * each by. Read from the source rather than imported, because `MainSection` is
 * a type: a member renamed in it and nowhere else is a change `vitest run`
 * would otherwise never see, and one renamed here is then checked — and found
 * missing — under its new name.
 *
 * A union this cannot read yields no sections at all, which would leave them
 * unchecked rather than failing. What catches that is the coverage test below:
 * the comment on `MainSection` names all three, and every name a "must match"
 * comment claims has to be checked here.
 */
function sectionStrings(source: string): Record<string, string> {
  const union = source.match(/export type MainSection =([^\n]*)/)?.[1] ?? ''

  return Object.fromEntries(
    [...union.matchAll(/'([^']*)'/g)].map(([, section]) => [
      `${section.toUpperCase()}_SECTION`,
      section,
    ]),
  )
}

const desktop = read(DESKTOP_FILE)

/** Every shared string, under the name the Rust side declares it by. */
const shared: Record<string, string> = {
  CAPTURE_WINDOW,
  TASK_CREATION_WINDOW,
  MAIN_WINDOW,
  ...sectionStrings(desktop),
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

/** `const NAME: &str = "value";`, which is how every shared name is declared. */
function rustStrings(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/^const ([A-Z][A-Z0-9_]*): &str = "(.*)";$/gm)].map(
      ([, name, value]) => [name, value],
    ),
  )
}

/** Both comment forms: a TypeScript `/** *\/` block and a run of Rust `///`. */
function docComments(source: string): string[] {
  return [
    ...(source.match(/\/\*\*[\s\S]*?\*\//g) ?? []),
    ...(source.match(/(?:^[ \t]*\/\/[^\n]*\n)+/gm) ?? []),
  ]
}

/**
 * The comments in one file that claim a name matches one in the other, paired
 * with the names they claim it of — so that a name declared with such a comment
 * and missing from `shared` above fails rather than going unchecked.
 *
 * A comment that names no constant of its own is not one of these: the
 * `__THEME__` global is written by a Rust method rather than declared as a
 * shared string, and there is nothing here for it to be checked against.
 */
function mustMatchComments(
  source: string,
  otherFile: string,
): [string, string[]][] {
  return docComments(source)
    .map((comment): [string, string[]] => [
      comment,
      [...comment.matchAll(/`([A-Z][A-Z0-9_]*)`/g)].map(([, name]) => name),
    ])
    .filter(
      ([comment, names]) =>
        /[Mm]ust match/.test(comment) &&
        comment.includes(otherFile) &&
        names.length > 0,
    )
}

const rustSource = read(RUST_FILE)
const rust = rustStrings(rustSource)
const comments = mustMatchComments(desktop, RUST_FILE)
/**
 * Both sides' claims. The Rust side's are held to the pointer rule below and
 * to nothing else: its geometry comments name `CAPTURE_HEIGHT` and the rest,
 * which are deliberately not checked here, so demanding a counterpart for
 * every name it claims would demand the one thing this test does not do.
 */
const allComments = [
  ...comments,
  ...mustMatchComments(rustSource, DESKTOP_FILE),
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

  it('checks every name declared with a "must match" comment', () => {
    const claimed = comments.flatMap(([, names]) => names)
    // Said with the Rust value, because the two ways to get here are a name
    // that never had a counterpart and a name that has one under a spelling
    // `desktop.ts` has since dropped — and which of those it is, is exactly
    // what the Rust side holding something says.
    const unchecked = claimed
      .filter((name) => !(name in shared))
      .map(
        (name) =>
          `${name} is ${JSON.stringify(rust.get(name))} in ${RUST_FILE} and ` +
          `nothing in ${DESKTOP_FILE} is checked against it`,
      )

    expect(claimed.length).toBeGreaterThan(0)
    expect(unchecked, unchecked.join('; ')).toEqual([])
  })

  it('points every "must match" comment on either side at this test', () => {
    // Only the comments claiming a name this test checks: a comment about
    // something it deliberately leaves alone has no business naming it.
    const checked = allComments.filter(([, names]) =>
      names.some((name) => name in shared),
    )

    expect(checked.length).toBeGreaterThan(0)
    for (const [comment] of checked) {
      expect(comment, comment).toContain(TEST_FILE)
    }
  })
})
