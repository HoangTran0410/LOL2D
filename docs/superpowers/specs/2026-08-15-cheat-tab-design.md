# Cheat tab — design

Date: 2026-08-15
Status: approved, ready for an implementation plan
Follows: `docs/superpowers/specs/2026-08-15-practice-panel-design.md`

## The problem

The practice panel reshapes a match — who is in it, how many, cooldowns,
whether the jungle exists — but it cannot touch the state of a unit *inside*
that match. Practising a Nasus combo at 300 stacks means farming 300 stacks.
Practising a burst rotation against something that survives it means picking a
tanky champion and hoping. Checking what a spell does at zero cooldown means
waiting out the cooldown.

The reference point is the same one the panel already follows: the practice
tool in Wild Rift / LoL, where a training dummy does not die and the cooldowns
are yours to switch off.

## Scope

In:

- **Invulnerable** — a sticky toggle; the unit takes no damage from anything.
- **Refill** — health and mana to full, one shot.
- **Clear cooldowns** — every ability off cooldown, one shot.
- **Set stacks** — for the spells that accumulate one (Nasus Q, Veigar Q,
  Cho'Gath R), set the count directly.

Applies to **the player or any bot**, selected the way `RosterTab` selects.

Also in, and neither is a cheat — both arrived with this work because the panel
is where they belong:

- **The panel drops from four tabs to three.** The Chiêu thức tab is deleted
  outright, and Trận đấu absorbs Thế giới. See "The panel loses a tab" below.
- **Escape stops ending the match**, and the match gets a real exit button. See
  "Escape stops ending the match" below.

Out, and why:

- **Teleport.** Deferred to the minimap spec, on the user's reasoning: the
  camera shows a few hundred pixels, so picking a destination on the visible
  map can only move you as far as you could already see. Teleport wants a
  minimap to tap, and should be designed with it. This also means **the
  minimap comes before teleport**, not after.
- **Debug hub, map swapping.** Their own specs, unchanged from the practice
  panel spec's deferral list.

## What already exists

Established by reading the code before designing, because four of these
findings changed the design:

1. **`GameObject.teleportTo(x, y)` already exists** and does the whole job:
   `markDisplaced()`, `pathAgent.clear()`, sets both `position` and
   `destination`. `Flash` and `Zed_W` use it. It does not check terrain — it
   drops the unit wherever asked and `TerrainMap.update()` pushes the body out
   of a wall on the next unpaused tick. So when teleport does arrive with the
   minimap, the mechanism is a one-line call; the cost is entirely in choosing
   the destination.

2. **Damage immunity has a working mechanism, and it is not
   `StatusFlags.Invulnerable`.** That flag exists in the enum but nothing reads
   it: `ActionState` has no corresponding bit, `Stats.updateActionState` has no
   line mapping it, and `AttackableUnit.takeDamage` never consults it. What
   *does* work is `Buff.modifyIncomingDamage` — `takeDamage` loops every buff
   through it and returns early once damage reaches zero
   (`AttackableUnit.ts:348-351`). `Stasis` is built on exactly this
   (`return 0`), and `Shield` and `Zed_R` are the other two users.

3. **`AttackableUnit.ts:363` is the only line in the codebase that originates a
   death.** The three other `die(` hits are `super.die(deathData)` inside
   overrides. So a buff that zeroes incoming damage makes a unit genuinely
   unkillable, with no second path to close.

4. **Stacking has two unrelated mechanisms**, and the two champions the user
   named are one of each:

   | | Nasus Q | Veigar Q, Cho'Gath R |
   |---|---|---|
   | Stored as | a `stacks` number field on the **spell** | N buff instances on the **unit** |
   | Adding one | `this.stacks++`, rebuild `description` | `owner.addBuff(new X(...))` |
   | HUD badge | yes, via `get stackCount()` | **no** — neither overrides it |

   `Spell.stackCount` (`Spell.ts:95`) is the read side and returns `undefined`
   for "nothing to count"; `DesktopHudView.vue:82` badges the icon when it is
   defined. **Only `Nasus_Q` overrides it.** There is no write side.

5. **`Spell.currentCooldown` has a setter** routing to
   `runtime.setCompatibilityCooldown`. `BasicAttack` deliberately overrides it
   with an empty setter so a reset cannot hand back a swing — which is the
   behaviour we want, for free.

6. **`Game.draw()` returns early while paused**, so the canvas freezes on its
   last frame while the panel is open. Nothing in this spec needs to draw, but
   it is the constraint that ruled out picking a teleport point on the map.

## Design

### Where cheats live

`MatchDirector` grows a small cheat surface, and the mechanisms live where this
codebase already puts that kind of work: a `Buff` for invulnerability, a method
on `Spell` for stacks. `MatchDirector` is the seam the practice panel is built
on and the one thing that mutates a running match; a separate `CheatConsole`
class was considered and rejected, because it splits that responsibility in two
with no defensible line between them (is "refill health" a cheat or a roster
operation?).

### 1. Invulnerability is a buff

`src/game/gameObject/buffs/Invulnerable.ts`, modelled on `Invisible.ts`:

```ts
export default class Invulnerable extends Buff {
  image: Buff['image'] = AssetManager.get('buff_stasis');
  name = 'Bất Tử';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  /** The whole buff. See Stasis, which does this plus the crowd control. */
  modifyIncomingDamage(): number {
    return 0;
  }
}
```

Deliberately **not** `Stasis`: stasis also stuns the unit and drops
`Targetable`, and a player who turns on invulnerability to practise a combo
must still be able to move and cast. Deliberately **not** wiring
`StatusFlags.Invulnerable` into `ActionState`: nothing reads that flag today,
and adding a bit, a mapping line and a `takeDamage` branch to reach a result
`modifyIncomingDamage` already delivers is speculative work.

Icon reuses `buff_stasis` — the Zhonya's hourglass, which reads correctly and
needs no new asset and no `assets:generate` run.

Duration: the same effectively-permanent value the other never-expiring buffs
use (`600000`, as `Veigar_Q_Power` and `ChoGath_R_Growth` do). The toggle turns
it off by calling `deactivateBuff()`, so the duration is a backstop, not the
mechanism.

Because `Minion`, `Monster` and `Turret` all call `super.takeDamage`, one buff
covers every unit type without a per-class change.

### 2. Stacks get a write side on `Spell`

```ts
/**
 * Set this spell's accumulated stacks. Default: this spell has none, so the
 * call is refused rather than silently doing nothing surprising.
 * Returns whether the spell accepted it.
 */
setStackCount(_count: number): boolean {
  return false;
}
```

Symmetric with `get stackCount()`, and absolute rather than incremental so one
method covers both "give me 100" and "back to zero".

Three overrides:

- **`Nasus_Q`** — clamp to `>= 0`, assign `this.stacks`, rebuild
  `this.description = describe(this.stacks)`.
- **`Veigar_Q`** — compare against the current count and add or remove
  `Veigar_Q_Power` buffs to match.
- **`ChoGath_R`** — the same against `ChoGath_R_Growth`.

Both buff-based overrides need the buff *configured the way the spell
configures it* (`stackId`, `image`, `name`, `buffAddType`, `maxStacks`,
`bonuses`). Today that configuration is inline in `Veigar_Q_Object.onHit` and
`ChoGath_R.onSpellCast`. **Extract it to a factory function in each spell
file** and call it from both places, so the cheat cannot drift from the real
thing.

Two behaviours to get right, both of which need a test:

- **Cho'Gath's fill.** `onSpellCast` calls `takeHeal(MAX_HEALTH_PER_STACK)`
  with the comment "the extra max health is only worth something if it comes
  filled in". `setStackCount` must mirror this **when raising** the count —
  otherwise setting 50 stacks leaves Cho'Gath at a few percent of a huge health
  pool, which looks like a bug. No heal when lowering.
- **Lowering below current health.** Removing stacks drops `maxHealth`. Verify
  `stats.health.baseValue` is clamped to the new maximum; if `Stats.update()`
  does not already do it, the override must.

Free fix while in these files: **`Veigar_Q` and `ChoGath_R` gain
`get stackCount()`**. All three of these spells stack permanently and only
Nasus shows a badge; the HUD support has been there the whole time
(`DesktopHudView.vue:82`) and nothing was feeding it.

The tab lists a unit's spells where `stackCount !== undefined`, so a stacking
spell added later appears with no change to the panel.

### 3. Two one-shot actions on `MatchDirector`

```ts
/** Health and mana to full. Same two lines `applyLoadout` already runs. */
refill(unit: Champion): void

/** Every ability off cooldown. BasicAttack's no-op setter keeps the swing timer. */
clearCooldowns(unit: Champion): void
```

Plus the invulnerability pair, which owns the buff so the tab never constructs
one:

```ts
isInvulnerable(unit: Champion): boolean
setInvulnerable(unit: Champion, on: boolean): void
```

### 4. `CheatTab.vue`

A fifth tab in `PracticePanel.vue`, `v-if` like the other three (it reads its
state from the director on mount and has nothing staged to lose).

Unit selection reuses `director.roster()` and `RosterTab`'s `version` /
`invalidate` pattern verbatim, including its invariant: **every director call in
the component is followed by `version.value++`**. The reason `RosterTab`
documents for it holds here unchanged — `hudInteractions.ts` wraps the director
in `markRaw` on purpose, so the roster is not reactive.

Controls, in order: unit picker, then Bất tử (toggle), Hồi đầy (button), Xoá hồi
chiêu (button), then one row per stacking spell. "Năng lượng" is this codebase's
word for mana in player-facing text (`Veigar_Q.ts:16`), not "ngọc" or "mana".

**No text input.** Stack rows are buttons — `+1 / +10 / +100 / Xoá` — not a
number field. A text input inside a running match is a known hazard in this
codebase: p5 binds `keydown` on `window`, so typing casts abilities and Escape
exits to `MenuScene`. The saved-kit name form solved it with
`@keydown.stop`/`@keyup.stop`/`@keypress.stop`, but that is a cost worth paying
for a name and not for a number four buttons can express.

Every control needs `@touchend.prevent` (or the equivalent) alongside its click
handler: `GameScene` calls `preventDefault()` on every touch page-wide, which
during the practice panel work killed a checkbox `change`, a range drag and a
plain `@click` on three separate occasions.

### 5. The panel loses a tab, and gains no width problem

The Chiêu thức tab existed because it was once the *only* thing in the game you
could change without quitting. It is now the smaller half of something the
Đấu thủ tab does better: `RosterTab.vue:302` opens `LoadoutEditorModal` for
**every** roster row including the player's (the `v-if="!entry.isPlayer"` on
line 321 guards only the remove button and the behaviour flags), and that editor
sets all seven slots, from the catalogue or from a saved kit.

