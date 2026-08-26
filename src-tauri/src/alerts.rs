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

#[cfg(target_os = "macos")]
mod user_notifications {
    use super::{Permission, TaskAlert};
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{define_class, msg_send, DefinedClass, MainThreadOnly};
    use objc2_foundation::{
        NSBundle, NSDateComponents, NSError, NSMutableArray, NSObject, NSObjectProtocol, NSString,
    };
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNCalendarNotificationTrigger,
        UNMutableNotificationContent, UNNotification, UNNotificationPresentationOptions,
        UNNotificationRequest, UNNotificationResponse, UNNotificationSettings, UNNotificationSound,
        UNUserNotificationCenter, UNUserNotificationCenterDelegate,
    };
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

        cancel_all_but(&center, alerts)?;

        for alert in alerts {
            // No completion handler: a request macOS will not take is one the
            // next reconciliation asks for again, and the Task is stored either
            // way.
            center.addNotificationRequest_withCompletionHandler(&build(alert), None);
        }

        Ok(())
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
        for identifier in pending {
            if !keeping.iter().any(|alert| alert.id == identifier) {
                stale.addObject(&*NSString::from_str(&identifier));
            }
        }

        if !stale.is_empty() {
            center.removePendingNotificationRequestsWithIdentifiers(&stale);
        }

        Ok(())
    }

    /// One request, as macOS holds it: the whole Task Description as the body,
    /// the default sound, and a calendar trigger that fires once.
    fn build(alert: &TaskAlert) -> Retained<UNNotificationRequest> {
        let content = UNMutableNotificationContent::new();
        // No separate title: the Task Description is the whole of what the
        // Alert has to say, and a title of "Task" above it would only shorten
        // the room the description has.
        content.setBody(&NSString::from_str(&alert.description));
        content.setSound(Some(&UNNotificationSound::defaultSound()));

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

    /// What a click on a Task Alert does, and what one arriving while Work
    /// Journal is in front looks like. Held by the notification centre for the
    /// life of the app.
    pub struct Clicks {
        /// Called with the identifier the Alert was registered under.
        pub opened: Box<dyn Fn(String) + Send + Sync>,
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

            /// The user clicked it. There are no actions on a Task Alert — no
            /// Complete and no Snooze — so the only response worth anything is
            /// the click itself, and all it does is open Tasks View on that
            /// Task.
            #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
            fn did_receive(
                &self,
                _center: &UNUserNotificationCenter,
                response: &UNNotificationResponse,
                completion: &block2::DynBlock<dyn Fn()>,
            ) {
                let identifier = response.notification().request().identifier();
                (self.ivars().opened)(identifier.to_string());
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
    }

    pub fn watch_for_clicks(_clicks: Clicks) {}

    pub fn open_settings() -> Result<(), String> {
        Err("Task Alerts are a macOS feature.".to_string())
    }
}

pub use user_notifications::{
    open_settings, permission, reconcile, request_permission, watch_for_clicks, Clicks,
};
