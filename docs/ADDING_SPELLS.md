# Adding spells to LOL2D

Every rule here exists because breaking it produced a real bug in this repo.
Read it before writing a spell; skim the **Checklist** at the end before you
claim one is done.

---

## 0. Research the ability before writing code

Look up the real League of Legends ability on `wiki.leagueoflegends.com`. Do not
write mechanics from memory — the first pass at Singed W "poisoned" enemies
(Mega Adhesive deals **no damage**; the poison is his Q), Cassiopeia W silenced
(Miasma **grounds**, never silences), and Thresh Q dragged the victim all the way
home (it stuns and **tugs twice**, then Thresh **recasts to leap to them**).

`fandom.com` returns HTTP 402 to WebFetch. Use WebSearch, or WebFetch
`https://wiki.leagueoflegends.com/en-us/<Champion>`.

**This game has no basic attacks.** Any ability that empowers the next attack
(Nasus Q, Ashe Q, Blitzcrank E, Cho'Gath E, Malphite W, Twitch Q) must be adapted
into something instant. State the adaptation in the Vietnamese `description` so
players are not misled.

---

## 1. Registering a spell — three places, all required

A spell that compiles but is registered in only two places silently never
appears. There is no error.

1. `src/game/gameObject/spells/index.ts` — `export { default as Champ_Q } from './Champ_Q';`
2. `src/game/preset.ts` — add it to the champion's entry in `SpellGroups`
   (new champion? add a group; leave `background: ''` when there is no art —
   the HUD skips a falsy background, but a wrong path renders a broken image)
3. `src/managers/AssetManager.ts` — `spell_champ_q: 'assets/images/spells/champ_q.png'`,
   **only if the PNG actually exists**

Missing art is fine: `AssetManager.getAsset()` generates a labelled placeholder
tile (initials + a colour hashed from the key) that works both as an HTML `<img>`
and on the p5 canvas. Use the natural key and move on.

`getAsset()` returns `undefined` for a falsy key on purpose — callers like
`getAsset(preset?.avatar)` depend on it. Do not "fix" that.

---

## 2. The `Spell` base class

Override `onSpellCast()`; optionally `onUpdate()`, `checkCastCondition()`,
`drawPreview()`. Set `image`, `name`, `description`, `coolDown`, `manaCost`.
The base owns the cooldown state machine — never assign `state` yourself.

> **Class field initializers must never touch `this.owner` or `this.game`.**
> The HUD builds every spell as `new SpellClass(null)` just to read its metadata.
> A field initializer that dereferences the owner crashes the whole spell picker.
> Only method bodies may use them.

`checkCastCondition()` returning `false` refuses the cast **before** the cooldown
is charged, which is what you want for "no target in range".

---

## 3. Projectiles: extend `MissileSpellObject`

`src/game/gameObject/MissileSpellObject.ts` owns travel, hitting each enemy at
most once, the trail, and the bounding box. A normal skillshot is then just
tuning fields plus `onHit` and `draw`.

| Field | Meaning |
|---|---|
| `maxHitCount` | `Infinity` pierces everything, `1` dies on first enemy, `0` never collides in flight |
| `removeOnArrive` | `false` keeps it flying past the destination (boomerangs) |
| `removeOnMaxHit` | `false` survives its last hit (chains and hooks that latch on) |

Hooks: `onHit(enemy)`, `onBeforeMove()`, `onAfterMove()` (after the step, before
collision — for visuals that track distance), `onArrive()`, `getTrailPosition()`.

> **Declare `trailSystem` in your subclass, never in the base.** Subclass field
> initializers run *after* the base's, so a trail built in the base reads the
> base's `size`, not yours.

**Do not force this base on something with a different motion model.** `Lux_E`
(static zone), `Ashe_R` (direction-based, unbounded), `Teemo_R` (lob then mine),
`Ahri_W` (orbits then homes) and `Yasuo_Q` Q1/Q2 (cone anchored on the caster)
deliberately do not use it.

---

## 4. Buffs

Construct as `new X(durationMs, sourceUnit, targetUnit)`, then `unit.addBuff(x)`.
Always set `buff.image = AssetManager.getAsset('spell_<your_key>')` so the player
can see which spell caused it.

**Crowd control**: `Stun` (no move, no cast), `Root` (no move, can cast),
`Silence` (no cast), `Slow`/`Speedup` (`.percent`), `Airborne` (`.height`),
`Charm`/`Fear` (`.speed`), `Nearsight` (`.newVisionRadius`), `Invisible`,
`TrueSight` (`.visionRadius`).

**Movement / targeting**: `Dash` (`.dashDestination` — assigning a unit's live
`position` object makes it home; `.dashSpeed`, `.cancelable`, callbacks
`.onReachedDestination`/`.onCancelled`), `Untargetable`, `Stasis`, `Ground`.

**Generic effects**: `Shield` (`.amount`), `DamageOverTime` (`.damagePerTick`,
`.tickInterval`, `.flameColor`, `.emberColor`), `StatAmp` (`.bonuses`).

### 4a. `stackId` — mandatory for generic buffs

`addBuff` groups stacks by **constructor**. Two different spells both applying a
bare `StatAmp` fight over the same slot: each Malphite W cast used to strip a
Veigar Q stack. Seven spells sharing `DamageOverTime` with `RENEW_EXISTING`
renewed each other instead of burning independently.

Whenever a spell applies `StatAmp`, `DamageOverTime` or `Shield`, tag it:

```ts
burn.stackId = 'ignite_burn';
```

(Subclassing the buff works too, and is better when the buff also needs its own
stacking rules — see `ChoGath_R_Growth`.)

### 4b. `StatusFlags.CanMove` and `CanCast` are dead flags

`Stats.updateActionState()` derives `CAN_MOVE`/`CAN_CAST` **entirely from the CC
flags** (`Stunned`, `Rooted`, `Charmed`, `Feared`, `Silenced`, `Suppressed`,
`Immovable`) and never reads `StatusFlags.CanMove` or `CanCast`. Setting
`statusFlagsToDisable = StatusFlags.CanMove` looks right and does nothing — the
first `Stasis` did exactly that and the unit walked away.

To immobilise, enable a real CC flag. `StatusFlags.Invulnerable` is also never
read; use `modifyIncomingDamage` instead.

`StatusFlags.Targetable` **is** wired, so `statusFlagsToDisable = Targetable`
genuinely makes a unit untargetable.

### 4c. Status semantics

| Buff | Targetable | Walks | Own dash | Damage |
|---|---|---|---|---|
| `Untargetable` | no | yes | yes | AoE queries skip it |
| `Ground` | yes | yes | **no** | yes |
| `Stasis` | no | no | no | **zero** |

Grounding blocks a unit's *own* movement abilities (enforced in
`Dash.CanDash`); it does **not** make it immune to being hooked or knocked back —
those construct a `Dash` directly. When gating a self-dash, prefer
`Dash.CanDash(this.owner)`; but note LoL lets some pulls (Amumu Q) start while
immobilised, so check the wiki rather than copying blindly.

