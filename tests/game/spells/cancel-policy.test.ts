import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: () => undefined,
    getAsset: () => undefined,
    ensure: () => Promise.resolve(),
    // Garen W has no icon on the Wiki, so it declares a placeholder rather
    // than borrowing someone else's art — see docs/ADDING_SPELLS.md §6.
    placeholder: () => ({ url: '', status: 'ready' }),
  },
}));
import * as CoreSpells from '../../../src/game/gameObject/coreSpells/index';
import Spell from '../../../src/game/gameObject/Spell';
import Stats from '../../../src/game/gameObject/Stats';
import StatusFlags from '../../../src/game/enums/StatusFlags';
import Stasis from '../../../src/game/gameObject/buffs/Stasis';
import BasicAttack from '../../../src/game/gameObject/coreSpells/BasicAttack';
import {
  SPELL_FORM_NAMES,
  SpellForm,
  interruptSwitchFor,
  spellFormNameOf,
  type SpellFormName,
} from '../../../src/game/spell/runtime/CancelPolicy';
import type { CancelReason, CastContext, CastSpec } from '../../../src/game/spell/runtime/types';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeJanna_Q from '../../../packs/riot/spells/Janna_Q';
import makeAnivia_R from '../../../packs/riot/spells/Anivia_R';
import makeRammus_Q, { makeRammus_Q_Object } from '../../../packs/riot/spells/Rammus_Q';
import * as AllSpellFactories from '../../../packs/riot/spells/index';
const __api = buildContentApi();
const Janna_Q = makeJanna_Q(__api);
const Anivia_R = makeAnivia_R(__api);
const Rammus_Q = makeRammus_Q(__api);
const Rammus_Q_Object = makeRammus_Q_Object(__api);
// Every pack spell's `default` export is now a factory (batch 4 task 3) —
// resolved once so `AllSpells.Varus_Q` etc. below stay plain classes.
const AllSpells: Record<string, unknown> = Object.fromEntries(
  Object.entries(AllSpellFactories).map(([id, factory]) => [
    id,
    typeof factory === 'function' ? (factory as (api: typeof __api) => unknown)(__api) : factory,
  ])
);

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
  add(vector: TestVector): this {
    this.x += vector.x;
    this.y += vector.y;
    return this;
  }
  mult(value: number): this {
    this.x *= value;
    this.y *= value;
    return this;
  }
  dist(vector: TestVector): number {
    return Math.hypot(this.x - vector.x, this.y - vector.y);
  }
}

const owner = () => ({
  game: {
    eventManager: { emit: vi.fn(), on: vi.fn(() => vi.fn()) },
    worldMouse: new TestVector(100, 0),
    objectManager: { addObject: vi.fn(), queryObjects: vi.fn(() => []) },
  },
  position: new TestVector(0, 0),
  destination: new TestVector(0, 0),
  teamId: 'blue',
  isDead: false,
  canCast: true,
  status: StatusFlags.None,
  movementRevision: 0,
  displacementRevision: 0,
  animatedValues: { displaySize: 55 },
  bodyRadius: 27.5,
  collisionRadius: 25,
  buffs: [] as unknown[],
  addBuff: vi.fn(),
  hasBuff: vi.fn(() => false),
  updateBuffs: vi.fn(),
  basicAttack: { target: {} as unknown, clear: vi.fn() },
  stats: new Stats(),
});

type TestOwner = ReturnType<typeof owner>;

const context = (caster: TestOwner): CastContext =>
  Object.freeze({
    spellId: 'spell',
    activationId: 'activation',
    startedAtMs: 0,
    caster,
    origin: Object.freeze({ x: 0, y: 0 }),
    cursorWorld: Object.freeze({ x: 100, y: 0 }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

/** The caster states the watcher turns into each governed reason. */
const applyReason: Record<string, (caster: TestOwner) => void> = {
  DEATH: caster => {
    caster.isDead = true;
  },
  STUN: caster => {
    caster.status |= StatusFlags.Stunned;
  },
  SILENCE: caster => {
    caster.status |= StatusFlags.Silenced;
  },
  DISPLACEMENT: caster => {
    caster.displacementRevision += 1;
  },
  MOVE: caster => {
    caster.movementRevision += 1;
  },
};

class FormSpell extends Spell {
  cancelled: CancelReason[] = [];
  constructor(
    casterUnit: TestOwner,
    private readonly form: SpellFormName
  ) {
    super(casterUnit);
  }
  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 5_000,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: 0 },
      interrupts: SpellForm[this.form],
    };
  }
  onCancel(_context: CastContext, reason: CancelReason): void {
    this.cancelled.push(reason);
  }
}

