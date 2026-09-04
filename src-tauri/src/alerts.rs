//! The Task Alerts macOS holds, and delivers whether or not Work Journal is
//! still running.
//!
//! Registered through `UNUserNotificationCenter` with calendar triggers — see
//! docs/adr/0017-the-os-schedules-task-alerts.md. That is the whole reason this
//! module exists rather than the Tauri notification plugin, which sends
//! immediately and cannot durably schedule anything for after the process
//! exits. There is no network call and no push service anywhere in it: the OS
//! keeps the pending requests on this machine and fires them from its own
//! clock.
//!
//! Nothing here decides anything. Which Tasks have an Alert, when, and under
//! what identifier are all the journal's — see `taskAlerts` in
//! `src/journal/journal.ts`. This module answers three questions and no others:
//! what am I allowed to deliver, will the user allow it, and please make the
//! pending requests say exactly this.
//!
//! Delivering needs a real bundle: `UNUserNotificationCenter` reads the main
//! bundle's identifier and raises rather than returns when there is none, which
//! is exactly what a bare `tauri dev` binary is. Every entry point checks first
//! and answers as an OS that allows nothing, so development is degraded rather
//! than crashed — the same shape as the calendar grant; see
//! docs/calendar-access.md.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// What the OS currently allows. Must match `TaskAlertPermission` in
/// `src/platform/desktop.ts`.
#[derive(Clone, Copy, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Permission {
    Granted,
    Denied,
    /// Nobody has been asked yet — where every install starts, because the app
    /// asks in context when the first timed Task is saved rather than at first
    /// launch.
    Undetermined,
}

/// One Task Alert as the journal hands it over: the identifier it always
/// claims, the whole Task Description to show, and the civil date and minute
/// macOS matches its own clock against. Must match `TaskAlert` in
/// `src/journal/journal.ts`.
///
/// Civil components rather than an instant, deliberately: macOS resolves them
/// against the timezone in force when the moment arrives, which is what makes
/// "Monday at 14:00" still 14:00 after the user travels — see
/// docs/adr/0021-task-schedules-are-stored-as-civil-time.md.
#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAlert {
    pub id: String,
    pub description: String,
    pub year: i32,
    pub month: i32,
    pub day: i32,
    pub hour: i32,
    pub minute: i32,
}

/// What choosing Complete on a Task Alert carries: which Task, and the exact
/// Scheduled For the delivered banner represented. Must match
/// `TaskAlertCompletion` in `src/platform/desktop.ts`.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskAlertCompletion {
    pub alert_id: String,
    pub date: String,
    pub time: String,
}

/// The identifier of the Complete action. Completion is never inferred from
/// button text — only this identifier decides.
pub const COMPLETE_ACTION_ID: &str = "complete-task";

/// The notification category Task Alerts are registered under: one action,
/// Complete, and nothing else.
pub const TASK_ALERT_CATEGORY_ID: &str = "task-alert";

/// The `userInfo` keys carrying the delivered slot. The Task is named by the
/// pending request's identifier verbatim — which Task that is stays the
/// journal's to say — while the date and time it represented travel here,
/// spelled exactly as `TaskSchedule` spells them.
const USER_INFO_ALERT_ID: &str = "alertId";
const USER_INFO_DATE: &str = "date";
const USER_INFO_TIME: &str = "time";

/// What a notification response is, once classified: a default click opens the
/// Task, while a Complete action carries the exact delivered slot for the
/// guarded completion to check.
#[derive(Debug, PartialEq, Eq)]
pub enum AlertResponse {
    Open,
    Complete(TaskAlertCompletion),
}

/// Which response a notification response is, from the action identifier and
/// the `userInfo` payload — and nothing else.
///
/// Pure, and deliberately out of the `objc2` module so it is reachable from a
/// test on any platform; the delegate calls it and does nothing else with the
/// response. Anything that is not a Complete with a whole slot behind it is an
/// Open — including a Complete whose payload is missing, which opens the Task
/// rather than dropping the response on the floor.
pub fn classify_alert_response(
    action_id: &str,
    user_info: &HashMap<String, String>,
) -> AlertResponse {
    if action_id != COMPLETE_ACTION_ID {
        return AlertResponse::Open;
    }

    let slot = [USER_INFO_ALERT_ID, USER_INFO_DATE, USER_INFO_TIME]
        .into_iter()
        .map(|key| user_info.get(key).filter(|value| !value.is_empty()))
        .collect::<Option<Vec<_>>>();

    match slot.as_deref() {
        Some([alert_id, date, time]) => AlertResponse::Complete(TaskAlertCompletion {
            alert_id: alert_id.to_string(),
            date: date.to_string(),
            time: time.to_string(),
        }),
        _ => AlertResponse::Open,
    }
}