So: **delete the Chiêu thức tab**, and **fold Thế giới into Trận đấu** — CDR,
URF, jungle and minions are all "settings for this match", and the two tabs hold
two controls each. The panel becomes **Đấu thủ | Trận đấu | Gian lận**.

That is worth stating twice, because it deletes a risk this spec was carrying:
at three tabs, the "five tabs will not fit at 390px" problem does not arise.

**What goes with the tab.** `oneForAll` and `cloneMySpell` (both read in
`hudInteractions.confirmPicks`) are the two mode toggles the user called out;
they have no meaning once picks are per-unit through the roster. With them go
`SpellPickerModal.vue` and, from `hudInteractions.ts`, `draftSpells`, `pick`,
`pickKit`, `confirmPicks`, `changeSpell`, `spellIndexToSwap`, `filteredSpells`
and the touch handlers that served the picker's icons — a large part of a 22KB
file, and `styles/hud.css`'s `.spell-picker` section with it.

**Check before deleting, do not assume:** `allSpells`, `spellGroups` and
`loadSpellPickerAssets` exist to pre-load spell icons. `LoadoutEditorModal` /
`KitRoster` need icons too and build their shelves from
`src/scenes/setup/pregameCatalog.ts`. Whether the HUD-side asset preload is
still doing useful work after the picker is gone is a question to answer by
reading, not by guessing in either direction.

