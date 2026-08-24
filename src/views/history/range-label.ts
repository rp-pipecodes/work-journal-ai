/**
 * The Filter's day axis in words, for the one control that now carries it.
 *
 * A range reads as a range rather than as two dates side by side: the reader's
 * own locale decides how the ends join, and everything the two ends share —
 * the month, the year — is said once. In UTC for the same reason
 * `formatJournalDay` is: a Journal Day is a `YYYY-MM-DD` label, which parses
 * as UTC midnight and would otherwise read as the previous evening.
 */
const DAYS = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
})

export function formatDayRange(from: string, to: string): string {
  // A range whose ends are equal is one day, and says so once.
  if (from === to) return DAYS.format(new Date(from))

  return DAYS.formatRange(new Date(from), new Date(to))
}
