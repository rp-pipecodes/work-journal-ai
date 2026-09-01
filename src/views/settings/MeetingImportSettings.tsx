import { useEffect, useState } from 'react'
import { Checkbox } from '@/components/ui/checkbox'
import { Switch } from '@/components/ui/switch'
import type {
  CalendarAccess,
  CalendarInfo,
  Desktop,
} from '@/platform/desktop'
import type { AppSettings } from '@/settings/app-settings'
import { DEFAULT_SETTINGS } from '@/settings/settings'
import type { SettingsInitialState } from './SettingsInitialState'
import {
  SettingsAside,
  SettingsGroup,
  SettingsProblem,
  SettingsRow,
} from './SettingsGroup'

/** Whether today's meetings are imported, and which calendars are read. */
export default function MeetingImportSettings({
  desktop,
  settings,
  initialSettings,
}: {
  desktop: Desktop
  settings: AppSettings
  initialSettings: Promise<SettingsInitialState | null> | null
}) {
  const [importMeetings, setImportMeetings] = useState(
    DEFAULT_SETTINGS.importMeetings,
  )
  const [importCalendars, setImportCalendars] = useState<string[]>(
    DEFAULT_SETTINGS.importCalendars,
  )
  const [calendars, setCalendars] = useState<CalendarInfo[]>([])
  // Why Import is not on, when the reason is the OS rather than the user.
  // Nothing until there is something to say.
  const [calendarProblem, setCalendarProblem] = useState<string | null>(null)

  useEffect(() => {
    if (initialSettings === null) return

    void initialSettings.then((initial) => {
      if (initial === null) return

      const { stored, calendarAccess } = initial
      setImportMeetings(stored.importMeetings)
      setImportCalendars(stored.importCalendars)

      if (calendarAccess === 'granted') {
        void desktop.calendars().then(
          setCalendars,
          (error: unknown) => {
            console.error('could not read the settings', error)
          },
        )
        setCalendarProblem(null)
        return
      }

      setCalendars([])
      // Only worth saying to someone who asked for Import: a user who has
      // never turned it on is owed no explanation for something they never
      // wanted, and the toggle says so for itself the moment they do. The
      // stored wish is the evidence, and it survives the permission going —
      // the sweep does not overwrite it, precisely so this can be said.
      setCalendarProblem(
        stored.importMeetings ? describeCalendarAccess(calendarAccess) : null,
      )
    })
  }, [desktop, initialSettings])

  // Import as the window shows it: the user's wish, less whatever macOS is
  // withholding. The stored wish outlives a lost permission — that is what
  // makes the reason sayable — so the toggle is off whenever there is a reason
  // underneath it saying why.
  const importing = importMeetings && calendarProblem === null

  /**
   * Turning Import on is also where the calendar is asked for, because it is
   * the one moment the user has said they want it. Refused, it stays off and
   * says why — the app asks once here and never again on its own.
   */
  function toggleImport(next: boolean) {
    void (async () => {
      try {
        if (!next) {
          setImportMeetings(false)
          await settings.saveImportMeetings(false)
          return
        }

        const access =
          (await desktop.calendarAccess()) === 'granted'
            ? 'granted'
            : await desktop.requestCalendarAccess()

        if (access !== 'granted') {
          // The wish is kept, not discarded: the toggle reads off because the
          // reason underneath it says so, and a grant given in System Settings
          // later resumes Import without being asked for a second time.
          setImportMeetings(true)
          setCalendarProblem(describeCalendarAccess(access))
          await settings.saveImportMeetings(true)
          return
        }

        setImportMeetings(true)
        setCalendarProblem(null)
        setCalendars(await desktop.calendars())
        await settings.saveImportMeetings(true)
      } catch (error) {
        console.error('could not change how meetings are imported', error)
        setImportMeetings(!next)
      }
    })()
  }

  /** Ticking a calendar, or unticking it — an unticked one is ignored. */
  function toggleCalendar(id: string, ticked: boolean) {
    const next = ticked
      ? [...importCalendars, id]
      : importCalendars.filter((each) => each !== id)

    setImportCalendars(next)
    settings.saveImportCalendars(next).catch((error: unknown) => {
      console.error('could not change which calendars are imported', error)
      setImportCalendars(importCalendars)
    })
  }

  return (
    <SettingsGroup>
      <SettingsRow
        label="Add today's meetings to the journal"
        explanation="Today's meetings, added to the journal as they end. Never a backfill."
        controls="import-meetings"
      >
        <Switch
          id="import-meetings"
          checked={importing}
          // Pressed, the switch means the opposite of the wish rather than
          // the opposite of what it reads: with the permission gone it reads
          // off while the wish is on, and a press there is the user
          // withdrawing it — the reason underneath goes with it. Reading the
          // switch back would ask to turn on what is already wished for,
          // leaving no way to change their mind.
          onCheckedChange={() => toggleImport(!importMeetings)}
        />
      </SettingsRow>

      {calendarProblem !== null && <SettingsProblem>{calendarProblem}</SettingsProblem>}

      {importing && (
        <CalendarTicks
          calendars={calendars}
          ticked={importCalendars}
          onToggle={toggleCalendar}
        />
      )}

      <SettingsAside>
        Imported meetings are ordinary Notes: reword them, file them under a
        Project, or delete them. Deleting one refuses that meeting for good —
        it is never added again. Declined meetings and all-day blocks are never
        added in the first place.
      </SettingsAside>
    </SettingsGroup>
  )
}

/**
 * Why Import is not on, when the reason is macOS rather than the user. Both
 * answers are routine: a grant is keyed to the binary, so every rebuilt release
 * starts as one macOS has no record of.
 */
function describeCalendarAccess(access: Exclude<CalendarAccess, 'granted'>): string {
  return access === 'denied'
    ? 'macOS is not allowing Work Journal to read your calendars. Turn Calendars on for Work Journal in System Settings › Privacy & Security, then switch this back on.'
    : 'macOS has not been asked about your calendars — a rebuilt Work Journal is a new app as far as it is concerned. Meetings are not being imported; everything else in the journal is unaffected.'
}

/**
 * Which calendars an Import reads. None are ticked to begin with, because the
 * app cannot tell which of them mean work — a calendar nobody ticked is ignored
 * entirely rather than swept quietly.
 */
function CalendarTicks({
  calendars,
  ticked,
  onToggle,
}: {
  calendars: CalendarInfo[]
  ticked: string[]
  onToggle: (id: string, ticked: boolean) => void
}) {
  if (calendars.length === 0) {
    return <SettingsAside>No calendars to read.</SettingsAside>
  }

  return (
    <fieldset className="flex flex-col gap-2 pl-1">
      <legend className="sr-only">Calendars to import from</legend>
      {calendars.map((calendar) => (
        <div key={calendar.id} className="flex items-center gap-2">
          <Checkbox
            id={`calendar-${calendar.id}`}
            checked={ticked.includes(calendar.id)}
            onCheckedChange={(next: boolean) => onToggle(calendar.id, next)}
          />
          <label htmlFor={`calendar-${calendar.id}`} className="type-meta">
            {calendar.title}
          </label>
          <span className="type-micro text-muted-foreground">
            {calendar.source}
          </span>
        </div>
      ))}
    </fieldset>
  )
}
