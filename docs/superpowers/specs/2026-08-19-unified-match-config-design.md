# One match-config panel, two sources — design

Date: 2026-08-19
Status: implemented
Supersedes: `docs/superpowers/specs/2026-08-15-practice-panel-design.md` (the
"superset of the setup screen" framing), and the session-state rule in
`docs/superpowers/specs/2026-08-16-panel-persistence-design.md`.

## The problem

There are two match-configuration surfaces and they disagree.

- `SetupScene.vue` → `usePregameConfig()` → reads and writes `localStorage`
  (`PregameConfig`) directly. No match exists.
- `PracticePanel.vue` → `MatchDirector` → mutates the *running* match, then
  derives and persists the config from it.

Two backends grew two independent sets of controls over the same settings.
Today, neither is a superset of the other:

| | pregame | in-game |
|---|---|---|
| loadout editor (`LoadoutEditorModal`) | yes | yes (already shared) |
| add / remove bot | yes | yes |
| **blue/red side per participant** | **no** | yes |
| **per-bot AI flags** | **no** (global only) | yes |
| CDR, URF | yes | yes |
| **jungle, lane minions** | **no** (`world` exists in the config, unexposed) | yes |
| **zoom, render quality, FPS, fullscreen** | **no** | yes |
| **input mode, tap-target priority** | yes | **no** |
| reveal map, debug layers, per-unit cheats, KDA | no | yes |
| ability description on a kit icon | yes | no (icons are decorative) |

Every one of those gaps is the same bug: a control was added to whichever
component the author was in.

## What we are building

One panel component, used in both places, backed by an interface with two
implementations. Everything the panel changes persists.

```
        ┌───────────────────────────────────────┐
        │ MatchConfigPanel.vue                  │
        │   RosterTab · MatchTab · SettingsTab  │
        └──────────────────┬────────────────────┘
                           │ inject('configSource')
              ┌────────────┴─────────────┐
              ▼                          ▼
     PregameConfigSource         MatchDirectorSource
     (localStorage only)         (wraps MatchDirector)
     live: null                  live: { camera, hud }
```

`SetupScene.ts` stays a scene (same `#pregame-scene` host, same dynamic import
from `MenuScene.ts`, so the lazy load already in place is unchanged). Only its
Vue tree is replaced.

### Design goals, in priority order

1. **A control can only be added in one place.** Divergence must become
   impossible, not merely fixed once.
2. **The panel must not pull the game chunk into the menu chunk.** A static
   import of any `src/game/` runtime value from the shared panel drags ~2MB of
   match code in front of the menu — the exact reason `touchPreferences.ts`
   exists.
3. Persist everything the panel changes, including cheats and debug layers.

## 1. The seam: `MatchConfigSource`

`src/game/hud/config/MatchConfigSource.ts` — types only, no p5, no game
runtime.

```ts
export interface ConfigRosterEntry {
  /** `unit.id` in a match; `'player'` / `'bot-<i>'` outside one. */
  id: string;
  /** "Bạn" / "Bot 1" — position in the roster, not a unit identity. */
  label: string;
  isPlayer: boolean;
  team: MatchTeamId;
  /**
   * What the row displays as the champion. In a match this is the unit
   * standing on the map (`unit.name`); outside one it is the *loadout*
   * ("Ngẫu Nhiên"), because the setting is what is being edited and reading a
   * rolled champion back would silently pin a bot that is meant to keep
   * re-rolling. Same distinction `RosterTab.vue` documents today.
   */
  title: string;
  avatarUrl: string | null;
  abilities: { letter: string; url: string | null; spellId: string | null }[];
  loadout: ChampionLoadout;
  /** Bots only. */
  behaviour?: BotBehaviour;
  invulnerable: boolean;
}
```

A row carries no reference to its live unit, deliberately. Whether the
live-only sections render is a property of the *source*, not of a row — every
row is live or none is — so `source.live !== null` is the single gate, and no
`Champion` ever crosses this seam.

