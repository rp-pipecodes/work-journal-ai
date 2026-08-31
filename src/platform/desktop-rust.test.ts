/**
 * The names shared with the Rust side, checked. A window label, a section name
 * or an event name that stops matching its counterpart in `src-tauri/src/lib.rs`
 * is silent: no error, no failed build, and no symptom except a window that
 * never hears something. This reads the Rust source as text, because that is
 * enough — there is no build step and no generated file in the Rust tree.
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
  type MainSection,
  SECTION_REQUESTED_EVENT,
  SETTINGS_FILE,
  SYSTEM_WOKE_EVENT,
  TASK_ALERT_OPENED_EVENT,
  TASK_CREATION_SHOWN_EVENT,
  TASK_CREATION_WINDOW,
  THEME_KEY,
} from './desktop'

const TEST_FILE = 'src/platform/desktop-rust.test.ts'
const RUST_FILE = 'src-tauri/src/lib.rs'

/**
 * Every shared string, under the name the Rust side declares it by. The
 * sections are the three members of `MainSection`, which is a type rather than
 * three constants — written out here, and checked against the type.
 */
const shared = {
  CAPTURE_WINDOW,
  TASK_CREATION_WINDOW,
  MAIN_WINDOW,
  HISTORY_SECTION: 'history' satisfies MainSection,
  TASKS_SECTION: 'tasks' satisfies MainSection,
  SETTINGS_SECTION: 'settings' satisfies MainSection,
  CAPTURE_SHOWN_EVENT,
  TASK_CREATION_SHOWN_EVENT,
  COPY_YESTERDAY_DIGEST_EVENT,
  SYSTEM_WOKE_EVENT,
  SECTION_REQUESTED_EVENT,
  TASK_ALERT_OPENED_EVENT,
  SETTINGS_FILE,
  THEME_KEY,
  DATABASE_URL,
}

function read(file: string): string {
  return readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8')
}

/** `const NAME: &str = "value";`, which is how every shared name is declared. */
function rustStrings(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/^const ([A-Z][A-Z0-9_]*): &str = "(.*)";$/gm)].map(
      ([, name, value]) => [name, value],
    ),
  )
}

/**
 * The doc comments that claim a name matches one in the Rust file, paired with
 * the names they claim it of — so that a name declared with such a comment and
 * missing from `shared` above fails rather than going unchecked.
 *
 * A comment that names no constant of its own is not one of these: the
 * `__THEME__` global is written by a Rust method rather than declared as a
 * shared string, and there is nothing here for it to be checked against.
 */
function mustMatchComments(source: string): [string, string[]][] {
  return [...source.matchAll(/\/\*\*[\s\S]*?\*\//g)]
    .map(([comment]): [string, string[]] => [
      comment,
      [...comment.matchAll(/`([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)`/g)].map(
        ([, name]) => name,
      ),
    ])
    .filter(
      ([comment, names]) =>
        /ust match/.test(comment) &&
        comment.includes(RUST_FILE) &&
        names.length > 0,
    )
}

const rust = rustStrings(read(RUST_FILE))
const comments = mustMatchComments(read('src/platform/desktop.ts'))

describe('the names shared with the Rust side', () => {
  for (const [name, value] of Object.entries(shared)) {
    it(`declares ${name} the same on both sides`, () => {
      expect(
        rust.get(name),
        `${name} is ${JSON.stringify(value)} in src/platform/desktop.ts and ` +
          `${JSON.stringify(rust.get(name))} in ${RUST_FILE}`,
      ).toBe(value)
    })
  }

  it('checks every name declared with a "must match" comment', () => {
    const claimed = comments.flatMap(([, names]) => names)

    expect(claimed.length).toBeGreaterThan(0)
    expect(claimed.filter((name) => !(name in shared))).toEqual([])
  })

  it('points every "must match" comment at this test', () => {
    for (const [comment] of comments) {
      expect(comment, comment).toContain(TEST_FILE)
    }
  })
})
