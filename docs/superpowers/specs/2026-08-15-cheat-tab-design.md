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

## Known risks

**Five tabs will not fit.** `.pregame-tab` is `flex: 1`, so on a 390px-wide
portrait phone each tab gets roughly 63px once the close button takes its
share, and "Chiêu thức" does not fit at `0.95em`. The fix is not chosen here on
purpose — **measure at phone width first**, then pick between a font-size step
under a media query and a horizontally scrolling tab row. Committing to a fix
before measuring is how the picker's collapsed roster happened.

**`tests/e2e/drive-practice-panel.mjs` will go red.** It asserts
`tabs === TAB_LABELS` exactly (line ~270) and iterates `TAB_IDS`. This is the
script doing its job, and updating both constants belongs in the same task as
the tab, not a follow-up.

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

## Files

- Create: `src/game/gameObject/buffs/Invulnerable.ts`,
  `src/game/hud/practice/CheatTab.vue`
- Modify: `src/game/gameObject/Spell.ts` (`setStackCount` default),
  `src/game/gameObject/spells/Nasus_Q.ts`,
  `src/game/gameObject/spells/Veigar_Q.ts`,
  `src/game/gameObject/spells/ChoGath_R.ts` (overrides + buff factories +
  the two missing `stackCount` getters), `src/game/MatchDirector.ts`
  (four methods), `src/game/hud/PracticePanel.vue` (fifth tab),
  `styles/hud.css` (tab row at phone width),
  `tests/e2e/drive-practice-panel.mjs` (`TAB_LABELS`, `TAB_IDS`, new checks)
