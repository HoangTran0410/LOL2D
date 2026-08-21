import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: () => undefined,
    getAsset: () => undefined,
    placeholder: () => undefined,
    renderable: () => undefined,
    ensure: () => Promise.resolve(undefined),
    ensureMany: () => Promise.resolve(undefined),
  },
}));

import { Circle } from '../../../src/libs/quadtree';
import {
  DEFAULT_BODY_RADIUS,
  bodyRadiusOf,
  bodyReachBonus,
  effectiveRange,
  withinRange,
} from '../../../src/game/combat/Reach';
import { DEFAULT_UNIT_SIZE, MAX_UNIT_SIZE } from '../../../src/game/gameObject/Stats';
import ObjectManager, { PredefinedFilters } from '../../../src/game/managers/ObjectManager';
import TargetResolver from '../../../src/game/spell/targeting/TargetResolver';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import { Rectangle } from '../../../src/libs/quadtree';
import EventManager from '../../../src/managers/EventManager';
import { TestVector, installSpellObjectGlobals } from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeAlistar_W from '../../../packs/riot/spells/Alistar_W';
import makeChoGath_R from '../../../packs/riot/spells/ChoGath_R';
import makeIgnite from '../../../packs/riot/spells/Ignite';
import makeLeeSin_R from '../../../packs/riot/spells/LeeSin_R';
import makeLeeSin_W from '../../../packs/riot/spells/LeeSin_W';
import makeNasus_Q from '../../../packs/riot/spells/Nasus_Q';
import makeNocturne_R from '../../../packs/riot/spells/Nocturne_R';
import { makeRammus_Q_Object } from '../../../packs/riot/spells/Rammus_Q';
import makeShaco_E from '../../../packs/riot/spells/Shaco_E';
import makeWarwick_Q from '../../../packs/riot/spells/Warwick_Q';
import makeZed_R from '../../../packs/riot/spells/Zed_R';
const __api = buildContentApi();
const Alistar_W = makeAlistar_W(__api);
const ChoGath_R = makeChoGath_R(__api);
const Ignite = makeIgnite(__api);
const LeeSin_R = makeLeeSin_R(__api);
const LeeSin_W = makeLeeSin_W(__api);
const Nasus_Q = makeNasus_Q(__api);
const Nocturne_R = makeNocturne_R(__api);
const Rammus_Q_Object = makeRammus_Q_Object(__api);
const Shaco_E = makeShaco_E(__api);
const Warwick_Q = makeWarwick_Q(__api);
const Zed_R = makeZed_R(__api);

/**
 * The size an enemy's centre is held at by body separation, which is what a
 * caster-centred range has to clear before it can select anybody at all.
 * `UnitCollisionSystem` pushes until `bodyRadius(a) + bodyRadius(b)`.
 */
const separationGap = (casterSize: number, targetSize: number): number =>
  casterSize / 2 + targetSize / 2;

const sized = (size: number, x = 0, y = 0) => ({
  position: new TestVector(x, y),
  stats: { size: { value: size } },
});

interface QueriedArea {
  readonly r: number;
}

/** A caster whose object manager records the circles its spells ask for. */
function createProbeCaster(size: number) {
  const queried: QueriedArea[] = [];
  const owner = {
    position: new TestVector(0, 0),
    destination: new TestVector(0, 0),
    teamId: 'blue',
    isDead: false,
    stats: { size: { value: size } },
    bodyRadius: size / 2,
    moveTo: vi.fn(),
    game: {
      worldMouse: { x: 0, y: 0 },
      eventManager: new EventManager(),
      objectManager: {
        addObject: vi.fn(),
        queryObjects: (options: { area?: QueriedArea }) => {
          if (options.area) queried.push(options.area);
          return [];
        },
      },
    },
  };
  return { owner, queried };
}

