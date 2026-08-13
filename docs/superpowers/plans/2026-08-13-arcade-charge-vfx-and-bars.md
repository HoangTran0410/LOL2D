# Arcade Charge VFX and Bars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make charge/channel spells readable in motion, restore visible projectiles and Lux R's layered beam, normalize arcade cooldowns/Janna Q scale, and display shields as extra effective health.

**Architecture:** Keep `CastContext` immutable for gameplay and inject live presentation providers into reusable VFX handles. Keep projectile/beam visual dimensions separate from collision geometry, and make each balance/layout change observable through a focused regression test.

**Tech Stack:** TypeScript, p5.js global renderer, Vitest, existing spell runtime and `AssetManager`.

## Global Constraints

- Do not push or access the network.
- No current numeric spell cooldown may exceed `10_000ms`.
- Varus Q, Pantheon Q, and Janna R presentation follows the caster without mutating the frozen cast context.
- Janna R gameplay zone and Lux R beam geometry remain frozen at cast start.
- Projectile visual size and Lux R glow never change collision geometry.
- Janna Q uses `48–72` width and `550–900` center travel while preserving damage, airborne duration, and three-second charge.
- Shield uses a silver-grey segment after health on the same `maxHealth` scale; mana keeps the base health width.
- Reuse existing assets and dependencies; add no package.

---

### Task 1: Live charge and channel presentation

**Files:**
- Modify: `src/game/vfx/CastBar.ts`
- Modify: `src/game/vfx/CastTelegraph.ts`
- Create: `src/game/vfx/VfxGroup.ts`
- Create: `src/game/vfx/ChargeRangeTelegraph.ts`
- Modify: `src/game/gameObject/spells/Varus_Q.ts`
- Modify: `src/game/gameObject/spells/Pantheon_Q.ts`
- Modify: `src/game/gameObject/spells/Janna_R.ts`
- Test: `tests/game/vfx/SpellVfx.test.ts`
- Test: `tests/game/spells/Varus_Q.test.ts`
- Test: `tests/game/spells/Pantheon_Q.test.ts`
- Test: `tests/game/spells/Janna_R.test.ts`

**Interfaces:**
- `CastBar(context, getProgress, render?, getAnchor?)`, where `getAnchor` returns live `{x,y}`.
- `CastTelegraph(context, radius, render?, getCenter?)`, where `getCenter` returns live `{x,y}`.
- `VfxGroup(...effects: VfxHandle[])` forwards `update`, `draw`, and `dispose`.
- `ChargeRangeTelegraph(getOrigin, getDirection, getRange, getProgress)` draws a growing directional lane.

- [ ] **Step 1: Write failing live-anchor and monotonic-range tests**

```ts
const context = frozenContext({ origin: { x: 10, y: 20 } });
const anchor = { x: 10, y: 20 };
const render = vi.fn();
const bar = new CastBar(context, () => 0.5, render, () => anchor);
anchor.x = 90;
bar.draw();
expect(render).toHaveBeenCalledWith(context, 0.5, { x: 90, y: 20 });

expect(spell.chargeRangeAt(0)).toBe(minRange);
expect(spell.chargeRangeAt(750)).toBeGreaterThan(minRange);
expect(spell.chargeRangeAt(1_500)).toBe(maxRange);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/game/vfx/SpellVfx.test.ts tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts tests/game/spells/Janna_R.test.ts`

Expected: FAIL because live providers, grouped handles, and range telegraphs do not exist.

- [ ] **Step 3: Implement minimal provider-based VFX**

```ts
export type PositionProvider = () => Readonly<{ x: number; y: number }>;

draw(): void {
  if (!this.disposed) {
    this.render(this.context, clamp01(this.getProgress()), this.getAnchor?.() ?? this.context.origin);
  }
}

export default class VfxGroup implements VfxHandle {
  constructor(private readonly effects: VfxHandle[]) {}
  get complete() { return this.effects.every(effect => effect.complete); }
  update(deltaMs: number) { this.effects.forEach(effect => effect.update(deltaMs)); }
  draw() { this.effects.forEach(effect => effect.draw()); }
  dispose() { this.effects.forEach(effect => effect.dispose()); }
}
```

