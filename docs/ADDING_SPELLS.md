# Adding spells

Use the typed spell runtime for new abilities. Existing spells may still use the legacy `cast()`/`onSpellCast()` bridge, but new code should describe its lifecycle in `castSpec` and implement only the relevant hooks.

## 1. Research and register

Import PC League data and images into the repository before implementing mechanics:

```sh
npm run ability:import -- --champion Janna
npm run ability:update -- --champion Janna --slots Q,R
npm run ability:check
npm run assets:generate
```

Read the checked-in record under `docs/abilities/<champion>/`. Keep English Wiki fields authoritative and record deliberate LOL2D changes in `adaptation`. Normal tests and builds must never fetch the Wiki.

Image provenance currently records the source URL, source revision, fetch time, and content hash. The Wiki image API response used by the importer does not provide rights or license fields, so do not infer or add a license; record one only when the upstream API supplies it directly.

Export the spell from `src/game/gameObject/spells/index.ts` and add it to its champion group in `src/game/preset.ts`.

## 2. Choose activation and targeting

Override `castSpec` with one activation gesture and one targeting mode:

- `PRESS`: one press, such as Lux R or Malphite Q.
- `HOLD_RELEASE`: press, charge, then physical release, such as Varus Q.
- `RECAST`: press again while `ACTIVE`, such as Janna Q.
- `TOGGLE`: press again to end an `ACTIVE` effect, such as Anivia R.
- `TAP_OR_HOLD`: release behavior depends on the charge duration, such as Pantheon Q.

Targeting is `SELF`, `DIRECTION`, `POINT`, or `UNIT`. Use `TargetResolver` for unit validation and range/team checks. A cast context snapshots origin, cursor, direction, and optional target; do not read `game.worldMouse` later unless the mechanic explicitly samples live aim while charging.

```ts
protected get castSpec(): CastSpec {
  return {
    activation: 'PRESS',
    targeting: 'DIRECTION',
    castTimeMs: 500,
    resource: { commitAt: 'start', refundOn: [] },
    cooldown: { startAt: 'release', durationMs: this.coolDown },
  };
}
```

### Targeting mode also decides how a thumb aims your spell

The touch controls (`src/game/input/`) read `castSpec.targeting` and nothing
else to decide what a press-and-drag on your spell's button means:

| Targeting | What a drag does | What a tap does |
|---|---|---|
| `DIRECTION` | picks the direction only, fired at the spell's range | fires at the auto-picked target, else the champion's facing |
| `POINT` | picks direction *and* distance within range | drops on the auto-picked target, else short of the range in front |
| `UNIT` | picks the body the drag points at, snapping the cursor onto it | takes the auto-picked target, or refuses the cast |
| `SELF` | nothing — the cursor is the champion | casts |

You get all of that for free. The one thing worth declaring is **how far your
spell reaches**, because the aim layer draws a telegraph at that length and
auto-targets inside it. It looks for `targetingRequest.range`, then a `range`
field, then `castRange`, and falls back to `DEFAULT_TOUCH_AIM_RANGE` (600) —
which is a guess, and will be wrong for your spell. A spell that keeps its
reach as a bare number inside `onSpellCast` gets the guess; one that declares
it gets a telegraph the player can trust.

### A legacy spell (no `castSpec` override) still has to declare this

A spell that only implements `onSpellCast()` and never overrides `castSpec`
gets `castSpec` from `Spell`'s own default, which now **requires** a
`targetingMode` field — it throws instead of guessing:

```ts
export default class MySpell extends Spell {
  coolDown = 5000;
  targetingMode = 'POINT' as const; // 'as const', not `: TargetingMode`, so
                                     // TS narrows the literal without an import
  onSpellCast() { /* ... */ }
}
```

There used to be no such field, and the default was a silent `'DIRECTION'` for
every legacy spell — the one mode that discards a drag's distance, so on touch
every one of them flew to its absolute maximum range regardless of where the
thumb let go. `tests/game/spells/TargetingModeDeclared.test.ts` fails the
build for a spell file that sets neither this nor its own `castSpec`.