/**
 * Every spell whose selection radius can be provoked with one call. The
 * function is what actually issues the query; `range` is the number the spell
 * was authored with, read off the instance rather than copied here so a retune
 * does not have to touch this file.
 */
const selectionSpells: readonly {
  name: string;
  build: (owner: unknown) => { range: number; select: () => unknown };
}[] = [
  {
    name: 'LeeSin_R',
    build: owner => {
      const spell = new LeeSin_R(owner);
      return { range: spell.rangeToCheckEnemies, select: () => spell.onSpellCast() };
    },
  },
  {
    name: 'Warwick_Q',
    build: owner => {
      const spell = new Warwick_Q(owner);
      return { range: spell.range, select: () => spell.findNearestEnemy() };
    },
  },
  {
    name: 'Alistar_W',
    build: owner => {
      const spell = new Alistar_W(owner);
      return { range: spell.range, select: () => spell.findNearestEnemy() };
    },
  },
  {
    name: 'ChoGath_R',
    build: owner => {
      const spell = new ChoGath_R(owner);
      return { range: spell.range, select: () => spell.findVictim() };
    },
  },
  {
    name: 'Nasus_Q',
    build: owner => {
      const spell = new Nasus_Q(owner);
      return { range: spell.range, select: () => spell.findVictim() };
    },
  },
  {
    name: 'Ignite',
    build: owner => {
      const spell = new Ignite(owner);
      return { range: spell.range, select: () => spell._findNearestEnemy() };
    },
  },
  {
    name: 'Shaco_E',
    build: owner => {
      const spell = new Shaco_E(owner);
      return { range: spell.range, select: () => spell.checkCastCondition() };
    },
  },
  {
    name: 'Zed_R',
    build: owner => {
      const spell = new Zed_R(owner);
      return { range: spell.range, select: () => spell._findTarget() };
    },
  },
  {
    name: 'Nocturne_R',
    build: owner => {
      const spell = new Nocturne_R(owner);
      return { range: spell.leapRange, select: () => spell.findLeapTarget() };
    },
  },
  {
    name: 'LeeSin_W',
    build: owner => {
      const spell = new LeeSin_W(owner);
      return { range: spell.range, select: () => spell.findNearestAlly() };
    },
  },
];

