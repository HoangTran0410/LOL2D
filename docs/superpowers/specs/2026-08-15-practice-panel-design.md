# Practice panel — design

Date: 2026-08-15
Status: approved, ready for an implementation plan

## The problem

Every knob that shapes a match lives on the pregame setup screen, and the only
way back to it is to abandon the match. Want a different bot? Different CDR?
Jungle off? Quit, re-configure, re-enter, walk back to where you were. The
in-game HUD's one editable thing is the player's own seven spell slots.

The reference point is the practice tool in Wild Rift / LoL: a panel you open
mid-match that reshapes the match around you without leaving it.

## What v1 covers

One modal, four tabs, plus a saved-kit library that both this panel and the
pregame editor read.

| Tab | Contents |
|---|---|
| Chiêu thức | The roster that is already there, unchanged, now one tab of several |
| Đấu thủ | The live roster: add a bot, remove a bot, change any unit's champion/kit, per-bot behaviour flags |
| Trận đấu | CDR, URF |
| Thế giới | Jungle on/off, minions on/off |

Deferred to their own projects, in this order: cheats (teleport, heal,
invulnerable, spell stacks), a debug hub, a minimap, map swapping. Map swapping
stays blocked until a second map exists — there is exactly one today
(`assets/json/summoner_map.json`).

## Decisions taken during brainstorming

1. **The panel mutates the running match only.** It never writes
   `lol2d:pregameConfig:v1`. Leaving the match and starting a new one returns
   to whatever the setup screen has stored. A practice tool you can flail
   around in without wrecking your real configuration.
2. **Changes apply instantly, in place.** Changing a unit's champion swaps its
   kit where it stands — full HP/mana, cooldowns cleared, position kept. No
   death, no walk back from the fountain.
3. **A saved kit is a whole `ChampionLoadout`** — all seven slots, A through F
   — under a user-given name, assignable to the player or to any bot, from
   either screen. This is the one thing in v1 that does touch `localStorage`,
   under its own key, and only when the player presses save. An explicit,
   user-initiated save is a different act from the panel silently writing
   through, which is what decision 1 rules out.

## Constraint that shapes everything: the match is paused

`hudInteractions.ts` calls `game.pause()` when the modal opens, and both
`Game.update()` and `Game.draw()` return early while `paused` is set
(`Game.ts:252`, `Game.ts:257`). Two consequences:

- **Nothing the director does is visible until the panel closes.** The canvas
  is not redrawn, and `ObjectManager.update()` — which is what actually sweeps
  `toRemove` objects out and flushes `_objectToBeAdd` in — does not run. Spawns
  and removals land on the first unpaused tick.
- **That is a feature, not a workaround.** The picker already batches every
  pick behind Huỷ / Xác nhận. The panel keeps the same contract: edit freely,
  commit once, and the match resumes having absorbed the lot.

The panel must therefore never promise live feedback on the canvas. Its own UI
reflects the pending state; the world catches up on close.

## Architecture

### `MatchDirector` — one place that mutates a running match

New: `src/game/MatchDirector.ts`. Constructed by `Game` and exposed as
`game.director`. Every "change the match" operation goes through it. No Vue, no
DOM, no p5 globals beyond what `Game` already provides — so it is testable
under plain Vitest with `tests/game/fixtures.ts`'s `createGame()`.

It takes a `MatchDirectorContext`, not a `Game`. **The boundary is wider than
it first looks, and getting it wrong was this design's one real mistake.** The
tempting version is a narrow bag of exactly what the director's own methods
touch — `objectManager`, `player`, `randomSpawnPoint`, `monsters`,
`minionSpawner`, `matchRules`, `spawnJungle`. That is wrong, because `addBot`
does not merely *use* the context: it **hands the context to the new bot as
that bot's `game`**. From its next tick the bot reaches for `eventManager`,
`navigation`, `createSpellContext` and `mapSize` on its own, none of which the
narrow interface promised. Implemented that way it crashed in `Spell.press`
with `Cannot read properties of undefined (reading 'emit')` — and only
*sometimes*, since it takes the bot's `random() < 0.1` auto-cast roll to come
up. The honest requirement is "a whole game context, plus the match-level
things the director edits":

```ts
export interface MatchDirectorContext extends GameObjectRuntimeContext {
  player: Champion; // narrowed from AttackableUnit — only a champion has a kit to swap
  monsters: Monster[];
  minionSpawner: { minions: { toRemove: boolean }[]; enabled: boolean };
  matchRules: MatchRules;
  spawnJungle(): void;
}
```

Widening it costs nothing that mattered: `GameObjectRuntimeContext` is itself a
plain interface with no p5 in it, already satisfied by `createGame()`, so the
testability this design rests on is intact — and `Game` satisfies it with no
changes at all.

