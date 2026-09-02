//! Where the quick-action popup goes, in physical screen pixels.
//!
//! Pure arithmetic, separated from the Win32 calls that supply the numbers, so
//! the off-screen cases can be tested without a second monitor to hand.

/// A screen rectangle in physical pixels (virtual-screen coordinates).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

impl Rect {
    pub fn right(&self) -> i32 {
        self.x + self.width
    }
    pub fn bottom(&self) -> i32 {
        self.y + self.height
    }
}

/// Where the popup hangs from: the caret (or the cursor, when the app exposes
/// no caret). `height` is the caret's own height so the menu clears the text
/// line instead of covering it; 0 for a cursor anchor.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Anchor {
    pub x: i32,
    pub y: i32,
    pub height: i32,
}

/// Distance between the anchored text line and the popup edge.
const GAP: i32 = 6;

/// Top-left corner for a popup of `size` (w, h) anchored at `anchor`.
///
/// Below the anchor by default, flipped above when the menu would not fit — the
/// same rule as the alarm widget's notify menu, and the reason a selection near
/// the taskbar does not push the popup off-screen. Clamping comes last so a
/// popup taller than the work area still starts inside it rather than above it.
pub fn place_popup(anchor: Anchor, size: (i32, i32), work: Rect) -> (i32, i32) {
    let (width, height) = size;

    let below = anchor.y + anchor.height + GAP;
    let above = anchor.y - GAP - height;
    let y = if below + height <= work.bottom() {
        below
    } else if above >= work.y {
        above
    } else {
        below
    };

    let max_x = (work.right() - width).max(work.x);
    let max_y = (work.bottom() - height).max(work.y);
    (anchor.x.clamp(work.x, max_x), y.clamp(work.y, max_y))
}

#[cfg(test)]
mod tests {
    use super::*;

    const WORK: Rect = Rect {
        x: 0,
        y: 0,
        width: 1920,
        height: 1040,
    };

    #[test]
    fn hangs_below_the_caret_line() {
        let anchor = Anchor {
            x: 400,
            y: 300,
            height: 20,
        };
        assert_eq!(place_popup(anchor, (240, 180), WORK), (400, 326));
    }

    #[test]
    fn flips_above_when_the_bottom_edge_is_close() {
        let anchor = Anchor {
            x: 400,
            y: 1000,
            height: 20,
        };
        // 1000 + 20 + 6 + 180 > 1040, so it goes above: 1000 - 6 - 180.
        assert_eq!(place_popup(anchor, (240, 180), WORK), (400, 814));
    }

    #[test]
    fn a_selection_at_the_right_edge_stays_fully_visible() {
        let anchor = Anchor {
            x: 1900,
            y: 300,
            height: 20,
        };
        assert_eq!(place_popup(anchor, (240, 180), WORK).0, 1680);
    }

    /// Secondary monitors sit at negative or large offsets; nothing may be
    /// clamped towards the primary screen's origin.
    #[test]
    fn respects_a_monitor_that_does_not_start_at_zero() {
        let work = Rect {
            x: -1920,
            y: -200,
            width: 1920,
            height: 1080,
        };
        let anchor = Anchor {
            x: -1910,
            y: -190,
            height: 20,
        };
        assert_eq!(place_popup(anchor, (240, 180), work), (-1910, -164));

        let far_left = Anchor {
            x: -3000,
            y: -190,
            height: 20,
        };
        assert_eq!(place_popup(far_left, (240, 180), work).0, -1920);
    }

    /// A popup taller than the screen must still start on-screen — clamping is
    /// the last word, not the flip.
    #[test]
    fn an_oversized_popup_starts_inside_the_work_area() {
        let anchor = Anchor {
            x: 100,
            y: 900,
            height: 20,
        };
        assert_eq!(place_popup(anchor, (240, 2000), WORK), (100, 0));
    }
}
