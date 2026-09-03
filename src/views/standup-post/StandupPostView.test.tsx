// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { fakeDesktop, type FakeDesktop } from '@/platform/testing/desktop'
import { createJournal, formatJournalDay, type Journal } from '@/journal/journal'
import { fixedClock, openTestDatabase } from '@/journal/testing/database'
import { createAppSettings } from '@/settings/app-settings'
import type { StandupFailure } from '@/platform/desktop'
import {
  buildStandupMaterial,
  selectStandupPost,
} from '@/journal/standup-post'
import StandupPostView from './StandupPostView'

const openDatabases: Array<() => void> = []

afterEach(() => {
  cleanup()
  for (const close of openDatabases.splice(0)) close()
})

const STORED = { modelBaseUrl: 'https://api.openai.com/v1', model: 'gpt-test' }

async function standupPostAt(stored: Record<string, unknown> = STORED) {
  const { driver, close } = await openTestDatabase()
  openDatabases.push(close)
  const clock = fixedClock('2026-03-12T09:00:00')
  const journal = createJournal({ clock, driver })
  const desktop = fakeDesktop({ driver, stored })
  const settings = createAppSettings(desktop)
  return { clock, desktop, settings, journal }
}

function renderStandupPost({
  desktop,
  settings,
  journal,
  clock,
  onOpenSettings = () => undefined,
}: {
  desktop: FakeDesktop
  settings: ReturnType<typeof createAppSettings>
  journal: Journal
  clock: ReturnType<typeof fixedClock>
  onOpenSettings?: () => void
}) {
  render(
    <StandupPostView
      desktop={desktop}
      settings={settings}
      journal={Promise.resolve(journal)}
      clock={clock}
      onOpenSettings={onOpenSettings}
    />,
  )
}

/** A yesterday holding both a Note and a completed Task, and a today holding open Tasks. */
async function journalWithBothHalves(
  journal: Journal,
  clock: ReturnType<typeof fixedClock>,
): Promise<void> {
  clock.set(new Date('2026-03-11T09:00:00'))
  await journal.capture('#ops shipped the migration')
  clock.set(new Date('2026-03-11T09:05:00'))
  await journal.capture('plain note')
  const completed = await journal.createTask('kept yesterday')
  await journal.completeTask(completed.id)

  clock.set(new Date('2026-03-12T09:00:00'))
  await journal.createTask('overdue', { date: '2026-03-10', time: null })
  await journal.createTask('today', { date: '2026-03-12', time: '17:00' })
  await journal.createTask('upcoming', { date: '2026-03-13', time: null })
}

/**
 * A Recurring Task one of whose occurrences was completed yesterday: the
 * series was created on the 10th for the 11th at 09:00, opened on yesterday's
 * slot, and was completed at 10:00 that morning. The parent continues, and a
 * reanchoring edit moves its Open slot out of the Standup Post's Open half —
 * which a schedule edit does without touching the kept history — so the tests
 * that use this see the occurrence and its count on their own.
 */
async function journalWithCompletedOccurrence(
  journal: Journal,
  clock: ReturnType<typeof fixedClock>,
): Promise<void> {
  clock.set(new Date('2026-03-11T08:00:00'))
  const daily = await journal.createTask(
    'water the plants',
    { date: '2026-03-11', time: '09:00' },
    { unit: 'day', interval: 1, weekdays: [] },
  )

  clock.set(new Date('2026-03-11T10:00:00'))
  await journal.completeTask(daily.id)

  clock.set(new Date('2026-03-12T09:00:00'))
  await journal.editTask(daily.id, {
    description: 'water the plants',
    schedule: { date: '2026-03-16', time: '09:00' },
  })
}