**The desktop fast path must survive.** `DesktopHudView.vue:67` binds a click on
a spell icon to `changeSpell(index)`, which opened the picker focused on that
slot. Its replacement: open the panel on Đấu thủ with the player's loadout
editor open, on that slot — the editor has a pinned slot row already, so the
gesture keeps its meaning.

**One real behaviour change, stated rather than slipped in.** `confirmPicks`
applied picks with `replaceSpell`, which does not touch health or mana.
`MatchDirector.applyLoadout` goes through `Champion.applyPreset` and then
refills both to maximum. After this deletion, changing a spell mid-match heals
the unit to full. In a practice panel that is arguably a feature, but it is a
change, and it should be in the commit message rather than discovered later.

**Blast radius, measured.** `tests/game/hud/hudInteractions.test.ts` is 282
lines and its whole `pick / confirmPicks — batched apply` block (~100 lines,
including the `oneForAll` and `cloneMySpell` cases) goes with the feature.
Three e2e scripts reference picker internals: `drive-mobile-hud.mjs` (15
references — it scrolls `.spell-picker` by hand and asserts on it),
`drive-touch-controls.mjs` (7) and `drive-practice-panel.mjs` (7).

**Do this before the cheat tab.** Both change `PracticePanel.vue`, and it is
cheaper to add a third tab to a two-tab panel than to add a fifth and then
delete two.