```ts

export interface MatchConfigSource {
  /** `null` outside a match. Presence gates every live-only control. */
  readonly live: MatchLiveControls | null;

  roster(): ConfigRosterEntry[];
  addBot(): Promise<void>;
  removeBot(id: string): void;
  setTeam(id: string, team: MatchTeamId): void;
  setBotBehaviour(id: string, flags: Partial<BotBehaviour>): void;
  loadoutOf(id: string): ChampionLoadout;
  applyLoadout(id: string, loadout: ChampionLoadout): Promise<void>;
  setInvulnerable(id: string, on: boolean): void;

  getRules(): MatchRulesConfig;
  /** `persist: false` is the CDR slider mid-drag (`seedRules` today). */
  setRules(rules: MatchRulesConfig, persist: boolean): void;
  readonly matchRules: MatchRules;

  getWorld(): WorldConfig;
  setWorld(world: Partial<WorldConfig>): void;

  getCheats(): CheatConfig;
  setCheats(cheats: Partial<CheatConfig>): void;

  resetToDefaults(): Promise<void>;
}

/** Only reachable when a match is running. */
export interface MatchLiveControls {
  refill(id: string): void;
  clearCooldowns(id: string): void;
  scoreOf(id: string): ScoreLine;
  statGroupsOf(id: string): StatGroup[];
  stacksOf(id: string): { spellId: string; name: string; count: number }[];
  addStacks(id: string, spellId: string, amount: number): void;
  setStacks(id: string, spellId: string, count: number): void;
  zoom: number;
  setZoom(factor: number): void;
  persistZoom(): void;
  renderQuality: RenderQuality;
  renderFps: RenderFps;
  setRenderQuality(q: RenderQuality): void;
  setRenderFps(f: RenderFps): void;
  requestExit(): void;
}
```

Both implementations end every mutator by persisting. `MatchDirectorSource`
delegates to `MatchDirector` (which already persists) and adds persistence for
the cheats; `PregameConfigSource` writes through `savePregameConfig`.

### Chunk discipline

The shared panel imports **types only** from `src/game/`. All `instanceof`
narrowing (`AIChampion`), all `Champion`/`Spell`/`Camera` field access lives
inside `MatchDirectorSource`, which is only ever constructed from inside the
game chunk.

Enforced by a source-scan test (`tests/scenes/matchConfigChunk.test.ts`,
modelled on `mana-spend-seam.test.ts`): in `src/game/hud/config/` minus
`MatchDirectorSource.ts`, and in the panel components, no value import of
`MatchDirector`, `AIChampion`, `Champion`, `Camera`, `Game`, `hudInteractions`.
Comments stripped before matching.

### The anti-drift test

`tests/game/config/matchConfigSource.contract.test.ts` runs one suite twice —
once against `PregameConfigSource` over a fake `localStorage`, once against
`MatchDirectorSource` over `tests/game/practice/helpers.ts`'s bench. Every
method: set it, read it back, assert it persisted. A control that only one
side can serve fails here before it can ship.

## 2. Layout — three tabs

Four will not fit: `.pregame-tab` is `flex: 1` and a 390px landscape phone
holds three plus the close button.

| Tab | Contents | Outside a match |
|---|---|---|
| **Đội** (`roster`) | Blue/Red sections · kit editor · side switch · per-bot AI flags · add/remove bot · Bất tử | full, minus KDA / Hồi đầy / Xoá hồi chiêu / stacks |
| **Trận đấu** (`rules`) | CDR · URF · jungle · minions · Đặt lại mặc định · **Bắt đầu** (pregame) or **Thoát trận** (in-match) | full |
| **Cài đặt** (`settings`) | Điều khiển · Ưu tiên mục tiêu · chất lượng · FPS · zoom · toàn màn hình · hiện toàn bản đồ · lớp gỡ lỗi | full, minus zoom |

"Gian lận" disappears as a tab: its per-unit half is already on each roster row
(where it landed in the cheat-tab redesign), and its two global switches move to
Cài đặt beside the other display settings.

