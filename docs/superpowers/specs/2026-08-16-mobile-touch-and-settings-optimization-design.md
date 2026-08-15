# Mobile Touch and Settings Optimization Design

**Date:** 2026-08-16  
**Status:** Approved design, pending implementation plan

## Goal

Make touch-mode gameplay comfortable and keep the in-game practice panel responsive on phone-sized viewports without changing desktop controls or game rules.

Success means:

- Q/W/E/R sit materially closer to basic attack while every combat target remains at least 44px across and adjacent targets retain at least 8px of separation.
- Touching a combat button gives one light, best-effort haptic acknowledgement. Joystick movement and ordinary settings navigation do not vibrate.
- A fresh touch-mode zoom preference starts at 100%, remains independent from the pointer-mode preference, updates visibly while the game is paused, and survives closing the panel and reloading.
- The `Trận đấu` tab scrolls with the browser's native vertical touch gesture at 844×390 and other supported phone layouts.
- Opening, switching, and editing the practice panel no longer starts unused catalogue work or repeatedly serializes the full match during a slider drag.
- Existing pointer controls, touch aiming, spell casts, panel actions, and persistence continue to pass their tests.

## Evidence and Root Causes

### Touch layout

At the existing 844×390 reference viewport, all four ability buttons have an edge-to-edge gap of about 59px from basic attack. The layout preserves large buttons, but the four abilities are forced onto a narrow 100-degree quadrant, so the chord-spacing calculation pushes the entire ring too far away.

### Zoom default and close behavior

`lol2d.zoomFactor` currently serves both pointer and touch modes. A previously stored `0.6` therefore becomes the next mobile match's opening value even though the code's missing-value default is `1`.

A real touch trace starting from stored 60% showed:

| Moment | zoom factor | target scale | visible/current scale | stored value |
|---|---:|---:|---:|---:|
| Match start | 0.6 | 0.30 | 0.30 | 0.6 |
| Slider at 100%, panel paused | 1.0 | 0.39 | 0.30 | 1 |
| Immediately after close | 1.0 | 0.39 | 0.34 | 1 |
| About one second later | 1.0 | 0.39 | 0.39 | 1 |

Persistence already contains the new value, but `Game.update()` does not run while the panel is open, so `Camera.currentScale` remains at the old value. The first visible frame after close starts from that stale scale and slowly interpolates, which looks like the setting reset.

### Modal scrolling

At 844×390, `RulesTab` produces 392px of content in a 351px scroll viewport. A real thumb drag left `scrollTop` at `0`.

The p5 touch callbacks are installed at page scope and return `false` for every target. p5 interprets that as `preventDefault()`. This is correct for the canvas, where a drag is game input, but it also suppresses native scrolling, range behavior, checkbox clicks, and synthesized clicks in DOM overlays.

The practice components compensate with separate hand-written touch handlers. `RulesTab` has custom range and checkbox handling but no body scroll bridge, so its overflow remains unreachable. The source-level fix is to suppress browser gestures only when the event targets the game canvas.

### Modal performance

Opening the panel calls `preloadSpellIcons()`. The HUD interaction state also constructs ownerless instances for the complete spell catalogue twice: once as `allSpells` and once through `spellGroups`. The removed spell-picker UI is the only reason those structures existed; the current panel does not render them. Opening an ordinary settings panel therefore starts a burst of image loads and decoding for a catalogue that is only used later by a separate loadout editor.

The HUD also rebuilds fresh spell, stat, and buff snapshots at 20Hz while the game is paused, although none of those game values can change. Range input currently persists the whole match configuration on every input/touch-move event. A desktop trace measured 100 persisted rule writes at about 3.3ms, so persistence is not the main standalone stall, but it is unnecessary high-frequency main-thread work during the same asset-loading burst.

## Chosen Approach

Use the existing architecture and correct the shared seams:

1. Keep combat geometry pure in `TouchLayout.ts`, but retune ability size and arc geometry instead of introducing a second mobile-control component.
2. Keep canvas gestures custom and let DOM overlays use native browser interaction by fixing `GameScene` event routing.
3. Delete the unused eager HUD catalogue/preload path instead of scheduling it differently.
4. Apply slider changes live but persist once at gesture completion.
5. Separate touch and pointer zoom preferences, and snap the camera's visible scale when the paused modal changes zoom.

This is preferred over two alternatives:

- **Component-local patch:** add another manual scroll tracker to `RulesTab` and debounce its current handlers. This is a smaller first diff but preserves the global event bug and duplicates the brittle bridge already present in other tabs.
- **Input rewrite:** replace p5 touch dispatch and the touch controller with a new pointer-event layer. This could unify input eventually, but it is much larger than the four reported issues require and risks spell/joystick regressions.

## Detailed Design

### 1. Compact combat cluster and haptics

`computeTouchLayout()` remains the sole source of drawing and hit-test geometry.

- Reduce ability button diameter, but never below the 44px accessibility minimum at supported phone sizes.
- Widen the usable ability arc and retune its gap calculation so the edge-to-edge distance from basic attack falls to roughly 16–24px at 844×390.
- Preserve at least 8px between neighboring hit targets after clamping them to the viewport.
- Leave basic attack as the largest target and keep summoner spells on the outer ring.
- Keep the cluster clear of the top-right practice button and the bottom gesture-safe area.