`PracticePanel.vue`'s default tab is `'spells'` and must become `'roster'`.
`state.showSpellsPicker` keeps its name for now: renaming it reaches into all
three e2e scripts for no behaviour, and this change already touches them enough.

### 6. Escape stops ending the match

`GameScene.keyPressed` (`GameScene.ts:150-154`) sends keycode 27 straight to
`sceneManager.showScene(MenuScene)`. One mis-hit ends the match — no
confirmation, no way back, and everything built up in it is gone. That is the
worst possible thing for a panel whose entire purpose is a long practice
session you keep tuning.

Two changes, and they only work as a pair:

**Escape toggles the practice panel instead.** Closed → open it; open → close
it, the same discard-and-close `closeSpellPicker` already does. `Game.keyPressed`
binds only Space (32) and N (78), so 27 is free. This keeps the reflex — Escape
still means "get me to the menu" — while making the menu the match's own.

**The exit moves into the panel, at the bottom of the Trận đấu tab.**
Deliberately not beside the shell's close button in the tab row: two adjacent
buttons whose outcomes differ by an entire match is exactly the mis-hit being
designed out, and that row is already tight enough that five tabs may not fit
(see Known risks). "Trận đấu" is the tab that means *this match*, which is what
is being quit.

It needs a **two-step confirm** — press once for "Chắc chưa?", again to leave.
Nothing else in this panel confirms (bots, saved kits and champion swaps are all
one press, on purpose, because each is cheap to redo); this one is not
recoverable, which is the whole reason it is being moved.

**Plumbing.** `Game` holds no reference to the scene manager and should not
gain one — the dependency runs the other way everywhere else. `GameScene` sets
a callback on the game it just constructed:

```ts
this.game.onExitRequested = () => this.sceneManager.showScene(MenuScene);
```

`hudInteractions` exposes it to the panel the way it exposes `director`. Not a
`MatchDirector` method: quitting is a scene transition, not a mutation of the
running match, and the director's contract is the latter.

**Discoverability matters more than usual here.** `src/game/hud/` contains no
`showScene`, no `MenuScene` import, no "Thoát" — Escape is currently the *only*
way out of a match. Removing it without a findable replacement traps the player
in the game.

**Nested modals.** `RosterTab` can have `LoadoutEditorModal` open over it. Escape
must close the innermost layer first rather than the whole panel — the same
"backdrop steps back one layer" rule commit `b48ef7d` established for the setup
screen.

**Verified not to break the e2e suite.** Three scripts press Escape
(`drive-kit-builder.mjs:345`, `drive-pregame-config.mjs:106,348`) and all three
are in `SetupScene`, closing setup-screen modals. No script uses Escape to leave
a match.

## Known risks

**`tests/e2e/drive-practice-panel.mjs` will go red twice** — once when the tab
count drops to two, once when it returns to three. It asserts
`tabs === TAB_LABELS` exactly (line ~270) and iterates `TAB_IDS`. This is the
script doing its job; updating both constants belongs in the same task as the
tab change that caused it, never a follow-up.

