/**
 * Sequencing for the Standup Post section: one read on open, refreshes when
 * Notes or Tasks change, and a rollover when the previous calendar day moves.
 * The view renders what this session delivers; it does not own the
 * coordination.
 */

import type { Desktop, Unlisten } from '@/platform/desktop'
import {
  msUntilNextJournalDay,
  type Clock,
  type Journal,
} from './journal'
import {
  selectStandupPost,
  type StandupPostSelection,
} from './standup-post'

export type StandupPostState =
  | { state: 'loading' }
  | { state: 'ready'; selection: StandupPostSelection }
  | { state: 'unreadable' }

export interface StandupPostSession {
  /** Starts listening and reads the material for the first time. */
  start(): Promise<void>
  /** Gives up all listeners and the calendar rollover. */
  stop(): void
}

export function createStandupPostSession({
  journal,
  desktop,
  clock,
  onChange,
}: {
  journal: Promise<Journal>
  desktop: Desktop
  clock: Clock
  onChange: (state: StandupPostState) => void
}): StandupPostSession {
  let running = false
  let rollover: ReturnType<typeof setTimeout> | null = null
  let unlisten: Unlisten[] = []
  let latestRead = 0

  async function read(): Promise<void> {
    const readTicket = ++latestRead

    try {
      const resolvedJournal = await journal
      const selection = await selectStandupPost({
        journal: resolvedJournal,
        clock,
      })
      if (!running || latestRead !== readTicket) return
      onChange({ state: 'ready', selection })
    } catch (error) {
      console.error('could not read the Standup Post material', error)
      if (running && latestRead === readTicket) onChange({ state: 'unreadable' })
    }
  }

  function armRollover(): void {
    if (!running) return

    rollover = setTimeout(() => {
      void read().then(armRollover)
    }, msUntilNextJournalDay(clock.now()))
  }

  return {
    async start() {
      running = true
      const refresh = () => void read()
      const stopListening = await Promise.all([
        desktop.onJournalChanged(refresh),
        desktop.onTasksChanged(refresh),
        desktop.onWindowFocused(refresh),
        desktop.onSystemWoke(refresh),
      ])

      if (!running) {
        for (const stop of stopListening) stop()
        return
      }

      unlisten = stopListening
      await read()
      armRollover()
    },

    stop() {
      running = false
      latestRead += 1
      if (rollover !== null) clearTimeout(rollover)
      rollover = null
      for (const stop of unlisten) stop()
      unlisten = []
    },
  }
}