Wire Varus/Pantheon cast loops to a live bar plus growing directional lane. Use the live cursor direction for both preview and release. Wire Janna R to a live caster-centered circle and bar while leaving its `AreaSpellObject` center unchanged. Keep the existing champion/world draw order; the live bar's offset keeps it above the sprite.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/game/vfx/SpellVfx.test.ts tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts tests/game/spells/Janna_R.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/vfx src/game/gameObject/spells/Varus_Q.ts src/game/gameObject/spells/Pantheon_Q.ts src/game/gameObject/spells/Janna_R.ts tests/game/vfx/SpellVfx.test.ts tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts tests/game/spells/Janna_R.test.ts
git commit -m "fix: anchor charged spell visuals to casters"
```

### Task 2: Visible charged projectiles

**Files:**
- Modify: `src/game/gameObject/MissileSpellObject.ts`
- Modify: `src/game/gameObject/spells/Varus_Q.ts`
- Modify: `src/game/gameObject/spells/Pantheon_Q.ts`
- Test: `tests/game/spell/HomingMissileSpellObject.test.ts`
- Test: `tests/game/spells/Varus_Q.test.ts`
- Test: `tests/game/spells/Pantheon_Q.test.ts`

**Interfaces:**
- `MissileSpellObject.image?: AssetHandle` opts into base sprite rendering.
- `visualWidth`, `visualHeight`, and `visualRotationOffset` affect drawing only; `size` remains collision diameter.

- [ ] **Step 1: Write failing sprite and fallback tests**

```ts
missile.image = loadedHandle;
missile.visualWidth = 80;
missile.visualHeight = 28;
missile.draw();
expect(image).toHaveBeenCalledWith(renderable, 0, 0, 80, 28);

missile.image = loadingHandle;
missile.draw();
expect(line).toHaveBeenCalled();
expect(missile.size).toBe(32);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/game/spell/HomingMissileSpellObject.test.ts tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts`

Expected: FAIL because the missile base has no asset-aware renderer.

- [ ] **Step 3: Implement one base renderer and configure both missiles**

```ts
draw(): void {
  const angle = Math.atan2(this.destination.y - this.position.y, this.destination.x - this.position.x);
  push();
  translate(this.position.x, this.position.y);
  rotate(angle + this.visualRotationOffset);
  if (this.image?.status === 'loaded') {
    imageMode(CENTER);
    image(AssetManager.renderable(this.image), 0, 0, this.visualWidth, this.visualHeight);
  } else {
    stroke(235, 225, 170, 230);
    strokeWeight(Math.max(3, this.visualHeight / 5));
    line(-this.visualWidth / 2, 0, this.visualWidth / 2, 0);
  }
  pop();
}
```

Set Varus arrow collision/visual dimensions to `36` and `90×32`; set Pantheon spear to `32` and `84×30`. Do not add spell-specific duplicate `draw()` methods.

- [ ] **Step 4: Run focused tests and verify GREEN**

Run: `npm test -- tests/game/spell/HomingMissileSpellObject.test.ts tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts`

Expected: all selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/gameObject/MissileSpellObject.ts src/game/gameObject/spells/Varus_Q.ts src/game/gameObject/spells/Pantheon_Q.ts tests/game/spell/HomingMissileSpellObject.test.ts tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts
git commit -m "fix: render charged spell projectiles"
```

### Task 3: Arcade cooldown boundary and Janna Q scale