```ts
export interface BotBehaviour {
  autoMove: boolean;
  autoAttack: boolean;
  autoCast: boolean;
}

export interface RosterEntry {
  unit: Champion;
  isPlayer: boolean;
  /** Present for bots only. */
  behaviour?: BotBehaviour;
}

export default class MatchDirector {
  constructor(game: Game);

  // ---- roster
  /** The player first, then every live AIChampion, in spawn order. */
  roster(): RosterEntry[];
  /** Spawns a bot at a fountain spawn point. Returns it; it enters the world on the next unpaused tick. */
  addBot(loadout: ChampionLoadout): AIChampion;
  /** Marks a bot for removal along with anything it owns. No-op on the player. */
  removeBot(bot: AIChampion): void;
  /** Swaps a unit's champion where it stands (decision 2). Also rewrites a bot's presetFactory so the identity survives death. */
  applyLoadout(unit: Champion, loadout: ChampionLoadout): void;
  setBotBehaviour(bot: AIChampion, flags: Partial<BotBehaviour>): void;

  // ---- world
  /** Off marks every monster `toRemove` and empties `game.monsters`; on re-runs `Game.spawnJungle()`. */
  jungleEnabled: boolean;
  /** Off marks every live minion `toRemove` and stops the wave clock; on resumes it. */
  minionsEnabled: boolean;

  // ---- rules
  /** Writes `game.matchRules` (read live by Spell.ts — see below). */
  setRules(rules: MatchRulesConfig): void;
  getRules(): MatchRulesConfig;
}
```

Stopping the wave clock is one flag read at the top of `MinionSpawner.update()`
(`enabled`, default true), not a change at the `Game.fixedUpdate` call site —
the spawner already owns the clock and the live cap, so the switch belongs
where the thing it switches lives.

Why a class on `Game` rather than functions the Vue components call directly:
the deferred tabs (cheats, debug, minimap) all mutate the same match, and each
one reaching into `objectManager`/`minionSpawner`/`matchRules` on its own is
how this ends up with four different ways to remove a unit. It is also the
seam that makes the behaviour testable without mounting a component.

### Rules are already live

`Spell.ts:320` reads `this.game?.matchRules?.cooldownMultiplier` at cast time
and `:369` reads `manaFree` — neither is captured at construction. `setRules`
is therefore an assignment to `game.matchRules` and nothing else. `MatchRules`
is `{ cooldownMultiplier, manaFree }`, derived from `MatchRulesConfig` by the
existing `toMatchRules`, which the director reuses rather than recomputing.

### `Champion.applyPreset` — extracted, and it fixes a bug

`Champion`'s constructor (`Champion.ts:96-103`) sets `name`, `spells`, and the
three attack stats from a `ChampionPresetData`. `AIChampion.respawn()` does the
same job again for a bot rolling a new champion — except it only restores
`avatar` and `spells`. **A bot that respawns as a new champion keeps the old
champion's name and the old attack damage, attack speed and attack range.**
That is a live bug today, independent of this feature.

Extract the constructor's body into one method and have all three callers use it:

```ts
applyPreset(preset: ChampionPresetData): void {
  this.name = preset.name;
  if (preset.avatar) this.avatar = AssetManager.get(preset.avatar);
  this.replaceSpells((preset.spells ?? []).map(SpellClass => new SpellClass(this)));
  const attack = preset.attack ?? DEFAULT_CHAMPION_ATTACK;
  this.stats.attackDamage.baseValue = attack.damage;
  this.stats.attackSpeed.baseValue = attack.attacksPerSecond;
  this.stats.attackRange.baseValue = attack.range;
}
```

Callers: the `Champion` constructor, `AIChampion.respawn()`, and
`MatchDirector.applyLoadout`. The bug fix needs its own regression test.

`applyPreset` deliberately does **not** touch health or mana: the constructor
must not (the unit is being built) and `respawn()` must not (`super.respawn()`
already refilled it). Restoring the bars is `applyLoadout`'s job, because it is
specific to swapping a champion under a unit that is standing there mid-fight —
a Yasuo on 12 HP that becomes a Zed on 12 HP is not what "try this champion
now" means. `applyLoadout` therefore calls `applyPreset` and then refills
health and mana to their maxima.

### `_respawnWithNewPreset` gets a type

`hudInteractions.ts:305` reaches through `(bot as any)._respawnWithNewPreset`.
The flag is real and load-bearing (it is what "Clone my spells" uses to stop a
bot re-rolling), so it stays — but it becomes a typed method on `AIChampion`
(`setRespawnRollsNewPreset(on: boolean)`) and the `as any` casts in
`hudInteractions.ts` go. The bot enumeration on line 299 —
`objects.filter(o => o instanceof AIChampion)` — moves into
`MatchDirector.roster()` so there is one definition of "who is in this match".

### Saved kits

New: `src/game/config/savedKits.ts`, key `lol2d:savedKits:v1`, separate from
the pregame config so a corrupt library can never take the match config with it.

```ts
export interface SavedKit {
  id: string;
  name: string;
  loadout: ChampionLoadout;
  savedAt: number;
}

export const loadSavedKits: () => SavedKit[];
export const saveKit: (name: string, loadout: ChampionLoadout) => SavedKit;
export const renameKit: (id: string, name: string) => void;
export const deleteKit: (id: string) => void;
```

