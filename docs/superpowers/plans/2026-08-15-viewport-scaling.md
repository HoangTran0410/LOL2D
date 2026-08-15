# Viewport Scaling Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every screen shows at least the player's full vision circle, with a manual zoom factor on top of that balanced default.

**Architecture:** `Camera` gains a `baseScale` derived from the viewport's shorter side and a persisted `zoomFactor` multiplier; `Game.resize` recomputes it. Overlays (health bars, combat text, stack tallies) compensate for scale so they stay a constant size on screen while the world scales.

**Tech Stack:** TypeScript, p5.js global mode, Vue 3 (`<script setup>`), Vitest (`environment: 'node'`), Playwright via `puppeteer-core`.

**Spec:** `docs/superpowers/specs/2026-08-15-viewport-scaling-design.md`

## Global Constraints

- **p5 global mode.** `createVector`, `width`, `height`, `lerp`, `constrain`, `textSize` are globals with no import. Nothing may touch them at module eval time — see the comment at the top of `src/main.ts`. Pure helpers in this plan use `Math.min`/`Math.max` rather than p5's `constrain` precisely so they are callable from a Vitest `environment: 'node'` run with no stubs.
- **`VISION_SPAN = 1000`**, from `Stats.ts:190`'s `visionRadius = new Stat(500)`. A constant, never a live read of the player's current vision.
- **`SCALE_MIN = 0.3`, `SCALE_MAX = 2.5`.** The existing `constrain(this.scale, 0.5, 2)` must go: a landscape phone needs 0.39 and 0.5 would clip it.
- **`ZOOM_FACTOR_MIN = 0.6`, `ZOOM_FACTOR_MAX = 1.6`**, default `1`.
- **Storage key `'lol2d.zoomFactor'`**, query override `?zoom=`. Mirrors `TouchControls.ts:160` (`'lol2d.touchControls'`) and its `?touch=` override.
- **`npm run verify` must pass before any task is called done.**
- Every test is written first, run, and **its failure message read** before the implementation exists.

---

### Task 1: Camera base scale, zoom factor, widened clamp

**Files:**
- Modify: `src/game/gameObject/map/Camera.ts:21-29` (replace `zoomBy`/`zoomTo`)
- Test: `tests/game/map/Camera.test.ts` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `VISION_SPAN`, `SCALE_MIN`, `SCALE_MAX`, `ZOOM_FACTOR_MIN`, `ZOOM_FACTOR_MAX`, `baseScaleFor(w, h): number`, `clampZoomFactor(n): number` (all named exports from `Camera.ts`); and on the class: `baseScale: number`, `zoomFactor: number`, `fitTo(w, h): void`, `setZoomFactor(n): void`, `zoomBy(delta): void`, `snapToScale(): void`.

- [ ] **Step 1: Write the failing test**

`tests/game/map/Camera.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { baseScaleFor, clampZoomFactor, SCALE_MIN, VISION_SPAN } from '../../../src/game/gameObject/map/Camera';

describe('baseScaleFor', () => {
  // The spec's table. A landscape phone is the case the whole feature exists
  // for, and 0.39 is below the clamp floor the old code shipped (0.5) — which
  // is why SCALE_MIN is asserted here rather than left implicit.
  it.each([
    ['phone landscape', 844, 390, 0.39],
    ['phone portrait', 390, 844, 0.39],
    ['tablet', 1180, 820, 0.82],
    ['laptop', 1440, 900, 0.9],
    ['desktop', 2560, 1440, 1.44],
    ['ultrawide', 3440, 1440, 1.44],
  ])('%s: %ix%i -> %f', (_name, w, h, expected) => {
    expect(baseScaleFor(w, h)).toBeCloseTo(expected, 5);
  });

  it('keys off the shorter side, so an ultrawide is not punished for its width', () => {
    expect(baseScaleFor(3440, 1440)).toBe(baseScaleFor(1440, 1440));
  });

  it('admits a landscape phone: the floor is below 0.39, not the old 0.5', () => {
    expect(baseScaleFor(844, 390)).toBeGreaterThan(SCALE_MIN);
    expect(SCALE_MIN).toBeLessThan(0.39);
  });

  it('VISION_SPAN is the full vision circle, not the radius', () => {
    expect(VISION_SPAN).toBe(1000);
  });
});

describe('clampZoomFactor', () => {
  it('clamps to the manual range and passes the default through', () => {
    expect(clampZoomFactor(1)).toBe(1);
    expect(clampZoomFactor(0.1)).toBe(0.6);
    expect(clampZoomFactor(99)).toBe(1.6);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/map/Camera.test.ts`
