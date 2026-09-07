import { Checkbox } from '@/components/ui/checkbox'
import type { CalendarInfo } from '@/platform/desktop'

/**
 * Which calendars an Import reads. None are ticked to begin with, because the
 * app cannot tell which of them mean work — a calendar nobody ticked is ignored
 * entirely rather than swept quietly.
 *
 * Shown wherever Import is offered — the Settings section and the Onboarding
 * flow's Meeting Import step — ticking the same saved list through the same
 * saves. One control, however many flows show it.
 */
export function CalendarTicks({
  calendars,
  ticked,
  onToggle,
}: {
  calendars: CalendarInfo[]
  ticked: string[]
  onToggle: (id: string, ticked: boolean) => void
}) {
  if (calendars.length === 0) {
    return <p className="type-meta text-muted-foreground">No calendars to read.</p>
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