describe('size-aware reach', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('the rule itself', () => {
    it('derives the default body from the champion default in Stats', () => {
      expect(DEFAULT_BODY_RADIUS).toBe(DEFAULT_UNIT_SIZE / 2);
    });

    it('is a no-op between two default bodies', () => {
      const caster = sized(DEFAULT_UNIT_SIZE);
      const target = sized(DEFAULT_UNIT_SIZE);

      for (const authored of [80, 150, 200, 350, 500, 1_200]) {
        expect(effectiveRange(authored, caster, target)).toBe(authored);
      }
    });

    it('adds the caster excess and nothing else', () => {
      const grown = sized(MAX_UNIT_SIZE);
      const excess = MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS;

      expect(bodyReachBonus(grown)).toBe(excess);
      expect(effectiveRange(80, grown, sized(DEFAULT_UNIT_SIZE))).toBe(80 + excess);
    });

    it('adds the target excess too, so a grown victim is still reachable', () => {
      const excess = MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS;

      expect(effectiveRange(80, sized(DEFAULT_UNIT_SIZE), sized(MAX_UNIT_SIZE))).toBe(80 + excess);
      expect(effectiveRange(80, sized(MAX_UNIT_SIZE), sized(MAX_UNIT_SIZE))).toBe(80 + excess * 2);
    });

    it('never lets a body smaller than default shorten a spell', () => {
      const minion = sized(34);
      const wisp = sized(1);

      expect(bodyReachBonus(minion)).toBe(0);
      expect(bodyReachBonus(wisp)).toBe(0);
      expect(effectiveRange(80, sized(DEFAULT_UNIT_SIZE), minion)).toBe(80);
      expect(effectiveRange(80, wisp, wisp)).toBe(80);
    });

    it('treats an unreadable body as a default one', () => {
      expect(bodyRadiusOf(undefined)).toBe(DEFAULT_BODY_RADIUS);
      expect(bodyRadiusOf(null)).toBe(DEFAULT_BODY_RADIUS);
      expect(bodyRadiusOf({})).toBe(DEFAULT_BODY_RADIUS);
      expect(effectiveRange(80)).toBe(80);
    });

    it('accepts a radius already in hand', () => {
      expect(bodyRadiusOf(MAX_UNIT_SIZE / 2)).toBe(MAX_UNIT_SIZE / 2);
      expect(effectiveRange(80, MAX_UNIT_SIZE / 2, DEFAULT_BODY_RADIUS)).toBe(
        80 + MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS
      );
    });
  });

  describe('withinRange, for sites that measure centre to centre themselves', () => {
    it('matches the authored range exactly between default bodies', () => {
      const caster = sized(DEFAULT_UNIT_SIZE, 0, 0);

      expect(withinRange(500, caster, sized(DEFAULT_UNIT_SIZE, 500, 0))).toBe(true);
      expect(withinRange(500, caster, sized(DEFAULT_UNIT_SIZE, 501, 0))).toBe(false);
    });

    it('reaches further once a body has grown', () => {
      const grown = sized(MAX_UNIT_SIZE, 0, 0);

      expect(withinRange(500, grown, sized(DEFAULT_UNIT_SIZE, 520, 0))).toBe(true);
      expect(withinRange(500, sized(DEFAULT_UNIT_SIZE, 0, 0), sized(MAX_UNIT_SIZE, 520, 0))).toBe(
        true
      );
      expect(
        withinRange(500, sized(DEFAULT_UNIT_SIZE, 0, 0), sized(DEFAULT_UNIT_SIZE, 520, 0))
      ).toBe(false);
    });

    it('calls a unit with no position out of range rather than at the origin', () => {
      expect(withinRange(500, sized(DEFAULT_UNIT_SIZE), {})).toBe(false);
      expect(withinRange(500, {}, sized(DEFAULT_UNIT_SIZE))).toBe(false);
    });
  });

  // The regression guard that matters most: at default size every migrated
  // spell must still ask for exactly the number it was authored with.
  describe('no balance drift at default size', () => {
    for (const spell of selectionSpells) {
      it(`${spell.name} queries its authored range unchanged`, () => {
        const { owner, queried } = createProbeCaster(DEFAULT_UNIT_SIZE);
        const { range, select } = spell.build(owner);

        select();

        expect(queried).toHaveLength(1);
        expect(queried[0].r).toBe(range);
      });
    }
  });

  describe('a grown caster keeps its reach', () => {
    for (const spell of selectionSpells) {
      it(`${spell.name} widens by the caster excess only`, () => {
        const { owner, queried } = createProbeCaster(MAX_UNIT_SIZE);
        const { range, select } = spell.build(owner);

        select();

        expect(queried[0].r).toBe(range + MAX_UNIT_SIZE / 2 - DEFAULT_BODY_RADIUS);
      });
    }
  });
});

/**
 * Lee Sin R is the spell the bug killed outright: 80 units from the caster's
 * centre, against a separation that parks a full-size Cho'Gath's victim 110
 * away. These drive the real quadtree, so the query's own surface test against
 * the victim's body is part of the answer.
 */