---

## 5. Damage pipeline

`AttackableUnit.takeDamage()` runs the damage through every buff's
`modifyIncomingDamage(damage, attacker)` before it reaches health. Return less to
absorb, more to amplify, or the same value to merely observe (that is how
`Zed_R_Mark` banks a share of Zed's damage without changing it).

If you deal damage from inside `onDeactivate`, guard against re-entrancy —
`takeDamage` will run the pipeline again, including your own buff.

Anything that absorbs damage should also report `get shieldAmount()`, which is
what draws the grey segment on the health bar.

---

## 6. Rendering rules

- **`ObjectManager` already calls `update()` on every registered object.**
  `TrailSystem` and `ParticleSystem` are `SpellObject`s, so once you
  `addObject()` them, calling `particleSystem.update()` yourself makes particles
  age twice as fast. Three spells shipped with this bug.
- `ParticleSystem` defaults to `autoRemoveIfEmpty: true`, so a system that is
  momentarily empty deletes itself and silently stops rendering. Pass
  `autoRemoveIfEmpty: false` for a system you feed intermittently.
- `Buff.draw()` is called once per frame from `AttackableUnit.drawBuffs()`.
  **Spawn particles in `onUpdate()` and only render in `draw()`** — otherwise
  their rate depends on how many times the unit happens to be drawn.
- A spell object with `toRemove = true` is removed before the draw pass, so
  cosmetic work on its final frame is wasted.

---

## 7. Multi-stage and recast spells

`src/game/gameObject/spells/LeeSin_Q.ts` is the canonical pattern: a `phase`
field on the `Spell`, `onSpellCast()` branching on it, `checkCastCondition()`
gating the recast, `onUpdate()` restoring the phase and full cooldown when the
window lapses, and `this.image` swapped per phase so the HUD icon changes.
Set `currentCooldown` to the short recast delay after the first stage.

`Yasuo_Q.ts` shows a three-stage version. Thresh Q, Zed R, Fizz E, Anivia Q and
Janna Q all use this shape.

---

## 8. Zones and other non-projectiles

Extend `SpellObject`, implement `update()`, `draw()` and
`getDisplayBoundingBox()` returning a `Rectangle`. Age with `deltaTime` and set
`this.toRemove = true` when expired. `Lux_E.ts` is the reference.

Re-applying a debuff every frame is fine if it is `RENEW_EXISTING`; prefer a
short duration refreshed on a tick (~200ms) over one long application, so it
falls off shortly after the target leaves.

For real collision (`Anivia_W`), run SAT resolution inside the object's own
`update()`. Do **not** register into the terrain quadtree: it has no `remove()`,
and `FogOfWar` would make the obstacle block vision too.

---

## 9. Verifying — the repo has no test framework

`tsc --noEmit` catches almost nothing here: the project is `strict: false` and
full of `any`. It did not catch `getAsset(undefined)` crashing the game, nor a
spell whose description promised damage it never dealt (`Zed_E`).

Drive the real game instead. With `npx vite` running:

```js
// Playwright + system Chrome
await page.click('#play-btn');
await page.waitForFunction(() => window.objectManager?.game?.player);
await page.evaluate(async () => {
  const mod = await import('/src/game/gameObject/spells/index.ts');
  const Dummy = (await import('/src/game/gameObject/attackableUnits/DummyChampion.ts')).default;
  // park the AI, spawn a frozen dummy, install the spell on game.player, cast
});
```

Assert the *effect*, not the absence of a crash: damage dealt, buff class names
applied, stats before/during/after. Then confirm nothing leaked — no buffs left
on either unit, `targetable`/`canMove`/`canCast` back to true, no orphaned spell
objects.

> **Vite HMR pitfall**: `import('/src/...')` inside `page.evaluate` can return a
> *second copy* of a module, so `instanceof` against a re-imported class silently
> fails and `AssetManager._asset` looks empty. Read live game objects, or resolve
> the app's actual module URL from `performance.getEntriesByType('resource')`.

---

## Checklist

- [ ] Mechanic checked against the wiki; adaptation noted in `description` if the ability normally modifies basic attacks
- [ ] Registered in `index.ts`, `preset.ts`, and `AssetManager.ts` (art only if the file exists)
- [ ] No field initializer touches `this.owner` / `this.game`
- [ ] `trailSystem` declared in the subclass, not the base
- [ ] `stackId` set on every generic `StatAmp` / `DamageOverTime` / `Shield`
- [ ] `buff.image` set on every buff applied
- [ ] No manual `particleSystem.update()` on a registered system
- [ ] Particles spawned in `onUpdate()`, drawn in `draw()`
- [ ] `tsc --noEmit` clean
- [ ] Cast in the real game: effect confirmed, nothing thrown, no buff or object leak
