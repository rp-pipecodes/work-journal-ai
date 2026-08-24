//! The user's calendars, as the app is allowed to see them.
//!
//! Read straight out of the local macOS store through EventKit, which is why
//! there is no OAuth and no network call anywhere in Import: a Google account
//! synced through Calendar.app arrives here as an ordinary `CalDAV` source.
//!
//! Nothing here decides anything. Which events become Notes, what their Bodies
//! read as and which have been handled already are all the journal's — see
//! `meetingsToImport` in `src/journal/journal.ts`. This module answers three
//! questions and no others: what am I allowed to read, which calendars are
//! there, and what is on them today.
//!
//! Reading events needs `NSCalendarsFullAccessUsageDescription` in the running
//! bundle's `Info.plist` — without it macOS refuses in milliseconds and shows
//! no dialog at all. Tauri merges `src-tauri/Info.plist` into the bundle; a
//! bare `tauri dev` binary has no bundle and therefore cannot hold a grant.
//! See `docs/calendar-access.md`.

use serde::Serialize;

/// What the OS currently allows. Must match `CalendarAccess` in
/// `src/platform/desktop.ts`.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Access {
    Granted,
    Denied,
    /// Nobody has been asked — or macOS has no record of *this* binary, which
    /// is the ordinary state of a freshly built release: the grant is keyed to
    /// the code signature, so every rebuild starts here again.
    Undetermined,
}

/// One calendar, as Settings lists it. Must match `CalendarInfo` in
/// `src/platform/desktop.ts`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarInfo {
    pub id: String,
    pub title: String,
    /// The account it came from: two calendars can share a title.
    pub source: String,
}

/// One event, as the journal reads it. Must match `CalendarEvent` in
/// `src/journal/journal.ts`.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarEvent {
    pub id: String,
    pub calendar_id: String,
    pub title: String,
    /// Milliseconds since the epoch — a real instant, which is what makes an
    /// Imported Note sort into the morning its meeting happened in.
    pub starts_at: f64,
    pub ends_at: f64,
    pub is_all_day: bool,
    /// Whether the user's own attendance says Declined.
    pub is_declined: bool,
}

#[cfg(target_os = "macos")]
mod event_kit {
    use super::{Access, CalendarEvent, CalendarInfo};
    use block2::RcBlock;
    use objc2_event_kit::{
        EKAuthorizationStatus, EKCalendar, EKEntityType, EKEvent, EKEventStore, EKParticipantStatus,
    };
    use objc2_foundation::{NSCalendar, NSDate};
    use std::sync::mpsc;
    use std::time::Duration;

    /// How long to wait for an answer before giving up on the prompt. Only
    /// reached when the dialog is left standing; the answer is the same either
    /// way, since the status is read back from the OS afterwards.
    const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

    pub fn access() -> Access {
        let status = unsafe { EKEventStore::authorizationStatusForEntityType(EKEntityType::Event) };

        match status {
            EKAuthorizationStatus::FullAccess => Access::Granted,
            EKAuthorizationStatus::NotDetermined => Access::Undetermined,
            // Denied, Restricted, and WriteOnly, which cannot read events at
            // all. Nothing to distinguish for the app: it is not allowed.
            _ => Access::Denied,
        }
    }

    /// Asks, through the OS, and waits for the answer. Asking again once macOS
    /// has an answer on file does not put a second dialog up — it answers for
    /// the user — which is what keeps the app from nagging.
    pub fn request_access() -> Access {
        let store = unsafe { EKEventStore::new() };
        let (sender, receiver) = mpsc::channel();

        let completion = RcBlock::new(
            move |_granted: objc2::runtime::Bool, _error: *mut objc2_foundation::NSError| {
                // The status is read back from the OS rather than trusted from
                // here, so a refusal and a failure end up in the same place.
                let _ = sender.send(());
            },
        );

        unsafe {
            store.requestFullAccessToEventsWithCompletion(RcBlock::as_ptr(&completion));
        }

        if receiver.recv_timeout(PROMPT_TIMEOUT).is_err() {
            log::warn!("the calendar prompt was never answered");
        }

        access()
    }

