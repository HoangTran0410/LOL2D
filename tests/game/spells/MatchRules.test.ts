/**
 * Proves the single seam cooldown reduction and URF (mana-free) run through:
 * `Spell.applyMatchRules` (cooldown) and `Spell.effectiveManaCost` (mana),
 * both reading `owner.game.matchRules` — set once by `Game.ts` from the
 * pregame config, never touched by an individual spell file.
 *
 * Two real spells stand in for the two ways a spell's cooldown reaches the
 * runtime: `Ahri_Q` never overrides `castSpec` (its cooldown comes from the
 * base class's `legacyCastSpec(this.coolDown)`), while `Lux_R` overrides
 * `castSpec` itself but still writes `durationMs: this.coolDown` — which is
 * what every overriding spell in this codebase does. If the seam only
 * covered one of the two, this would tell them apart.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));

import Ahri_Q from '../../../src/game/gameObject/spells/Ahri_Q';
import Lux_R, { CAST_TIME_MS, MANA_COST } from '../../../src/game/gameObject/spells/Lux_R';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import type { MatchRules } from '../../../src/game/config/PregameConfig';

class TestVector {
  constructor(public x = 0, public y = 0) {}
  copy(): TestVector { return new TestVector(this.x, this.y); }
  set(x: number, y: number): this { this.x = x; this.y = y; return this; }
  add(value: TestVector): this { this.x += value.x; this.y += value.y; return this; }
  mult(value: number): this { this.x *= value; this.y *= value; return this; }
  mag(): number { return Math.hypot(this.x, this.y); }
  setMag(value: number): this {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  dist(value: TestVector): number { return Math.hypot(this.x - value.x, this.y - value.y); }
  static sub(a: TestVector, b: TestVector): TestVector { return new TestVector(a.x - b.x, a.y - b.y); }
  static add(a: TestVector, b: TestVector): TestVector { return a.copy().add(b); }
}

const context = (caster: unknown): CastContext => Object.freeze({
  spellId: 'match-rules-spell',
  activationId: 'activation',
  startedAtMs: 0,
  caster,
  origin: Object.freeze({ x: 0, y: 0 }),
  cursorWorld: Object.freeze({ x: 100, y: 0 }),
  direction: Object.freeze({ x: 1, y: 0 }),
});

const makeOwner = (matchRules?: MatchRules, mana = 500) => {
  const objects: unknown[] = [];
  return {
    position: new TestVector(),
    destination: new TestVector(),
    collisionRadius: 20,
    teamId: 'blue',
    isDead: false,
    canCast: true,
    spells: [] as unknown[],
    stats: {
      mana: { value: mana },
      health: { value: 100 },
      addModifier: vi.fn(),
      removeModifier: vi.fn(),
    },
    addBuff: vi.fn((buff: { activateBuff?: () => void }) => buff.activateBuff?.()),
    takeDamage: vi.fn(),
    game: {
      worldMouse: new TestVector(100, 0),
      matchRules,
      eventManager: { emit: vi.fn(), on: vi.fn(() => () => undefined) },
      objectManager: { objects, addObject: vi.fn((o: unknown) => objects.push(o)) },
    },
  };
};

describe('cooldown reduction runs through the resolved CastSpec, for both castSpec strategies', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves the cooldown untouched with no matchRules on game (every pre-existing test/spell)', () => {
    const owner = makeOwner(undefined);
    const spell = new Ahri_Q(owner as never);
    expect(spell.effectiveCoolDownMs).toBe(spell.coolDown);
    spell.press(context(owner));
    expect(spell.currentCooldown).toBe(spell.coolDown);
  });

  it('leaves the cooldown untouched at 0% reduction', () => {
    const owner = makeOwner({ cooldownMultiplier: 1, manaFree: false });
    const spell = new Ahri_Q(owner as never);
    spell.press(context(owner));
    expect(spell.currentCooldown).toBe(spell.coolDown);
  });

  it('halves a legacy-castSpec spell (no castSpec override) at 50% reduction', () => {
    const owner = makeOwner({ cooldownMultiplier: 0.5, manaFree: false });
    const spell = new Ahri_Q(owner as never);
    expect(spell.coolDown).toBe(5_000);
    expect(spell.effectiveCoolDownMs).toBe(2_500);

    expect(spell.press(context(owner))).toBe(true);
    expect(spell.currentCooldown).toBe(2_500);
  });

  it('halves a spell that overrides castSpec at 50% reduction', () => {
    const owner = makeOwner({ cooldownMultiplier: 0.5, manaFree: false });
    const spell = new Lux_R(owner as never);
    expect(spell.coolDown).toBe(10_000);
    expect(spell.effectiveCoolDownMs).toBe(5_000);

    expect(spell.press(context(owner))).toBe(true);
    expect(spell.currentCooldown).toBe(0); // cooldown starts at 'release', not 'start'
    vi.stubGlobal('deltaTime', CAST_TIME_MS);
    spell.update();
    expect(spell.currentCooldown).toBe(5_000);
  });

  it('reproduces 90%-reduction arithmetic exactly as Game.ts computes it from a percent', () => {
    // toMatchRules(90) = 1 - 90/100 = 0.1
    const owner = makeOwner({ cooldownMultiplier: 0.1, manaFree: false });
    const spell = new Ahri_Q(owner as never);
    spell.press(context(owner));
    expect(spell.currentCooldown).toBeCloseTo(500);
  });
});

describe('URF (manaFree) zeroes every mana path through the same getter', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('charges full mana with no matchRules on game', () => {
    const owner = makeOwner(undefined, 500);
    const spell = new Lux_R(owner as never);
    expect(spell.effectiveManaCost).toBe(MANA_COST);
    spell.press(context(owner));
    expect(owner.stats.mana.value).toBe(500 - MANA_COST);
  });

  it('charges full mana with manaFree off', () => {
    const owner = makeOwner({ cooldownMultiplier: 1, manaFree: false }, 500);
    const spell = new Lux_R(owner as never);
    spell.press(context(owner));
    expect(owner.stats.mana.value).toBe(500 - MANA_COST);
  });

  it('charges nothing with manaFree on, even though manaCost itself is untouched', () => {
    const owner = makeOwner({ cooldownMultiplier: 1, manaFree: true }, 500);
    const spell = new Lux_R(owner as never);
    expect(spell.manaCost).toBe(MANA_COST); // the tuning number never changes
    expect(spell.effectiveManaCost).toBe(0); // what actually gets charged does

    expect(spell.press(context(owner))).toBe(true);
    expect(owner.stats.mana.value).toBe(500); // nothing was spent
  });

  it('lets a cast through under manaFree even with zero mana in the pool', () => {
    const owner = makeOwner({ cooldownMultiplier: 1, manaFree: true }, 0);
    const spell = new Lux_R(owner as never);
    expect(spell.press(context(owner))).toBe(true);
    expect(owner.stats.mana.value).toBe(0);
  });
});

// The seam only holds if nothing goes around it. Mirrors
// tests/game/buffs/Ground.test.ts's guard for owner.teleportTo.
describe('no spell file reaches for matchRules on its own', () => {
  const spellsDir = join(process.cwd(), 'src/game/gameObject/spells');

  it.each(readdirSync(spellsDir).filter(name => name.endsWith('.ts')))('%s', name => {
    const source = readFileSync(join(spellsDir, name), 'utf8');
    expect(source).not.toMatch(/matchRules/);
  });
});