**Files:**
- Modify: `src/game/gameObject/spells/{Varus_Q,Pantheon_Q,Janna_Q,Janna_R,Lux_R,Morgana_E,Ignite,Nocturne_R,Twitch_Q,Anivia_W,ChoGath_R,Zed_R,Ashe_E}.ts`
- Test: `tests/game/spells/cooldowns.test.ts`
- Test: `tests/game/spells/Janna_Q.test.ts`
- Test: affected existing spell tests that assert imported cooldowns

**Interfaces:**
- Numeric cooldown boundary is source-enforced at `10_000ms`.
- Janna Q exposes the existing `minRange`, `maxRange`, `minSize`, and `maxSize` values with new arcade numbers.

- [ ] **Step 1: Write failing cooldown and Janna Q balance tests**

```ts
for (const file of spellFiles) {
  for (const match of readFileSync(file, 'utf8').matchAll(/coolDown\s*=\s*([\d_]+)/g)) {
    expect(Number(match[1].replaceAll('_', '')), file).toBeLessThanOrEqual(10_000);
  }
}

expect(spell).toMatchObject({ coolDown: 5_000, minRange: 550, maxRange: 900 });
expect(tornado).toMatchObject({ minSize: 48, maxSize: 72 });
```

- [ ] **Step 2: Run tests and verify RED**

Run: `npm test -- tests/game/spells/cooldowns.test.ts tests/game/spells/Janna_Q.test.ts tests/game/spells/Janna_R.test.ts tests/game/spells/Lux_R.test.ts tests/game/spells/Varus_Q.test.ts tests/game/spells/Pantheon_Q.test.ts`

Expected: FAIL on current cooldown outliers and Janna Q dimensions.

- [ ] **Step 3: Apply the exact arcade values**

```ts
// Focused spells
Varus Q = 5_000; Pantheon Q = 4_000; Janna Q = 5_000;
Janna R = 10_000; Lux R = 10_000;
// Remaining outliers
Morgana E = 6_000; Ignite = 6_000; Nocturne R = 10_000;
Twitch Q = 6_000; Anivia W = 6_000; ChoGath R = 10_000;
Zed R = 10_000; Ashe E = 6_000;
```

Set Janna Q `minRange=550`, `maxRange=900`, object `minSize=48`, `maxSize=72`; keep its current interpolation for speed, damage, airborne duration, charge, trail, bounds, and gust so they automatically derive from the new values. Pantheon quick thrust remains `coolDown * 0.4 = 1_600ms`.

- [ ] **Step 4: Run affected tests and verify GREEN**

Run: `npm test -- tests/game/spells`

Expected: all spell tests PASS and no numeric cooldown exceeds `10_000`.

- [ ] **Step 5: Commit**

```bash
git add src/game/gameObject/spells tests/game/spells
git commit -m "balance: shorten cooldowns and scale Janna tornado"
```

### Task 4: Shield as extra effective health

**Files:**
- Modify: `src/game/gameObject/attackableUnits/Champion.ts`
- Create: `tests/game/types/ChampionHealthBar.test.ts`

**Interfaces:**
- Base health width remains `108` pixels (`125 - 17`).
- Frame content width is `max(108, healthWidth + shieldWidth)`.
- Shield begins exactly at `healthStartX + healthWidth` and is not capped.

- [ ] **Step 1: Write a failing draw-call layout test**

```ts
champion.stats.health.value = 100;
champion.stats.maxHealth.value = 100;
champion.shieldAmount = 50;
champion.drawHealthBar();

const [frame, health, shield, mana] = rect.mock.calls;
expect(frame[2]).toBe(182); // 17 score + 108 health + 54 shield + 3 border
expect(shield[0]).toBe(health[0] + health[2]);
expect(shield[2]).toBe(54);
expect(mana[2]).toBe(108);
expect(fill).toHaveBeenCalledWith(225, 230, 238, expect.any(Number));
```

Use positions derived from the test champion's known center; assert mana width remains `108` at full mana.

- [ ] **Step 2: Run test and verify RED**

Run: `npm test -- tests/game/types/ChampionHealthBar.test.ts`