/**
 * Every spell class the game can put in a slot.
 *
 * `BasicAttack` is included — it is always slot 0.
 */
const productionSpells = Object.entries({ ...AllSpells, ...CoreSpells }).filter(
  (entry): entry is [string, typeof Spell] =>
    typeof entry[1] === 'function' && entry[1].prototype instanceof Spell
);

describe('cancel policy, driven through real spells', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', (a = 1, b?: number) => (b === undefined ? a * 0.5 : (a + b) / 2));
    vi.stubGlobal('constrain', (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v))
    );
    vi.stubGlobal('lerp', (a: number, b: number, t: number) => a + (b - a) * t);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  for (const form of SPELL_FORM_NAMES) {
    for (const reason of Object.keys(applyReason) as (keyof typeof applyReason)[]) {
      const expected = SpellForm[form][interruptSwitchFor(reason as CancelReason)!];

      it(`a ${form} spell ${expected ? 'ends on' : 'survives'} ${reason} on its caster`, () => {
        const caster = owner();
        const spell = new FormSpell(caster, form);
        spell.press(context(caster));
        expect(spell.state).toBe('CASTING');

        applyReason[reason](caster);
        spell.update();

        expect(spell.cancelled).toEqual(expected ? [reason] : []);
        expect(spell.state).toBe(expected ? 'READY' : 'CASTING');
      });
    }
  }

  it('has every production spell state one of the named forms', () => {
    const declared = productionSpells.map(([name, SpellClass]) => {
      const instance = new SpellClass(undefined);
      return [name, spellFormNameOf(instance.castSpec.interrupts)] as const;
    });

    for (const [name, form] of declared) {
      expect(form, `${name} declares an interrupt table that is not a named form`).toBeDefined();
    }
  });

  it('keeps the roster of spells that are not plain HELD casts', () => {
    const exceptions = productionSpells
      .map(
        ([name, SpellClass]) =>
          [name, spellFormNameOf(new SpellClass(undefined).castSpec.interrupts)] as const
      )
      .filter(([, form]) => form !== 'HELD')
      .map(([name, form]) => `${name}: ${form}`)
      .sort();

    expect(exceptions).toEqual([
      'Anivia_R: TETHERED',
      // Decimate: the wiki is explicit that Darius may walk through the wind-up,
      // so stepping forward is part of the gesture; crowd control still takes it.
      'Darius_Q: AIMED',
      // Flawless Duet: the first blade is standing out in the world waiting for
      // its partner, and walking between the two presses is the ability. Losing
      // control of herself still drops it.
      'Irelia_E: TETHERED',
      // Defiance roots her outright for the wind-up, so the move interrupt is
      // not a gesture allowance but the opposite: `movementRevision` ticks on
      // the *order*, before `canMove` is ever consulted, so HELD would end the
      // charge on a right click she was in no position to obey. Crowd control
      // and displacement still take it.
      'Irelia_W: AIMED',
      'Janna_Q: INDEPENDENT',
      // Curtain Call: the four shots are fired from a set position over a 6s
      // window, and walking between them is part of the performance. Crowd
      // control still ends it, which is the whole counterplay.
      'Jhin_R: AIMED',
      'Lux_R: INDEPENDENT',
      'Pantheon_Q: AIMED',
      'Rammus_Q: INDEPENDENT',
      // Slice and Dice spends its ACTIVE window as a recast timer over a dash
      // that already has its momentum — the Dash buff owns being interrupted.
      'Renekton_E: INDEPENDENT',
      // Blade of the Exile is a 9s empower she has to fight through; a silence
      // landing halfway must not confiscate the reforged blade, and the Wind
      // Slash recast is gated on the window rather than on holding still.
      'Riven_R: INDEPENDENT',
      // Force of Will holds a seized sphere over her head: out in the world and
      // leashed to her, so she may walk and be shoved, and losing control of
      // herself drops it.
      'Syndra_W: TETHERED',
      'Varus_Q: AIMED',
      // Vault Breaker charges while strafing, the same gesture as Varus Q.
      'Vi_Q: AIMED',
      // The satchel is already stuck in the ground on its own 4s fuse, and the
      // detonation knocks Ziggs himself back — a form that ended on being
      // shoved would have the ability cancel itself.
      'Ziggs_W: INDEPENDENT',
    ]);
  });
});

