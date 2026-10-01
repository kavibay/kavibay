# Designing a Kavibay widget

Short rules, taken from the widgets already in the app. Follow them and a new
widget looks like it belongs; ignore them and it looks pasted on.

## What you are drawing on

A widget is content inside a card the host draws. The card owns the background,
the rounded corners, the shadow, the title bar and the menu. **You draw the
content only.**

Two consequences that catch people out:

- **`color-scheme: dark` does not mean a dark background.** It makes the
  document canvas opaque black, and no background rule can undo that: the canvas
  takes the scheme's colour precisely *when* the root's background is
  transparent, so forcing it transparent is what hands the canvas over. The host
  settles it in the document itself: the host injects the rule into `<head>`
  before your first stylesheet is parsed, so there is no moment at which the
  canvas is dark. (The two guests inject it too, but only when their script
  runs — which is after your CSS, and losing that race is what made the black
  come and go.) The rule takes the scheme off the root entirely
  (`color-scheme: normal`)
  and putting back what it was wanted for — a `scrollbar-color` for the
  viewport and the dark scheme on form controls, where it changes rendering
  rather than the canvas. You do not have to do anything, and writing
  `color-scheme: dark` on `:root` yourself is simply overruled.
- **Your background must be transparent.** Painting your own panel puts a
  rectangle inside a rectangle.
- **Runtime packages run in an iframe, so the host's CSS variables do not reach
  you.** `var(--fg-rgb)` works in a first-party Vue widget and is empty in a
  package. Packages use the literal colours below.

The card already insets its content by roughly 10px. Start at `padding: 0` on
`body` and add space only where you actually need it.

## Colour

One text colour at different opacities does almost everything. These are the
values the existing widgets use, written out for the iframe:

| Use | Value |
|---|---|
| Primary text | `rgba(232, 232, 234, 0.92)` |
| Secondary text, labels | `rgba(232, 232, 234, 0.55)` |
| Faint text, disabled | `rgba(232, 232, 234, 0.4)` |
| Filled surface (button, chip, row) | `rgba(232, 232, 234, 0.08)` |
| Hover fill | `rgba(232, 232, 234, 0.12)` |
| Border, divider | `rgba(232, 232, 234, 0.14)` |

Status colours, used sparingly:

| Meaning | Text | Background |
|---|---|---|
| Good | `rgba(166, 220, 180, 0.95)` | `rgba(120, 200, 150, 0.16)` |
| Warning | `rgba(235, 190, 130, 0.95)` | `rgba(220, 160, 90, 0.16)` |
| Bad | `rgba(255, 157, 157, 0.95)` | `rgba(255, 120, 120, 0.16)` |

Do not introduce a brand colour, a gradient, or a second hue for decoration. The
widget sits on the user's wallpaper next to a dozen others; it is one of many,
not a landing page.

## Type

`font-family: system-ui, sans-serif`, and four sizes:

| Size | For |
|---|---|
| `13px` | Headings, the one number a widget exists to show |
| `12px` | Body — the default |
| `11px` | Secondary lines |
| `10px` | Labels, usually uppercase with `letter-spacing: 0.06em` |

One big number is fine when it *is* the widget: a clock, a temperature, a
countdown. Then go to 28–32px and keep everything else at 11px.

## Spacing, corners, borders

- Gaps and padding in multiples of 2, mostly `6px`, `8px`, `10px`.
- `border-radius: 8px` for panels and inputs, `6px` for small controls,
  `999px` for pills.
- Borders are `1px solid` in the border colour above. Most things need none — a
  faint fill separates better than a line.

## Size

Widgets are small. Real defaults in the app: clock 200x120, weather 260x200,
todo 280x260, stocks 280x240, calendar 260x320. **Between 200 and 320 wide is
normal; anything past 360 needs a reason.**

A layout that needs scrolling to read one number is a failed widget. If the
content does not fit, show less, not smaller, and move the rest to a second
view one click away: history, details and settings live there.

## Interaction

