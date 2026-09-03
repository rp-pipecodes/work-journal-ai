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
  STANDUP_POST_SECTION,
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
  STANDUP_POST_SECTION,
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
 *
 * A declaration wrapped after the `=` reads the same as one that fits, for the
 * reason the comments do: a name this cannot see is a name nothing accounts
 * for, and that is the one way to be missed here without a word being said.
 */
function desktopStrings(source: string): Map<string, string> {
  return new Map(
    [...source.matchAll(/^export const ([A-Z][A-Z0-9_]*) =\s+'([^']*)'/gm)].map(
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
    [...source.matchAll(/^const ([A-Z][A-Z0-9_]*): &str =\s+"([^"]*)";/gm)].map(
      ([, name, value]) => [name, value],
    ),
  )
}

/**
 * A comment as one line of prose. The line breaks and the prefixes go, because
 * a "must match" that a formatter wrapped over two lines has to read the same
 * as one that fits: a claim that goes unrecognised is a claim nothing enforces.
 */
function oneLine(comment: string): string {
  return comment
    .replace(/\/\*\*|\*\/|^\s*(\*|\/\/\/?)/gm, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The `/** *\/` blocks of `desktop.ts`. */
function desktopComments(source: string): string[] {
  return (source.match(/\/\*\*[\s\S]*?\*\//g) ?? []).map(oneLine)
}

/**
 * Each run of `///` lines in the Rust file with the constant it documents.
 * What a comment is attached to is what says whether this test can hold it to
 * anything: the geometry constants are `f64` and deliberately unchecked, and a
 * comment documenting one of those is not making a claim about a shared
 * string. Judging by the names a comment happens to mention instead would let
 * a comment naming its counterpart under some other spelling say nothing at
 * all — and it would say it silently.
 */
function rustComments(source: string): { comment: string; documents: string }[] {
  return [
    ...source.matchAll(/((?:^[ \t]*\/\/\/[^\n]*\n)+)[ \t]*const ([A-Z][A-Z0-9_]*)/gm),
  ].map(([, comment, documents]) => ({ comment: oneLine(comment), documents }))
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
function mustMatchComments(comments: string[], otherFile: string): Claim[] {
  return comments
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
 * Rust ones documenting a string the Rust side declares.
 */
const claims: Claim[] = [
  ...mustMatchComments(desktopComments(desktop), RUST_FILE),
  ...mustMatchComments(
    rustComments(rustSource)
      .filter(({ documents }) => rust.has(documents))
      .map(({ comment }) => comment),
    DESKTOP_FILE,
  ),
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

/**
 * A command that can leave a system dialog on screen must not hold the main
 * thread while it is there. `#[tauri::command]` runs the body on the main
 * thread; `#[tauri::command(async)]` runs it off it. The difference is silent —
 * it compiles, it works every time nobody is prompted, and it shows up only as
 * a frozen app in front of a prompt the user is still reading.
 *
 * The rule is not "anything that touches the OS": it is "anything that can
 * block on a person". The Keychain is one of those, because macOS puts an
 * authorization prompt in front of a read or a write whenever the binary
 * asking is not the one that saved the item — see
 * docs/adr/0026-the-api-key-lives-in-the-keychain-and-rust-makes-the-call.md,
 * which counts a denied prompt as an ordinary outcome.
 */
describe('the commands that can block on a person', () => {
  const rustSource = read(RUST_FILE)

  const BLOCKING_COMMANDS = [
    // The keychain prompts on a read or a write, not only on a first save.
    'api_key_set',
    'save_api_key',
    'clear_api_key',
    // The model call reads the Key — which can sit behind the same prompt —
    // and is then allowed 60 seconds of network.
    'generate_standup_post',
    // The two that already carry the rule, here so it reads as a rule.
    'request_calendar_access',
    'request_task_alert_permission',
    // The save dialog is the system's, and the app must not sit frozen
    // behind it while the user reads it.
    'choose_backup_location',
  ]

  it('runs the backup status read off the main thread with its siblings', () => {
    // The automatic-backups read reaches the file system, so it rides the
    // same async shape as the commands beside it.
    const declaration = rustSource.match(
      /#\[tauri::command\(async\)\]\s*fn automatic_backups\b/,
    )
    expect(declaration).toBeTruthy()
  })

  it('carries every backup command the desktop surface names', () => {
    // The webview calls these by name; a rename on either side is a Settings
    // button that answers nothing. Each must be both declared as a command
    // and listed in the invoke handler.
    const handler = rustSource.match(
      /invoke_handler\(tauri::generate_handler!\[([\s\S]*?)\]\)/,
    )?.[1]
    expect(handler, 'the invoke handler could not be read').toBeTruthy()

    for (const command of [
      'automatic_backups',
      'choose_backup_location',
      'backup_journal',
      'reveal_backups',
    ]) {
      expect(
        rustSource.match(new RegExp(`fn ${command}\\b`)),
        `${command} is not a command in ${RUST_FILE}`,
      ).toBeTruthy()
      expect(
        handler,
        `${command} is not registered in the invoke handler`,
      ).toContain(command)
    }
  })

  it.each(BLOCKING_COMMANDS)('runs %s off the main thread', (command) => {
    // An `async fn` command is off the main thread by its very shape; the
    // attribute is what a sync body needs, and is what the declaration is
    // checked for below.
    const declaration = rustSource.match(
      new RegExp(`(#\\[tauri::command[^\\]]*\\])\\s*(?:async\\s+)?fn ${command}\\b`),
    )

    expect(declaration, `${command} is not a command in ${RUST_FILE}`).toBeTruthy()
    expect(declaration?.[1]).toBe('#[tauri::command(async)]')
  })
})

/**
 * The argument names a command is invoked with, checked both ways. Tauri
 * matches the keys of the webview's invoke payload against the command's
 * parameter names — snake_case on the Rust side reads as camelCase in the
 * payload — and a name that matches nothing refuses the call before the
 * command's body runs. Silent is the cruelty of it: the build passes, the
 * fake desktop passes every test, and pressing the button reports nothing.
 *
 * Both sides are read as source, as the shared strings above are: the
 * arguments `tauri-desktop.ts` sends, and the parameters each command
 * receives. Parameters this side never sends are named here so that adding
 * one is a deliberate act rather than a silent one.
 */
describe('the arguments commands are invoked with', () => {
  const desktopSource = read(DESKTOP_FILE)

  /**
   * Every command whose arguments the webview sends, with what it sends.
   * The payload's keys must be exactly these, and Rust's parameters — read
   * back in camelCase — must match them one for one.
   */
  const invoked: Record<string, string[]> = {
    journal_transaction: ['statements'],
    reconcile_task_alerts: ['alerts'],
    set_hotkey: ['action', 'hotkey'],
    save_api_key: ['apiKey'],
    export_journal: ['markdown', 'fileName'],
    backup_journal: ['path'],
    generate_standup_post: ['request'],
    show_tray_count: ['title'],
  }

  /** The parameter names of one Rust command, in snake_case as written. */
  function rustParameters(command: string): string[] {
    const signature = rustSource.match(
      new RegExp(`(?:async )?fn ${command}\\b([\\s\\S]*?)\\) ->`),
    )?.[1]
    if (signature === undefined) {
      throw new Error(`${command} is not a command in ${RUST_FILE}`)
    }

    return [...signature.matchAll(/[(,]\s*(?:mut )?([a-z_][a-z0-9_]*):/gm)]
      .map(([, name]) => name)
      // Handled by Tauri itself — the app handle, injected state, the
      // window — are not part of the payload the webview sends, and never
      // have been: `journal_transaction`'s `databases` and `set_hotkey`'s
      // `hotkeys` ride in the command's context, not its arguments.
      .filter((name) => !['app', '_app', 'window', 'state'].includes(name))
      // State's generic is a type, not a name; `databases` and `hotkeys`
      // are `State<'_, T>` parameters and are dropped here with their kind.
      .filter((name) => !new RegExp(`${name}:\\s*tauri::State`).test(signature))
  }

  it('sends every argument with the name the command receives', () => {
    expect(Object.keys(invoked).length).toBeGreaterThan(0)

    for (const [command, sent] of Object.entries(invoked)) {
      const parameters = rustParameters(command)
        .map((name) => name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()))

      expect(
        parameters,
        `${command} receives [${parameters.join(', ')}] but the webview sends ` +
          `[${sent.join(', ')}] — a name the command does not receive refuses ` +
          'the call before its body runs',
      ).toEqual(sent)
    }
  })

  it('accounts for every command the webview invokes with arguments', () => {
    // Read from `tauri-desktop.ts` itself, so a new invoke with a payload
    // has to land in `invoked` above — checked, or named here — rather than
    // appearing silently beside them.
    const sent = [...desktopSource.matchAll(/invoke[^\n]*'([a-z_]+)'/g)].map(
      ([, command]) => command,
    )
    const withPayload = sent.filter((command) =>
      new RegExp(`'${command}'\\\\?,\\s*\\{`).test(desktopSource),
    )

    const unaccounted = withPayload.filter((command) => !(command in invoked))
    expect(unaccounted, unaccounted.join('; ')).toEqual([])
  })
})

/**
 * The Standup Post call's wire contract, checked the way the rest of the
 * shared names are — by reading both sides' sources, because a drift between
 * them is silent: no error, no failed build, and no symptom except a failure
 * that renders as a blank line. `src-tauri/src/standup.rs` also pins the
 * exact serialized shapes from its own side; these tests hold the TypeScript
 * half of the same pairs.
 */
describe('the Standup Post call contract', () => {
  const standupSource = read('src-tauri/src/standup.rs')
  const desktopSource = read(DESKTOP_FILE)

  it('spells the failure kinds the same on both sides', () => {
    const rustKinds = rustVariants(standupSource, 'StandupFailure').map(kebab)
    const tsKinds = tsUnionKinds(desktopSource, 'StandupFailure')

    expect(rustKinds).toEqual([
      'model-access',
      'keychain',
      'offline',
      'unauthorized',
      'rate-limited',
      'timeout',
      'other',
      'empty-response',
    ])
    // One kind is this side's own — a call that could not even be prepared
    // is never the model's answer, so Rust has no name for it — and it is
    // named first in the union, where the comment next to it says so.
    expect(tsKinds).toEqual(['local', ...rustKinds])
  })

  it('spells the response states the same on both sides', () => {
    const rustStates = rustVariants(standupSource, 'StandupPostResponse').map(kebab)
    const tsStates = tsUnionKinds(desktopSource, 'StandupPostResponse')

    expect(rustStates).toEqual(['generated', 'failed'])
    expect(tsStates).toEqual(rustStates)
  })

  it('names the request fields the same on both sides', () => {
    const rustFields = rustFieldNames(standupSource, 'StandupPostRequest').map(camel)
    const tsFields = tsFieldNames(desktopSource, 'StandupPostRequest')

    expect(rustFields).toEqual([
      'baseUrl',
      'model',
      'systemPrompt',
      'userContent',
    ])
    expect(tsFields).toEqual(rustFields)
  })
})

/** The variant names of one Rust enum, as written. */
function rustVariants(source: string, name: string): string[] {
  const body = source.match(new RegExp(`pub enum ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  return [...body.matchAll(/^\s*([A-Z][A-Za-z0-9]*)(?=\s*[,{(])/gm)].map(([, variant]) => variant)
}

/** The field names of one Rust struct, as written. */
function rustFieldNames(source: string, name: string): string[] {
  const body = source.match(new RegExp(`pub struct ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  return [...body.matchAll(/^\s*pub ([a-z_]+):/gm)].map(([, field]) => field)
}

/** The quoted member names of one TypeScript union, as written. */
function tsUnionKinds(source: string, name: string): string[] {
  const body = source.match(new RegExp(`export type ${name} =\\n([\\s\\S]*?)\\n\\n`))?.[1] ?? ''
  return [...body.matchAll(/'([a-z-]+)'/g)].map(([, kind]) => kind)
}

/** The field names of one TypeScript interface, as written. */
function tsFieldNames(source: string, name: string): string[] {
  const body = source.match(new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ''
  return [...body.matchAll(/^\s{2}([a-z][A-Za-z]*):/gm)].map(([, field]) => field)
}

/** `ModelAccess` to `model-access`, the serde rule the Rust side declares. */
function kebab(name: string): string {
  return name.replace(/[A-Z]/g, (letter, at) =>
    at === 0 ? letter.toLowerCase() : `-${letter.toLowerCase()}`,
  )
}

/** `base_url` to `baseUrl`, matching `#[serde(rename_all = "camelCase")]`. */
function camel(snake: string): string {
  return snake.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase())
}
