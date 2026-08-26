import { useId, useState } from 'react'
import { CalendarPlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import {
  formatWeekday,
  journalDayFor,
  weekdayOf,
  type Recurrence,
  type RecurrenceUnit,
  type TaskSchedule,
  type TaskTiming,
} from '@/journal/journal'

/**
 * What a Task is committed to: the day and minute it is meant to be done on,
 * and how often that comes round again. The one place in the app that offers
 * either, used by both surfaces that set one — the Task Creation window and
 * the Task Editor — so the gesture is the same wherever it is made and the
 * dependencies between the fields are written down once.
 *
 * The date is the prerequisite for both the time and the cadence: clearing it
 * clears them with it, because a minute with no day is not a schedule and a
 * cadence with no starting date cannot be counted. Whether clearing it needs
 * asking first is the caller's, not this control's — only the Editor has an
 * existing recurrence to stop.
 *
 * Nothing here reads the Task Description. Schedule words in it are never
 * interpreted — the date, the time and the cadence are chosen here and nowhere
 * else; see CONTEXT.md.
 *
 * Deliberately plain fields rather than calendars and menus in popovers: the
 * Task Creation window is transparent, undecorated and only as tall as its view
 * asks for, so anything drawn outside the panel is clipped by the window's own
 * edge. A control that worked in one of the two surfaces and not the other
 * would not be one control.
 */
export default function ScheduleFields({
  schedule,
  recurrence,
  onChange,
  disabled = false,
}: {
  /** What is set now, or null while the Task is Unscheduled. */
  schedule: TaskSchedule | null
  /** The cadence, or null while the Task does not repeat. */
  recurrence: Recurrence | null
  /**
   * Both halves at once, because they move together: the caller never has to
   * work out that clearing a date also cleared a cadence.
   */
  onChange: (next: TaskTiming) => void
  disabled?: boolean
}) {
  const dateId = useId()
  const timeId = useId()
  const cadenceId = useId()
  const intervalId = useId()
  // What is in the interval field while it is being retyped, which is not
  // always a cadence: clearing it to type "12" empties it first, and a field
  // that snapped to 1 on the way past would fight the user for the second
  // digit. Null while the field is showing the committed cadence.
  const [draftInterval, setDraftInterval] = useState<string | null>(null)

  /** The cadence cannot outlive the date it would be counted from. */
  function setSchedule(next: TaskSchedule | null) {
    onChange({ schedule: next, recurrence: next === null ? null : recurrence })
  }

  function setUnit(unit: RecurrenceUnit | 'none') {
    if (unit === 'none' || schedule === null) {
      onChange({ schedule, recurrence: null })
      return
    }

    onChange({
      schedule,
      recurrence: {
        unit,
        interval: recurrence?.interval ?? 1,
        // A weekly cadence starts on the weekday the user already chose, which
        // is the one thing they have said about it.
        weekdays:
          unit === 'week'
            ? recurrence?.weekdays.length
              ? recurrence.weekdays
              : [weekdayOf(schedule.date)]
            : [],
      },
    })
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 type-meta">
        {schedule === null ? (
          // An empty date field cannot say it is empty: WebKit fills one with
          // today's date in grey, which is indistinguishable from a date the
          // user chose — so the Task reads as scheduled for today while the
          // time and the cadence stay disabled with no visible reason. An
          // Unscheduled Task therefore offers an action instead of a field,
          // and taking it starts the schedule on today, which is the date the
          // empty field was pretending to hold anyway.
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() =>
              setSchedule({ date: journalDayFor(new Date()), time: null })
            }
            className="text-muted-foreground"
          >
            <CalendarPlusIcon />
            Add a date
          </Button>
        ) : (
          <>
            <label htmlFor={dateId} className="sr-only">
              Scheduled For
            </label>
            <Input
              id={dateId}
              type="date"
              disabled={disabled}
              value={schedule.date}
              onChange={(event) =>
                setSchedule(
                  event.target.value === ''
                    ? null
                    : { date: event.target.value, time: schedule.time },
                )
              }
              className="h-8 w-40 tabular-nums"
            />

            {/* And the same for the minute of it: an empty time field reads as
                a time WebKit chose, and a date alone must never look like it
                carries one — that is the difference between a Task that will
                raise a Task Alert and one that will not. Asking for a time
                starts it at the current one, which the field then edits;
                emptying the field puts this action back. */}
            {schedule.time === null ? (
              <Button
                variant="ghost"
                size="sm"
                disabled={disabled}
                onClick={() =>
                  setSchedule({ ...schedule, time: timeOfDay(new Date()) })
                }
                className="text-muted-foreground"
              >
                Add a time
              </Button>
            ) : (
              <>
                <label htmlFor={timeId} className="sr-only">
                  Time
                </label>
                <Input
                  id={timeId}
                  type="time"
                  disabled={disabled}
                  value={schedule.time}
                  onChange={(event) =>
                    setSchedule({
                      ...schedule,
                      time:
                        event.target.value === '' ? null : event.target.value,
                    })
                  }
                  className="h-8 w-28 tabular-nums"
                />
              </>
            )}

            {!disabled && (
              <Button
                variant="ghost"
                size="sm"
                aria-label="Clear the schedule"
                onClick={() => setSchedule(null)}
                className="text-muted-foreground"
              >
                <XIcon />
                Clear
              </Button>
            )}
          </>
        )}
      </div>

      <div className="flex items-center gap-2 type-meta">
        <label htmlFor={cadenceId} className="sr-only">
          Repeats
        </label>
        <select
          id={cadenceId}
          // A cadence is counted from a starting date, so there has to be one.
          disabled={disabled || schedule === null}
          value={recurrence?.unit ?? 'none'}
          onChange={(event) => setUnit(event.target.value as RecurrenceUnit | 'none')}
          className="h-8 rounded-md border border-input bg-transparent px-2 text-foreground outline-none disabled:opacity-50 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
        >
          <option value="none">Does not repeat</option>
          <option value="day">Daily</option>
          <option value="week">Weekly</option>
          <option value="month">Monthly</option>
          <option value="year">Yearly</option>
        </select>

        {recurrence !== null && (
          <>
            <label htmlFor={intervalId} className="text-muted-foreground">
              every
            </label>
            <Input
              id={intervalId}
              type="number"
              min={1}
              // Whole units only, and said in the control rather than left to
              // the journal to refuse: a cadence counts calendar units, and
              // half of one is not a unit. Without it the field takes "1.5"
              // quite happily and the save is what fails.
              step={1}
              disabled={disabled}
              aria-label={`How many ${recurrence.unit}s between occurrences`}
              value={draftInterval ?? recurrence.interval}
              onChange={(event) => {
                setDraftInterval(event.target.value)

                // A field mid-retype says nothing about the cadence, so the
                // committed one is left exactly as it was until it does.
                const asked = Math.round(Number(event.target.value))
                if (event.target.value === '' || !Number.isFinite(asked)) return

                onChange({
                  schedule,
                  recurrence: { ...recurrence, interval: Math.max(1, asked) },
                })
              }}
              // Whatever was being typed is over: the field goes back to
              // showing the cadence that was actually committed.
              onBlur={() => setDraftInterval(null)}
              className="h-8 w-16 tabular-nums"
            />
            <span className="text-muted-foreground">
              {recurrence.interval === 1 ? recurrence.unit : `${recurrence.unit}s`}
            </span>
          </>
        )}

        {/* Seven small buttons rather than a menu: the Task Creation panel is a
            fixed width and a fixed height, so this row has to fit beside the
            cadence without wrapping and without drawing outside the panel. */}
        {recurrence?.unit === 'week' && (
          <ToggleGroup
            aria-label="Which weekdays it repeats on"
            multiple
            spacing={0}
            disabled={disabled}
            className="ml-auto gap-0.5"
            value={recurrence.weekdays.map(String)}
            onValueChange={(chosen) => {
              const weekdays = chosen
                .map(Number)
                .sort((one, other) => one - other)
              // A weekly cadence with nothing selected repeats on no day at
              // all. The sole remaining weekday is disabled below so this
              // reads as unavailable rather than as a press that did nothing,
              // and this is the guard behind that.
              if (weekdays.length === 0) return
              onChange({ schedule, recurrence: { ...recurrence, weekdays } })
            }}
          >
            {[1, 2, 3, 4, 5, 6, 7].map((weekday) => (
              <ToggleGroupItem
                key={weekday}
                value={String(weekday)}
                aria-label={formatWeekday(weekday)}
                // The last one standing cannot be turned off, so it says so
                // rather than springing back under the cursor. Every other
                // weekday stays pressable, which is how it is turned off: by
                // choosing another one first.
                disabled={
                  disabled ||
                  (recurrence.weekdays.length === 1 &&
                    recurrence.weekdays[0] === weekday)
                }
                className="size-6 rounded-sm! p-0 type-micro data-pressed:bg-primary data-pressed:text-primary-foreground"
              >
                {formatWeekday(weekday).slice(0, 1)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
      </div>
    </div>
  )
}

/** The wall-clock minute an instant falls on, as Scheduled For writes one. */
function timeOfDay(instant: Date): string {
  return [
    String(instant.getHours()).padStart(2, '0'),
    String(instant.getMinutes()).padStart(2, '0'),
  ].join(':')
}
