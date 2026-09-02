# Long-press × → Remove Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 750ms hold on chrome × morphs to trash; release on it removes (same as menu Remove).

**Architecture:** Pure `hidePressLogic.ts` for release outcomes; `WidgetCard` owns timer + morph UI.

---

### Task 1: Pure press-resolve helpers ✅

- [x] `hidePressLogic.ts` + asserts — green

### Task 2: Wire chrome × in WidgetCard ✅

- [x] pointerdown/up/cancel + 750ms morph; Esc cancel; multi-desk opens menu chooser
- [x] `npm run build`

### Task 3: Manual smoke

- [ ] Quick click hide; hold→remove; hold→drag off→cancel; multi-desk chooser

**Completed (code):** 2026-07-25
