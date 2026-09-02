import { describe, expect, it, vi } from 'vitest'
import { saySettled } from './saySettled'

/**
 * What a group does with a save is decided when it settles, and the order is
 * the contract: the group's own answer first — the problem line, the rollback
 * — then the toast, so what the user is told agrees with what they can see.
 */

/** A `says` that remembers what it was told, in the order it was told. */
function recordingSays() {
  const said: string[] = []
  return {
    said,
    success: (message: string, id?: string) => {
      said.push(`success ${id}: ${message}`)
    },
    failure: (message: string, id?: string) => {
      said.push(`failure ${id}: ${message}`)
    },
  }
}

describe('saySettled', () => {
  it('says what was saved, against the setting’s own id, once the write settles', async () => {
    const says = recordingSays()

    saySettled(says, Promise.resolve('the statuses'), {
      id: 'the-setting',
      saved: 'Saved.',
      couldNot: 'Could not.',
    })
    // Nothing is said while the write is in flight — it may still be refused.
    expect(says.said).toEqual([])

    await expect
      .poll(() => says.said)
      .toEqual(['success the-setting: Saved.'])
  })

  it('says what could not be saved, and logs the refusal as what it was', async () => {
    const says = recordingSays()
    const refused = new Error('the file is read-only')
    const logged: unknown[][] = []
    vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      logged.push(args)
    })

    saySettled(says, Promise.reject(refused), {
      id: 'the-setting',
      saved: 'Saved.',
      couldNot: 'Could not.',
      what: 'could not save the thing',
    })

    await expect
      .poll(() => says.said)
      .toEqual(['failure the-setting: Could not.'])
    expect(logged).toEqual([['could not save the thing', refused]])
    vi.restoreAllMocks()
  })

  it('lets the group answer a refusal that is already said on screen without logging it twice', async () => {
    const says = recordingSays()
    const errorLog = vi.spyOn(console, 'error').mockImplementation(() => {})

    saySettled(says, Promise.reject(new Error('it is already the Task Hotkey')), {
      id: 'hotkey-note',
      saved: 'Note Hotkey saved.',
      couldNot: 'Could not save the Note Hotkey.',
    })

    await expect
      .poll(() => says.said)
      .toEqual(['failure hotkey-note: Could not save the Note Hotkey.'])
    expect(errorLog).not.toHaveBeenCalled()
    vi.restoreAllMocks()
  })

  it('runs the group’s own answer before the toast, on either end', async () => {
    const says = recordingSays()
    const happened: string[] = []

    saySettled(says, Promise.resolve('the statuses'), {
      id: 'hotkey-note',
      saved: 'Note Hotkey saved.',
      couldNot: 'Could not save the Note Hotkey.',
      onSaved: (status) => {
        happened.push(`chips: ${String(status)}`)
      },
      onRefused: () => {
        happened.push('problem line')
      },
    })

    await expect
      .poll(() => [...happened, ...says.said])
      .toEqual(['chips: the statuses', 'success hotkey-note: Note Hotkey saved.'])
  })

  it('rolls back before saying the refusal, and says nothing of a save that did not happen', async () => {
    const says = recordingSays()
    const happened: string[] = []
    vi.spyOn(console, 'error').mockImplementation(() => {})

    saySettled(says, Promise.reject(new Error('the OS refused')), {
      id: 'start-at-login',
      saved: 'Work Journal will start at login.',
      couldNot: 'Could not change whether Work Journal starts at login.',
      what: 'could not change the login item',
      onSaved: () => {
        happened.push('a save that did not happen')
      },
      onRefused: () => {
        happened.push('rollback')
      },
    })

    await expect
      .poll(() => [...happened, ...says.said])
      .toEqual([
        'rollback',
        'failure start-at-login: Could not change whether Work Journal starts at login.',
      ])
    vi.restoreAllMocks()
  })
})