Expected: FAIL because the frame is fixed and shield overlays/caps inside health.

- [ ] **Step 3: Implement expanded frame geometry**

```ts
const healthContainerW = barWidth - barHeight;
const healthW = map(health, 0, maxHealth, 0, healthContainerW);
const shieldW = map(this.shieldAmount, 0, maxHealth, 0, healthContainerW);
const effectiveHealthW = Math.max(healthContainerW, healthW + shieldW);
const frameWidth = barHeight + effectiveHealthW;
```

Center the expanded frame around the champion, draw shield at `healthStartX + healthW`, preserve `[225, 230, 238]`, and calculate mana from `healthContainerW` only.

- [ ] **Step 4: Run test and verify GREEN**

Run: `npm test -- tests/game/types/ChampionHealthBar.test.ts tests/game/types/ChampionTypes.test.ts`

Expected: selected tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/gameObject/attackableUnits/Champion.ts tests/game/types/ChampionHealthBar.test.ts
git commit -m "fix: extend health bars for shields"
```

### Task 5: Lux R layered prepare and release beam

**Files:**
- Create: `src/game/vfx/LuxBeamEffect.ts`
- Modify: `src/game/gameObject/spells/Lux_R.ts`
- Test: `tests/game/spells/Lux_R.test.ts`
- Test: `tests/game/vfx/SpellVfx.test.ts`

**Interfaces:**
- `LuxBeamEffect(geometry, phase)` implements `VfxHandle`.
- Prepare phase reads cast progress and remains runtime-owned.
- Release phase owns a `450ms` timer and reports `complete` only at expiry.

- [ ] **Step 1: Write failing layered beam lifecycle tests**

```ts
const release = new LuxBeamEffect(geometry, 'release');
release.draw();
expect(strokeWeight).toHaveBeenCalledWith(expect.any(Number));
expect(line.mock.calls.length).toBeGreaterThanOrEqual(3);
release.update(449);
expect(release.complete).toBe(false);
release.update(1);
expect(release.complete).toBe(true);

spell.update();
spell.drawVfx();
expect(releaseDraw).toHaveBeenCalled();
expect(beamObjects).toHaveLength(1);
```

- [ ] **Step 2: Run focused tests and verify RED**

Run: `npm test -- tests/game/spells/Lux_R.test.ts tests/game/vfx/SpellVfx.test.ts`

Expected: FAIL because Lux R has only the default one-stroke cast loop and no persistent release effect.

- [ ] **Step 3: Restore the two visual phases without touching gameplay**

```ts
// prepare: growing translucent outer lane + center guide
// release: outer glow, bright core, and deterministic animated strands
vfx: {
  castStart: context => new CastBar(context, () => this.castElapsedMs / this.castTimeMs),
  castLoop: context => new LuxBeamEffect(this.beamGeometry(context), 'prepare', () => this.castElapsedMs / this.castTimeMs),
  release: context => new LuxBeamEffect(this.beamGeometry(context), 'release'),
}
```

Use `450ms` release lifetime, frozen geometry, cool cyan/lavender glow and white core. Derive strand positions deterministically from elapsed progress instead of frame-random values so tests and replay visuals are stable. Keep exactly one instant `BeamSpellObject` applying `30` damage and True Sight.

- [ ] **Step 4: Run focused and full verification**

Run: `npm test -- tests/game/spells/Lux_R.test.ts tests/game/vfx/SpellVfx.test.ts`

Expected: focused tests PASS.

Run: `npm run verify`

Expected: asset checks, ability data, both typechecks, all tests, and production build PASS.

- [ ] **Step 5: Commit**

```bash
git add src/game/vfx/LuxBeamEffect.ts src/game/gameObject/spells/Lux_R.ts tests/game/spells/Lux_R.test.ts tests/game/vfx/SpellVfx.test.ts
git commit -m "fix: restore layered Lux ultimate beam"
```