    pub fn calendars() -> Vec<CalendarInfo> {
        if !matches!(access(), Access::Granted) {
            return Vec::new();
        }

        let store = unsafe { EKEventStore::new() };

        unsafe {
            store
                .calendarsForEntityType(EKEntityType::Event)
                .iter()
                .map(|calendar| CalendarInfo {
                    id: calendar.calendarIdentifier().to_string(),
                    title: calendar.title().to_string(),
                    source: calendar
                        .source()
                        .map(|source| source.title().to_string())
                        .unwrap_or_default(),
                })
                .collect()
        }
    }

    /// Everything on today's calendars, from local midnight to the next. The
    /// window is the machine's own day because a Journal Day is, and the
    /// journal narrows it further from there.
    pub fn todays_events() -> Vec<CalendarEvent> {
        if !matches!(access(), Access::Granted) {
            return Vec::new();
        }

        let store = unsafe { EKEventStore::new() };

        unsafe {
            let day = NSCalendar::currentCalendar();
            let start = day.startOfDayForDate(&NSDate::now());
            let end = NSDate::dateWithTimeInterval_sinceDate(86_400.0, &start);

            let predicate =
                store.predicateForEventsWithStartDate_endDate_calendars(&start, &end, None);

            store
                .eventsMatchingPredicate(&predicate)
                .iter()
                .map(|event| describe(&event))
                .collect()
        }
    }

    /// One event in the journal's terms.
    unsafe fn describe(event: &EKEvent) -> CalendarEvent {
        let starts_at = unsafe { event.startDate() };
        let ends_at = unsafe { event.endDate() };

        CalendarEvent {
            // Shared by every occurrence of a recurring event; the journal
            // pairs it with the start instant to tell occurrences apart.
            id: unsafe { event.eventIdentifier() }
                .map(|id| id.to_string())
                .unwrap_or_else(|| unsafe { event.calendarItemIdentifier() }.to_string()),
            calendar_id: unsafe { event.calendar() }
                .map(|calendar: objc2::rc::Retained<EKCalendar>| {
                    calendar.calendarIdentifier().to_string()
                })
                .unwrap_or_default(),
            title: unsafe { event.title() }.to_string(),
            starts_at: milliseconds(&starts_at),
            ends_at: milliseconds(&ends_at),
            is_all_day: unsafe { event.isAllDay() },
            is_declined: unsafe { declined(event) },
        }
    }

    /// Whether the user themselves declined. Read from the attendee EventKit
    /// marks as the current user; an event the user is not an attendee of —
    /// one they made themselves — is never declined.
    unsafe fn declined(event: &EKEvent) -> bool {
        unsafe { event.attendees() }.is_some_and(|attendees| {
            attendees.iter().any(|attendee| {
                attendee.isCurrentUser()
                    && attendee.participantStatus() == EKParticipantStatus::Declined
            })
        })
    }

    fn milliseconds(date: &NSDate) -> f64 {
        date.timeIntervalSince1970() * 1000.0
    }
}

#[cfg(not(target_os = "macos"))]
mod event_kit {
    use super::{Access, CalendarEvent, CalendarInfo};

    /// There is no local calendar store to read anywhere else, so Import is
    /// simply never allowed: Settings shows it off, and the journal is
    /// untouched.
    pub fn access() -> Access {
        Access::Denied
    }

    pub fn request_access() -> Access {
        Access::Denied
    }

    pub fn calendars() -> Vec<CalendarInfo> {
        Vec::new()
    }

    pub fn todays_events() -> Vec<CalendarEvent> {
        Vec::new()
    }
}

pub use event_kit::{access, calendars, request_access, todays_events};