describe('Lee Sin R reaches past body separation', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function createWorld() {
    const camera = {
      getBoundingBox: () => new Rectangle({ x: -5_000, y: -5_000, w: 10_000, h: 10_000 }),
    };
    return new ObjectManager({ mapSize: 10_000, camera });
  }

  /** Runs Lee Sin R's own query against a real world without letting the rest
   *  of the cast run: the spell sees an empty result and refunds itself. */
  function whatLeeSinRWouldFind(casterSize: number, victimSize: number) {
    const manager = createWorld();
    const game = {
      mapSize: 10_000,
      camera: {
        getBoundingBox: () => new Rectangle({ x: -5_000, y: -5_000, w: 10_000, h: 10_000 }),
      },
      objectManager: manager,
      eventManager: new EventManager(),
      player: { teamId: 'blue' },
      randomSpawnPoint: () => createVector(),
      createSpellContext: () => undefined,
      worldMouse: { x: 1_000, y: 0 },
    };

    const gap = separationGap(casterSize, victimSize);
    const victim = new AttackableUnit({
      game: game as never,
      position: createVector(gap, 0),
      teamId: 'red',
    });
    victim.stats.size.baseValue = victimSize;
    victim.animatedValues.size = victimSize;

    manager.objects = [victim];
    manager._objectsTree.clear();
    manager._objectsTree.insert(victim.getDisplayBoundingBox());

    const found: unknown[] = [];
    const owner = {
      position: new TestVector(0, 0),
      teamId: 'blue',
      isDead: false,
      stats: { size: { value: casterSize } },
      bodyRadius: casterSize / 2,
      moveTo: vi.fn(),
      game: {
        ...game,
        objectManager: {
          addObject: vi.fn(),
          queryObjects: (options: Parameters<ObjectManager['queryObjects']>[0]) => {
            found.push(...manager.queryObjects(options));
            return [];
          },
        },
      },
    };

    const spell = new LeeSin_R(owner);
    spell.onSpellCast();

    // what the spell asked for, and what the raw authored number would have found
    const rawFound = manager.queryObjects({
      area: new Circle({ x: 0, y: 0, r: spell.rangeToCheckEnemies }),
      filters: [PredefinedFilters.canTakeDamageFromTeam('blue')],
    });

    return { found, rawFound, gap, range: spell.rangeToCheckEnemies };
  }

  it('finds a default enemy at default size, exactly as it always did', () => {
    const { found, rawFound } = whatLeeSinRWouldFind(DEFAULT_UNIT_SIZE, DEFAULT_UNIT_SIZE);

    expect(found).toHaveLength(1);
    // unchanged: the authored 80 already sufficed between two default bodies
    expect(rawFound).toHaveLength(1);
  });

  it('finds an enemy that a grown caster holds at arms length', () => {
    const { found, rawFound, gap, range } = whatLeeSinRWouldFind(MAX_UNIT_SIZE, DEFAULT_UNIT_SIZE);

    // the gap separation enforces is wider than the authored range plus the
    // victim's own body, which is why the raw query comes back empty
    expect(gap).toBeGreaterThan(range + DEFAULT_BODY_RADIUS);
    expect(rawFound).toHaveLength(0);
    expect(found).toHaveLength(1);
  });

  it('finds a grown enemy that a default caster holds at arms length', () => {
    const { found, rawFound } = whatLeeSinRWouldFind(DEFAULT_UNIT_SIZE, MAX_UNIT_SIZE);

    // the target end already came free with the query's surface test, so this
    // one was never broken — it must stay working
    expect(rawFound).toHaveLength(1);
    expect(found).toHaveLength(1);
  });

  it('finds an enemy when both bodies are at the ceiling', () => {
    const { found, rawFound } = whatLeeSinRWouldFind(MAX_UNIT_SIZE, MAX_UNIT_SIZE);

    expect(rawFound).toHaveLength(0);
    expect(found).toHaveLength(1);
  });
});

/**
 * Rammus Q deliberately stays off this rule. Its circle is not a range, it is
 * the ball's own body, so it measures surface to surface with *whole* radii the
 * way a basic attack does. The property that has to hold is the same one
 * though: it must clear the gap separation enforces.
 */