describe('Standup Post section', () => {
  it('shows yesterday’s date and the counts for both halves', async () => {
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })

    expect(
      await screen.findByText(
        `Yesterday: ${formatJournalDay('2026-03-11')}`,
      ),
    ).toBeTruthy()
    expect(await screen.findByText('2 Notes')).toBeTruthy()
    expect(await screen.findByText('1 Completed Task')).toBeTruthy()
    expect(await screen.findByText('0 recurring completions')).toBeTruthy()
    expect(await screen.findByText('2 Open Tasks')).toBeTruthy()
    expect(await screen.findByRole('button', { name: 'Generate' })).toBeTruthy()
  })

  it('counts recurring completions separately from Completed Tasks', async () => {
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithCompletedOccurrence(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })

    // The occurrence is not a Completed Task, so the summary never folds it
    // into that count: the user sees what a billable call is about to spend
    // itself on, and a Task Occurrence is a different record.
    expect(await screen.findByText('0 Completed Tasks')).toBeTruthy()
    expect(await screen.findByText('1 recurring completion')).toBeTruthy()
  })

  it('sends the completed occurrence in the material a call is written from', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithCompletedOccurrence(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await screen.findByText('The standup post the model wrote.')
    expect(desktop.standupRequests[0].userContent).toContain(
      '- [x] water the plants (occurrence 2026-03-11 09:00)',
    )
  })

  it('says Nothing to say when both halves are empty, and refuses Generate without spending a call', async () => {
    const { clock, desktop, settings, journal } = await standupPostAt()

    renderStandupPost({ journal, clock, desktop, settings })

    expect(await screen.findByText('Nothing to say yet.')).toBeTruthy()
    expect(screen.getByText('0 Notes')).toBeTruthy()
    expect(screen.getByText('0 Completed Tasks')).toBeTruthy()
    expect(screen.getByText('0 Open Tasks')).toBeTruthy()

    // The refusal is on screen before a call could be spent: nothing was
    // asked for, and nothing could be.
    const generate = screen.getByRole('button', { name: 'Generate' })
    expect((generate as HTMLButtonElement).disabled).toBe(true)
    expect(desktop.standupRequests).toEqual([])
  })

  it('generates from yesterday’s Notes and the Tasks, and Copy puts it on the clipboard', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    // The model's post is on screen, named by the model that wrote it.
    expect(
      await screen.findByText('The standup post the model wrote.'),
    ).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Written by gpt-test' })).toBeTruthy()

    // What was sent: the settings' Base URL and Model, the system prompt the
    // settings hold — the shipped one while the store says nothing about it —
    // and the selection's own Digest and Task lists.
    expect(desktop.standupRequests).toHaveLength(1)
    const request = desktop.standupRequests[0]
    expect(request.baseUrl).toBe('https://api.openai.com/v1')
    expect(request.model).toBe('gpt-test')
    expect(request.systemPrompt).toContain('standup post')
    expect(request.userContent).toContain('- #ops shipped the migration')
    expect(request.userContent).toContain('## Completed yesterday')
    expect(request.userContent).toContain('## Still to do')

    await user.click(screen.getByRole('button', { name: 'Copy post' }))

    await waitFor(() => {
      expect(desktop.clipboard).toBe('The standup post the model wrote.')
    })
    // Said twice: the live region beside the button and the toast.
    expect(
      await screen.findAllByText('Copied the standup post to the clipboard.'),
    ).toBeTruthy()
  })

  it('copies the exact Standup Material with zero model calls and no Model Access', async () => {
    const user = userEvent.setup()
    // No Model Access at all — the state this button exists for.
    const { journal, clock, desktop, settings } = await standupPostAt({})
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Copy material' })

    await user.click(screen.getByRole('button', { name: 'Copy material' }))

    const expected = await buildStandupMaterial({
      journal,
      selection: await selectStandupPost({ journal, clock }),
    })
    await waitFor(() => {
      expect(desktop.clipboard).toBe(expected)
    })
    // The Markdown carries both halves, exactly as a call would send it.
    expect(desktop.clipboard).toContain('- #ops shipped the migration')
    expect(desktop.clipboard).toContain('## Completed yesterday')
    expect(desktop.clipboard).toContain('## Still to do')
    expect(
      await screen.findAllByText(
        'Copied the standup material to the clipboard.',
      ),
    ).toBeTruthy()
    // No Model Access was read and no call was spent.
    expect(desktop.standupRequests).toEqual([])
  })

  it('keeps Copy material enabled and correct after a post exists', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByText('The standup post the model wrote.')

    // Prose has arrived; the lossless rendering is still there, still live —
    // that is the point of a second rendering.
    const copyMaterial = screen.getByRole('button', {
      name: 'Copy material',
    }) as HTMLButtonElement
    expect(copyMaterial.disabled).toBe(false)

    // Built before the click: the fixture's clock is shared with the section,
    // and what the selection describes must not move while the copy lands.
    const expected = await buildStandupMaterial({
      journal,
      selection: await selectStandupPost({ journal, clock }),
    })
    await user.click(copyMaterial)
    await waitFor(() => {
      expect(desktop.clipboard).toBe(expected)
    })
    // Each confirmation is beside its own button and names its own subject:
    // a shared flag would let a material copy light up beside the post.
    // Scoped to the rows, because the toasts of earlier tests outlive them
    // in the document.
    expect(
      within(copyMaterial.parentElement as HTMLElement).getByRole('status')
        .textContent,
    ).toBe('Copied the standup material to the clipboard.')
    expect(
      within(
        screen.getByRole('button', { name: 'Copy post' })
          .parentElement as HTMLElement,
      ).getByRole('status').textContent,
    ).toBe('')
  })

  it('keeps Copy material working after a generation failure', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)
    desktop.standupPostResponse = {
      state: 'failed',
      failure: { kind: 'offline' },
    }

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByRole('alert')

    // No post ever arrived; the material is still one click away.
    await user.click(screen.getByRole('button', { name: 'Copy material' }))
    const expected = await buildStandupMaterial({
      journal,
      selection: await selectStandupPost({ journal, clock }),
    })
    await waitFor(() => {
      expect(desktop.clipboard).toBe(expected)
    })
  })

  it('disables Copy material under the same refusal as Generate', async () => {
    const { clock, desktop, settings, journal } = await standupPostAt()

    renderStandupPost({ journal, clock, desktop, settings })

    expect(await screen.findByText('Nothing to say yet.')).toBeTruthy()
    expect(
      (screen.getByRole('button', { name: 'Copy material' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true)
  })

  it('says when copying the material could not be written', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)
    let copies = 0
    const write = desktop.copyToClipboard.bind(desktop)
    desktop.copyToClipboard = async (text) => {
      copies += 1
      // The post copy, if any, still works; the material's write is refused.
      if (text === 'The standup post the model wrote.') return write(text)
      throw new Error('the clipboard refused')
    }

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Copy material' })

    await user.click(screen.getByRole('button', { name: 'Copy material' }))

    await waitFor(() => {
      if (
        !document.body.textContent?.includes(
          'Could not copy the standup material.',
        )
      ) {
        throw new Error('the failed material copy was not said')
      }
    })
    expect(copies).toBe(1)
  })

  it('shows a pending state naming the model while the call is in flight', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const answer = desktop.generateStandupPost.bind(desktop)
    desktop.generateStandupPost = async (request) => {
      await held
      return answer(request)
    }

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    // Ten silent seconds read as broken without this line naming the model.
    expect(await screen.findByText('Writing with gpt-test…')).toBeTruthy()
    expect(screen.queryByText('The standup post the model wrote.')).toBeNull()

    release()
    expect(
      await screen.findByText('The standup post the model wrote.'),
    ).toBeTruthy()
  })

  it('spends only one call when Generate is asked twice in a row', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    let release!: () => void
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const answer = desktop.generateStandupPost.bind(desktop)
    desktop.generateStandupPost = async (request) => {
      await held
      return answer(request)
    }

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    // Two clicks while the first call is still in flight: a model call is
    // billable, so the second must not become a second call.
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    release()

    await screen.findByText('The standup post the model wrote.')
    expect(desktop.standupRequests).toHaveLength(1)
  })

  it('asks the model under the prompt the user wrote in Settings', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt({
      ...STORED,
      standupPrompt: 'Write it in pirate speak.',
    })
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await screen.findByText('The standup post the model wrote.')
    expect(desktop.standupRequests[0].systemPrompt).toBe(
      'Write it in pirate speak.',
    )
  })

  it('sends the shipped prompt, not an empty one, when the stored prompt is cleared', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt({
      ...STORED,
      standupPrompt: '',
    })
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    await screen.findByText('The standup post the model wrote.')
    const prompt = desktop.standupRequests[0].systemPrompt
    expect(prompt).not.toBe('')
    // A model asked nothing does not write a standup post: the cleared field
    // reads as the shipped prompt again.
    expect(prompt).toContain('standup post')
  })

  it('generates from today’s Tasks alone when yesterday is empty', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journal.createTask('today', { date: '2026-03-12', time: '17:00' })

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(
      await screen.findByText('The standup post the model wrote.'),
    ).toBeTruthy()
    expect(desktop.standupRequests[0].userContent).toBe(
      `## Still to do\n- [ ] today (scheduled 2026-03-12 17:00)`,
    )
  })

  it('reports Model Access missing without spending a call, and links to Settings', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt({})
    await journalWithBothHalves(journal, clock)
    const onOpenSettings = vi.fn()

    renderStandupPost({ journal, clock, desktop, settings, onOpenSettings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(
      await screen.findByText(
        'Model Access is not configured. Open Settings to add a Base URL, a Model and an API Key.',
      ),
    ).toBeTruthy()
    expect(desktop.standupRequests).toEqual([])

    await user.click(screen.getByRole('button', { name: 'Open Settings' }))
    expect(onOpenSettings).toHaveBeenCalledTimes(1)
  })

  it('says a call could not be prepared rather than blaming the network', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop } = await standupPostAt()
    await journalWithBothHalves(journal, clock)
    // The settings file itself will not open — a local failure, with no model
    // call behind it and no network involved.
    const settings = createAppSettings({
      ...desktop,
      openSettingsStore: async () => {
        throw new Error('the settings file would not open')
      },
    })

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(
      await screen.findByText('Could not ask for a Standup Post. Try again.'),
    ).toBeTruthy()
    expect(desktop.standupRequests).toEqual([])
  })

  it.each([
    [{ kind: 'model-access' }, 'Model Access is not configured'],
    [{ kind: 'keychain' }, 'macOS is not letting Work Journal reach the API Key'],
    [{ kind: 'offline' }, 'The model could not be reached'],
    [{ kind: 'unauthorized' }, 'The model refused the API Key (401)'],
    [{ kind: 'rate-limited' }, 'The model is rate limited (429)'],
    [{ kind: 'timeout' }, 'The model took longer than 60 seconds'],
    [{ kind: 'other', status: 502 }, 'The model answered with an error (502)'],
    [{ kind: 'empty-response' }, 'The model returned nothing'],
  ] as Array<[StandupFailure, string]>)(
    'renders %s as a line and nothing else',
    async (failure, line) => {
      const user = userEvent.setup()
      const { journal, clock, desktop, settings } = await standupPostAt()
      await journalWithBothHalves(journal, clock)
      desktop.standupPostResponse = { state: 'failed', failure }

      renderStandupPost({ journal, clock, desktop, settings })
      await screen.findByRole('button', { name: 'Generate' })

      await user.click(screen.getByRole('button', { name: 'Generate' }))

      expect((await screen.findByRole('alert')).textContent).toContain(line)
      // No failure touches the clipboard.
      expect(desktop.clipboard).toBeNull()
      // And none writes the journal: the Notes are exactly the two captured.
      expect(
        (await journal.notesForFilter({ from: '2026-03-11', to: '2026-03-11' }))
          .length,
      ).toBe(2)
    },
  )

  it('keeps the previous post on screen when a second Generate fails', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByText('The standup post the model wrote.')

    // A second call goes wrong. The clipboard has never been touched, and the
    // post the first call wrote stays on screen for the reader to still use.
    desktop.standupPostResponse = {
      state: 'failed',
      failure: { kind: 'timeout' },
    }
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(
      await screen.findByText('The model took longer than 60 seconds to answer. Try again.'),
    ).toBeTruthy()
    expect(screen.getByText('The standup post the model wrote.')).toBeTruthy()
    expect(desktop.clipboard).toBeNull()
    expect(desktop.standupRequests).toHaveLength(2)
  })

  it('replaces the post when Generate is asked again', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByText('The standup post the model wrote.')

    desktop.standupPostResponse = {
      state: 'generated',
      markdown: 'The second post, replacing the first.',
    }
    await user.click(screen.getByRole('button', { name: 'Generate' }))

    expect(
      await screen.findByText('The second post, replacing the first.'),
    ).toBeTruthy()
    expect(screen.queryByText('The standup post the model wrote.')).toBeNull()
  })

  it('never writes the clipboard when generating, even after a Copy', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByText('The standup post the model wrote.')
    await user.click(screen.getByRole('button', { name: 'Copy post' }))
    await waitFor(() => {
      expect(desktop.clipboard).toBe('The standup post the model wrote.')
    })

    // The copy is the only thing that writes the clipboard: a fresh post
    // replaces what is on screen, not what is on the clipboard.
    desktop.standupPostResponse = {
      state: 'generated',
      markdown: 'The replacement post.',
    }
    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByText('The replacement post.')

    expect(desktop.clipboard).toBe('The standup post the model wrote.')
  })

  it('says when a copy could not be written', async () => {
    const user = userEvent.setup()
    const { journal, clock, desktop, settings } = await standupPostAt()
    await journalWithBothHalves(journal, clock)
    desktop.copyToClipboard = async () => {
      throw new Error('the clipboard refused')
    }

    renderStandupPost({ journal, clock, desktop, settings })
    await screen.findByRole('button', { name: 'Generate' })

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    await screen.findByText('The standup post the model wrote.')
    await user.click(screen.getByRole('button', { name: 'Copy post' }))

    await waitFor(() => {
      if (!document.body.textContent?.includes('Could not copy the standup post.')) {
        throw new Error('the failed copy was not said')
      }
    })
  })
})