- Controls are quiet until touched: transparent, then the hover fill.
- `cursor: pointer` on anything clickable, and `:disabled { opacity: 0.4 }`.
- Transitions no longer than 120ms, and only on colour or opacity. A widget that
  animates its layout is distracting on a desktop that is always visible.
- No focus outlines removed without a replacement — keyboard users exist.

## Dropdowns

**Never use a native `<select>`.** The popup is drawn by the operating system,
not by you: white or light grey on Windows, square corners, its own font, its own
row height, a scrollbar that ignores every value on this page. On a dark glass
widget it reads as a different program leaking through. The same applies to
anything else the OS paints — `alert()`, `confirm()`, `<input type="date">`.

Build the menu yourself: a trigger button showing the current value with a small
chevron, and a panel of rows underneath. The chosen row carries a check, the
hovered row takes the hover fill.

```html
<div class="menu">
  <button type="button" class="menu-trigger" aria-haspopup="listbox" aria-expanded="false">
    <span>Correct grammar</span>
    <svg width="10" height="10" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" />
    </svg>
  </button>
  <div class="menu-panel" role="listbox" hidden>
    <button type="button" class="menu-item is-selected" role="option" aria-selected="true">
      <span class="menu-check">✓</span>Correct grammar
    </button>
    <button type="button" class="menu-item" role="option" aria-selected="false">
      <span class="menu-check"></span>Translate
    </button>
  </div>
</div>
```

```css
.menu { position: relative; }
.menu-trigger {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  width: 100%;
  padding: 5px 8px;
  font: inherit;
  border: 1px solid rgba(232, 232, 234, 0.14);
  border-radius: 6px;
  background: rgba(232, 232, 234, 0.08);
  color: inherit;
  cursor: pointer;
}
.menu-trigger:hover { background: rgba(232, 232, 234, 0.12); }
.menu-panel {
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  z-index: 10;
  min-width: 100%;
  padding: 4px;
  border: 1px solid rgba(232, 232, 234, 0.14);
  border-radius: 8px;
  /* The only place a widget paints its own surface: it floats over content. */
  background: rgba(28, 28, 32, 0.98);
  box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
}
.menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 6px 8px;
  font: inherit;
  text-align: left;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: rgba(232, 232, 234, 0.92);
  cursor: pointer;
}
.menu-item:hover { background: rgba(232, 232, 234, 0.12); }
.menu-check { width: 12px; color: rgba(232, 232, 234, 0.92); }
```

Behaviour, all of it required:

- Click the trigger to toggle, click a row to choose and close.
- Click outside or press `Escape` to close.
- Rows are real `<button>`s inside a real `<button>` trigger, so Tab and Enter
  work and focus stays visible.
- More than about ten options: give the panel `max-height: 180px; overflow: auto`
  rather than a longer widget.

## A starting point

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      :root {
        color-scheme: dark;
        font-family: system-ui, sans-serif;
      }
      body {
        margin: 0;
        padding: 0;
        background: transparent;
        color: rgba(232, 232, 234, 0.92);
        font-size: 12px;
      }
      .label {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: rgba(232, 232, 234, 0.55);
      }
      .value {
        font-size: 28px;
      }
      button {
        font: inherit;
        padding: 5px 10px;
        border-radius: 6px;
        border: 1px solid rgba(232, 232, 234, 0.14);
        background: rgba(232, 232, 234, 0.08);
        color: inherit;
        cursor: pointer;
      }
      button:hover {
        background: rgba(232, 232, 234, 0.12);
      }
    </style>
  </head>
  <body>
    <p class="label">Today</p>
    <p class="value">0</p>
    <button type="button">Add</button>
  </body>
</html>
```

## Don't

- Don't paint a background or a border around the whole widget.
- Don't use a native `<select>` — see Dropdowns above.
- Don't add a title inside the content — the card already has one.
- Don't use a font the machine may not have; there is no network for webfonts.
- Don't fill the first view with chrome. Depth belongs in behaviour and in a
  second view inside the card, not in more controls up front; the fastest way to
  look wrong here is to look busy.
