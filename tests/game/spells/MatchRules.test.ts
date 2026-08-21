/**
 * Proves the single seam cooldown reduction and URF (mana-free) run through:
 * `Spell.reducedCooldown` (cooldown) and `Spell.effectiveManaCost` (mana),
 * both reading `owner.game.matchRules` — seeded by `Game.ts` from the pregame
 * config, retuned mid-match by `MatchDirector`, never touched by an individual
 * spell file.
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
import Spell from '../../../src/game/gameObject/Spell';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import type { MatchRules } from '../../../src/game/config/PregameConfig';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeAhri_Q from '../../../packs/riot/spells/Ahri_Q';
import makeAnivia_Q from '../../../packs/riot/spells/Anivia_Q';
import { CAST_TIME_MS, MANA_COST } from '../../../packs/riot/spells/Lux_R';
import makeLux_R from '../../../packs/riot/spells/Lux_R';
const __api = buildContentApi();
const Ahri_Q = makeAhri_Q(__api);
const Anivia_Q = makeAnivia_Q(__api);
const Lux_R = makeLux_R(__api);

/**
 * Every spell file, content and core alike, for the two source scans below.
 * `coreSpells/` left `spells/` but did not stop being spells; `index.ts` is a
 * barrel, not a spell.
 */
const spellFiles = (): { dir: string; name: string }[] => {
  const spellsDir = join(process.cwd(), 'packs/riot/spells');
  const coreSpellsDir = join(process.cwd(), 'src/game/gameObject/coreSpells');
  return [
    ...readdirSync(spellsDir)
      .filter(name => name.endsWith('.ts'))
      .map(name => ({ dir: spellsDir, name })),
    ...readdirSync(coreSpellsDir)
      .filter(name => name.endsWith('.ts') && name !== 'index.ts')
      .map(name => ({ dir: coreSpellsDir, name })),
  ];
};

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy(): TestVector {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }
  add(value: TestVector): this {
    this.x += value.x;
    this.y += value.y;
    return this;
  }
  mult(value: number): this {
    this.x *= value;
    this.y *= value;
    return this;
  }
  mag(): number {
    return Math.hypot(this.x, this.y);
  }
  setMag(value: number): this {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  dist(value: TestVector): number {
    return Math.hypot(this.x - value.x, this.y - value.y);
  }
  static sub(a: TestVector, b: TestVector): TestVector {
    return new TestVector(a.x - b.x, a.y - b.y);
  }
  static add(a: TestVector, b: TestVector): TestVector {
    return a.copy().add(b);
  }
}

