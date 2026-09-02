# Widget Menu Icon Toolbar — Design

**Date:** 2026-07-22  
**Status:** Approved  
**Tier:** S

## Goal

Make the shared widget ⋯ menu more compact without crowding hover chrome.

## Behavior

- Host actions render as one horizontal **icon row** with tooltips/`aria-label`.
- Order: Duplicate (if allowed) → Settings (if present) → Hide title (toggle) → Hide → Remove (danger).
- Extension `#menu` items stay a **text list under** the icon row; separator only when that slot has content.
- Sticky + ⋯ hover chrome unchanged.

## Out of scope

- Moving actions into chrome, redesigning per-extension menus, new actions.