/// The delivered slot, spelled exactly as `TaskSchedule` spells it: the civil
/// date and minute a pending request represents, as the strings the guarded
/// completion compares.
///
/// Pure and beside `classify_alert_response`, for the same reason: `taskAlerts`
/// splits the schedule into components and the completion compares the rebuilt
/// strings, so any drift between the two spellings turns every Complete
/// silently stale — and only a test pins them together.
pub fn delivered_slot(alert: &TaskAlert) -> (String, String) {
    (
        format!(
            "{:04}-{:02}-{:02}",
            alert.year, alert.month, alert.day
        ),
        format!("{:02}:{:02}", alert.hour, alert.minute),
    )
}

/// Which of the app's pending requests the journal no longer wants: everything
/// macOS is holding that is not in the answer it was just handed.
///
/// Pure, and deliberately out of the `objc2` module so it can be tested without
/// a notification centre. It is the whole of the cancelling decision — the
/// registering half needs none, because adding a request under an identifier
/// that is already pending replaces it, which is what a Recurring Task
/// advancing to its next occurrence is.
fn stale_identifiers(pending: &[String], keeping: &[TaskAlert]) -> Vec<String> {
    pending
        .iter()
        .filter(|identifier| !keeping.iter().any(|alert| &&alert.id == identifier))
        .cloned()
        .collect()
}