When `TouchControls` accepts a new finger on a combat button, it requests `navigator.vibrate(10)` through a guarded best-effort helper. Missing support, denied vibration, or browsers that return `false` are normal no-op cases. There is no haptic on every movement frame, joystick steering, aiming, cancellation, tab navigation, or settings changes.

### 2. Touch-only zoom preference and immediate visible scale

Zoom storage gains distinct keys for touch and pointer modes. The current pointer key remains the pointer preference so existing mouse-wheel behavior is preserved. Touch mode uses a new key whose missing-value default is `1`.

`Game` resolves touch mode once before constructing the camera and touch controls. It then reads the matching zoom preference and passes the same resolved touch flag to `TouchControls`, preventing detection from being run twice with potentially different answers.

The in-game zoom slider follows a two-stage flow:

1. `input`: apply the factor to the camera and immediately call `snapToScale()`. The canvas is paused and hidden behind the modal, so the next visible frame should use the selected scale rather than animate from a stale one.
2. `change`: persist the clamped factor to the touch or pointer key matching the active HUD mode.

The `?zoom=` override keeps highest precedence for deterministic testing. Invalid or blocked storage continues to fall back without breaking the match.

### 3. Canvas-only gesture suppression and native modal controls

`GameScene.touchStarted`, `touchMoved`, and `touchEnded` receive the browser event already forwarded by `SceneManager`.

- If the event target is the p5 canvas, synchronize game pointers and return `false`; canvas drags remain joystick/spell input and cannot scroll or pinch the page.
- If the event target is a DOM overlay, do not synchronize it into game controls and do not return `false`; the browser owns the gesture.

With that boundary corrected, practice-panel components rely on semantic browser events:

- tabs and buttons use `click`;
- checkboxes use `change`;
- ranges use `input` plus `change`;
- `.practice-tab-body` uses native `overflow-y: auto`, `touch-action: pan-y`, and contained overscroll.

The manual roster/editor scrolling and touch-to-click bridge can be removed. The canvas keeps `touch-action: none`; the modal scroller explicitly opts into vertical panning. A range consumes a gesture that starts on its track, while a gesture starting elsewhere in the tab scrolls the body normally.

### 4. Paused-panel performance

Delete `allSpells`, `spellGroups`, their ownerless spell construction, and `preloadSpellIcons()` from `HudInteractions`. They have no current UI consumer; `LoadoutEditorModal` owns its catalogue and browser `<img>` loading already.

Add native lazy loading to below-the-fold catalogue images in the loadout editor so opening that deeper editor does not decode every shelf at once.

While `game.paused` is true, `InGameHUD` skips the 20Hz `computeHudState()` snapshot. Practice components keep working because their refs and the shared reactive `hud` object update directly; only immutable game HUD snapshots stop rebuilding. The loop resumes naturally after unpause.

For match rules, slider `input` calls the director's non-persisting live rule application, while `change` calls the public persisting setter once. Checkbox changes still apply and persist immediately because they are discrete events. Zoom follows the equivalent apply-on-input/persist-on-change flow.

## Error and Compatibility Behavior

- Vibration support is optional and never blocks an input.
- Storage reads/writes retain their current `try`/`catch` fallback behavior.
- Query-string overrides continue to work in automated drives.
- Desktop mouse wheel and pointer-mode HUD behavior remain unchanged.
- A modal touch can no longer become a joystick/spell pointer because non-canvas targets are excluded before `syncTouches()`.
- If a touch ends outside the canvas, the controller's existing full-pointer reconciliation still clears game gestures on the next canvas event or explicit control release; opening the panel already pauses after a discrete DOM action and begins with no modal gesture routed into the canvas.

## Test Strategy

Follow red-green-refactor for each behavior.

### Unit and component-level checks

- `TouchLayout`: assert minimum target diameter, minimum neighboring separation, viewport containment, and a materially smaller attack-to-ability gap at 844×390 and representative small/large phone viewports.
- `TouchControls`: assert one haptic request for an accepted combat-button touch, none for joystick movement or a duplicate finger, and safe behavior without `navigator.vibrate`.
- `Camera` preferences: assert independent touch/pointer keys, 100% fresh touch default, clamping, query precedence, and persistence.
- `InGameHUD`: assert paused updates do not rebuild snapshots and unpaused updates do.
- `MatchDirector`/rules binding: assert live input changes rules without storage and the finishing change persists once.

### Real-touch browser checks

Extend the existing mobile/practice drives at 844×390 with real CDP touch events:

- open the panel and switch all tabs without page errors;
- drag the `Trận đấu` body and verify `scrollTop` increases;
- drag CDR and zoom ranges and toggle checkboxes through native events;
- set zoom from stored 60% to 100%, close the panel, assert factor, target scale, current scale, and storage are already at 100%, then reload and assert 100% again;
- verify a DOM modal touch never creates a game touch gesture;
- verify the control cluster stays reachable and non-overlapping;
- verify opening the panel does not start the removed full-catalogue preload.

Run the focused tests first, then typecheck, the full Vitest suite, production build, existing touch-control/practice-panel e2e drives, and the mobile benchmark as the final regression check.

## Out of Scope

- New game mechanics, spells, visual themes, or a settings redesign.
- Native iOS haptic APIs unavailable to ordinary web pages; vibration is best-effort through the Web Vibration API.
- A wholesale p5-to-Pointer-Events input rewrite.
- General desktop performance work unrelated to the practice panel or touch controls.
