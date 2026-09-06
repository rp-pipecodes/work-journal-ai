//! The durable state behind automatic Onboarding: whether it is still due or
//! has been dismissed, and the one classification that state rests on —
//! whether this installation existed before this launch.
//!
//! Onboarding is offered automatically to a genuinely new installation and
//! stays due until it is finished, skipped, closed, quit out of, or left by
//! navigating away. An existing journal or a settings file holding anything
//! counts as an installation that existed before this launch, and suppresses
//! automatic presentation — including after reinstalling, since both survive
//! an uninstall. A surviving API Key alone says nothing about an
//! installation: it lives in the Keychain and is never among the evidence
//! read here.
//!
//! Classification happens before plugin-sql's preload can create the journal
//! and before default settings are written, so the very first launch cannot
//! manufacture the evidence of an older one. The state decided there is
//! written down before those side effects too, so a crash during the first
//! launch leaves `UNFINISHED` behind — and a stored `UNFINISHED` or
//! `SUPPRESSED` always takes precedence over whatever the journal and the
//! settings file say on a later launch.

/// Automatic Onboarding is still due: offered until it is deliberately
/// dismissed. What a first launch writes before the journal or the defaults
/// exist, and what a crash leaves behind for the next launch.
pub const UNFINISHED: &str = "unfinished";

/// Automatic Onboarding will not be offered again on its own. What an
/// existing installation settles on, and what finishing, skipping, closing,
/// quitting or navigating away from automatic Onboarding records.
pub const SUPPRESSED: &str = "suppressed";

/// The evidence that an installation existed before this launch: a settings
/// file with anything in it, or a journal already on disk — either is an
/// installation that was running before this launch, exactly as the Hotkey
/// migration reads it. Both are read *before* this launch can create either,
/// which is what makes the fresh case distinguishable at all.
pub fn installation_existed(
    settings_held_anything: bool,
    journal_was_on_disk: bool,
) -> bool {
    settings_held_anything || journal_was_on_disk
}

/// The state to write down, or nothing when what the store holds already
/// stands.
///
/// A stored state always takes precedence over the classification: it was
/// decided by an earlier launch, and whatever the journal or the settings
/// file have come to say since is that launch's own doing. A crash during an
/// unfinished first launch therefore offers the introduction again on the
/// next launch rather than misreading the journal and defaults that launch
/// created as evidence of an older installation.
///
/// `None` stored is the one launch that has never been classified: a fresh
/// installation becomes `UNFINISHED`, and an existing one `SUPPRESSED`.
/// A stored value this build does not recognise is left alone — it reads as
/// suppressed, which is the safe answer to a file edited by hand.
pub fn settle(
    stored: Option<&str>,
    existing_installation: bool,
) -> Option<&'static str> {
    match stored {
        Some(UNFINISHED) | Some(SUPPRESSED) | Some(_) => None,
        None => Some(if existing_installation {
            SUPPRESSED
        } else {
            UNFINISHED
        }),
    }
}

/// Whether a stored marker means automatic Onboarding is still due. Anything
/// that is not `UNFINISHED` — `SUPPRESSED`, nothing at all, or a value this
/// build does not recognise — is suppressed: a store that cannot be read
/// must not turn into an introduction asked about on every launch.
pub fn is_unfinished(stored: Option<&str>) -> bool {
    stored == Some(UNFINISHED)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A fresh installation — nothing on disk before this launch — settles on
    /// unfinished, so the introduction is offered automatically.
    #[test]
    fn a_fresh_installation_is_offered_onboarding() {
        assert_eq!(settle(None, false), Some(UNFINISHED));
    }

    /// An existing installation — a journal or saved settings from before —
    /// settles on suppressed, so automatic Onboarding never interrupts
    /// established work.
    #[test]
    fn an_existing_installation_suppresses_automatic_onboarding() {
        assert_eq!(settle(None, true), Some(SUPPRESSED));
    }

    /// A surviving API Key alone is not installation evidence: the Keychain
    /// outlives an uninstall, and a reinstalled app must not take it as a
    /// sign that the introduction has been seen.
    #[test]
    fn an_api_key_alone_does_not_make_an_installation_existing() {
        assert!(!installation_existed(false, false));
    }

    /// A journal already on disk is existing, and so is a settings file that
    /// holds anything — the migration's reading of installation evidence.
    #[test]
    fn the_evidence_is_settings_or_journal() {
        assert!(installation_existed(true, false));
        assert!(installation_existed(false, true));
        assert!(installation_existed(true, true));
    }

    /// An unfinished marker survives a launch that now looks existing: the
    /// journal and the defaults were created by that same unfinished first
    /// launch, so the next launch must offer the introduction again rather
    /// than conclude it was never due.
    #[test]
    fn unfinished_takes_precedence_over_later_evidence() {
        assert_eq!(settle(Some(UNFINISHED), true), None);
        assert_eq!(settle(Some(UNFINISHED), false), None);
    }

    /// A suppressed marker is never re-enabled by a later launch's
    /// classification, whatever the evidence now says.
    #[test]
    fn dismissed_stays_dismissed() {
        assert_eq!(settle(Some(SUPPRESSED), true), None);
        assert_eq!(settle(Some(SUPPRESSED), false), None);
    }

    /// A marker this build does not recognise is left alone; it reads as
    /// suppressed, the safe answer to a file edited by hand.
    #[test]
    fn an_unrecognised_marker_is_left_alone_and_reads_suppressed() {
        assert_eq!(settle(Some("perhaps"), false), None);
        assert!(!is_unfinished(Some("perhaps")));
    }

    /// Only the unfinished marker means the introduction is still due.
    #[test]
    fn only_unfinished_means_still_due() {
        assert!(is_unfinished(Some(UNFINISHED)));
        assert!(!is_unfinished(Some(SUPPRESSED)));
        assert!(!is_unfinished(None));
    }
}
