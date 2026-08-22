import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import ActionState from '../../../src/game/enums/ActionState';
import Spell from '../../../src/game/gameObject/Spell';
import AIChampion from '../../../src/game/gameObject/attackableUnits/AIChampion';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { SpellRole, roles } from '../../../src/game/ai/SpellRole';
import { THINK_INTERVAL_MS } from '../../../src/game/ai/BotBrain';
import Game from '../../../src/game/Game';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeAhri_Q from '../../../packs/riot/spells/Ahri_Q';
import { makeZed_W_Clone } from '../../../packs/riot/spells/Zed_W';
const __api = buildContentApi();
const Ahri_Q = makeAhri_Q(__api);
const Zed_W_Clone = makeZed_W_Clone(__api);

class TestVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy() {
    return new TestVector(this.x, this.y);
  }
  set(x: number, y: number) {
    this.x = x;
    this.y = y;
    return this;
  }
  add(value: TestVector | number, y?: number) {
    this.x += typeof value === 'number' ? value : value.x;
    this.y += typeof value === 'number' ? (y ?? value) : value.y;
    return this;
  }
  sub(value: TestVector) {
    this.x -= value.x;
    this.y -= value.y;
    return this;
  }
  mult(value: number) {
    this.x *= value;
    this.y *= value;
    return this;
  }
  mag() {
    return Math.hypot(this.x, this.y);
  }
  magSq() {
    return this.x * this.x + this.y * this.y;
  }
  setMag(value: number) {
    const length = this.mag();
    if (length > 0) this.mult(value / length);
    return this;
  }
  normalize() {
    return this.setMag(1);
  }
  limit(value: number) {
    return this.mag() > value ? this.setMag(value) : this;
  }
  dist(value: TestVector) {
    return Math.hypot(this.x - value.x, this.y - value.y);
  }
  heading() {
    return Math.atan2(this.y, this.x);
  }
  rotate(angle: number) {
    const x = this.x * Math.cos(angle) - this.y * Math.sin(angle);
    this.y = this.x * Math.sin(angle) + this.y * Math.cos(angle);
    this.x = x;
    return this;
  }
  static add(a: TestVector, b: TestVector) {
    return a.copy().add(b);
  }
  static sub(a: TestVector, b: TestVector) {
    return a.copy().sub(b);
  }
  static dist(a: TestVector, b: TestVector) {
    return a.dist(b);
  }
  static fromAngle(angle: number) {
    return new TestVector(Math.cos(angle), Math.sin(angle));
  }
}

const castContext = (caster: unknown, cursorWorld = { x: 0, y: 10 }): CastContext =>
  Object.freeze({
    spellId: 'spell',
    activationId: 'activation',
    startedAtMs: 1,
    caster,
    origin: Object.freeze({ x: 0, y: 0 }),
    cursorWorld: Object.freeze({ ...cursorWorld }),
    direction: Object.freeze({ x: 0, y: 1 }),
  });

const gameWithMouse = (worldMouse = new TestVector(10, 0)) => ({
  worldMouse,
  eventManager: {
    emit: vi.fn(),
    on: vi.fn(),
    unsub: vi.fn(),
  },
  // `objects` is what `TeamBlackboard` reads to build the roster a bot decides
  // from, and what `Game.createSpellContext` hands the resolver as candidates.
  objectManager: { addObject: vi.fn(), objects: [] as unknown[] },
  mapSize: 6400,
});

const ownerFor = (game: ReturnType<typeof gameWithMouse>, id = 'owner') => ({
  id,
  game,
  position: new TestVector(0, 0),
  teamId: 'blue',
  isDead: false,
  canCast: true,
  stats: { mana: { value: 100 }, health: { value: 100 } },
});

const makeResourcesWritable = (unit: AIChampion | Zed_W_Clone) => {
  for (const resource of [unit.stats.mana, unit.stats.health]) {
    Object.defineProperty(resource, 'value', {
      configurable: true,
      get: () => resource.baseValue,
      set: (value: number) => {
        resource.baseValue = value;
      },
    });
  }
};