Expected: FAIL — `No "baseScaleFor" export is defined on the module`. **Read the message.** If it instead fails with an assertion mismatch, something already exports these names and this plan's assumption is wrong; stop and re-read `Camera.ts`.

- [ ] **Step 3: Write the implementation**

At the top of `src/game/gameObject/map/Camera.ts`, after the existing import:

```ts
/**
 * The world span every screen must show. A champion's `visionRadius` is 500
 * (`Stats.ts:190`), so what a player is permitted to know is a circle 1000
 * units across; everything past it is fog. Deriving the camera from that
 * rather than from an invented number is what makes "one world unit is one
 * pixel" — a 11x area advantage for a desktop over a phone — go away.
 *
 * A constant, never a live read of the player's current vision: a buff that
 * grants sight must not make the camera lurch.
 */
export const VISION_SPAN = 1000;

/**
 * Bounds on the final scale. The floor is deliberately below a landscape
 * phone's 0.39 — the shipped code clamped at 0.5, which would silently clip
 * the one device this whole feature exists for and leave the bug in a form
 * much harder to see.
 */
export const SCALE_MIN = 0.3;
export const SCALE_MAX = 2.5;

/** Bounds on the player's manual multiplier over the balanced base. */
export const ZOOM_FACTOR_MIN = 0.6;
export const ZOOM_FACTOR_MAX = 1.6;

/**
 * `Math.min`, not p5's `constrain`: this is called from `zoomFactorPreference`
 * before any p5 global exists, and from Vitest's `environment: 'node'` with
 * nothing stubbed.
 */
export const clampZoomFactor = (factor: number): number =>
  Math.min(ZOOM_FACTOR_MAX, Math.max(ZOOM_FACTOR_MIN, factor));

/**
 * The shorter side, so an ultrawide gets more horizontal world rather than a
 * penalty. The consequence is intended: a 2.16-aspect phone ends up seeing
 * more horizontal world than a 1.78-aspect desktop. Aspect ratio decides
 * horizontal extent, and that is not something to normalise away.
 */
export const baseScaleFor = (viewportWidth: number, viewportHeight: number): number =>
  Math.min(viewportWidth, viewportHeight) / VISION_SPAN;
```

Replace `zoomBy`/`zoomTo` (lines 21-29) with:

```ts
  /** The balanced scale for this viewport, before the player's preference. */
  baseScale = 1;
  /** The player's multiplier over `baseScale`. Persisted; see `zoomFactorPreference`. */
  zoomFactor = 1;

  /**
   * Recompute for a viewport size. Takes explicit numbers rather than reading
   * the `width`/`height` globals so it is callable from a headless test.
   */
  fitTo(viewportWidth: number, viewportHeight: number): void {
    this.baseScale = baseScaleFor(viewportWidth, viewportHeight);
    this.applyZoom();
  }

  /**
   * A factor over the base, never an absolute scale. That is what lets the two
   * inputs compose: with an absolute scale, resizing the window would discard
   * the player's zoom and choosing a zoom would discard the balance.
   */
  setZoomFactor(factor: number): void {
    this.zoomFactor = clampZoomFactor(factor);
    this.applyZoom();
  }

  zoomBy(delta: number): void {
    this.setZoomFactor(this.zoomFactor + delta);
  }

  /** Drop the opening lerp and start where we mean to be. */
  snapToScale(): void {
    this.currentScale = this.scale;
  }

  private applyZoom(): void {
    this.scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, this.baseScale * this.zoomFactor));
  }
```

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/game/map/Camera.test.ts`
Expected: PASS, 9 assertions.

Then `npx tsc --noEmit -p tsconfig.json` — `zoomTo` is deleted, and this proves nothing called it. If anything did, this plan's premise was wrong; report it rather than re-adding the method.

- [ ] **Step 5: Commit**

```bash
git add tests/game/map/Camera.test.ts
git commit -m "feat(camera): derive scale from the viewport's shorter side" -- src/game/gameObject/map/Camera.ts tests/game/map/Camera.test.ts
```

---

### Task 2: Persist the zoom factor

**Files:**
- Modify: `src/game/gameObject/map/Camera.ts` (append)
- Test: `tests/game/map/zoomPreference.test.ts` (create)

**Interfaces:**
- Consumes: `clampZoomFactor` from Task 1.
- Produces: `zoomFactorPreference(): number`, `setZoomFactorPreference(factor: number): void`.

- [ ] **Step 1: Write the failing test**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setZoomFactorPreference, zoomFactorPreference } from '../../../src/game/gameObject/map/Camera';

const withEnv = (search: string, stored: string | null) => {
  const store = new Map<string, string>();
  if (stored !== null) store.set('lol2d.zoomFactor', stored);
  vi.stubGlobal('window', {
    location: { search },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  });
  return store;
};

afterEach(() => vi.unstubAllGlobals());

describe('zoomFactorPreference', () => {
  it('defaults to 1 with no query and no stored value', () => {
    withEnv('', null);
    expect(zoomFactorPreference()).toBe(1);
  });

  it('reads the stored value', () => {
    withEnv('', '1.3');
    expect(zoomFactorPreference()).toBeCloseTo(1.3, 5);
  });

  // The override is what lets an e2e run pin a zoom; it must beat storage, or
  // a developer's own stored preference would change what the suite measures.
  it('the query overrides the stored value', () => {
    withEnv('?zoom=0.8', '1.5');
    expect(zoomFactorPreference()).toBeCloseTo(0.8, 5);
  });

  it('clamps both sources into the manual range', () => {
    withEnv('?zoom=99', null);
    expect(zoomFactorPreference()).toBe(1.6);
    withEnv('', '0.01');
    expect(zoomFactorPreference()).toBe(0.6);
  });

  it('ignores junk rather than producing NaN', () => {
    withEnv('?zoom=banana', null);
    expect(zoomFactorPreference()).toBe(1);
    withEnv('', 'banana');
    expect(zoomFactorPreference()).toBe(1);
  });

  it('round-trips through storage', () => {
    const store = withEnv('', null);
    setZoomFactorPreference(1.2);
    expect(store.get('lol2d.zoomFactor')).toBe('1.2');
    expect(zoomFactorPreference()).toBeCloseTo(1.2, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/map/zoomPreference.test.ts`
Expected: FAIL — `No "zoomFactorPreference" export is defined`.

- [ ] **Step 3: Write the implementation**

Append to `Camera.ts`:

```ts
/** Mirrors `TouchControls.ts:160`'s `'lol2d.touchControls'`. */
const ZOOM_STORAGE_KEY = 'lol2d.zoomFactor';

const finiteAbove = (value: number, floor: number): boolean =>
  Number.isFinite(value) && value > floor;

/**
 * The player's zoom multiplier. Three sources, most explicit first — the same
 * shape as `touchControlsPreference` (`TouchControls.ts:220`), and for the
 * same reason: the query parameter is what makes this verifiable from a
 * Playwright run, independent of whatever the developer has stored.
 */
export function zoomFactorPreference(): number {
  try {
    const query = new URLSearchParams(window.location.search).get('zoom');
    if (query !== null) {
      const parsed = Number(query);
      if (finiteAbove(parsed, 0)) return clampZoomFactor(parsed);
    }
  } catch {
    /* no location: fall through to the stored preference */
  }
  try {
    const stored = Number(window.localStorage.getItem(ZOOM_STORAGE_KEY));
    if (finiteAbove(stored, 0)) return clampZoomFactor(stored);
  } catch {
    /* storage blocked: fall through to the default */
  }
  return 1;
}

export function setZoomFactorPreference(factor: number): void {
  try {
    window.localStorage.setItem(ZOOM_STORAGE_KEY, String(clampZoomFactor(factor)));
  } catch {
    /* storage blocked: the setting still works for this session */
  }
}
```

