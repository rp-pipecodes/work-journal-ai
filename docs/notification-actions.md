# Notification actions

Task Alerts are scheduled through `UNUserNotificationCenter`
([`src-tauri/src/alerts.rs`](../src-tauri/src/alerts.rs)) and register no
`UNNotificationCategory`, so they carry no action buttons today. This note
records what Apple actually documents about how a custom action would be
presented on macOS, and — more usefully — what Apple does not document.

## Verdict

**A single action is very likely one hover, one click on macOS, but Apple never
says so in a sentence you can quote.** The claim has to be assembled from three
primary sources that each cover part of it, and the last mile — that *one*
action renders as a bare button rather than under "Options" — rests on an Apple
worked example rather than an Apple rule.

- Apple documents that the system adds *a button per action*, and that a banner
  shows the first two.
  ([`UNNotificationCategory.actions`](https://developer.apple.com/documentation/usernotifications/unnotificationcategory/actions))
  One action is inside that budget on either alert style, so nothing forces a
  collapse.
- Apple's macOS User Guide documents both presentations side by side — "Click
  the action **or** click Options" — and the direct-button example it gives
  (News, "Read Story") is a single-action notification, while the Options
  example (Calendar snooze durations) is a multi-action one.
  ([View app notifications on Mac](https://support.apple.com/guide/mac-help/view-app-notifications-mh40609/mac))
- Nothing in Apple's documentation states the threshold at which macOS switches
  from buttons to "Options", and nothing states how long a Temporary banner
  stays on screen or whether hovering holds it open.

Confidence: **high that a single action is reachable without a submenu.** The
timing half was the residual risk — "the banner is gone before the user's
pointer arrives" — and it has since been measured rather than left open: an
un-hovered Temporary banner lasts ~4.5s, and hovering holds it open
indefinitely. See "Measured on this machine".

## 1. One action: button or submenu?

Apple's API reference is unambiguous that each action becomes a button:

> When displaying a notification assigned to this category, the system adds a
> button to the notification interface for each action in this property. The
> system displays these buttons after the notification's content but before the
> Dismiss button.
> — [`UNNotificationCategory.actions`](https://developer.apple.com/documentation/usernotifications/unnotificationcategory/actions)
> (declared for macOS)

It never mentions an "Options" menu, a chevron, or any collapsing behaviour.
That word does not appear in the UserNotifications reference at all.

The "Options" menu is documented only on the *user* side, in the macOS User
Guide, and only by example:

> **Take an action:** Click the action or click Options. For example, in a
> notification from the News app, click Read Story. Or in a notification from
> the Calendar app, click Options, then choose a Snooze duration.
> — [View app notifications on Mac](https://support.apple.com/guide/mac-help/view-app-notifications-mh40609/mac)

Notification Centre is described the same way, with an arrow instead of an
Options button:

> **Take action:** Click the action. […] If an action has an arrow next to it,
> click the arrow for more options.
> — [Use Notification Center on Mac](https://support.apple.com/guide/mac-help/get-notifications-mchl2fb1258f/mac)

So Apple shows a one-action app (News) getting a direct button and a
many-action app (Calendar) getting a menu, but never states the rule connecting
the two. **Classification: (b) shown in Apple's own example, not (a) documented
as a rule.**

## 2. How many actions before it collapses?

There are three different Apple numbers in circulation, and they do not agree.

| Source | Number | Scope |
| --- | --- | --- |
| [`UNNotificationCategory`](https://developer.apple.com/documentation/usernotifications/unnotificationcategory) overview | "When the system has unlimited space, the system displays up to 10 actions. When the system has limited space, the system displays at most two actions." | Current; platform-agnostic wording |
| [`UNNotificationCategory.actions`](https://developer.apple.com/documentation/usernotifications/unnotificationcategory/actions) | "When displaying banner notifications, the system displays only the first two actions." | Current; platform-agnostic wording |
| [HIG › Notifications › Notification actions](https://developer.apple.com/design/human-interface-guidelines/notifications) | "a customizable detail view that contains up to four buttons" | Current design guidance |
| [Local and Remote Notification Programming Guide](https://developer.apple.com/library/archive/documentation/NetworkingInternet/Conceptual/RemoteNotificationsPG/SupportingNotificationsinYourApp.html) (archived) | "up to four actions […] banners display no more than two actions" | **Superseded.** Same page says "Actionable notifications are supported only on iOS and watchOS" — true when written, false since macOS 10.14 |

What is safe to take from this: **one action is comfortably under every stated
cap, in every presentation, on every platform.** What is not safe: reading "at
most two" as "the third and beyond go into a menu on macOS". Apple says
*displays*, not *collapses*; the collapsing behaviour is unstated.

Note also that the HIG's action guidance is written in tap language and its
platform section says, verbatim, "No additional considerations for iOS, iPadOS,
macOS, tvOS, or visionOS." Apple offers **no macOS-specific design guidance for
notification actions at all**. Its only platform carve-out is watchOS.

## 3. Temporary vs Persistent

These are the user-facing names for the two alert styles the API exposes as
[`UNAlertStyle`](https://developer.apple.com/documentation/usernotifications/unalertstyle):

- **Temporary** — "Notifications disappear after a while."
  ([Notifications settings on Mac](https://support.apple.com/guide/mac-help/notifications-settings-mh40583/mac))
  The API calls this `.banner`: "Alerts are displayed as a slide-down banner.
  Banners appear for a short time and then disappear automatically if the user
  does nothing."
  ([`UNAlertStyle.banner`](https://developer.apple.com/documentation/usernotifications/unalertstyle/banner))
- **Persistent** — "Notifications remain until you dismiss them." The API calls
  this `.alert`: "Alerts are displayed in a modal window that must be dismissed
  explicitly by the user."
  ([`UNAlertStyle.alert`](https://developer.apple.com/documentation/usernotifications/unalertstyle/alert))

Apple documents **no difference in action presentation between the two**. The
only presentation difference Apple states anywhere is the two-action cap on
banners, which a single action does not reach. The app can read the user's
current choice at runtime via
[`UNNotificationSettings.alertStyle`](https://developer.apple.com/documentation/usernotifications/unnotificationsettings/alertstyle),
but cannot set it — it is the user's setting.

Temporary is the macOS default for most apps, and it is the case the go/no-go
turns on.

## 4. Does a Temporary banner last long enough?

**Not documented.** This is the largest gap, and it is the one that decides the
feature.

- Apple's only statements are qualitative: "for a short time"
  ([`UNAlertStyle.banner`](https://developer.apple.com/documentation/usernotifications/unalertstyle/banner)),
  "after a while"
  ([Notifications settings on Mac](https://support.apple.com/guide/mac-help/notifications-settings-mh40583/mac)),
  "appear briefly"
  ([View app notifications on Mac](https://support.apple.com/guide/mac-help/view-app-notifications-mh40609/mac)).
- No Apple page gives a duration in seconds, and none is exposed in the API.
- Whether **hovering pauses or cancels the auto-dismiss is not documented by
  Apple anywhere I could find.** The User Guide's instruction is "move the
  pointer over a notification, then do any of the following" — which reads as if
  the pointer holds it, since several of the listed operations (expanding a
  stack, opening the settings arrow, Clear All) take more than an instant — but
  that is inference from phrasing, not a stated behaviour.

Classification: (d) unknown from primary sources. Third-party reports commonly
quote ~5 seconds and claim hovering holds the banner open; **unverified, and not
citable.** Measure it rather than believe it.

## 5. Do `UNNotificationActionOptions` change presentation?

Only `.destructive` does, and only cosmetically. Read literally, Apple's
discussions describe invocation behaviour, not layout:

- `.foreground` — "the system brings the app to the foreground, asking the user
  to unlock the device as needed."
  ([docs](https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions/foreground))
  Invocation only.
- `.destructive` — "The action button is displayed with special highlighting to
  indicate that it performs a destructive task."
  ([docs](https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions/destructive))
  The one option that provably affects appearance. Wrong for "Complete" anyway.
- `.authenticationRequired` — "the system prompts the user to unlock the
  device."
  ([docs](https://developer.apple.com/documentation/usernotifications/unnotificationactionoptions/authenticationrequired))
  Invocation only, and device-lock framing that does not obviously map onto a
  Mac.
- No options (`[]`) — the default in
  [`init(identifier:title:options:)`](https://developer.apple.com/documentation/usernotifications/unnotificationaction/init(identifier:title:options:)).
  Nothing in the docs suggests an optionless action is presented differently.

**Nothing in Apple's documentation lets an app ask for a direct button rather
than an Options menu.** There is no API surface for it. If macOS decides to
collapse, the app cannot opt out.

`UNNotificationAction.icon` is declared for macOS
([docs](https://developer.apple.com/documentation/usernotifications/unnotificationaction/icon)),
and the HIG says "The system displays your interface icon on the trailing side
of the action title" — but that sentence sits in a section with no macOS
carve-out and no macOS screenshot, so whether macOS renders the icon at all is
**(d) unknown**.

## 6. Everything else that could break one-hover-one-click

- **Focus / Do Not Disturb.** A Focus can delay the alert entirely; the
  notification still exists, but no banner appears to hover.
  ([HIG › Managing notifications](https://developer.apple.com/design/human-interface-guidelines/managing-notifications))
  Users can allow Time Sensitive alerts through per app
  ([Notifications settings on Mac](https://support.apple.com/guide/mac-help/notifications-settings-mh40583/mac)),
  which is the lever a Task reminder would plausibly want. Not currently used by
  the app.
- **Notification grouping.** macOS stacks an app's notifications; the guide says
  to click the top notification to expand a stack.
  ([Use Notification Center on Mac](https://support.apple.com/guide/mac-help/get-notifications-mchl2fb1258f/mac))
  This does not bite us — the ADR guarantees at most one pending Alert at a
  time — but it would if that ever changed. The user can set grouping to
  Automatic, By Application, or Off.
- **Show previews.** "Never" hides the body. Apple documents the hidden-previews
  *content* replacements
  ([`hiddenPreviewsBodyPlaceholder`](https://developer.apple.com/documentation/usernotifications/unnotificationcategory/hiddenpreviewsbodyplaceholder),
  `hiddenPreviewsShowTitle`) but says nothing about whether action buttons
  survive when previews are hidden. **(d) unknown.**
- **Notification Centre vs the desktop.** Apple describes these separately and
  uses different words for the overflow affordance — "Options" on the desktop,
  "an arrow next to it" in Notification Centre. Whether that is two different
  controls or one control described twice is not stated.
- **App in the foreground.** Irrelevant here: `alerts.rs` already returns
  `.Banner | .List | .Sound` from `willPresent`, so Alerts show even while Work
  Journal is active (see
  [ADR 0017](adr/0017-the-os-schedules-task-alerts.md)).

## What is not documented

Every gap hit while writing this, so the next reader does not re-run the search:

1. **The rule for when macOS collapses actions into "Options."** Apple shows one
   example of each outcome and states no threshold.
2. ~~**The Temporary banner's on-screen duration.**~~ Still undocumented by
   Apple, but measured here — see "Measured on this machine" below.
3. ~~**Whether hovering pauses or cancels a Temporary banner's dismissal.**~~
   Still unstated by Apple, but measured here.
4. **Whether "Options" and the Notification Centre chevron are the same
   control.**
5. **Whether macOS renders `UNNotificationAction.icon`.** Declared for macOS,
   documented in tap-language HIG prose only.
6. **Whether actions survive "Show previews: Never" on macOS.**
7. **Whether Apple's "up to 10 / at most two / up to four" numbers apply to
   macOS at all.** All three are written platform-agnostically inside
   iOS-centric prose.
8. **WWDC coverage.** The session that introduced UserNotifications on macOS —
   WWDC18 "What's New in User Notifications" (session 710) — is no longer listed
   in Apple's WWDC18 video index and its transcript was not retrievable. No
   reachable WWDC session addresses macOS action layout.

## Measured on this machine

Gaps 2 and 3 above are the two that decided whether a Complete action was worth
building, and Apple documents neither. Both were measured directly on macOS 26
(Work Journal 0.9.0, Alert Style "Temporary", a real scheduled Task Alert), by
sampling the screen every 0.4s across the delivery.

| | Un-hovered | Pointer held on the banner |
|---|---|---|
| Scheduled for | 10:43:00 | 10:48:00 |
| Banner appears | 10:43:00.6 | 10:48:00.4 |
| Last seen | 10:43:04.9 | 10:48:39.8 |
| On screen | **~4.5s** | **>=39s, never dismissed** |

**Hovering holds a Temporary banner open indefinitely.** The ~4.5s dismissal is
a countdown the pointer cancels, not a hard limit — so an action button is
reachable at leisure once the pointer arrives, and the only real deadline is the
~4.5s to get there.

Hovering also reveals a control area: a Close (X) button appears at the banner's
top-left. With no `UNNotificationCategory` registered, that is the only control
there. It is where a registered action's button would appear.

Both numbers are one machine, one macOS version, and Apple guarantees neither.
Treat them as evidence that the interaction works, not as a contract.

## The iOS trap

Most of the UserNotifications documentation was written for iOS and never
revised. Do not read presentation guarantees out of it:

- [Declaring your actionable notification types](https://developer.apple.com/documentation/usernotifications/declaring-your-actionable-notification-types)
  says to declare categories "at launch time from your iOS app" and describes
  the interaction as "Tapping a button". Sole worked example, and it is iOS.
- The archived programming guide still asserts "Actionable notifications are
  supported only on iOS and watchOS" — accurate in 2016, wrong since macOS
  10.14, and easy to mistake for a live statement.
- The HIG's actions guidance is tap-shaped and carries **no macOS
  considerations**; its only platform carve-out is watchOS (short look / long
  look / Double Tap).
- `.authenticationRequired` and the "asking the user to unlock the device"
  language in `.foreground` are phrased around a locked iPhone. What either does
  on a Mac is not described.

## What a spike would need to settle

**Settled** — see "Measured on this machine". What follows is what was open
before that measurement, kept because the reasoning still applies if Apple
changes the behaviour.


Register one `UNNotificationCategory` with exactly one non-destructive,
optionless action, attach it to a Task Alert, and answer, in order:

1. Under **Temporary**, does the banner show "Complete" as a button, or only
   "Options"?
2. Does moving the pointer onto the banner stop it disappearing? If not, how
   many seconds is the window?
3. Same two questions under **Persistent**.

Questions 1 and 3 will very likely confirm the docs. Question 2 is the one
carrying the decision, and it is the one Apple has never written down.