Hidden, not disabled, for the live-only controls — a row of dead buttons on
the screen a player opens first is worse than a shorter panel.

`panelTab.ts`'s `PracticeTabId` gains `'settings'` and loses `'cheats'`; a
stored `'cheats'` value (it is a module ref, not persisted, so only within one
session) falls back to `'roster'`.

### The roster row's kit icons

Adopt `ParticipantCard.vue`'s shape in the shared row: a transparent full-row
button that opens the loadout editor, with each ability icon a real
`position: relative` button stacked above it. So tapping an icon opens
`SpellPreviewModal` in **both** places — closing the last divergence in the
table above. `spellId` on `ConfigRosterEntry.abilities` is what makes this
resolvable outside a match.

### Invulnerability is visible on the row

A small shield icon on the row whenever that participant is invulnerable —
not only inside the expanded drawer. Persisted cheats mean a player can return
days later to a match they do not remember configuring; the state has to be
legible without opening anything.

## 3. Storage

Same key, `lol2d:pregameConfig:v1`. One new branch, following the per-field
optional policy `PregameConfig.ts` has used from the start:

```ts
export interface CheatConfig {
  revealMap: boolean;
  debug: { routes: boolean; terrain: boolean; collision: boolean;
           vision: boolean; quadtree: boolean };
  playerInvulnerable: boolean;
  /** Index-aligned with `ai.bots`, length `AI_COUNT_MAX`. */
  botInvulnerable: readonly boolean[];
}
```

A blob without `cheats` sanitizes to all-`false`, which is exactly today's
behaviour — a lossless read of what an old config meant, not a reset.

### What this changes elsewhere