Validation follows `sanitizePregameConfig`'s established rule: every field
independently optional with a per-field fallback, a malformed entry dropped
rather than thrown on, a malformed file read as an empty library. A kit whose
`loadout` names a spell that no longer exists resolves the same way a stored
pregame loadout does — through the existing catalogue lookup, which already
falls back per slot.

Both screens render the library as a shelf at the top of `KitRoster`, beside
the existing "Ngẫu Nhiên" card, so saving in a match and using it in the next
one is one roster away in both directions.

**Correction, from implementing Task 11.** An earlier draft of this paragraph
justified the above with "`KitRoster` is already shared between the pregame
editor and the in-game panel". That is not what Task 8 built. `KitRoster` is
mounted by `LoadoutEditorModal`; the panel's **Chiêu thức** tab is
`SpellPickerModal`, which carries its own roster markup and has never imported
`KitRoster` at all. So in a match the library is not on the tab that looks like
a roster — it is at **Đấu thủ → a unit's row → the editor**, which is the same
editor the setup screen opens. The conclusion survives (one component, both
screens, no duplication); the route to it in-game does not match what this
paragraph implied, and any test written from that implication would look for
the shelf in the wrong place.

One hazard this feature introduced that nothing above anticipated: **a text
input inside a running match is not free.** p5 registers `keydown` on `window`,
and `GameScene.keyPressed` maps A/Q/W/E/R/D/F to casts and Escape to "leave the
match". Typing a kit's name would fire abilities, and one Escape would end the
match. The name field stops `keydown`/`keyup`/`keypress` for that reason. Any
future tab that takes typed input — a search box, a bot's name — inherits the
same requirement.

## UI

`SpellPickerModal.vue` stops being the modal root and becomes the Chiêu thức
tab's body. A new `src/game/hud/PracticePanel.vue` owns the shell: the title,
the tab bar, and the tab switch.

The tab bar reuses `.pregame-tabs` / `.pregame-tab` from
`styles/pregame-scene.css` — both stylesheets are loaded globally
(`index.html:22-27`) and the two screens now share the `--hextech-*` palette,
so this is reuse, not a copy.

New components under `src/game/hud/practice/`:

- `RosterTab.vue` — the live roster, one row per unit, reusing `ParticipantCard`'s
  shape; add/remove; opens the loadout editor for a row
- `RulesTab.vue` — CDR slider + URF toggle, driven by `MatchRulesPanel`'s markup
- `WorldTab.vue` — jungle and minion toggles

**Correction, from implementing Task 9.** This section originally said "the
existing draft/commit contract holds for the whole panel: the slot row's Huỷ /
Xác nhận stay, and every tab's edits are staged until Xác nhận." That is false
as built, and it contradicts this spec's own verification section, which asserts
on `game.matchRules` while the panel is still open.

What is actually true: **only the Chiêu thức tab stages.** Rules and world
changes apply the moment you make them. Two reasons, and neither is laziness.
Staging them would need a second draft layer with nothing to gain — a slider is
undone by dragging it back, and a checkbox by clicking it again, so "cancel"
adds a concept the controls already provide. And Huỷ / Xác nhận live inside
`SpellPickerModal`'s slot row, not in the panel shell, so they only render on
the tab whose picks they govern; there is no button on the Rules tab implying a
promise it does not keep.

The consequence to know: **Huỷ does not undo a rules or world change.** It
discards staged spell picks and closes the panel. A player who sets CDR to 90
and then presses Huỷ keeps CDR at 90.

Note this is orthogonal to *when a change becomes visible*: every world change —
staged or not — only reaches the canvas on the first unpaused tick, because
`ObjectManager.update()` does not run while the panel is open.

## Verification

**Vitest** (`tests/game/practice/MatchDirector.test.ts`), on `createGame()`:
- `addBot` puts an `AIChampion` in `_objectToBeAdd`, and it is in `roster()`
  after one `objectManager.update()`
- `removeBot` sets `toRemove`; the unit is gone after one update; the player
  cannot be removed
- `applyLoadout` keeps `position` and clears cooldowns; a bot's `presetFactory`
  is rewritten so the identity survives a respawn
- `setRules` changes what `Spell.effectiveCoolDownMs` returns for an
  already-constructed spell — the claim that rules are live, asserted rather
  than assumed
- jungle/minion toggles clear and restore their populations

`tests/game/attackableUnits/Champion.applyPreset.test.ts`: a respawn into a new
preset restores name and all three attack stats (the bug above).

`tests/game/config/savedKits.test.ts`, mirroring `PregameConfig.test.ts`:
round-trip, rename, delete, corrupt blob reads as empty, malformed entry dropped.

**Playwright** — a new `tests/e2e/drive-practice-panel.mjs`: open the panel
mid-match, add a bot and see it in the world after closing, remove it, change a
bot's champion and confirm the unit kept its position, drag CDR and confirm a
cast's cooldown actually changed, toggle the jungle off and count monsters,
save a kit and re-apply it to a different unit.

`npm run verify` gates the lot.

## Out of scope for v1

Cheats, debug hub, minimap, map swapping — each its own spec. Nothing in this
design should assume they will never arrive: `MatchDirector` is deliberately
the place they will attach.
