import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Monster, {
  MONSTER_HOME_TOLERANCE,
} from '../../../src/game/gameObject/attackableUnits/Monster';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const CAMP = { x: 1_000, y: 1_000, r: 300 };

let game: TestGame;

const makeCamp = (overrides: Record<string, unknown> = {}) =>
  new Monster({
    game,
    preset: {
      name: 'Camp',
      avatar: 'monster_Baron_Nashor',
      camp: { ...CAMP },
      speed: 2,
      size: 80,
      attackRange: 50,
      reviveTime: 100,
      health: 300,
      ...overrides,
    },
  } as ConstructorParameters<typeof Monster>[0]);

describe('Monster', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  describe('leashing home', () => {
    /**
     * The arrival test used to be a flat `< 10px` bullseye. Camp points sit
     * ~100px apart (the three wolves, the four raptors) while
     * `UnitCollisionSystem` holds two bodies `bodyRadius + bodyRadius` apart,
     * so the small ones physically cannot reach the exact point their preset
     * names. A camp that never arrives never leaves BACK_TO_CAMP — it keeps
     * the walking-home regen rate and, far worse, never runs `updateIdle`
     * again, so it stops re-aggroing on proximity for the rest of the match
     * while standing on its own camp.
     */
    it('counts as home once it is within its own body radius of the camp point', () => {
      const camp = makeCamp();
      indexObjects(game, [camp]);
      camp.phase = Monster.PHASES.BACK_TO_CAMP;

      // 40px out: past the old flat threshold, inside this body's radius
      camp.position.set(CAMP.x + camp.stats.size.value / 2 - 1, CAMP.y);
      camp.updateBackToCamp();

      expect(camp.phase).toBe(Monster.PHASES.IDLE);
    });

    it('keeps walking while it is still further out than that', () => {
      const camp = makeCamp();
      indexObjects(game, [camp]);
      camp.phase = Monster.PHASES.BACK_TO_CAMP;

      camp.position.set(CAMP.x + camp.stats.size.value, CAMP.y);
      camp.updateBackToCamp();

      expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
    });

    it('never lets the tolerance fall below its floor, however small the body', () => {
      const camp = makeCamp({ size: 4 });
      indexObjects(game, [camp]);
      camp.phase = Monster.PHASES.BACK_TO_CAMP;

      camp.position.set(CAMP.x + MONSTER_HOME_TOLERANCE - 1, CAMP.y);
      camp.updateBackToCamp();

      expect(camp.phase).toBe(Monster.PHASES.IDLE);
    });

    it('gives up a chase that drags it past its leash radius', () => {
      const camp = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      indexObjects(game, [camp, champion]);

      camp.aggroOn(champion);
      expect(camp.phase).toBe(Monster.PHASES.ATTACK);

      camp.position.set(CAMP.x + CAMP.r + 50, CAMP.y);
      champion.position.set(camp.position.x + 20, camp.position.y);
      camp.updateAttack();

      expect(camp.phase).toBe(Monster.PHASES.BACK_TO_CAMP);
      expect(camp.targetLock).toBeNull();
    });
  });

  describe('bushes', () => {
    it('does not wake up for a champion hidden in a bush', () => {
      const camp = makeCamp();
      const champion = new Champion({ game, teamId: 'other' });
      champion.position.set(CAMP.x + 40, CAMP.y);
      indexObjects(game, [camp, champion]);

      expect(camp.findNearestChampion(camp.aggroRange)).toBe(champion);

      champion.isInsideBush = true;
      expect(camp.findNearestChampion(camp.aggroRange)).toBeNull();
    });
  });
});