- `MatchDirector.persist()` is now called from `setInvulnerable`, `revealMap`
  and the debug flags. Its file comment says the opposite today ("from none of
  the cheats") and must be rewritten.
- `MatchDirector.toPregameConfig()` gains the `cheats` branch, derived from
  live state the same way everything else is: `isInvulnerable(unit)` per roster
  position, `revealMap`, `debug`.
- **Boot must apply them.** `Game` seeds `revealMap` and the debug flags from
  the config, and applies `Invulnerable` to the player and to each bot whose
  slot carries the flag. This is new work on the boot path, not just storage.
- The `N` key (`GameScene.keyPressed` → `debug.routes`) must route through the
  director so a keyboard toggle persists like the checkbox does.

### Deliberately not persisted

- **Stack counts.** `+1/+10/+100` is an action on a live spell instance, not a
  setting. Persisting one means keying by `slot × spellId` and replaying it at
  spawn — a separate change, and it is hidden outside a match anyway.
- **Device preferences keep their own keys.** Input mode
  (`lol2d.touchControls`), tap-target priority
  (`lol2d.touchTargetPriority`), render quality (`lol2d.renderQuality`), FPS
  (`lol2d.renderFps`) and zoom already persist independently and already work
  without a `Game`. Folding them into the config blob is a migration with risk
  and no user-visible gain.

### Accepted consequence

Invulnerability now survives a reload. That is the owner's explicit decision;
the shield badge on the roster row (§2) is the mitigation.

## 4. Files

**Deleted:** `scenes/SetupScene.vue`, `scenes/setup/PlayersTab.vue`,
`SettingsTab.vue`, `AiConfigPanel.vue`, `MatchRulesPanel.vue`,
`ParticipantCard.vue`, `usePregameConfig.ts`;
`game/hud/PracticePanel.vue`, `game/hud/practice/CheatTab.vue`.

**New:** `game/hud/config/MatchConfigSource.ts`, `PregameConfigSource.ts`,
`MatchDirectorSource.ts`, `MatchConfigPanel.vue`, `config/RosterTab.vue`,
`config/MatchTab.vue`, `config/SettingsTab.vue`, `config/rosterVisuals.ts`
(catalogue-backed avatar/icon resolution for the pregame side).

**Moved:** `game/hud/practice/RosterTab.vue` and `RulesTab.vue` become the new
tabs, rewritten against the source; `scenes/setup/InputModePanel.vue` →
`game/hud/config/`; `practice/participantStats.ts` → behind
`MatchLiveControls`.

**Changed:** `SetupScene.ts` (mounts the panel with `PregameConfigSource`),
`InGameHUD.vue` (provides `MatchDirectorSource`), `PregameConfig.ts`
(`cheats`), `MatchDirector.ts` (persist cheats), `Game.ts` (seed cheats at
boot), `GameScene.ts` (`N` routes through the director), `panelTab.ts`.

**Unchanged:** `LoadoutEditorModal.vue`, `KitRoster.vue`, `SpellDetailPane.vue`,
`SpellIcon.vue`, `SpellPreviewModal.vue`, `pregameCatalog.ts`, `useTouchUi.ts`,
`savedKits.ts`, `MatchTeams.ts`.

## 5. Testing

- `matchConfigSource.contract.test.ts` — the suite run against both sources.
- `matchConfigChunk.test.ts` — the source scan of §1.
- `PregameConfig.test.ts` — `cheats` sanitize/migrate cases.
- `MatchDirector.persistence.test.ts` — **rewritten**: it currently asserts the
  stored blob is byte-identical after every cheat is switched on, which is now
  the opposite of the requirement.
- New: cheats are applied at boot (invulnerable player, revealed map, lit debug
  layer) — a `Game`-construction test, not an e2e.
- `usePregameConfig.test.ts`, `pregameBootPath.test.ts`,
  `loadoutChanges.test.ts` — retargeted at `PregameConfigSource`.
- e2e: `drive-pregame-config.mjs` rewritten (the `pregame-*` ids are gone).
  **`practice-*` DOM ids are kept verbatim** so `drive-practice-panel.mjs`,
  `drive-roster-stats.mjs`, `drive-kit-builder.mjs`, `drive-mobile-hud.mjs` and
  `drive-touch-controls.mjs` change as little as possible.

Every test is written first and shown to fail before the code that satisfies
it, and each is read for *why* it failed — not merely that it did.

## 6. What changed during implementation

Three things landed differently from the design above, each for a reason found
by building it:

- **`describeAbility` replaced the row's `spellId`.** The design gave each
  ability icon a catalogue id so tapping it could open the description in both
  places. A live `Spell` has no reliable catalogue id — `Spell.name` is a
  constructor name a minifier may mangle — so the seam became a method, and the
  in-match answer is built from the live spell instead. That is the better
  answer, not a fallback: the numbers it quotes are this match's, after CDR and
  URF.
- **The row's "open the editor" button covers the identity zone, not the row.**
  `styles/hud.css` already recorded a decision against a full-row invisible
  overlay (it would sit over the drawer toggle, the side switch and the delete).
  Scoped to the portrait and the name it covers none of them, which is the
  situation `ParticipantCard` used the same shape in.
- **`renderPreferences.ts` and `zoomBounds.ts` had to be split out** of `Game.ts`
  and `Camera.ts`. Neither was in the design, and both are the chunk rule biting:
  the settings tab reads a stored FPS cap and a slider's bounds, and importing
  either from its old home would have pulled the match into the menu.

`drive-pregame-config.mjs` was deleted rather than retargeted — every selector it
drove belonged to the screen that is gone. The behaviour it proved that still
matters (a config edited with no match running *is* the match you get: champion,
bot count, CDR reaching a real spell, URF making a cast free) moved into
`drive-match-config.mjs`.

## 7. Risks

1. **Chunk leakage** is the one that would go unnoticed: it costs the menu ~2MB
   and nothing on screen looks wrong. The scan test in §1 is the only defence,
   so it is written first, in step 1, not last.
2. **Boot-applied cheats** touch the match-construction path, which nothing
   else in this change goes near. Kept to a separate step with its own test.
3. **e2e churn** is wide but shallow; keeping the `practice-*` ids is what
   bounds it.