**Deleting the picker is the largest piece of this work, and it is a deletion
across four kinds of file** — a component, a slice of `hudInteractions.ts`, a
stylesheet section, a unit-test block and three e2e scripts. The failure mode is
a half-removal that leaves dead exports type-checking cleanly. `npm run verify`
catches unused *files* only if nothing imports them, so the check that matters
is grepping for each removed name after removing it.

**The five-tab width problem is designed out, not solved.** It would return the
moment a fourth tab is proposed. At 390px with `.pregame-tab { flex: 1 }` plus
the close button, four is the practical ceiling.

## Testing

Vitest, in `tests/game/`:

- Invulnerability blocks damage — **with the paired control**: the same unit
  without the buff takes the same hit for full damage. A test that only asserts
  "health unchanged with the buff on" passes against a broken `takeDamage` that
  drops all damage.
- `setStackCount` on each of the three spells, raising *and* lowering, asserting
  the mechanism (`stacks` field / buff count) and `stackCount` agree.
- Cho'Gath's heal on raise, and health clamped on lower.
- `clearCooldowns` leaves the basic attack's swing timer alone.
- `refill` from a damaged, mana-drained unit.
- `GameScene.keyPressed(27)` no longer calls `showScene`, and does call the
  panel toggle. Assert on the scene manager, not on a flag the handler sets.

**Every test must be shown to fail first, and the failure message read.** The
practice panel plan shipped six tests that could never fail, all the same
shape: asserting on state *after* the code under test had already mutated it
into the expected value, or wrapped in a defensive early return that swallowed
the case. The red step is the check for this, and "I ran it and it failed" is
not the same as "I read why it failed".

e2e: extend `drive-practice-panel.mjs` rather than adding a script, since the
fifth tab forces changes to that file anyway. New checks: the toggle survives a
close/reopen, a bot set invulnerable actually stops losing health across
unpaused frames, and a stack button moves both the spell and the HUD badge.

Two more, for the Escape change, and these are the ones worth most: **pressing
Escape mid-match leaves you in the match** (`GameScene` still current, game
still alive) with the panel open, and **the exit button's first press does not
leave** — only the confirm does. Both are regressions a player would discover
by losing a match, which is the failure this whole section exists to prevent.

## Files

- Create: `src/game/gameObject/buffs/Invulnerable.ts`,
  `src/game/hud/practice/CheatTab.vue`
- Delete: `src/game/hud/SpellPickerModal.vue`,
  `src/game/hud/practice/WorldTab.vue` (merged into `RulesTab.vue`)
- Modify: `src/game/gameObject/Spell.ts` (`setStackCount` default),
  `src/game/gameObject/spells/Nasus_Q.ts`,
  `src/game/gameObject/spells/Veigar_Q.ts`,
  `src/game/gameObject/spells/ChoGath_R.ts` (overrides + buff factories +
  the two missing `stackCount` getters), `src/game/MatchDirector.ts`
  (four methods), `src/game/hud/PracticePanel.vue` (fifth tab),
  `styles/hud.css` (tab row at phone width, exit button),
  `tests/e2e/drive-practice-panel.mjs` (`TAB_LABELS`, `TAB_IDS`, new checks)
- Modify, for the tab deletion: `src/game/hud/hudInteractions.ts` (remove the
  picker surface), `src/game/hud/DesktopHudView.vue` (redirect the spell-icon
  click), `src/game/hud/practice/RulesTab.vue` (absorb `WorldTab`),
  `tests/game/hud/hudInteractions.test.ts` (drop the `pick / confirmPicks`
  block), `tests/e2e/drive-mobile-hud.mjs`, `tests/e2e/drive-touch-controls.mjs`
- Modify, for the Escape change: `src/scenes/GameScene.ts` (drop the
  `showScene` on 27, set `onExitRequested`), `src/game/Game.ts`
  (`onExitRequested` field), `src/game/hud/hudInteractions.ts` (expose it, and
  the panel toggle Escape calls),
  `src/game/hud/practice/RulesTab.vue` (the exit button and its confirm)