Note `Number(null)` is `0` and `Number('banana')` is `NaN`; `finiteAbove(_, 0)` rejects both, which is what the junk test pins.

- [ ] **Step 4: Run the tests**

Run: `npx vitest run tests/game/map/`
Expected: PASS, both files.

- [ ] **Step 5: Commit**

```bash
git add tests/game/map/zoomPreference.test.ts
git commit -m "feat(camera): persist the zoom factor, with a ?zoom= override" -- src/game/gameObject/map/Camera.ts tests/game/map/zoomPreference.test.ts
```

---

### Task 3: Wire the camera into Game and the wheel into GameScene

**Files:**
- Modify: `src/game/Game.ts:134-135` (construction), `src/game/Game.ts:344-347` (`resize`)
- Modify: `src/scenes/GameScene.ts` (add `mouseWheel`)
- Test: `tests/game/map/CameraWiring.test.ts` (create)

**Interfaces:**
- Consumes: `fitTo`, `setZoomFactor`, `snapToScale`, `zoomFactorPreference`, `setZoomFactorPreference` from Tasks 1-2.
- Produces: nothing new; `Game.resize` gains a camera call.

- [ ] **Step 1: Write the failing test**

Testing `Game`'s constructor headlessly is not worth the stubbing; test the contract that matters — that a resize recomputes the scale and **keeps the player's factor**.

```ts
import { describe, expect, it, vi } from 'vitest';
import Camera from '../../../src/game/gameObject/map/Camera';

const camera = (): Camera => {
  vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
  return new Camera();
};

describe('Camera under resize', () => {
  it('a resize recomputes the scale and leaves the manual factor alone', () => {
    const c = camera();
    c.fitTo(2560, 1440);
    c.setZoomFactor(1.3);
    const desktop = c.scale;

    c.fitTo(844, 390);

    // The factor is the player's; only the base moved.
    expect(c.zoomFactor).toBeCloseTo(1.3, 5);
    expect(c.scale).toBeCloseTo(0.39 * 1.3, 5);
    expect(c.scale).toBeLessThan(desktop);
  });

  it('a phone at the default factor lands at 0.39, not clipped to 0.5', () => {
    const c = camera();
    c.fitTo(844, 390);
    expect(c.scale).toBeCloseTo(0.39, 5);
  });

  it('snapToScale drops the opening lerp', () => {
    const c = camera();
    c.fitTo(844, 390);
    expect(c.currentScale).toBe(0.5); // the constructed default, un-lerped
    c.snapToScale();
    expect(c.currentScale).toBeCloseTo(0.39, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/map/CameraWiring.test.ts`
Expected: the first two PASS already (Task 1 built them), the third FAILS if `snapToScale` was mis-implemented. If **all three pass immediately**, that is fine and expected — this file's value is as a regression guard on the composition rule, and the wiring below is what Step 3 adds. Do not invent a failing assertion to satisfy the ritual; say so and move on.

- [ ] **Step 3: Write the implementation**

`Game.ts`, replacing line 135 (`this.camera = new Camera();`):

```ts
    this.camera = new Camera();
    // Before anything reads a world position from the screen. `width`/`height`
    // are valid here: `Game` is constructed from `GameScene.enter()`, after
    // `createCanvas`.
    this.camera.setZoomFactor(zoomFactorPreference());
    this.camera.fitTo(width, height);
    // A match that boots and is never resized must not sit at the constructed
    // 0.5 default, and the opening lerp from it would now zoom a phone *out*.
    this.camera.snapToScale();
```

with `import Camera, { zoomFactorPreference } from './gameObject/map/Camera';` (adjust the existing import).

`Game.ts:344`:

```ts
  resize(w: number, h: number) {
    // First: both of the others derive from the camera's view of the world.
    this.camera.fitTo(w, h);
    this.fogOfWar.resize(w, h);
    this.touchControls.resize(w, h);
  }
```

`GameScene.ts`, next to `keyPressed`:

```ts
  /**
   * `SceneManager` has always routed this; nothing ever overrode it, which is
   * why `Camera.zoomBy` sat uncalled. One notch is 10% of the manual range.
   *
   * Adjusts the *factor*, not the scale, so the choice survives a resize —
   * see `Camera.setZoomFactor`.
   */
  mouseWheel(event?: WheelEvent): void {
    const delta = event?.deltaY ?? 0;
    if (!delta || !this.game) return;
    this.game.camera.zoomBy(delta < 0 ? ZOOM_WHEEL_STEP : -ZOOM_WHEEL_STEP);
    setZoomFactorPreference(this.game.camera.zoomFactor);
  }
```

with `const ZOOM_WHEEL_STEP = 0.1;` at module scope and the two imports from `../game/gameObject/map/Camera`.

- [ ] **Step 4: Run the tests**

Run: `npm run verify`
Expected: PASS. Then drive it by hand: `npm run dev`, scroll the wheel, confirm the world zooms and that reloading the page keeps the zoom.

- [ ] **Step 5: Commit**

```bash
git add tests/game/map/CameraWiring.test.ts
git commit -m "feat(camera): fit to the viewport on boot and resize, zoom on the wheel" -- src/game/Game.ts src/scenes/GameScene.ts tests/game/map/CameraWiring.test.ts
```

---

### Task 4: `constantSize`, and the health bar that needs it

**Files:**
- Modify: `src/game/gameObject/map/Camera.ts` (add `constantSize`)
- Modify: `src/game/gameObject/attackableUnits/AttackableUnit.ts:205-244` (`drawHealthBar`)
- Test: `tests/game/map/Camera.test.ts` (extend), `tests/game/attackableUnits/HealthBar.test.ts` (create)

**Interfaces:**
- Consumes: `Camera.currentScale`.
- Produces: `Camera.constantSize(px: number): number`.

- [ ] **Step 1: Write the failing test**

Extend `tests/game/map/Camera.test.ts`:

```ts
describe('constantSize', () => {
  it('returns a world size that renders as `px` on screen, at any scale', () => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
    const c = new Camera();
    for (const scale of [0.39, 1, 1.44]) {
      c.currentScale = scale;
      expect(c.constantSize(12) * scale).toBeCloseTo(12, 5);
    }
  });

  it('does not divide by zero', () => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
    const c = new Camera();
    c.currentScale = 0;
    expect(Number.isFinite(c.constantSize(12))).toBe(true);
  });
});
```

`tests/game/attackableUnits/HealthBar.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGame, stubGameGlobals } from '../fixtures';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';

let spies: Record<string, ReturnType<typeof vi.fn>>;

const unitAtScale = (currentScale: number | null): AttackableUnit => {
  const game = createGame() as never as { camera?: unknown };
  if (currentScale !== null) game.camera = { currentScale, constantSize: (px: number) => px / currentScale };
  const unit = new AttackableUnit({ game: game as never, position: createVector(0, 0) } as never);
  unit.stats.health.baseValue = 50;
  unit.stats.maxHealth.baseValue = 100;
  return unit;
};

beforeEach(() => { spies = stubGameGlobals(); });
afterEach(() => vi.unstubAllGlobals());

describe('drawHealthBar compensates for camera scale', () => {
  // The pair rule from the spec: compensating the text but not the bar gives
  // 12px digits over a 39px bar, which is worse than either extreme. Both
  // assertions are in one test on purpose — they must not be able to pass
  // separately.
  it('at 0.39 the bar and its text are both scaled up in world units', () => {
    unitAtScale(0.39).drawHealthBar();

    const barWidths = spies.rect.mock.calls.map(call => call[2]);
    expect(barWidths.some(w => Math.abs(w - 100 / 0.39) < 0.01)).toBe(true);
    expect(spies.textSize).toHaveBeenCalledWith(expect.closeTo(12 / 0.39, 5));
  });

  it('at scale 1 nothing changes from the shipped numbers', () => {
    unitAtScale(1).drawHealthBar();
    expect(spies.rect.mock.calls.map(c => c[2])).toContain(100);
    expect(spies.textSize).toHaveBeenCalledWith(12);
  });

  // Headless spell tests build units with no camera at all. A hard dependency
  // here would break dozens of existing files.
  it('survives a game with no camera', () => {
    expect(() => unitAtScale(null).drawHealthBar()).not.toThrow();
    expect(spies.textSize).toHaveBeenCalledWith(12);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/attackableUnits/HealthBar.test.ts`