**Auto-locking spells.** Several legacy spells (Ignite, Nasus Q, Warwick Q,
Zed R, Yasuo E/R, Shaco E, Lee Sin R/W, Cho'Gath R, Alistar W, Morgana E,
Nocturne R) pick their own target from inside `onSpellCast`/
`checkCastCondition` — nearest enemy or ally within a fixed radius of the
caster, occasionally broken among several candidates by whichever is closest
to the cursor — and never read `context.target`. That reads like `UNIT`, but
declaring it `UNIT` hands the *cast itself* to `TargetResolver`, which (unlike
these spells' own lookup) requires the cursor to be sitting almost on top of a
body before it will resolve at all — see `TargetResolver.resolve`'s `UNIT`
branch. None of these spells supply the `targetingRequest` + `press()`
override that the real `UNIT` spells do (`Malphite_Q`, `Janna_E`/`W`,
`Anivia_E`, `Leblanc_Q`, `Veigar_R` all override both — see any of them for
the pattern); without that, `UNIT` would silently swallow the key press
whenever the mouse is not precisely on a target, which none of them do today.
They are declared `targetingMode = 'SELF'` instead: it is the only mode that
changes nothing about when the cast is allowed to start, on touch or on
desktop. Turning one of these into a true `UNIT` spell — so a drag can
deliberately choose among several candidates and the touch layer can
highlight who is about to get hit — is a real improvement, but it is a
target-acquisition feature, not a targeting-mode correction; give it the
`targetingRequest`/`press()` treatment and its own test when you do.

**Whichever mode you pick, a spell that chooses a unit must pass
`PredefinedFilters.visibleTo(this.owner)` to the query it chooses from.** A true
`UNIT` spell gets this free — `TargetResolver` applies it to every candidate —
but a `SELF` spell doing its own lookup does not, and every one of them shipped
without it: Warwick R found the blue camp through a jungle wall, on a screen
showing nothing but fog, and leaped through the wall to bite it. The filter asks
`combat/Vision.ts`, which answers walls, bushes and friendly wards the same way
`FogOfWar` paints them, and is a no-op for allies. `tests/game/spells/
target-vision-seam.test.ts` scans for the missing line.

**Do not reach for `AttackableUnit.visibleToPlayerTeam` instead.** It is the
fog's own flag, written from *the player's* eyes for the draw cull, the minimap
and the debug overlay, and it answers a rendering question rather than a
targeting one. Thirteen abilities had used it as a vision check (under its old
name, `willDraw`, which is what made it look like one), and every bot's spell
was quietly limited to what the human could see: it could not target an enemy
beside it in an unlit bush, and could target one across the map the player had
lit. The same source scan now rejects the name anywhere under `spells/`.

The gate is on **acquisition, never on damage**. An area effect still hits
everyone it overlaps — Amumu W ticking on the champion hiding in the bush is
correct, and adding the filter there would be the bug. The question to ask of a
query is whether picking a unit out of it means the caster *chose* that unit.

### Driving your spell from a script

`Spell.cast()` is **not** the path a key press takes, and reaching for it is how
a working ability gets reported as broken. It builds a bare `CastContext` from
`game.worldMouse` with no `target` field, so a `UNIT` spell — whose entire job
is resolving one — is handed nothing to act on and declines silently.

The real path is `SpellInputController.keyDown`, which is two calls:

```ts
const context = game.createSpellContext(spell, caster, cursorWorld);
if (context) spell.press(context);
```

That is where `TargetResolver` runs, which is where team, range and *vision*
filtering happen. `tests/e2e/smoke-new-champions.mjs` drives all forty abilities
of the newest roster through it; seven of them failed against `cast()` first,
and not one of them was actually broken.

## 3. Define lifecycle policies

The runtime owns `READY`, `CASTING`, `CHARGING`, `CHANNELING`, `ACTIVE`, and `COOLDOWN`. Do not assign `state` or `currentCooldown` in migrated spells.

- Commit resources at `start`, `release`, or `tick`; list only cancellation reasons that refund them.
- Start cooldown at `start`, `release`, or `end`.
- Add `charge`, `channel`, or `active` only when the activation needs it.
- Set `interrupts` to one named form from `CancelPolicy` — see the next section.

Use `onCastStart`, `onChargeUpdate`, `onRelease`, `onChannelTick`, `onActivate`, `onRecast`, `onCancel`, and `onComplete`. Cleanup must be idempotent because death, scene exit, removal, and normal completion can converge on the same effect.

## 3a. What cancels your spell

`src/game/spell/runtime/CancelPolicy.ts` is the whole model. The question it answers is not "which interrupts apply" but **where the live effect lives**: a champion drawing a bow is holding the spell in his hands, and a tornado already standing in the world is not. Pick the form that describes yours and the flags follow.

| `interrupts:` | caster dies | stunned, suppressed | silenced | shoved | moves | it is |
|---|---|---|---|---|---|---|
| `SpellForm.HELD` *(default)* | ends | ends | ends | ends | ends | the champion performing it right now |
| `SpellForm.AIMED` | ends | ends | ends | ends | **survives** | held, but walking is part of the gesture |
| `SpellForm.TETHERED` | ends | ends | ends | **survives** | **survives** | out in the world, still leashed to him |
| `SpellForm.INDEPENDENT` | ends | **survives** | **survives** | **survives** | **survives** | out of his hands, on its own clock |

Who uses which, today:

- **`HELD`** — everything with a cast time or a channel: Janna R, Anivia E, Malphite E, Morgana R, Veigar R, and every legacy instant press. Omitting `interrupts` means this.
- **`AIMED`** — Varus Q and Pantheon Q. The champion is physically drawing the shot and strafing while he aims; crowd control still takes it.
- **`TETHERED`** — Anivia R. The storm stands in the world but is leashed to Anivia and billed to her mana, so she may walk and be knocked about without ending it, and losing control of herself still does.
- **`INDEPENDENT`** — Janna Q's tornado (summoned, growing on its own clock, fires itself at full charge), Lux R's beam (already called down), Rammus Q's roll (already has its momentum).

Death is on in every form on purpose: nothing in this game should outlive its caster. `SpellObject.attachTo` is the same rule for an effect glued to a body.

Four more knobs, all part of the same model:

- **`suspendedBy: [Stasis]`** — a buff that *pauses* the watcher rather than ending what it guards. Zhonya's reads as a stun and a silence at once, but whatever the champion was sustaining is still his when it ends. Anivia R is the only user; add a buff here rather than reaching for a wholesale opt-out.
- **`resource.refundOn`** — which cancellations give the mana back. Naming an interrupt your form never fires throws at construction, so a refund cannot quietly be a promise the spell does not keep.
- **`attackOrder: 'keep'`** — casting drops the caster's standing basic attack order unless the spell says otherwise. `BasicAttack` is the only `keep`, because casting it *is* the order.
- **`Dash.buffsToCheckCancel`** — the movement half. A dash is not a spell state so it carries no form, but `foreignControlBuff` answers the same question in the same vocabulary. It is a list of buff *classes* rather than status flags because the rule has to know who applied it: a spell that roots its victim and then pulls them must not have its own pull cancelled by its own root. `DASH_INTERRUPT_BUFFS` is the default list.

Two things this model deliberately does not cover, and you should not expect it to:

- **A standing attack order owns the caster's movement.** `BasicAttackController` writes `owner.destination` every frame it has a target — walking into range, then `stopMovement()` once there. A spell whose effect *is* movement (Rammus Q) is not cancelled by that, but it is held still by it, which looks the same. `tests/e2e/drive-rammus-cancel.mjs` measures it.
- **A buff's own end conditions.** A buff ends on its duration or when something calls `deactivateBuff()`. If a spell's live phase is really the buff's lifetime, give the spell an `active` window of the same length and close it from the effect (`Rammus_Q.endRoll`), so the runtime state and the thing the player can see agree.

## 4. Choose delivery

- Extend `MissileSpellObject` for linear travel and per-target hit bookkeeping.
- Extend `HomingMissileSpellObject` for one moving unit target and choose `remove` or `continue` on target loss.
- Use `BeamSpellObject` for instant or duration capsule geometry shared by collision and rendering.
- Use `AreaSpellObject` for enter/tick/exit membership, duration, or radius growth.
- Use `applyTargetedEffect` for an immediate payload that only needs a final validity check.

The primitive owns geometry, movement, lifetime, and hit bookkeeping. The spell owns damage, buffs, crowd control, and special rules.

## 5. Bind presentation to lifecycle

Add optional `vfx` and `sfx` factories to `castSpec` for `castStart`, `castLoop`, `release`, `activeLoop`, `channelLoop`, `impact`, and `cancel`. Use `CastBar`, `CastTelegraph`, `BeamRenderer`, `SpriteEffect`, `ParticleEmitter`, or `ImpactEffect`. Gameplay geometry remains authoritative; VFX observes it.

Looping effects are disposed by lifecycle transitions. Any spell-owned object or listener still needs idempotent cleanup in `onCancel`, `onComplete`, `deactivate`, and `onRemoved` as applicable.

`CastBar`, `CastTelegraph`, `BeamRenderer`, `SpriteEffect`, `ParticleEmitter` and `ImpactEffect` all live in `src/game/vfx/` and are reachable **only through `castSpec.vfx`** — they take a `Vec2` and are driven by `SpellVfx`, not by the object manager. A legacy `onSpellCast` spell cannot use them; its tool is `PredefinedParticleSystems` from `src/game/gameObject/helpers/ParticleSystem.ts`, added to the world with `objectManager.addObject`. Reach for the right one for the path you are on rather than assuming the guideline's name exists in your file's world.

### An effect that paints past its own centre owes the quadtree a box

`ObjectManager.draw` decides what to draw by querying the display quadtree with
the camera rectangle. `GameObject.getDisplayBoundingBox` derives that box from
`visionRadius`, which is **0** for a plain `SpellObject` — a zero-area box
sitting on the object's own centre. So an effect that paints a 400px cone but
inherits the default is drawn only while its *centre point* is on screen, and
vanishes at the screen edge while its damage lands normally.

```ts
getDisplayBoundingBox() {
  const r = this.radius + 40; // everything the draw actually touches
  return this.squareDisplayBoundingBox(r * 2);
}
```

`squareDisplayBoundingBox` takes the full edge length and **memoises on
`(position, size)`**, so the box is rebuilt only when one of those actually
moves. Prefer it: the box is asked for at least three times a frame per object
(quadtree rebuild, draw cull, every targeting candidate), and hand-rolling a
`new Rectangle` here is an allocation on all of them. `Minion`, `MinionSwing`
and `Turret` each shipped with that hand-rolled version and silently opted the
most numerous units on the board out of the cache.

**Build a `Rectangle` by hand when the box is not a square around your own
centre** — a ribbon that follows a path, a tether that reaches back to the
caster, anything spanning a list of victims. The helper's cache key is only
position and size, so a box that depends on anything else would go stale
without ever missing the cache. `Yasuo_E` and `Yasuo_R` are the live examples.

`MissileSpellObject` already supplies one sized to `size`; override it if you
paint wider than the missile, or if you draw back to the caster (a tether, a
cable) rather than only around yourself. Six of the twelve effects added with
Camille/Ekko/Jarvan shipped without it. `tests/game/spells/aoe-display-bounds.test.ts`
pins the ones that exist.

### Hook a dash frame with `onDashUpdate`, never by assigning `onUpdate`

`Buff.update()` calls `this.onUpdate()`, and `Dash` implements the movement
itself in `Dash.prototype.onUpdate` — the step toward `dashDestination`, the
arrival test that fires `onReachedDestination`, the interrupt check. Writing
`dashBuff.onUpdate = () => {…}` installs an own property that shadows the
prototype, so it does not *hook* the frame, it *replaces* it: the champion plays
the spell's own per-frame logic standing perfectly still.

```ts
// WRONG — deletes the dash
dashBuff.onUpdate = () => { /* damage everything I pass through */ };

// RIGHT — runs after each movement step
dashBuff.onDashUpdate = () => { /* damage everything I pass through */ };
```

It reads exactly like a callback, which is why Camille E, Ekko E and Jarvan Q
all shipped with it and none was caught: each still dealt its damage — to
whatever happened to be standing next to the caster — and still ended on time.
`tests/game/spells/dash-onupdate-seam.test.ts` scans every spell file for the
assignment.

## 6. Use typed assets

After adding an image, run `npm run assets:generate` and use its generated key:

```ts
const icon = AssetManager.get('spell_janna_q');
await AssetManager.ensure('spell_janna_q');
```

Use `AssetManager.ensureMany` for a visible batch. If art is intentionally absent, use `AssetManager.placeholder('Pantheon background')`. Never invent a key or use the deprecated `getAsset(string)` bridge in new code.

## 7. Test the public commands

Add a focused Vitest file under `tests/game/spells/`. Drive `press`, `hold`, `release`, and `cancel` with deterministic cast contexts and clocks. Assert:

- activation and runtime states;
- exact resource commitment/refund timing;
- exact cooldown start timing;
- targeting rejection before payment;
- payload and object behavior;
- exactly-once completion and cleanup.

Run the focused test while developing, then the complete offline gate:

```sh
npm test -- tests/game/spells/MySpell.test.ts
npm run verify
```

`verify` checks generated assets, imported abilities, both TypeScript boundaries, every Vitest test, and the production build.

## 8. Measure a caster-centred range through `Reach`

A range written from the caster's centre has to clear the caster's own body.
`UnitCollisionSystem` holds two units at least `bodyRadius(a) + bodyRadius(b)`
apart, and Cho'Gath R takes a champion to `MAX_UNIT_SIZE` — radius 82.5 — so an
enemy's centre can never come nearer than 110. A range shorter than that stops
working outright, not partially.

`src/game/combat/Reach.ts` is the only place that answers it. It gives back the
**excess** over a default champion body at each end and nothing more, so it is
exactly a no-op while both bodies are default-sized:

```ts
// a query keeps its implicit collideWith filter, which already tests the
// target's own body circle — so it takes the caster term alone
area: new Circle({ x: owner.position.x, y: owner.position.y,
                   r: effectiveRange(this.range, this.owner) })

// a hand-rolled distance test has no target term at all, so it takes both
withinRange(this.range, this.owner, target)
```

Handing both ends to a query that already collides would count the target
twice. `drawPreview` takes the same corrected number, or the circle tells the
player a different story from the cast. `TargetResolver` applies the rule for
you on `UNIT` targeting; `POINT` stays on the authored number, because the far
end of a point cast is ground and ground has no body.

What is **not** a reach: how far a missile flies, how far away a point may be
nominated, how big a blast is where it lands, how far a dash carries. And basic
attacks are their own thing — `attackRange` is authored surface to surface, so
`BasicAttackController.reachTo` adds whole radii on purpose.

## 9. Hook an on-hit passive onto basic attacks

An ability that triggers off basic attacks (Teemo's Toxic Shot, lifesteal, an attack-speed stack) subscribes to the event, it does not reimplement the swing. Both events come from `src/game/combat/`:

- `EventType.ON_ATTACK` fires when a swing starts. Payload is the attacking unit, nothing else. Use it to react to the commitment — Janna's ultimate breaks its channel on it.
- `EventType.ON_ATTACK_HIT` fires once per landed attack, after the damage applied. Payload is `BasicAttackHit` — `{ attacker, victim, damage, ranged }`.

```ts
this.stopWatching = this.game.eventManager.on(
  EventType.ON_ATTACK_HIT,
  ({ attacker, victim, damage }: BasicAttackHit) => {
    if (attacker !== this.owner) return;
    victim.takeDamage(damage * 0.5, this.owner);
  }
);
```

Filter on `attacker === this.owner`: the event is global. Unsubscribe in `onCancel`, `onComplete`, `deactivate` and `onRemoved`, like every other listener a spell owns.

An attack only reaches `ON_ATTACK_HIT` if it actually landed, so nothing fires when the victim died, went untargetable, or left reach in the meantime — a passive never has to re-check any of that.

`Stats` carries `attackDamage`, `attackSpeed` (attacks per second, capped at `MAX_ATTACK_SPEED`) and `attackRange`. Buff a swing by adding a `StatsModifier` to those, not by editing the controller. `StatusFlags.Disarmed` is the way to stop one.

## 10. The basic attack is itself a spell

`src/game/gameObject/spells/BasicAttack.ts` is the default occupant of slot 0, which `SpellHotKeys[0]` binds to `A`. Pressing it acquires the enemy nearest the **cursor** (`findAttackTargetNearPoint`, `CURSOR_ACQUISITION_RADIUS`, fog respected via `PredefinedFilters.visibleTo` over `combat/Vision.ts`) and hands it to `BasicAttackController.order()`. It asks the *attacker's* vision, never the fog's draw flag — see the note on `AttackableUnit.visibleToPlayerTeam` for why those are different questions. Right click is a move order and nothing else — it no longer doubles as an attack order, so a click meant to walk past a fight cannot commit to it. The slot is swappable like every other — the spell is in the picker under its own group so it can be put back.

Three consequences for a new spell:

- **Casting cancels a standing attack order.** `Spell.press` clears it on the accepted branch. A spell that must not — because casting it *is* the order — overrides `cancelsAttackOrder`.
- **An attack order is dropped by crowd control**, not paused: `BasicAttackController` ends it whenever `canAttack` goes false, with `lastEnd` set to `'DISABLED'`.
- **`cooldownLocksOut` splits a wait from a rhythm** in the HUD. Leave it alone unless the countdown runs on its own the way the swing timer does.

A champion-specific attack is a subclass of `BasicAttack` in that champion's preset. It must still only issue an order: `landBasicAttack` is the one place a basic attack becomes damage and the only thing that emits `ON_ATTACK_HIT`, so a spell that applies its own damage silently switches every on-hit passive off for that route.