describe('spell aim integration', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new TestVector(x, y));
    vi.stubGlobal('p5', { Vector: TestVector });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('publishes an immutable context before pre-cast and returns fresh aim vectors', () => {
    class ProbeSpell extends Spell {
      targetingMode = 'DIRECTION' as const;
    }
    const game = gameWithMouse();
    const owner = ownerFor(game);
    const spell = new ProbeSpell(owner);
    let contextSeenAtPreCast: CastContext | undefined;
    game.eventManager.emit.mockImplementation(() => {
      contextSeenAtPreCast = spell.castContext;
    });
    const mutableCursor = { x: 0, y: 10 };
    const context = { ...castContext(owner), cursorWorld: mutableCursor };

    spell.press(context);
    mutableCursor.y = 99;
    const firstAim = spell.aimPoint as unknown as TestVector;
    firstAim.y = 50;

    expect(contextSeenAtPreCast?.cursorWorld).toEqual({ x: 0, y: 10 });
    expect(Object.isFrozen(contextSeenAtPreCast)).toBe(true);
    expect(spell.aimPoint).toMatchObject({ x: 0, y: 10 });
    expect(spell.aimPoint).not.toBe(firstAim);
  });

  it('aims a legacy directed spell from CastContext instead of game.worldMouse', () => {
    const game = gameWithMouse();
    const owner = ownerFor(game);
    const spell = new Ahri_Q(owner);

    spell.press(castContext(owner));

    const missile = game.objectManager.addObject.mock.calls[0][0];
    expect(missile.destination.x).toBeCloseTo(0);
    expect(missile.destination.y).toBeCloseTo(350);
  });

  /**
   * A bot aims at the enemy it chose, never at `game.worldMouse`. The cursor is
   * still placed in these fixtures precisely so the assertions can say "not
   * that": on a phone it is wherever the thumb is resting — the on-screen
   * control pad — so a bot that aimed by it fired at a button in the corner.
   *
   * `matchTimeMs` is one millisecond past `THINK_INTERVAL_MS` because a brain
   * decides once per interval and jitters its first tick by up to a full one:
   * a match clock past the interval is what makes a single `update()` a
   * decision whatever the jitter rolled. `deltaTime` stays an ordinary frame —
   * it is the frame *length*, and the brain no longer keeps a clock of its own.
   */
  const enemyChampion = (
    game: ReturnType<typeof gameWithMouse>,
    x: number,
    healthPct = 1
  ): Champion => {
    const enemy = new Champion({
      game,
      position: new TestVector(x, 0) as any,
      teamId: 'blue',
      preset: { spells: [] },
    });
    enemy.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
    enemy.stats.health.baseValue = enemy.stats.maxHealth.value * healthPct;
    return enemy;
  };

  const aimingAI = (
    game: ReturnType<typeof gameWithMouse>,
    enemies: Champion[] = [],
    aiRoles?: number
  ) => {
    const ai = new AIChampion({
      game,
      position: new TestVector(0, 0) as any,
      teamId: 'red',
      preset: { spells: [] },
    });
    makeResourcesWritable(ai);
    ai.destination = new TestVector(0, 20) as any;
    ai.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
    class AimSpell extends Spell {
      static aiRoles = aiRoles;
      targetingMode = 'DIRECTION' as const;
      usedAim?: p5.Vector;
      onSpellCast() {
        this.usedAim = this.aimPoint;
      }
    }
    // Slot 0 is the basic attack in a champion's kit and the brain scores from
    // slot 1, so the spell under test is the second one.
    const spell = new AimSpell(ai);
    ai.spells = [new AimSpell(ai), spell];
    ai.brain.rng = () => 0; // no aim scatter and no score noise
    game.objectManager.objects = [ai, ...enemies];
    game.matchTimeMs = THINK_INTERVAL_MS + 1;
    vi.stubGlobal('deltaTime', 16);
    return { ai, spell };
  };

  it('aims an AI press at the enemy it picked, not at the cursor or its own feet', () => {
    const game = gameWithMouse(new TestVector(300, -40));
    const { ai, spell } = aimingAI(game, [enemyChampion(game, 200)]);
    // Parked, as a bot with movement switched off is: destination sits on its
    // own position, which is where the deleted aim fell back to.
    ai._autoMove = false;
    ai.destination = new TestVector(ai.position.x, ai.position.y) as any;

    ai.update();

    expect(spell.usedAim).toMatchObject({ x: 200, y: 0 });
  });

  it('casts nothing while it is roaming, even a spell it would otherwise want', () => {
    // The deleted code rolled `random() < 0.1` every frame and fired whatever
    // came up at the cursor. A self-buff scores 5 with no target at all, so the
    // posture gate in `maybeCast` is the only thing holding this one back.
    const { ai, spell } = aimingAI(
      gameWithMouse(new TestVector(900, 900)),
      [],
      roles(SpellRole.Buff)
    );

    ai.update();

    expect(spell.usedAim).toBeUndefined();
  });

  it.each(['HOLD_RELEASE', 'TAP_OR_HOLD'] as const)(
    'releases AI %s casts at a deterministic charge instead of timing out',
    activation => {
      const game = gameWithMouse();
      const ai = new AIChampion({
        game,
        position: new TestVector(0, 0) as any,
        teamId: 'red',
        preset: { spells: [] },
      });
      makeResourcesWritable(ai);
      ai.destination = new TestVector(0, 20) as any;
      ai.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
      class ChargedSpell extends Spell {
        releases = 0;
        get castSpec() {
          return {
            activation,
            targeting: 'DIRECTION' as const,
            charge: { maxDurationMs: 100, releaseAtMax: false },
            resource: { commitAt: 'start' as const, refundOn: [] },
            cooldown: { startAt: 'end' as const, durationMs: 0 },
            interrupts: { move: false },
          };
        }
        onRelease() {
          this.releases += 1;
        }
      }
      const spell = new ChargedSpell(ai);
      ai.spells = [new ChargedSpell(ai), spell];
      ai.brain.rng = () => 0;
      // Something to fight: a damage spell scores nothing without a target, so
      // a bot alone on the map now correctly never presses this at all.
      game.objectManager.objects = [ai, enemyChampion(game, 200)];
      game.matchTimeMs = THINK_INTERVAL_MS + 1;
      vi.stubGlobal('deltaTime', 50);

      ai.update();
      expect(spell.state).toBe('CHARGING');
      ai.update();
      expect(spell.releases).toBe(1);
    }
  );

  it('a bot killed mid-charge stops charging instead of firing from its corpse', () => {
    const game = gameWithMouse();
    const ai = new AIChampion({
      game,
      position: new TestVector(0, 0) as any,
      teamId: 'red',
      preset: { spells: [] },
    });
    makeResourcesWritable(ai);
    ai.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
    class ChargedSpell extends Spell {
      releases = 0;
      get castSpec() {
        return {
          activation: 'HOLD_RELEASE' as const,
          targeting: 'DIRECTION' as const,
          charge: { maxDurationMs: 4000, releaseAtMax: false },
          resource: { commitAt: 'start' as const, refundOn: [] },
          cooldown: { startAt: 'end' as const, durationMs: 0 },
          interrupts: { move: false },
        };
      }
      onRelease() {
        this.releases += 1;
      }
    }
    const spell = new ChargedSpell(ai);
    ai.spells = [new ChargedSpell(ai), spell];
    ai.brain.rng = () => 0;
    game.objectManager.objects = [ai, enemyChampion(game, 200)];
    game.matchTimeMs = THINK_INTERVAL_MS + 1;
    vi.stubGlobal('deltaTime', 50);

    ai.update();
    expect(spell.state).toBe('CHARGING');

    const hold = vi.spyOn(spell, 'hold');
    ai.die({ reviveAfter: 999_999 });
    ai.update();

    expect(hold).not.toHaveBeenCalled();
    expect(spell.releases).toBe(0);
  });

  describe.each(['HOLD_RELEASE', 'TAP_OR_HOLD'] as const)(
    'Zed shadow mirroring a %s cast',
    activation => {
      class ChargedSpell extends Spell {
        releases = 0;
        cancels = 0;
        get castSpec() {
          return {
            activation,
            targeting: 'DIRECTION' as const,
            charge: { maxDurationMs: 4000, releaseAtMax: false },
            resource: { commitAt: 'start' as const, refundOn: [] },
            cooldown: { startAt: 'end' as const, durationMs: 0 },
            interrupts: { move: false },
          };
        }
        onRelease() {
          this.releases += 1;
        }
        onCancel() {
          this.cancels += 1;
        }
      }

      const chargingShadow = () => {
        const game = gameWithMouse();
        const owner = ownerFor(game);
        const source = new ChargedSpell(owner);
        source.press(castContext(owner));

        const clone = new Zed_W_Clone({
          game,
          position: new TestVector(5, 5),
          teamId: 'blue',
        } as any);
        makeResourcesWritable(clone);
        clone.owner = owner;
        clone.onSomeOnePreCastSpell(source);
        clone.onAdded();
        clone.buffs[clone.buffs.length - 1].onReachedDestination();

        const entry = clone._mapSpells[source.id];
        expect((entry.clone as ChargedSpell).state).toBe('CHARGING');
        return { clone, entry, source, replay: entry.clone as ChargedSpell };
      };

      it('holds while the player holds, then fires when the player fires', () => {
        const { clone, entry, source, replay } = chargingShadow();

        clone.mirrorCharge(entry);
        expect(replay.releases).toBe(0);
        expect(replay.state).toBe('CHARGING');

        source.release(source.castContext!);
        clone.onSomeOnePostCastSpell(source);
        clone.mirrorCharge(entry);

        expect(replay.releases).toBe(1);
        expect(replay.cancels).toBe(0);
      });

      it('fizzles with the player instead of casting on its own', () => {
        const { clone, entry, source, replay } = chargingShadow();

        source.cancel('MAX_DURATION');
        clone.mirrorCharge(entry);

        expect(replay.releases).toBe(0);
        expect(replay.cancels).toBe(1);
      });
    }
  );

  it('aims an AI UNIT cast at the enemy the brain picked, not the nearest body', () => {
    const untargetable = {
      position: new TestVector(50, 0),
      collisionRadius: 25,
      teamId: 'blue',
      targetable: false,
    };
    const game = Object.assign(gameWithMouse(new TestVector(0, -400)), {
      createSpellContext: Game.prototype.createSpellContext,
    });
    // The nearest body is not the one worth killing, and that is the point: the
    // resolver takes whoever the aim points at, so this only lands on `wounded`
    // if the aim came from the brain's own target choice.
    const nearest = enemyChampion(game, 100);
    const wounded = enemyChampion(game, 350, 0.1);
    const ai = new AIChampion({
      game,
      position: new TestVector(0, 0) as any,
      teamId: 'red',
      preset: { spells: [] },
    });
    makeResourcesWritable(ai);
    ai._autoMove = false;
    ai.destination = new TestVector(0, 500) as any;
    ai.stats.actionState = ActionState.CAN_CAST | ActionState.TARGETABLE;
    class UnitSpell extends Spell {
      usedTarget?: unknown;
      get castSpec() {
        return {
          activation: 'PRESS' as const,
          targeting: 'UNIT' as const,
          resource: { commitAt: 'start' as const, refundOn: [] },
          cooldown: { startAt: 'start' as const, durationMs: 0 },
        };
      }
      get targetingRequest() {
        return {
          range: 500,
          targetTeam: 'ENEMY' as const,
        };
      }
      onSpellCast(context: CastContext) {
        this.usedTarget = context.target;
      }
    }
    const spell = new UnitSpell(ai);
    ai.spells = [new UnitSpell(ai), spell];
    ai.brain.rng = () => 0;
    game.objectManager.objects = [ai, untargetable, nearest, wounded];
    game.matchTimeMs = THINK_INTERVAL_MS + 1;
    vi.stubGlobal('deltaTime', 16);

    ai.update();

    expect(spell.usedTarget).toBe(wounded);
  });

  it('follows the live cursor only while the PLAYER charges, never a bot', () => {
    // `aimPoint`'s CHARGING branch is the player's own charge preview, and it
    // was the one place in this method chain that forgot the owner check
    // `onChargeUpdate` and `onRelease` below it both make. A bot charging a
    // HOLD_RELEASE spell read the human's pointer — on a phone, the on-screen
    // control pad. The seam scan cannot cover `Spell.ts`, which legitimately
    // reads `worldMouse` for the player, so this test is the whole guard.
    class ChargedSpell extends Spell {
      get castSpec() {
        return {
          activation: 'HOLD_RELEASE' as const,
          targeting: 'DIRECTION' as const,
          charge: { maxDurationMs: 4000, releaseAtMax: false },
          resource: { commitAt: 'start' as const, refundOn: [] },
          cooldown: { startAt: 'end' as const, durationMs: 0 },
          interrupts: { move: false },
        };
      }
    }
    const worldMouse = new TestVector(10, 0);
    const game = gameWithMouse(worldMouse);
    const player = ownerFor(game, 'player');
    Object.assign(game, { player });
    const bot = ownerFor(game, 'bot');

    const botSpell = new ChargedSpell(bot);
    const playerSpell = new ChargedSpell(player);
    botSpell.press(castContext(bot));
    playerSpell.press(castContext(player));
    expect(botSpell.state).toBe('CHARGING');
    expect(playerSpell.state).toBe('CHARGING');

    worldMouse.set(900, 900);

    expect(botSpell.aimPoint).toMatchObject({ x: 0, y: 10 }); // its cast context
    expect(playerSpell.aimPoint).toMatchObject({ x: 900, y: 900 }); // the drag
  });

  it('creates player contexts from the actual spell targeting mode', () => {
    const caster = ownerFor(gameWithMouse(new TestVector(100, 0)));
    const target = {
      position: new TestVector(100, 0),
      collisionRadius: 20,
      teamId: 'red',
      targetable: true,
    };
    class UnitSpell extends Spell {
      get castSpec() {
        return {
          activation: 'PRESS' as const,
          targeting: 'UNIT' as const,
          resource: { commitAt: 'start' as const, refundOn: [] },
          cooldown: { startAt: 'start' as const, durationMs: 0 },
        };
      }
      get targetingRequest() {
        return { range: 500, targetTeam: 'ENEMY' as const };
      }
    }
    const game = Object.assign(Object.create(Game.prototype), {
      worldMouse: new TestVector(100, 0),
      objectManager: { objects: [target] },
    }) as Game;
    const spell = new UnitSpell(caster);

    expect(game.createSpellContext(spell, caster, game.worldMouse)).toMatchObject({ target });
    // Past CURSOR_ACQUISITION_RADIUS and still acquired: the circle around the
    // cursor ranks candidates, it no longer excludes them. A unit inside the
    // spell's range is always castable at — pointing away from it used to make
    // the key do nothing at all, which read as the ability being broken.
    game.worldMouse.x = 400;
    expect(game.createSpellContext(spell, caster, game.worldMouse)).toMatchObject({ target });
  });

  it('replays a pending Zed shadow cast without mutating worldMouse', () => {
    const worldMouse = new TestVector(10, 0);
    const game = gameWithMouse(worldMouse);
    const owner = ownerFor(game);
    class MirroredSpell extends Spell {
      targetingMode = 'DIRECTION' as const;
      usedContext?: CastContext;
      onSpellCast(context: CastContext) {
        this.usedContext = context;
      }
    }
    const source = new MirroredSpell(owner);
    source.press(castContext(owner));

    const clone = new Zed_W_Clone({
      game,
      position: new TestVector(5, 5),
      teamId: 'blue',
    } as any);
    makeResourcesWritable(clone);
    clone.owner = owner;
    clone.onSomeOnePreCastSpell(source);
    clone.onAdded();
    const dash = clone.buffs[clone.buffs.length - 1];
    dash.onReachedDestination();

    const replay = clone._mapSpells[source.id].clone as MirroredSpell;
    expect(game.worldMouse).toBe(worldMouse);
    expect(replay.usedContext?.cursorWorld).toEqual({ x: 0, y: 10 });
    expect(replay.usedContext?.origin).toEqual({ x: 5, y: 5 });
    expect(replay.usedContext?.caster).toBe(clone);
    expect(replay.usedContext?.direction.x).toBeCloseTo(-Math.SQRT1_2);
    expect(replay.usedContext?.direction.y).toBeCloseTo(Math.SQRT1_2);

    const coincidentReplay = new MirroredSpell(clone);
    clone.pressClone(
      { clone: coincidentReplay, source: coincidentReplay, sourceReleased: false },
      castContext(owner, { x: 5, y: 5 })
    );
    expect(coincidentReplay.usedContext?.direction).toEqual({ x: 0, y: 0 });
  });

  // "keeps shared worldMouse out of spell activation code" used to live
  // here, hand-scanning `packs/riot/spells/` directly for
  // `this.game.worldMouse`. Content-pack-extraction batch 5 task 6 fix
  // round 1: that population is 100% pack content (core's own
  // `coreSpells/`, `spellObjects/` and `buffs/` read `worldMouse` nowhere),
  // so the check had nothing core-specific left to prove and was a straight
  // duplicate of `src/seams/worldMouseInSpellCode.ts`, exercised for real by
  // `packs/riot`'s own `check-seams` script (that tree's own
  // `seam-debt.mjs` pins the same known offender by file, line *and* the
  // line's own code — per-line rather than per-file, and since fix round 4
  // per-line-content rather than per-line-number). Removed rather than left
  // to duplicate the pack's own gate.
});