Expected: FAIL — the bar width is 100 and `textSize` is 12 at scale 0.39. **Read it**: the failure must be the *numbers*, not a `TypeError`. A `TypeError` means the fixture is wrong, not the implementation.

- [ ] **Step 3: Write the implementation**

On `Camera`:

```ts
  /**
   * The world size a `px`-sized thing must be drawn at to occupy `px` on
   * screen. Information overlays — health bars, damage numbers, stack tallies —
   * are a HUD that happens to be positioned in world coordinates, so they use
   * this; a champion sprite is the world, and does not.
   */
  constantSize(px: number): number {
    return this.currentScale > 0 ? px / this.currentScale : px;
  }
```

In `drawHealthBar`, after the existing `let { displaySize: size, alpha } = ...`:

```ts
    // Overlay, not world: see Camera.constantSize. The bar and its text
    // compensate together — 12px digits over a 39px bar is worse than either
    // extreme. `size` stays in world units: the bar hangs off a sprite that
    // really is that big.
    const k = this.game?.camera?.constantSize(1) ?? 1;

    let healthBarHeight = 6 * k;
    let healthBarWidth = 100 * k;
    let healthBarX = pos.x - healthBarWidth / 2;
    let healthBarY = pos.y - size / 2 - healthBarHeight - 15 * k;
```

and the two text lines:

```ts
    textSize(12 * k);
    text(`${healthBarValue} / ${healthBarMaxValue}`, pos.x, healthBarY - 10 * k);
```

- [ ] **Step 4: Run the tests**

Run: `npm run verify`
Expected: PASS. The whole suite matters here — `drawHealthBar` runs from `AttackableUnit.draw`, which many tests reach.

- [ ] **Step 5: Commit**

```bash
git add tests/game/attackableUnits/HealthBar.test.ts
git commit -m "fix(camera): health bars keep their size on screen as the world scales" -- src/game/gameObject/map/Camera.ts src/game/gameObject/attackableUnits/AttackableUnit.ts tests/game/map/Camera.test.ts tests/game/attackableUnits/HealthBar.test.ts
```

---

### Task 5: The remaining overlays, and the fog's wrong scale

**Files:**
- Modify: `src/game/gameObject/map/FogOfWar.ts:304-305`
- Modify: `src/game/gameObject/helpers/CombatText.ts`, `src/game/gameObject/attackableUnits/Champion.ts`, `src/game/gameObject/structures/Turret.ts`, `src/game/gameObject/spells/Nasus_Q.ts`, `src/game/gameObject/spells/Veigar_Q.ts`, `src/game/gameObject/spells/ChoGath_R.ts`, `src/game/nav/NavDebugOverlay.ts`
- Test: `tests/game/map/FogScale.test.ts` (create)