describe('Rammus Q keeps its own surface-to-surface rule', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const roller = (bodySize: number) => ({
    position: new TestVector(0, 0),
    teamId: 'blue',
    animatedValues: { displaySize: bodySize },
    stats: { size: { value: bodySize } },
    bodyRadius: bodySize / 2,
    game: { objectManager: { addObject: vi.fn(), queryObjects: () => [] } },
  });

  it('reaches a victim parked at separation distance, at both extremes', () => {
    for (const [casterSize, victimSize] of [
      [DEFAULT_UNIT_SIZE, DEFAULT_UNIT_SIZE],
      [MAX_UNIT_SIZE, DEFAULT_UNIT_SIZE],
      [DEFAULT_UNIT_SIZE, MAX_UNIT_SIZE],
      [MAX_UNIT_SIZE, MAX_UNIT_SIZE],
    ]) {
      const ball = new Rammus_Q_Object(roller(casterSize) as never);
      const gap = separationGap(casterSize, victimSize);

      expect(ball.reachTo({ bodyRadius: victimSize / 2, collisionRadius: 25 })).toBeGreaterThan(
        gap
      );
    }
  });

  it('takes whole radii, not the excess this module adds', () => {
    const ball = new Rammus_Q_Object(roller(DEFAULT_UNIT_SIZE) as never);

    expect(ball.reachTo({ bodyRadius: DEFAULT_BODY_RADIUS, collisionRadius: 25 })).toBe(
      ball.size / 2 + DEFAULT_BODY_RADIUS
    );
    expect(bodyReachBonus(sized(DEFAULT_UNIT_SIZE))).toBe(0);
  });
});

/**
 * The UNIT branch of TargetResolver is the one gate every targeted ability
 * shares, and it measures centre to centre with no surface test of its own, so
 * it has to correct both ends itself.
 */
describe('TargetResolver honours both bodies', () => {
  beforeEach(() => installSpellObjectGlobals());
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const request = (caster: unknown, candidate: unknown, range: number) => ({
    spellId: 'test',
    activationId: 'test',
    startedAtMs: 0,
    caster,
    casterTeamId: 'blue',
    origin: { x: 0, y: 0 },
    cursorWorld: (candidate as { position: { x: number; y: number } }).position,
    range,
    targetTeam: 'ENEMY' as const,
    queryCandidates: () => [candidate],
    isTargetable: () => true,
    getTargetInfo: (value: unknown) => ({
      position: (value as { position: { x: number; y: number } }).position,
      teamId: 'red',
      selectionRadius: 30,
    }),
  });

  const enemy = (size: number, distance: number) => ({
    position: { x: distance, y: 0 },
    stats: { size: { value: size } },
    teamId: 'red',
  });

  it('refuses a target one unit past the authored range at default size', () => {
    const caster = sized(DEFAULT_UNIT_SIZE);

    expect(
      TargetResolver.resolve('UNIT', request(caster, enemy(DEFAULT_UNIT_SIZE, 500), 500)).ok
    ).toBe(true);
    expect(
      TargetResolver.resolve('UNIT', request(caster, enemy(DEFAULT_UNIT_SIZE, 501), 500)).ok
    ).toBe(false);
  });

  it('accepts the same target once either body has grown', () => {
    expect(
      TargetResolver.resolve(
        'UNIT',
        request(sized(MAX_UNIT_SIZE), enemy(DEFAULT_UNIT_SIZE, 520), 500)
      ).ok
    ).toBe(true);
    expect(
      TargetResolver.resolve(
        'UNIT',
        request(sized(DEFAULT_UNIT_SIZE), enemy(MAX_UNIT_SIZE, 520), 500)
      ).ok
    ).toBe(true);
  });

  it('leaves POINT casts on the authored number, ground has no body', () => {
    const pointRequest = {
      ...request(sized(MAX_UNIT_SIZE), enemy(DEFAULT_UNIT_SIZE, 520), 500),
      cursorWorld: { x: 520, y: 0 },
    };

    expect(TargetResolver.resolve('POINT', pointRequest).ok).toBe(false);
  });
});
