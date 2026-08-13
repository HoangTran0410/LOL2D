import { afterEach, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import Buff from '../../../src/game/gameObject/Buff';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import type { GameObjectRuntimeContext } from '../../../src/game/gameObject/GameObject';
import BuffAddType from '../../../src/game/enums/BuffAddType';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import EventManager from '../../../src/managers/EventManager';
import { Rectangle } from '../../../src/libs/quadtree';
import buffSource from '../../../src/game/gameObject/Buff.ts?raw';
import attackableUnitSource from '../../../src/game/gameObject/attackableUnits/AttackableUnit.ts?raw';
import airborneSource from '../../../src/game/gameObject/buffs/Airborne.ts?raw';
import charmSource from '../../../src/game/gameObject/buffs/Charm.ts?raw';
import damageOverTimeSource from '../../../src/game/gameObject/buffs/DamageOverTime.ts?raw';
import dashSource from '../../../src/game/gameObject/buffs/Dash.ts?raw';
import fearSource from '../../../src/game/gameObject/buffs/Fear.ts?raw';
import groundSource from '../../../src/game/gameObject/buffs/Ground.ts?raw';
import invisibleSource from '../../../src/game/gameObject/buffs/Invisible.ts?raw';
import nearsightSource from '../../../src/game/gameObject/buffs/Nearsight.ts?raw';
import rootSource from '../../../src/game/gameObject/buffs/Root.ts?raw';
import shieldSource from '../../../src/game/gameObject/buffs/Shield.ts?raw';
import silenceSource from '../../../src/game/gameObject/buffs/Silence.ts?raw';
import slowSource from '../../../src/game/gameObject/buffs/Slow.ts?raw';
import speedupSource from '../../../src/game/gameObject/buffs/Speedup.ts?raw';
import stasisSource from '../../../src/game/gameObject/buffs/Stasis.ts?raw';
import statAmpSource from '../../../src/game/gameObject/buffs/StatAmp.ts?raw';
import stunSource from '../../../src/game/gameObject/buffs/Stun.ts?raw';
import trueSightSource from '../../../src/game/gameObject/buffs/TrueSight.ts?raw';
import untargetableSource from '../../../src/game/gameObject/buffs/Untargetable.ts?raw';

const scopedSources = [
  buffSource,
  attackableUnitSource,
  airborneSource,
  charmSource,
  damageOverTimeSource,
  dashSource,
  fearSource,
  groundSource,
  invisibleSource,
  nearsightSource,
  rootSource,
  shieldSource,
  silenceSource,
  slowSource,
  speedupSource,
  stasisSource,
  statAmpSource,
  stunSource,
  trueSightSource,
  untargetableSource,
];

class TrackingBuff extends Buff {
  created = 0;
  activated = 0;
  deactivated = 0;
  damageReduction = 0;

  onCreate(): void { this.created += 1; }
  onActivate(): void { this.activated += 1; }
  onDeactivate(): void { this.deactivated += 1; }
  modifyIncomingDamage(damage: number): number { return damage - this.damageReduction; }
}

function createGame(): GameObjectRuntimeContext {
  const camera = { getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 0, h: 0 }) };
  const objectManager = new ObjectManager({ mapSize: 100, camera });
  let player: AttackableUnit | undefined;

  return {
    mapSize: 100,
    camera,
    objectManager,
    eventManager: new EventManager(),
    get player() {
      if (!player) throw new Error('Player is not available in this test context.');
      return player;
    },
    randomSpawnPoint: () => createVector(),
    createSpellContext: () => undefined,
  };
}

describe('buff and attackable unit type boundary', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => ({
      x,
      y,
      copy: () => ({ x, y, set: vi.fn() }),
      set: vi.fn(),
    }));
    vi.stubGlobal('random', () => 0);
  });

  afterEach(() => { vi.unstubAllGlobals(); });

  it('does not use explicit any or deprecated asset lookups in scoped production files', () => {
    for (const source of scopedSources) {
      expect(source).not.toMatch(/\bany\b/);
      expect(source).not.toContain('AssetManager.getAsset(');
    }
  });

  it('keeps concrete buff source, target, game, and stack contracts', () => {
    const game = createGame();
    const source = new AttackableUnit({ game });
    const target = new AttackableUnit({ game });
    const buff = new TrackingBuff(500, source, target);

    expectTypeOf(buff.sourceUnit).toEqualTypeOf<AttackableUnit>();
    expectTypeOf(buff.targetUnit).toEqualTypeOf<AttackableUnit>();
    expectTypeOf(target.buffs).toEqualTypeOf<Buff[]>();
    expect(buff.game).toBe(game);

    if (false) {
      // @ts-expect-error Buff source must be an attackable unit.
      new TrackingBuff(100, new Date(), target);
      // @ts-expect-error Buff target must be an attackable unit.
      new TrackingBuff(100, source, new Date());
    }
  });

  it('renews a matching stack without replacing its lifecycle', () => {
    const game = createGame();
    const source = new AttackableUnit({ game });
    const target = new AttackableUnit({ game });
    const first = new TrackingBuff(500, source, target);
    first.stackId = 'test-stack';
    first.buffAddType = BuffAddType.RENEW_EXISTING;
    const second = new TrackingBuff(500, source, target);
    second.stackId = 'test-stack';
    second.buffAddType = BuffAddType.RENEW_EXISTING;

    target.addBuff(first);
    first.timeElapsed = 250;
    target.addBuff(second);

    expect(target.buffs).toEqual([first]);
    expect(first.created).toBe(1);
    expect(first.activated).toBe(1);
    expect(first.timeElapsed).toBe(0);
    expect(second.created).toBe(0);
  });

  it('applies incoming damage hooks in buff order before recording death data', () => {
    const game = createGame();
    const attacker = new AttackableUnit({ game });
    const target = new AttackableUnit({ game });
    const first = new TrackingBuff(500, attacker, target);
    const second = new TrackingBuff(500, attacker, target);
    first.damageReduction = 30;
    second.damageReduction = 20;
    first.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
    second.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
    first.maxStacks = 2;
    second.maxStacks = 2;
    target.addBuff(first);
    target.addBuff(second);

    target.takeDamage(60, attacker);

    expect(target.stats.health.baseValue).toBe(90);
    target.takeDamage(150, attacker);
    expect(target.deathData).toEqual({ attacker, reviveAfter: target.reviveTime });
  });
});