**Interfaces:**
- Consumes: `Camera.constantSize` from Task 4.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// A source assertion, deliberately. The defect is "reads the target scale
// instead of the lerped one", which is invisible in any single-frame render
// test — the two values are equal whenever the camera is at rest, which is
// every frame a unit test ever produces. What is actually being pinned is
// that nobody reintroduces `camera.scale` here.
describe('FogOfWar reads the lerped scale', () => {
  it('uses currentScale, never the target scale', () => {
    const source = readFileSync('src/game/gameObject/map/FogOfWar.ts', 'utf8');
    expect(source).not.toMatch(/camera\.scale\b/);
    expect(source).toMatch(/camera\.currentScale\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/game/map/FogScale.test.ts`
Expected: FAIL on the first `expect` — `camera.scale` is present at lines 304-305.

- [ ] **Step 3: Write the implementation**

`FogOfWar.ts:304-305`: `this.game.camera.scale` → `this.game.camera.currentScale`, both lines.

Then, in each remaining file, wrap world-space overlay text. The pattern, e.g. in `Nasus_Q_Object.draw`:

```ts
    const k = this.game?.camera?.constantSize(1) ?? 1;
    ...
    rect(this.targetPosition.x - 24 * k, ty - 10 * k, 48 * k, 20 * k, 5 * k);
    textSize((15 + 7 * (1 - Math.min(1, t * 4))) * k);
```

Apply the same treatment to the tally in `Veigar_Q_Power.draw`, the tally in
`ChoGath_R_Growth.draw`, `CombatText`'s text, `Champion`'s and `Turret`'s text,
and `NavDebugOverlay`'s labels. **Sprites, spell effects and range circles are
not touched** — they are the world.

- [ ] **Step 4: Run the tests**

Run: `npm run verify`, then `node tests/e2e/drive-new-spells.mjs` and `node tests/e2e/measure-fog.mjs`.
Expected: PASS. Then check by eye at `npm run dev`: at a small window, damage numbers and the Nasus tally must be the same size on screen as at a large one.

- [ ] **Step 5: Commit**

```bash
git add tests/game/map/FogScale.test.ts
git commit -m "fix(camera): overlays keep screen size; fog reads currentScale not scale" -- src/game/gameObject/map/FogOfWar.ts src/game/gameObject/helpers/CombatText.ts src/game/gameObject/attackableUnits/Champion.ts src/game/gameObject/structures/Turret.ts src/game/gameObject/spells/Nasus_Q.ts src/game/gameObject/spells/Veigar_Q.ts src/game/gameObject/spells/ChoGath_R.ts src/game/nav/NavDebugOverlay.ts tests/game/map/FogScale.test.ts
```

---

### Task 6: The zoom slider, for screens with no wheel

**Files:**
- Modify: `src/game/hud/practice/RulesTab.vue`, `src/game/hud/hudInteractions.ts` (expose the camera)
- Test: manual + Task 7's e2e

**Interfaces:**
- Consumes: `Camera.setZoomFactor`, `setZoomFactorPreference`, `ZOOM_FACTOR_MIN/MAX`.
- Produces: `#practice-zoom` (range input), `#practice-zoom-value` (label).

- [ ] **Step 1: Add the control**

A phone has no wheel, and phones are who this feature is for. Modelled on the
CDR slider in the same file — including the hand-rolled touch drag, because
`GameScene` `preventDefault()`s every touch on the page and a plain `@input`
does not fire under a real finger (`RulesTab.vue:57-73` says so in full).

In `<script setup>`:

```ts
import { ZOOM_FACTOR_MAX, ZOOM_FACTOR_MIN, setZoomFactorPreference } from '../../gameObject/map/Camera';

const ZOOM_STEP = 0.1;
const camera = hud.camera;
const zoom = ref(camera.zoomFactor);

const setZoom = (factor: number): void => {
  camera.setZoomFactor(factor);
  setZoomFactorPreference(camera.zoomFactor);
  zoom.value = camera.zoomFactor; // read back: setZoomFactor clamps
};

const onZoomInput = (event: Event): void => setZoom(Number((event.target as HTMLInputElement).value));

const onZoomTouch = (event: TouchEvent): void => {
  const touch = event.touches[0] ?? event.changedTouches[0];
  if (!touch) return;
  const track = (event.currentTarget as HTMLElement).getBoundingClientRect();
  if (!track.width) return;
  const ratio = Math.min(1, Math.max(0, (touch.clientX - track.left) / track.width));
  const raw = ZOOM_FACTOR_MIN + ratio * (ZOOM_FACTOR_MAX - ZOOM_FACTOR_MIN);
  setZoom(Math.round(raw / ZOOM_STEP) * ZOOM_STEP);
};
```

In the template, before the URF toggle:

```html
    <label class="pregame-field">
      <span>Thu phóng: <strong id="practice-zoom-value">{{ Math.round(zoom * 100) }}%</strong></span>
      <input
        type="range"
        id="practice-zoom"
        :min="ZOOM_FACTOR_MIN"
        :max="ZOOM_FACTOR_MAX"
        :step="ZOOM_STEP"
        :value="zoom"
        @input="onZoomInput"
        @touchstart.prevent="onZoomTouch"
        @touchmove.prevent="onZoomTouch"
      />
    </label>
```

`hudInteractions.ts` exposes `camera` beside `director` — **the same lazy
`markRaw` getter**, for the same two reasons written there: the HUD is
constructed before the rest of the game, and a `reactive()` camera would hand
back proxied p5 vectors on every read, every frame.

- [ ] **Step 2: Verify by hand**

`npm run dev`, open the panel, drag the slider: the world zooms live under the
paused match. Note that `Game.draw()` returns early while paused, so **the
canvas will not repaint until the panel closes** — confirm the change took by
closing it. If that turns out to be unacceptable to use, say so; do not fix it
here by making `draw()` run while paused, which is a change with its own blast
radius.

- [ ] **Step 3: Commit**

```bash
git commit -m "feat(camera): a zoom slider in the practice panel, for screens with no wheel" -- src/game/hud/practice/RulesTab.vue src/game/hud/hudInteractions.ts
```

---

### Task 7: Prove it on two real viewports

**Files:**
- Create: `tests/e2e/verify-viewport-scaling.mjs`

**Interfaces:**
- Consumes: everything above, plus `window.__lol2d` (DEV-only).

- [ ] **Step 1: Write the script**

Model it on `tests/e2e/drive-mobile-hud.mjs` for the launch/viewport plumbing.
The claim to falsify is the spec's headline, so measure the world span, not the
scale — the scale is the implementation, the span is the promise:

```js
const spanAt = async (page, w, h) => {
  await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
  await page.waitForTimeout(400); // let the resize handler and the lerp settle
  return page.evaluate(() => {
    const game = window.__lol2d.scene.oScene.game;
    const box = game.camera.getBoundingBox();
    return { w: box.w, h: box.h, scale: game.camera.currentScale };
  });
};
```

Checks:
1. `phone.h` and `desktop.h` are within 2% of each other — the vision circle
   fits on both.
2. Both are `>= 1000`, i.e. the full vision circle really is on screen.
3. `desktop.scale > phone.scale` — the desktop zoomed *in*, which is the half
   of the fix people do not expect.
4. With `?zoom=1.6`, the span shrinks and stays within the clamp.
5. A `setViewport` back to the phone size restores the phone's span, and
   `camera.zoomFactor` is unchanged across all of it.

- [ ] **Step 2: Prove the script can fail**

Mandatory, and the reason this task exists as its own gate. Make each of these
edits, run the script, confirm the expected check goes red, then revert:

- `SCALE_MIN` back to `0.5` → check 1 and 2 go red on the phone.
- `baseScaleFor` keyed on `Math.max` instead of `Math.min` → check 1 goes red.
- `Game.resize` no longer calling `camera.fitTo` → check 5 goes red.

Report the three failure messages. A script that cannot be shown to fail has
not been verified — the practice-panel plan shipped six tests that could never
fail, and reading the red output is the only thing that catches it.

- [ ] **Step 3: Run the neighbours**

Run: `node tests/e2e/drive-mobile-hud.mjs`, `node tests/e2e/drive-touch-controls.mjs`, `node tests/e2e/verify-touch-aiming.mjs`, `node tests/e2e/measure-fog.mjs`.
Expected: all PASS. Touch aiming converts screen coordinates to world through
the camera, so a scale change is exactly what would break it — this is not a
formality.

- [ ] **Step 4: Commit**

```bash
git add tests/e2e/verify-viewport-scaling.mjs
git commit -m "test(e2e): the visible world span matches across viewport sizes" -- tests/e2e/verify-viewport-scaling.mjs
```

---

## Self-review notes

- **Spec coverage.** Anchor and table → Task 1. Manual factor and persistence →
  Tasks 1-2. Wheel → Task 3. Slider → Task 6. Clamp widening → Task 1 (asserted
  in Task 1's third test and again in Task 7's mutation list). World-space text
  → Tasks 4-5. Fog `scale`/`currentScale` → Task 5. Opening lerp → Task 3
  (`snapToScale`). Out-of-scope items are not tasks, by design.
- **Task 3's test may pass on first run.** Called out in the step itself rather
  than papered over. The red step is a check, not a ritual to satisfy by
  inventing a failure.
- **Task 5's test is a source assertion**, which is unusual here and justified
  inline: the defect is invisible to any single-frame render test because the
  two values are equal whenever the camera is at rest.
- **The riskiest task is 4**, because `drawHealthBar` runs from `AttackableUnit.draw`
  and many existing tests reach it. The no-camera case is tested for that reason.
