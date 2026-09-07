import type { CalendarAccess } from '@/platform/desktop'

/**
 * Why Import is not on, when the reason is macOS rather than the user. Both
 * answers are routine: a grant is keyed to the binary, so every rebuilt release
 * starts as one macOS has no record of.
 *
 * Said in the same words wherever Import is offered — the Settings section
 * and the Onboarding flow's Meeting Import step — so one reason lives in one
 * place.
 */
export function describeCalendarAccess(
  access: Exclude<CalendarAccess, 'granted'>,
): string {
  return access === 'denied'
    ? 'macOS is not allowing Work Journal to read your calendars. Turn Calendars on for Work Journal in System Settings › Privacy & Security, then switch this back on.'
    : 'macOS has not been asked about your calendars — a rebuilt Work Journal is a new app as far as it is concerned. Meetings are not being imported; everything else in the journal is unaffected.'
}
