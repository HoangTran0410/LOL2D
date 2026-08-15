# Mobile Touch and Settings Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mobile combat controls compact and responsive, default mobile zoom to 100% and persist it, restore native scrolling in the in-game settings modal, and remove avoidable modal work that causes stalls.

**Architecture:** Keep the existing p5 game loop and Vue HUD, but make touch ownership explicit: the game canvas owns and cancels combat gestures while DOM overlays use native browser touch, click, range, checkbox, and scroll behavior. Camera zoom preference becomes input-mode-specific and is snapped immediately while the game is paused. Performance work removes unused spell-catalogue construction/preloading and pauses HUD snapshots while the settings panel has paused the game.

**Tech Stack:** TypeScript, Vue 3, p5.js, Vitest, Vite, Chrome DevTools Protocol integration scripts.

## Global Constraints

- Preserve keyboard/mouse behavior and query-string zoom overrides.
- Keep touch targets at least 44px with at least 8px separation.
- Haptics are best-effort and must never throw or fire for joystick/settings gestures.
- Use native DOM scrolling and controls inside the settings overlay; do not add a second custom gesture system.
- Add each regression test before its implementation and observe the expected failure.
- Keep changes surgical and avoid new dependencies.

---

## Task 1: Compact Combat Buttons and Add Haptic Feedback

**Files:**

- Modify: `src/game/input/TouchLayout.ts`
- Modify: `src/game/input/TouchControls.ts`
- Test: `tests/game/input/TouchLayout.test.ts`
- Test: `tests/game/input/TouchControls.test.ts`

- [ ] Add a layout regression test for a 844×390 viewport asserting attack-to-ability edge gaps are compact (8–32px), ability targets remain at least 44px, buttons do not overlap, and summoner spells remain outside the main arc.
- [ ] Run `rtk npm test -- tests/game/input/TouchLayout.test.ts` and confirm the compact-gap assertion fails against the current ~59px layout.
- [ ] Retune the ability/summoner arcs and ring distances in `TouchLayout.ts`, keeping attack largest and maintaining minimum target size/separation.
- [ ] Run the layout test and adjust only layout constants/math until it passes.
- [ ] Add `TouchControls` tests with a stubbed `navigator.vibrate` proving one short vibration occurs on an accepted combat-button touch-down and none occurs for joystick or rejected/repeated gestures.
- [ ] Run `rtk npm test -- tests/game/input/TouchControls.test.ts` and confirm the haptic test fails.
- [ ] Add a guarded, best-effort haptic helper and call it only after `beginSlot` accepts a combat button gesture.
- [ ] Run `rtk npm test -- tests/game/input/TouchLayout.test.ts tests/game/input/TouchControls.test.ts`.

## Task 2: Make Mobile Zoom 100% by Default and Persist It

**Files:**

- Modify: `src/game/gameObject/map/Camera.ts`
- Modify: `src/game/Game.ts`
- Modify: `src/game/hud/practice/RulesTab.vue`
- Test: `tests/game/map/zoomPreference.test.ts`
- Test: `tests/game/map/CameraWiring.test.ts`

- [ ] Add tests for separate touch/pointer storage keys, a fresh touch default of `1`, mode-specific writes, and query-string precedence.
- [ ] Run `rtk npm test -- tests/game/map/zoomPreference.test.ts` and confirm the new mode-specific cases fail.
- [ ] Extend zoom preference helpers to accept touch mode, use a dedicated touch key, retain the existing pointer key, and sanitize/clamp persisted values.
- [ ] Resolve touch-controls preference before constructing/configuring the camera in `Game`, then load the matching zoom preference.
- [ ] Add a wiring test showing that a zoom slider update while paused calls both `setZoomFactor(1)` and `snapToScale()`, while persistence occurs on the committed change using the active input mode.
- [ ] Run `rtk npm test -- tests/game/map/CameraWiring.test.ts` and confirm the snap/persistence regression fails.
- [ ] Change the zoom range handler to apply and snap during `input`, then persist once on `change` with the correct mode key.
- [ ] Run `rtk npm test -- tests/game/map/zoomPreference.test.ts tests/game/map/CameraWiring.test.ts`.

## Task 3: Restore Native Mobile Scrolling in the Practice Panel

**Files:**

