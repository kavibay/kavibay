//! Can we paste the answer back into where the text came from?
//!
//! Quick actions end in a synthesised Ctrl+V. Over a web page or a PDF that
//! keystroke either does nothing or triggers something entirely unrelated, so
//! the answer would be lost with no sign of what went wrong. Asking first turns
//! that into a different, useful outcome: the result stays on the clipboard.
//!
//! Two stages, cheapest first:
//!
//! 1. `GetGUIThreadInfo` — a real system caret means a real editable control,
//!    and a focused `Edit` with `ES_READONLY` means the opposite. Free, because
//!    the caret query already runs for the popup's position.
//! 2. UI Automation — the only thing that can answer for Chromium, Electron and
//!    UWP, which never expose a caret. Costs COM and a few tens of
//!    milliseconds, which sits in the shadow of the clipboard round-trip.
//!
//! Anything still unresolved counts as **not** editable. Typing is only ever
//! done into a control we positively identified as one that takes text. The
//! two mistakes are not symmetric: guessing wrong towards "clipboard" costs the
//! user one Ctrl+V, guessing wrong towards "paste" fires a keystroke into
//! whatever happens to have focus — dropping the text somewhere unrelated, or
//! triggering whatever that application binds to Ctrl+V.

/// What stage 1 could tell from the window itself.
///
/// Only the Win32 probe produces anything but `Unknown`, so off Windows the other
/// variants are never constructed outside the tests. They stay in the enum rather
/// than behind a `cfg`: `decide` matches on all of them, and the decision table is
/// the part worth testing on every platform.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum WindowProbe {
    /// A system caret is blinking in it.
    HasCaret,
    /// Focused control is an edit with `ES_READONLY`.
    ReadOnlyEdit,
    /// No caret, no recognisable control — ask UI Automation.
    Unknown,
}

/// What stage 2 could tell from the focused automation element.
///
/// Same reasoning as [`WindowProbe`]: UI Automation is a Windows API.
#[cfg_attr(not(windows), allow(dead_code))]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UiaProbe {
    /// A writable value pattern, a text-edit pattern, or an edit control.
    Writable,
    /// A value pattern that refuses writes, or a plain document.
    ReadOnly,
    /// No usable pattern, UI Automation unavailable, or the query failed.
    Unknown,
}

/// The verdict the paste path acts on.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Target {
    /// A confirmed text field: paste the answer over the selection.
    Editable,
    /// Everything else: leave the answer on the clipboard.
    ReadOnly,
}

impl Target {
    pub fn can_replace(self) -> bool {
        matches!(self, Target::Editable)
    }
}

/// Combine both probes. Only a positive identification pastes.
///
/// Stage 1 wins where it has an answer: a blinking caret is a stronger signal
/// than any property read, and it is the one case UI Automation is most likely
/// to describe oddly (Word reports its document as read-only while you type in
/// it). Only where stage 1 shrugs does stage 2 get a say — and where stage 2
/// also has nothing, the answer goes to the clipboard.
pub fn decide(window: WindowProbe, uia: UiaProbe) -> Target {
    match window {
        WindowProbe::HasCaret => Target::Editable,
        WindowProbe::ReadOnlyEdit => Target::ReadOnly,
        WindowProbe::Unknown => match uia {
            UiaProbe::Writable => Target::Editable,
            UiaProbe::ReadOnly | UiaProbe::Unknown => Target::ReadOnly,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_caret_settles_it_whatever_automation_says() {
        // Word: caret in the document, and a UIA document element that reports
        // itself read-only. Pasting there works, so the caret has to win.
        for uia in [UiaProbe::Writable, UiaProbe::ReadOnly, UiaProbe::Unknown] {
            assert_eq!(decide(WindowProbe::HasCaret, uia), Target::Editable);
        }
    }

    #[test]
    fn a_readonly_edit_is_never_pasted_into() {
        for uia in [UiaProbe::Writable, UiaProbe::ReadOnly, UiaProbe::Unknown] {
            assert_eq!(decide(WindowProbe::ReadOnlyEdit, uia), Target::ReadOnly);
        }
    }

    /// The browser case, which is the whole reason stage 2 exists.
    #[test]
    fn automation_decides_where_there_is_no_caret() {
        assert_eq!(
            decide(WindowProbe::Unknown, UiaProbe::Writable),
            Target::Editable
        );
        assert_eq!(
            decide(WindowProbe::Unknown, UiaProbe::ReadOnly),
            Target::ReadOnly
        );
    }

    /// The rule that matters: nothing identified means nothing typed.
    #[test]
    fn nothing_known_goes_to_the_clipboard() {
        assert_eq!(
            decide(WindowProbe::Unknown, UiaProbe::Unknown),
            Target::ReadOnly
        );
        assert!(!decide(WindowProbe::Unknown, UiaProbe::Unknown).can_replace());
        assert!(!decide(WindowProbe::ReadOnlyEdit, UiaProbe::Unknown).can_replace());
    }

    /// Exactly two ways to earn a paste — if a third ever appears, it should be
    /// a deliberate edit here rather than a side effect somewhere else.
    #[test]
    fn only_a_positive_identification_pastes() {
        let all = [
            WindowProbe::HasCaret,
            WindowProbe::ReadOnlyEdit,
            WindowProbe::Unknown,
        ]
        .into_iter()
        .flat_map(|window| {
            [UiaProbe::Writable, UiaProbe::ReadOnly, UiaProbe::Unknown]
                .into_iter()
                .map(move |uia| (window, uia))
        });
        for (window, uia) in all {
            let pastes = decide(window, uia).can_replace();
            let expected = window == WindowProbe::HasCaret
                || (window == WindowProbe::Unknown && uia == UiaProbe::Writable);
            assert_eq!(
                pastes, expected,
                "unexpected verdict for {window:?} / {uia:?}"
            );
        }
    }
}
