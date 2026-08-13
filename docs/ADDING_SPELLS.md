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

## 3. Define lifecycle policies

The runtime owns `READY`, `CASTING`, `CHARGING`, `CHANNELING`, `ACTIVE`, and `COOLDOWN`. Do not assign `state` or `currentCooldown` in migrated spells.

- Commit resources at `start`, `release`, or `tick`; list only cancellation reasons that refund them.
- Start cooldown at `start`, `release`, or `end`.
- Add `charge`, `channel`, or `active` only when the activation needs it.
- Override only relevant `interrupts` (`death`, `stun`, `silence`, `displacement`, `move`).

Use `onCastStart`, `onChargeUpdate`, `onRelease`, `onChannelTick`, `onActivate`, `onRecast`, `onCancel`, and `onComplete`. Cleanup must be idempotent because death, scene exit, removal, and normal completion can converge on the same effect.

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

## 8. Hook an on-hit passive onto basic attacks

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
