import { useId } from 'react'
import { XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { TaskSchedule } from '@/journal/journal'

/**
 * Scheduled For, as the two explicit controls that set it — the one place in
 * the app that offers a Task a date and a time, used by both surfaces that set
 * one: the Task Creation window and the Task Editor. One control rather than
 * two so the gesture is the same wherever it is made, and so the field
 * dependency between them is written down once.
 *
 * Nothing here reads the Task Description. Schedule words in it are never
 * interpreted — the date and the time are chosen here and nowhere else; see
 * CONTEXT.md.
 *
 * Deliberately two fields rather than a calendar in a popover: the Task
 * Creation window is transparent, undecorated and only as tall as its view
 * asks for, so anything drawn outside the panel is clipped by the window's own
 * edge. A control that worked in one of the two surfaces and not the other
 * would not be one control.
 */
export default function ScheduleFields({
  schedule,
  onChange,
  disabled = false,
}: {
  /** What is set now, or null while the Task is Unscheduled. */
  schedule: TaskSchedule | null
  onChange: (schedule: TaskSchedule | null) => void
  disabled?: boolean
}) {
  const dateId = useId()
  const timeId = useId()

  return (
    <div className="flex items-center gap-2 type-meta">
      <label htmlFor={dateId} className="sr-only">
        Scheduled For
      </label>
      <Input
        id={dateId}
        type="date"
        disabled={disabled}
        value={schedule?.date ?? ''}
        onChange={(event) =>
          // The date is the prerequisite: clearing it clears the time with it,
          // because a time with no day is not a schedule.
          onChange(
            event.target.value === ''
              ? null
              : { date: event.target.value, time: schedule?.time ?? null },
          )
        }
        className="h-8 w-40 tabular-nums"
      />

      <label htmlFor={timeId} className="sr-only">
        Time
      </label>
      <Input
        id={timeId}
        type="time"
        // A time is a minute of a day, so there has to be a day first.
        disabled={disabled || schedule === null}
        value={schedule?.time ?? ''}
        onChange={(event) =>
          schedule !== null &&
          onChange({
            ...schedule,
            time: event.target.value === '' ? null : event.target.value,
          })
        }
        className="h-8 w-28 tabular-nums"
      />

      {schedule !== null && !disabled && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Clear the schedule"
          onClick={() => onChange(null)}
          className="text-muted-foreground"
        >
          <XIcon />
          Clear
        </Button>
      )}
    </div>
  )
}