- Modify: `src/scenes/GameScene.ts`
- Modify: `src/game/hud/practice/PracticePanel.vue`
- Modify: `src/game/hud/practice/RulesTab.vue`
- Modify: `src/game/hud/practice/RosterTab.vue`
- Modify: `src/game/hud/practice/CheatTab.vue`
- Modify: `src/styles/hud.css`
- Test: `tests/game/scenes/GameSceneKeys.test.ts`
- Test: `tests/e2e/drive-practice-panel.mjs`

- [ ] Add a scene regression test proving canvas touch events sync game pointers and return `false`, while touch events originating in the DOM practice overlay are ignored and not cancelled.
- [ ] Run `rtk npm test -- tests/game/scenes/GameSceneKeys.test.ts` and confirm the overlay-routing case fails.
- [ ] Pass the original event through `GameScene` touch handlers and gate pointer synchronization/default prevention on the canvas target.
- [ ] Remove duplicate `touchend.prevent` click bridges and manual range/scroll gesture code from the practice components, leaving native `click`, `input`, `change`, and checkbox behavior.
- [ ] Add `touch-action: pan-y` and contained overscroll to the scroll body while retaining `overflow-y: auto` and momentum scrolling.
- [ ] Extend the mobile CDP practice-panel test to drag the `Trận đấu` body and assert `scrollTop` increases without triggering a canvas gesture.
- [ ] Run `rtk npm test -- tests/game/scenes/GameSceneKeys.test.ts`.
- [ ] Run `rtk node tests/e2e/drive-practice-panel.mjs` in real mobile touch emulation.

## Task 4: Remove Settings-Modal Stalls

**Files:**

- Modify: `src/game/hud/hudInteractions.ts`
- Modify: `src/game/hud/InGameHUD.ts`
- Modify: `src/game/hud/practice/RulesTab.vue`
- Modify: `src/scenes/setup/KitRoster.vue`
- Modify: `src/scenes/setup/SpellIcon.vue`
- Test: `tests/game/hud/hudInteractions.test.ts`
- Test: `tests/game/hud/hudState.test.ts`

- [ ] Add/adjust tests that the interaction state no longer exposes or constructs unused full spell catalogues and that paused HUD updates skip `computeHudState`/view snapshots while keeping touch UI mode synchronized.
- [ ] Run `rtk npm test -- tests/game/hud/hudInteractions.test.ts tests/game/hud/hudState.test.ts` and confirm the paused-update expectation fails.
- [ ] Delete unused `allSpells`, `spellGroups`, catalogue builders, and spell-icon preloading from `hudInteractions.ts`, preserving the picker’s filtered spell contract.
- [ ] Make `InGameHUD.update` return before expensive state recomputation while the game is paused.
- [ ] Ensure range controls apply live state without storage writes on every touch move and persist only on native `change`.
- [ ] Add native `loading="lazy"` and `decoding="async"` to below-fold spell/champion catalogue images owned by the setup roster.
- [ ] Run `rtk npm test -- tests/game/hud/hudInteractions.test.ts tests/game/hud/hudState.test.ts`.

## Task 5: Integration Verification

**Files:**

- Verify all files above
- Update tests only if integration reveals a real missing regression

- [ ] Run focused tests: `rtk npm test -- tests/game/input/TouchLayout.test.ts tests/game/input/TouchControls.test.ts tests/game/map/zoomPreference.test.ts tests/game/map/CameraWiring.test.ts tests/game/scenes/GameSceneKeys.test.ts tests/game/hud/hudInteractions.test.ts tests/game/hud/hudState.test.ts`.
- [ ] Run `rtk npm run typecheck`.
- [ ] Run `rtk npm test`.
- [ ] Run `rtk npm run build`.
- [ ] Run `rtk node tests/e2e/drive-mobile-hud.mjs`, `rtk node tests/e2e/drive-touch-controls.mjs`, and `rtk node tests/e2e/drive-practice-panel.mjs` with mobile touch emulation.
- [ ] Verify manually/through CDP that fresh mobile starts at 100%, changing zoom survives modal close and reload, combat buttons are compact, one haptic fires per accepted press, and `Trận đấu` scrolls naturally.
- [ ] Review the final diff for unrelated changes, debug code, duplicated touch paths, and accidental pointer/desktop regressions.