#[cfg(target_os = "macos")]
mod user_notifications {
    use super::{Permission, TaskAlert};
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly};
    use objc2_foundation::{
        NSArray, NSBundle, NSDateComponents, NSDictionary, NSError, NSMutableArray,
        NSMutableDictionary, NSSet, NSObject, NSObjectProtocol, NSString,
    };
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNCalendarNotificationTrigger,
        UNMutableNotificationContent, UNNotification, UNNotificationAction,
        UNNotificationActionOptionNone, UNNotificationCategory, UNNotificationCategoryOptionNone,
        UNNotificationPresentationOptions, UNNotificationRequest, UNNotificationResponse,
        UNNotificationSettings, UNNotificationSound, UNUserNotificationCenter,
        UNUserNotificationCenterDelegate,
    };
    use std::collections::HashMap;
    use std::sync::mpsc;
    use std::time::Duration;

    /// How long to wait for the OS to answer before giving up. Only reached
    /// when the prompt is left standing; the status is read back afterwards, so
    /// the answer is the same either way.
    const PROMPT_TIMEOUT: Duration = Duration::from_secs(300);

    /// How long to wait for one of the notification centre's own callbacks.
    /// These are local and immediate; a wait this long means something is
    /// wrong, and the caller is told the OS allows nothing rather than blocked.
    const CALLBACK_TIMEOUT: Duration = Duration::from_secs(10);

    /// Whether this binary is inside a real `.app`. Without one there is no
    /// bundle identifier, and `UNUserNotificationCenter` raises rather than
    /// returning — see the module docs.
    fn bundled() -> bool {
        NSBundle::mainBundle().bundleIdentifier().is_some()
    }

    fn center() -> Option<Retained<UNUserNotificationCenter>> {
        bundled().then(UNUserNotificationCenter::currentNotificationCenter)
    }

    pub fn permission() -> Permission {
        let Some(center) = center() else {
            return Permission::Denied;
        };

        let (sender, receiver) = mpsc::channel();
        let answered = RcBlock::new(move |settings: std::ptr::NonNull<UNNotificationSettings>| {
            let status = unsafe { settings.as_ref().authorizationStatus() };
            let _ = sender.send(match status {
                UNAuthorizationStatus::Authorized | UNAuthorizationStatus::Provisional => {
                    Permission::Granted
                }
                UNAuthorizationStatus::NotDetermined => Permission::Undetermined,
                // Denied, and everything else that cannot put an alert on
                // screen. Nothing to distinguish: it is not allowed.
                _ => Permission::Denied,
            });
        });

        center.getNotificationSettingsWithCompletionHandler(&answered);

        receiver
            .recv_timeout(CALLBACK_TIMEOUT)
            .unwrap_or(Permission::Denied)
    }

    /// Asks, through the OS, and waits for the answer. Asking again once macOS
    /// has an answer on file does not put a second dialog up — it answers for
    /// the user — which is why a denial is recovered from in System Settings
    /// rather than by asking again.
    pub fn request_permission() -> Permission {
        let Some(center) = center() else {
            return Permission::Denied;
        };

        let (sender, receiver) = mpsc::channel();
        let answered = RcBlock::new(
            move |_granted: objc2::runtime::Bool, _error: *mut NSError| {
                // The status is read back from the OS rather than trusted from
                // here, so a refusal and a failure end up in the same place.
                let _ = sender.send(());
            },
        );

        // Alert and sound, and nothing else. No badge: the Dock has no icon to
        // put one on, and a Task Alert is a moment rather than a count.
        center.requestAuthorizationWithOptions_completionHandler(
            UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
            &answered,
        );

        if receiver.recv_timeout(PROMPT_TIMEOUT).is_err() {
            log::warn!("the Task Alert prompt was never answered");
        }

        permission()
    }

    /// Makes the pending requests say exactly what the journal says, and
    /// nothing else: every Alert here is registered under its own identifier,
    /// and every other request this app owns is cancelled.
    ///
    /// Registering under an identifier that is already pending replaces it,
    /// which is what a rescheduled Task is — so identifiers are re-registered
    /// rather than diffed. Only the cancellations need working out, because
    /// macOS has no "remove everything except these".
    pub fn reconcile(alerts: &[TaskAlert]) -> Result<(), String> {
        let Some(center) = center() else {
            return Err("Work Journal is not running from a bundle, so macOS will not hold Task Alerts.".to_string());
        };

        register_complete_category(&center);
        cancel_all_but(&center, alerts)?;

        for alert in alerts {
            // No completion handler: a request macOS will not take is one the
            // next reconciliation asks for again, and the Task is stored either
            // way.
            center.addNotificationRequest_withCompletionHandler(&build(alert), None);
        }

        Ok(())
    }

    /// The one action a Task Alert carries: Complete, with no options — in
    /// particular not `.foreground`, so choosing it never brings the app
    /// forward. The session decides whether anything needs showing.
    ///
    /// Registering again replaces the category macOS holds, so this runs with
    /// every reconciliation rather than once: whatever the OS lost while the
    /// app was away is back before the requests that name it are.
    fn register_complete_category(center: &UNUserNotificationCenter) {
        let complete = UNNotificationAction::actionWithIdentifier_title_options(
            &NSString::from_str(super::COMPLETE_ACTION_ID),
            &NSString::from_str("Complete"),
            UNNotificationActionOptionNone,
        );
        let actions = NSArray::from_retained_slice(&[complete]);
        let category =
            UNNotificationCategory::categoryWithIdentifier_actions_intentIdentifiers_options(
                &NSString::from_str(super::TASK_ALERT_CATEGORY_ID),
                &actions,
                &NSArray::new(),
                UNNotificationCategoryOptionNone,
            );

        center.setNotificationCategories(&NSSet::setWithObject(&*category));
    }

    /// Every pending request of this app's that the journal no longer wants —
    /// a Task completed, deleted, unscheduled, or whose moment simply passed.
    fn cancel_all_but(
        center: &UNUserNotificationCenter,
        keeping: &[TaskAlert],
    ) -> Result<(), String> {
        let (sender, receiver) = mpsc::channel();
        let listed = RcBlock::new(
            move |requests: std::ptr::NonNull<
                objc2_foundation::NSArray<UNNotificationRequest>,
            >| {
                let identifiers = unsafe { requests.as_ref() }
                    .iter()
                    .map(|request| request.identifier().to_string())
                    .collect::<Vec<_>>();
                let _ = sender.send(identifiers);
            },
        );

        center.getPendingNotificationRequestsWithCompletionHandler(&listed);

        let pending = receiver
            .recv_timeout(CALLBACK_TIMEOUT)
            .map_err(|_| "macOS did not say what it is holding".to_string())?;

        let stale = NSMutableArray::new();
        for identifier in super::stale_identifiers(&pending, keeping) {
            stale.addObject(&*NSString::from_str(&identifier));
        }

        if !stale.is_empty() {
            center.removePendingNotificationRequestsWithIdentifiers(&stale);
        }

        Ok(())
    }

    /// One request, as macOS holds it: the whole Task Description as the body,
    /// the default sound, and a calendar trigger that fires once.
    ///
    /// The components are handed over civil and unresolved, which is what makes
    /// "Monday at 14:00" still 14:00 after the user travels — so the two
    /// awkward days of the year are resolved by `UNCalendarNotificationTrigger`
    /// against the timezone in force when the moment arrives, and not here.
    /// Apple documents no guarantee for either one, so both are verified by
    /// hand rather than asserted; see the Task Alerts section of
    /// docs/manual-verification.md.
    fn build(alert: &TaskAlert) -> Retained<UNNotificationRequest> {
        let content = UNMutableNotificationContent::new();
        // No separate title: the Task Description is the whole of what the
        // Alert has to say, and a title of "Task" above it would only shorten
        // the room the description has.
        content.setBody(&NSString::from_str(&alert.description));
        content.setSound(Some(&UNNotificationSound::defaultSound()));
        content.setCategoryIdentifier(&NSString::from_str(super::TASK_ALERT_CATEGORY_ID));
        // The delivered slot, as the response carries it back. The identifier
        // stays the Task's own — an interpolated one would break the
        // replacement reconciliation counts on.
        unsafe {
            content.setUserInfo(&slot_user_info(alert));
        }

        let when = NSDateComponents::new();
        when.setYear(alert.year as isize);
        when.setMonth(alert.month as isize);
        when.setDay(alert.day as isize);
        when.setHour(alert.hour as isize);
        when.setMinute(alert.minute as isize);

        // Not repeating: recurrence is the journal's, and it registers the one
        // Open occurrence itself.
        let trigger =
            UNCalendarNotificationTrigger::triggerWithDateMatchingComponents_repeats(&when, false);

        UNNotificationRequest::requestWithIdentifier_content_trigger(
            &NSString::from_str(&alert.id),
            &content,
            Some(&trigger),
        )
    }

    /// The delivered slot, as a response carries it back: the pending
    /// request's identifier verbatim, plus the civil date and minute it
    /// represented — spelled by `delivered_slot`, so the guarded completion
    /// compares strings without parsing anything.
    fn slot_user_info(alert: &TaskAlert) -> Retained<NSDictionary> {
        let (date, time) = super::delivered_slot(alert);

        let info: Retained<NSMutableDictionary> = NSMutableDictionary::new();
        // Safety: every key is an `NSString`, which is `NSCopying`, and every
        // value is one too.
        unsafe {
            for (key, value) in [
                (super::USER_INFO_ALERT_ID, alert.id.as_str()),
                (super::USER_INFO_DATE, date.as_str()),
                (super::USER_INFO_TIME, time.as_str()),
            ] {
                let key = NSString::from_str(key);
                let value = NSString::from_str(value);
                info.setObject_forKey(&value, ProtocolObject::from_ref(&*key));
            }
        }
        info.into_super()
    }

    /// The delivered slot back out of a response's payload: each of the three
    /// values this module wrote, read as the strings they were stored as.
    /// Anything else in there is not one of ours and is ignored.
    fn user_info_text(user_info: &NSDictionary, key: &str) -> Option<String> {
        let value = user_info.objectForKey(&NSString::from_str(key))?;
        let text: Retained<NSString> = value.downcast().ok()?;
        Some(text.to_string())
    }

    /// What a click on a Task Alert does, and what one arriving while Work
    /// Journal is in front looks like. Held by the notification centre for the
    /// life of the app.
    pub struct Clicks {
        /// Called with the identifier the Alert was registered under.
        pub opened: Box<dyn Fn(String) + Send + Sync>,
        /// Called with the Task and the exact delivered slot when Complete is
        /// chosen. Addressed to the Capture window, where the session that
        /// processes it lives — the default click keeps going to the Main
        /// Window.
        pub completed: Box<dyn Fn(super::TaskAlertCompletion) + Send + Sync>,
    }

    define_class!(
        // The notification centre calls its delegate on the main thread, and
        // holds it weakly — which is why the one built below is deliberately
        // never dropped.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "WorkJournalAlertDelegate"]
        #[ivars = Clicks]
        struct AlertDelegate;

        unsafe impl NSObjectProtocol for AlertDelegate {}

        unsafe impl UNUserNotificationCenterDelegate for AlertDelegate {
            /// An Alert arriving while Work Journal is the active application
            /// is shown anyway, with its sound. The default is to swallow it,
            /// which would mean a Task Alert that only works when the user is
            /// somewhere else. Whether the banner is previewed and whether the
            /// sound plays are macOS's own settings, left alone.
            #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
            fn will_present(
                &self,
                _center: &UNUserNotificationCenter,
                _notification: &UNNotification,
                completion: &block2::DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
            ) {
                completion.call((UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound,));
            }

            /// The user responded. A Complete action carries the delivered slot
            /// and goes to the session as a typed completion; anything else —
            /// the default click above all — opens Tasks View on the Task,
            /// exactly as before. Completion is never inferred from button
            /// text: only the action identifier decides, through
            /// `classify_alert_response`, which is also what the test proves.
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &block2::DynBlock<dyn Fn()>,
            ) {
                let request = response.notification().request();
                let action = response.actionIdentifier().to_string();

                let mut delivered = HashMap::new();
                let user_info = request.content().userInfo();
                for key in [
                    super::USER_INFO_ALERT_ID,
                    super::USER_INFO_DATE,
                    super::USER_INFO_TIME,
                ] {
                    if let Some(value) = user_info_text(&user_info, key) {
                        delivered.insert(key.to_string(), value);
                    }
                }

                match super::classify_alert_response(&action, &delivered) {
                    super::AlertResponse::Complete(done) => (self.ivars().completed)(done),
                    super::AlertResponse::Open => {
                        (self.ivars().opened)(request.identifier().to_string());
                    }
                }
                completion.call(());
            }
        }
    );

    /// Starts listening for clicks. Must run before the app finishes launching
    /// for a click on an Alert delivered while Work Journal was not running to
    /// reach it at all.
    pub fn watch_for_clicks(clicks: Clicks) {
        let Some(center) = center() else {
            log::warn!("no bundle, so no Task Alerts to listen for");
            return;
        };

        // Safety: `run` has already put the app on the main thread.
        let main_thread = unsafe { objc2::MainThreadMarker::new_unchecked() };
        let delegate = AlertDelegate::alloc(main_thread).set_ivars(clicks);
        let delegate: Retained<AlertDelegate> = unsafe { msg_send![super(delegate), init] };

        center.setDelegate(Some(ProtocolObject::from_ref(&*delegate)));

        // The centre holds its delegate weakly and the app only stops when the
        // process does, so this is deliberately never given up.
        std::mem::forget(delegate);
    }

    /// Opens System Settings at Notifications — the way back after a denial,
    /// since macOS never shows its prompt twice. The Notifications pane's own
    /// identifier, not a guessed per-app deep link: those are undocumented and
    /// silently open the wrong thing when they change.
    pub fn open_settings() -> Result<(), String> {
        use objc2::runtime::AnyObject;
        use objc2::{class, msg_send};
        use objc2_foundation::NSURL;

        let url = NSURL::URLWithString(&NSString::from_str(
            "x-apple.systempreferences:com.apple.Notifications-Settings.extension",
        ))
        .ok_or_else(|| "there is no Notifications pane to open".to_string())?;

        let opened: bool = unsafe {
            let workspace: Retained<AnyObject> = msg_send![class!(NSWorkspace), sharedWorkspace];
            msg_send![&*workspace, openURL: &*url]
        };

        if opened {
            Ok(())
        } else {
            Err("macOS would not open System Settings".to_string())
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod user_notifications {
    use super::{Permission, TaskAlert};

    /// There is no `UNUserNotificationCenter` anywhere else, so Task Alerts are
    /// simply never allowed: Settings says so, and every Task still works.
    pub fn permission() -> Permission {
        Permission::Denied
    }

    pub fn request_permission() -> Permission {
        Permission::Denied
    }

    pub fn reconcile(_alerts: &[TaskAlert]) -> Result<(), String> {
        Err("Task Alerts are a macOS feature.".to_string())
    }

    pub struct Clicks {
        pub opened: Box<dyn Fn(String) + Send + Sync>,
        pub completed: Box<dyn Fn(super::TaskAlertCompletion) + Send + Sync>,
    }

    pub fn watch_for_clicks(_clicks: Clicks) {}

    pub fn open_settings() -> Result<(), String> {
        Err("Task Alerts are a macOS feature.".to_string())
    }
}

pub use user_notifications::{
    open_settings, permission, reconcile, request_permission, watch_for_clicks, Clicks,
};

#[cfg(test)]
mod tests {
    use super::{
        classify_alert_response, delivered_slot, stale_identifiers, AlertResponse, TaskAlert,
        COMPLETE_ACTION_ID,
    };
    use std::collections::HashMap;

    /// One Task's pending request, under the identifier the journal derives
    /// from the Task — the same one every occurrence of a Recurring Task
    /// claims, which is what makes advancing a replacement rather than a
    /// second alert.
    fn alert(id: &str, day: i32) -> TaskAlert {
        TaskAlert {
            id: id.to_string(),
            description: "water the plants".to_string(),
            year: 2026,
            month: 3,
            day,
            hour: 9,
            minute: 0,
        }
    }

    #[test]
    fn cancels_every_request_the_journal_no_longer_wants() {
        let pending = vec!["task:a".to_string(), "task:b".to_string()];

        assert_eq!(
            stale_identifiers(&pending, &[alert("task:a", 16)]),
            vec!["task:b".to_string()]
        );
    }

    #[test]
    fn leaves_a_recurring_task_exactly_one_request_as_it_advances() {
        // The occurrence moved from the 16th to the 17th. The identifier is
        // the Task's, so nothing is cancelled and the re-registration below it
        // replaces what macOS holds — one request, never two.
        let pending = vec!["task:a".to_string()];

        assert!(stale_identifiers(&pending, &[alert("task:a", 17)]).is_empty());
    }

    #[test]
    fn cancels_the_request_of_a_series_that_was_stopped_or_removed() {
        let pending = vec!["task:a".to_string()];

        assert_eq!(
            stale_identifiers(&pending, &[]),
            vec!["task:a".to_string()]
        );
    }

    /// The `userInfo` payload a delivered Alert carries back: the pending
    /// request's identifier verbatim, plus the civil slot it represented.
    fn delivered() -> HashMap<String, String> {
        HashMap::from([
            ("alertId".to_string(), "task:a".to_string()),
            ("date".to_string(), "2026-03-16".to_string()),
            ("time".to_string(), "09:00".to_string()),
        ])
    }

    #[test]
    fn a_complete_action_with_a_whole_slot_completes() {
        assert_eq!(
            classify_alert_response(COMPLETE_ACTION_ID, &delivered()),
            AlertResponse::Complete(super::TaskAlertCompletion {
                alert_id: "task:a".to_string(),
                date: "2026-03-16".to_string(),
                time: "09:00".to_string(),
            })
        );
    }

    #[test]
    fn a_default_click_opens_whatever_the_payload_says() {
        // The system default action identifier, as Apple names it: a click is
        // a click even with a whole slot behind it.
        assert_eq!(
            classify_alert_response(
                "com.apple.UNNotificationDefaultActionIdentifier",
                &delivered()
            ),
            AlertResponse::Open
        );
    }

    #[test]
    fn an_unknown_action_opens() {
        assert_eq!(
            classify_alert_response("snooze-task", &delivered()),
            AlertResponse::Open
        );
    }

    #[test]
    fn a_complete_without_a_slot_opens_rather_than_dropping_the_response() {
        assert_eq!(
            classify_alert_response(COMPLETE_ACTION_ID, &HashMap::new()),
            AlertResponse::Open
        );
    }

    #[test]
    fn a_complete_with_a_partial_slot_opens() {
        let mut partial = delivered();
        partial.remove("time");

        assert_eq!(
            classify_alert_response(COMPLETE_ACTION_ID, &partial),
            AlertResponse::Open
        );
    }

    #[test]
    fn a_complete_with_an_empty_value_opens() {
        let mut empty = delivered();
        empty.insert("time".to_string(), String::new());

        assert_eq!(
            classify_alert_response(COMPLETE_ACTION_ID, &empty),
            AlertResponse::Open
        );
    }

    /// One Task's pending request with every component single-digit: the
    /// spelling has to pad each one, exactly as the schedule it came from.
    fn alert_at(year: i32, month: i32, day: i32, hour: i32, minute: i32) -> TaskAlert {
        TaskAlert {
            id: "task:a".to_string(),
            description: "water the plants".to_string(),
            year,
            month,
            day,
            hour,
            minute,
        }
    }

    #[test]
    fn the_delivered_slot_is_spelled_like_the_schedule_it_came_from() {
        // What `taskAlerts` splits out of "2026-03-05"/"09:05" must rebuild
        // byte-for-byte: the guarded completion compares strings, so any
        // drift here turns every Complete silently stale.
        assert_eq!(
            delivered_slot(&alert_at(2026, 3, 5, 9, 5)),
            ("2026-03-05".to_string(), "09:05".to_string())
        );
    }

    #[test]
    fn the_delivered_slot_needs_no_padding_when_nothing_is_single_digit() {
        assert_eq!(
            delivered_slot(&alert_at(2026, 11, 17, 17, 30)),
            ("2026-11-17".to_string(), "17:30".to_string())
        );
    }
}