describe('what casting does to a standing attack order', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('drops the order for an ability', () => {
    const caster = owner();
    new FormSpell(caster, 'HELD').press(context(caster));

    expect(caster.basicAttack.clear).toHaveBeenCalledOnce();
  });

  it('keeps the order for the basic attack, because casting it is the order', () => {
    const caster = owner();
    const attack = new BasicAttack(caster);
    attack.acquire = () => null;
    attack.press(context(caster));

    expect(caster.basicAttack.clear).not.toHaveBeenCalled();
  });

  it('leaves the order alone when the cast was refused', () => {
    const caster = owner();
    const spell = new FormSpell(caster, 'HELD');
    caster.canCast = false;

    expect(spell.press(context(caster))).toBe(false);
    expect(caster.basicAttack.clear).not.toHaveBeenCalled();
  });
});

describe('the three cases the forms exist for', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', (a = 1, b?: number) => (b === undefined ? a * 0.5 : (a + b) / 2));
    vi.stubGlobal('constrain', (v: number, lo: number, hi: number) =>
      Math.min(hi, Math.max(lo, v))
    );
    vi.stubGlobal('lerp', (a: number, b: number, t: number) => a + (b - a) * t);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => vi.unstubAllGlobals());

  // A summoned object already standing in the world.
  it('leaves Janna Q standing when Janna is stunned, and takes it when she dies', () => {
    const caster = owner();
    const stunned = new Janna_Q(caster);
    stunned.press(context(caster));
    expect(stunned.state).toBe('ACTIVE');
    caster.status |= StatusFlags.Stunned;
    stunned.update();
    expect(stunned.state).toBe('ACTIVE');

    const dying = owner();
    const withCaster = new Janna_Q(dying);
    withCaster.press(context(dying));
    dying.isDead = true;
    withCaster.update();
    expect(withCaster.state).toBe('COOLDOWN');
    expect(withCaster.spellObject).toBeNull();
  });

  // A held cast: the champion is physically drawing the shot.
  it('takes Varus Q away on a stun but not on a move order', () => {
    const walking = owner();
    const drawn = new AllSpells.Varus_Q(walking);
    drawn.press(context(walking));
    expect(drawn.state).toBe('CHARGING');
    walking.movementRevision += 1;
    drawn.update();
    expect(drawn.state).toBe('CHARGING');

    walking.status |= StatusFlags.Stunned;
    drawn.update();
    expect(drawn.state).not.toBe('CHARGING');
  });

  // A self effect that ends on its own terms.
  it('keeps Rammus rolling through a stun and ends the roll on contact', () => {
    const caster = owner();
    const roll = new Rammus_Q(caster);
    roll.press(context(caster));
    expect(roll.state).toBe('ACTIVE');

    caster.status |= StatusFlags.Stunned | StatusFlags.Silenced;
    roll.update();
    expect(roll.state).toBe('ACTIVE');
    expect(roll.rollObject?.toRemove).toBeFalsy();

    roll.endRoll();
    expect(roll.state).toBe('COOLDOWN');
    expect(roll.rollObject).toBeNull();
  });

  it('hands the ball a way to close the spell when it connects', () => {
    const caster = owner();
    const roll = new Rammus_Q(caster);
    roll.press(context(caster));
    const ball = caster.game.objectManager.addObject.mock.calls
      .map(call => call[0])
      .find((object: unknown): object is Rammus_Q_Object => object instanceof Rammus_Q_Object);

    expect(ball?.spell).toBe(roll);
  });

  // A tethered effect, and the one buff that suspends rather than interrupts.
  it('ends Anivia R on a stun, unless she is in stasis', () => {
    const stunned = owner();
    const storm = new Anivia_R(stunned);
    storm.press(context(stunned));
    expect(storm.state).toBe('ACTIVE');
    stunned.status |= StatusFlags.Stunned;
    storm.update();
    expect(storm.state).toBe('COOLDOWN');

    const frozen = owner();
    frozen.hasBuff = vi.fn((buffClass: unknown) => buffClass === Stasis);
    const suspended = new Anivia_R(frozen);
    suspended.press(context(frozen));
    frozen.status |= StatusFlags.Stunned;
    frozen.canCast = false;
    suspended.update();
    expect(suspended.state).toBe('ACTIVE');
  });
});
