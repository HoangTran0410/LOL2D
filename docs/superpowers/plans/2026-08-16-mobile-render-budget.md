# Mobile Render Budget Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bound mobile particle draw work, cull vision-only offscreen units, and remove per-pixel avatar tinting.

**Architecture:** Keep simulation unchanged. `ObjectManager` owns the viewport-wide particle budget because it already knows every visible object; `ParticleSystem` only knows how to sample its own array. Existing Canvas2D primitives handle alpha and culling.

**Tech Stack:** TypeScript, p5.js global mode, Canvas2D, Vitest, Playwright/Chrome.

## Global Constraints

- No new dependencies.
- Pointer mode draws all particles.
- Touch mode draws at most roughly 800 visible particles per frame.
- Update/lifetime/gameplay behavior is unchanged.

---

### Task 1: Particle sampling and expiry compaction

**Files:**
- Create: `tests/game/helpers/ParticleSystem.test.ts`
- Modify: `src/game/gameObject/helpers/ParticleSystem.ts`

**Interfaces:**
- Produces: `ParticleSystem.draw(limit?: number): void`.
- Preserves: `ParticleSystem.update(): void` callback order and survivor order.

- [ ] **Step 1: Write failing tests**

```ts
it('draws an evenly distributed subset when a limit is supplied', () => {
  const drawn: number[] = [];
  const system = particleSystem(p => drawn.push(p.id));
  system.particles = Array.from({ length: 10 }, (_, id) => ({ id }));
  system.draw(3);
  expect(drawn).toEqual([1, 5, 8]);
});

it('compacts dead particles without splice', () => {
  const system = particleSystem();
  system.particles = [{ dead: true }, { dead: false }, { dead: true }, { dead: false }];
  system.particles.splice = () => { throw new Error('splice'); };
  system.update();
  expect(system.particles.map(p => p.dead)).toEqual([false, false]);
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/game/helpers/ParticleSystem.test.ts`

Expected: subset test draws all particles and compaction throws from `splice`.

- [ ] **Step 3: Implement minimal sampling and compaction**

```ts
draw(limit = Infinity): void {
  const count = Math.min(this.particles.length, Math.max(0, Math.floor(limit)));
  for (let i = 0; i < count; i++) {
    const index = count === this.particles.length
      ? i
      : Math.floor(((i + 0.5) * this.particles.length) / count);
    this.drawFn?.(this.particles[index]);
  }
}
```

Compact survivors with read/write indexes and set `particles.length = write`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/game/helpers/ParticleSystem.test.ts`

Expected: all focused tests pass.

### Task 2: Global mobile budget and visual culling

**Files:**
- Create: `tests/game/managers/ObjectManager.render.test.ts`
- Modify: `src/game/managers/ObjectManager.ts`
- Modify: `src/game/Game.ts`

**Interfaces:**
- Produces: exported `MOBILE_PARTICLE_DRAW_BUDGET = 800`.
- Consumes: `ObjectManagerGameContext.touchUi?: boolean`.

- [ ] **Step 1: Write failing tests**

```ts
it('shares one mobile budget proportionally across visible particle systems', () => {
  const drawn = indexTwoThousandVisibleParticles({ touchUi: true });
  expect(drawn).toBe(MOBILE_PARTICLE_DRAW_BUDGET);
});

it('keeps pointer rendering unlimited', () => {
  const drawn = indexTwoThousandVisibleParticles({ touchUi: false });
  expect(drawn).toBe(2_000);
});

it('does not draw an allied body whose vision box alone intersects the camera', () => {
  const unit = alliedUnitAt(1_500, 0, { visionRadius: 1_000 });
  manager.draw();
  expect(unit.draw).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/game/managers/ObjectManager.render.test.ts`

Expected: missing export/context behavior and vision-only unit still draws.

- [ ] **Step 3: Implement minimal manager policy**

Compute visible particle total once, derive `min(1, 800 / total)` in touch mode, pass each system its proportional limit, and apply a 100-screen-pixel expanded camera check to `AttackableUnit` before drawing. Store the resolved touch mode on `Game` before constructing `ObjectManager`.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/game/managers/ObjectManager.render.test.ts tests/game/helpers/ParticleSystem.test.ts`

Expected: all focused tests pass.

### Task 3: Native avatar alpha

**Files:**
- Create: `tests/game/attackableUnits/AvatarRendering.test.ts`
- Modify: `src/game/gameObject/attackableUnits/AttackableUnit.ts`

**Interfaces:**
- Preserves: `drawAvatar()` appearance.
- Removes: p5 `tint()` from avatar transparency.

- [ ] **Step 1: Write failing test**

```ts
unit.animatedValues.alpha = 128;
unit.drawAvatar();
expect(spies.tint).not.toHaveBeenCalled();
expect(drawingContext.globalAlpha).toBeCloseTo(128 / 255);
```

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/game/attackableUnits/AvatarRendering.test.ts`

Expected: `tint()` was called.

- [ ] **Step 3: Implement native alpha**

Set `drawingContext.globalAlpha = alpha / 255` inside the existing Canvas2D save/restore block before the avatar image call.

- [ ] **Step 4: Run GREEN**

Run: `npm test -- tests/game/attackableUnits/AvatarRendering.test.ts`

Expected: focused test passes.

### Task 4: Benchmark and release verification

**Files:**
- Modify: production/tests above only.

- [ ] **Step 1: Run the 6× CPU A/B stress benchmark**

Use the same 844×390 scene with 25 champions and 3,000 particles in 11 visible systems. Record FPS, update p95, draw p95, and total frame p95 before/after.

- [ ] **Step 2: Run full verification**

Run: `npm test`

Run: `npm run typecheck`

Run: `npm run build`

Expected: 0 failures and exit code 0 for all commands.

- [ ] **Step 3: Commit**

```bash
git add docs src tests
git commit -m "perf: bound mobile particle rendering"
```