const context = (caster: unknown): CastContext =>
  Object.freeze({
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

/**
 * The rule is read at cast time, not at construction time.
 *
 * `MatchDirector.seedRules` mutates the *same* `matchRules` object every spell
 * already holds, precisely so a slider drag mid-match reaches spells that were
 * built before the panel opened. That only works if nothing caches the derived
 * cooldown: the runtime resolves its `CastSpec` once, on first cast, so a
 * multiplier baked into that spec is the multiplier the spell keeps for the
 * rest of the match no matter what the player does to the slider afterwards.
 *
 * The player-visible shape of that bug: the HUD ring (which reads
 * `effectiveCoolDownMs`, recomputed every frame) shows the new cooldown while
 * the spell keeps coming back on the old one, and picking a different spell —
 * which builds a *new* instance — is the only thing that "fixes" it.
 */
describe('a cooldown rule changed mid-match reaches spells that already exist', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  /** Runs the spell forward until its cooldown is spent, so it can cast again. */
  const waitOutCooldown = (spell: Spell) => {
    vi.stubGlobal('deltaTime', spell.currentCooldown);
    spell.update();
    vi.stubGlobal('deltaTime', 16);
    expect(spell.currentCooldown).toBe(0);
  };

  it('drops 90% reduction back to none on the next cast', () => {
    const rules: MatchRules = { cooldownMultiplier: 0.1, manaFree: false };
    const owner = makeOwner(rules);
    const spell = new Ahri_Q(owner as never);

    expect(spell.press(context(owner))).toBe(true);
    expect(spell.currentCooldown).toBeCloseTo(500);
    waitOutCooldown(spell);

    // The player drags the slider back to 0%: MatchDirector mutates in place.
    rules.cooldownMultiplier = 1;
    expect(spell.effectiveCoolDownMs).toBe(5_000); // what the HUD already shows

    expect(spell.press(context(owner))).toBe(true);
    expect(spell.currentCooldown).toBe(5_000);
  });

  it('picks up reduction switched on mid-match, the same way', () => {
    const rules: MatchRules = { cooldownMultiplier: 1, manaFree: false };
    const owner = makeOwner(rules);
    const spell = new Ahri_Q(owner as never);

    expect(spell.press(context(owner))).toBe(true);
    expect(spell.currentCooldown).toBe(5_000);
    waitOutCooldown(spell);

    rules.cooldownMultiplier = 0.1;
    expect(spell.press(context(owner))).toBe(true);
    expect(spell.currentCooldown).toBeCloseTo(500);
  });

  it('gives a spell whose cooldown starts at release the same live read', () => {
    const rules: MatchRules = { cooldownMultiplier: 0.5, manaFree: false };
    const owner = makeOwner(rules);
    const spell = new Lux_R(owner as never);

    expect(spell.press(context(owner))).toBe(true);
    vi.stubGlobal('deltaTime', CAST_TIME_MS);
    spell.update();
    expect(spell.currentCooldown).toBe(5_000);
    waitOutCooldown(spell);

    rules.cooldownMultiplier = 1;
    expect(spell.press(context(owner))).toBe(true);
    vi.stubGlobal('deltaTime', CAST_TIME_MS);
    spell.update();
    expect(spell.currentCooldown).toBe(10_000);
  });
});

/**
 * The other way a cooldown starts. A multi-phase spell does not get its second
 * cooldown from the runtime: it writes `this.currentCooldown = <its own
 * number>` when a recast phase ends, which the runtime never sees, so it has
 * to call `reducedCooldown` by hand. Left raw, Lee Sin's Q went on its full 9s
 * no matter what cooldown reduction the pregame screen was set to, while
 * single-phase spells honoured it.
 */
describe('a spell that sets its own cooldown mid-cast still gets cooldown reduction', () => {
  /** Exposes the protected seam so it can be checked without a whole cast. */
  class ProbeSpell extends Spell {
    targetingMode = 'SELF' as const;
    coolDown = 5_000;
    reduce(durationMs: number): number {
      return this.reducedCooldown(durationMs);
    }
  }

  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('leaves a self-set cooldown alone with no matchRules on game', () => {
    const spell = new ProbeSpell(makeOwner(undefined) as never);
    expect(spell.reduce(5_000)).toBe(5_000);
  });

  it('halves a self-set cooldown at 50% reduction', () => {
    const spell = new ProbeSpell(makeOwner({ cooldownMultiplier: 0.5, manaFree: false }) as never);
    expect(spell.reduce(5_000)).toBe(2_500);
  });

  // The regression itself, on a real two-phase spell: Anivia Q casts into Q2
  // (recast window), and the full cooldown is only set in `onUpdate` once the
  // ice is gone — the assignment that used to bypass the seam.
  it('halves the cooldown a two-phase spell sets when its recast window closes', () => {
    const owner = makeOwner({ cooldownMultiplier: 0.5, manaFree: false });
    const spell = new Anivia_Q(owner as never);
    expect(spell.coolDown).toBe(9_000);

    expect(spell.press(context(owner))).toBe(true);
    expect(spell.phase).toBe('Q2');
    // the recast window is a fixed input window and stays raw
    expect(spell.currentCooldown).toBe(spell.recastDelay);

    spell.spellObject!.toRemove = true; // the ice detonated at max range
    vi.stubGlobal('deltaTime', 0); // freeze the countdown so we read the value set
    spell.update();

    expect(spell.phase).toBe('Q1');
    expect(spell.currentCooldown).toBe(4_500);
  });

  it('leaves that same cooldown at full length with no matchRules', () => {
    const owner = makeOwner(undefined);
    const spell = new Anivia_Q(owner as never);

    expect(spell.press(context(owner))).toBe(true);
    spell.spellObject!.toRemove = true;
    vi.stubGlobal('deltaTime', 0);
    spell.update();

    expect(spell.currentCooldown).toBe(9_000);
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
  it.each(spellFiles())('$name', ({ dir, name }) => {
    const source = readFileSync(join(dir, name), 'utf8');
    expect(source).not.toMatch(/matchRules/);
  });
});

/**
 * The same guard for a self-set cooldown. A spell that sets its own cooldown
 * mid-cast writes `this.currentCooldown = ...` directly, which the runtime
 * never sees; such an assignment has to route through `Spell.reducedCooldown`
 * or the spell silently ignores cooldown reduction from its second phase
 * onward — the Lee Sin Q bug this exists to keep fixed.
 *
 * Only assignments naming a cooldown *field* are required to wrap. A recast
 * window ("you have N ms to press the key again") is a fixed input window, not
 * a wait for the ability to come back, and reducing it would shorten the
 * player's reaction time instead of the cooldown; those are written as plain
 * millisecond literals or as fields named for what they are (`recastDelay`,
 * `timeWaitForNextDash`), and pass untouched.
 *
 * Blind spot worth knowing: Leblanc W sets its cooldown through
 * `swtichPhase(phase, coolDown)`, so the assignment inside that helper reads a
 * parameter and this audit cannot see what was passed. Its call sites do the
 * wrapping, and one of them deliberately passes a recast window.
 */
describe('a spell that sets its own cooldown goes through reducedCooldown', () => {
  /**
   * Recast windows that happen to be *named* like cooldowns. Each is a fixed
   * "press the key again within N ms" window, so each must stay raw.
   */
  const RECAST_WINDOWS_NAMED_LIKE_COOLDOWNS = new Set([
    // the beat after the chain shackles a victim, before the leap recast opens
    'Thresh_Q.ts#coolDownAfterHook',
    // the window to press Q again and dash to the enemy the missile hit
    'LeeSin_Q.ts#collDownAfterQ1',
    // the window in which R can be recast to swap places with the shadow
    'Zed_R.ts#coolDownBeforeSwap',
  ]);

  // `[^;]*` spans newlines, so a wrapped multi-line assignment (Janna E's
  // refund) is read whole rather than cut off at the first line break.
  const ASSIGNMENT = /this\.currentCooldown\s*=\s*([^;]*);/g;
  const COOLDOWN_FIELD = /this\.(\w*(?:cool|coll)down\w*)/gi;

  it.each(spellFiles())('$name', ({ dir, name }) => {
    const source = readFileSync(join(dir, name), 'utf8');

    for (const [assignment, rightHandSide] of source.matchAll(ASSIGNMENT)) {
      if (assignment.includes('reducedCooldown(')) continue;

      const rawFields = [...rightHandSide.matchAll(COOLDOWN_FIELD)]
        .map(match => match[1])
        // the live remaining cooldown, not a tuning number — reading it to
        // shorten it (Janna E) is not itself an unreduced cooldown
        .filter(field => field !== 'currentCooldown')
        .filter(field => !RECAST_WINDOWS_NAMED_LIKE_COOLDOWNS.has(`${name}#${field}`));

      expect(
        rawFields,
        `${name}: \`${assignment.trim()}\` starts a cooldown from a raw tuning ` +
          'field, so cooldown reduction will not apply to it. Wrap it in ' +
          '`this.reducedCooldown(...)` — or, if it is really a recast window, ' +
          'name it for that and add it to RECAST_WINDOWS_NAMED_LIKE_COOLDOWNS.'
      ).toEqual([]);
    }
  });
});
