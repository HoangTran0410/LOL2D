import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Jhin_Q, {
  JHIN_MARK_MS,
  JHIN_Q_DAMAGE,
  JHIN_Q_MAX_HITS,
  Jhin_Q_Object,
  applyJhinMark,
  hasJhinMark,
} from '../../../src/game/gameObject/spells/Jhin_Q';
import Jhin_W, { JHIN_W_DAMAGE } from '../../../src/game/gameObject/spells/Jhin_W';
import Jhin_E, {
  JHIN_E_ARM_MS,
  JHIN_E_DAMAGE,
  JHIN_E_MAX_TRAPS,
  Jhin_E_Trap,
} from '../../../src/game/gameObject/spells/Jhin_E';
import Jhin_R, {
  JHIN_R_DAMAGE,
  JHIN_R_FINAL_DAMAGE,
  JHIN_R_SHOTS,
  JHIN_R_SHOT_GAP_MS,
} from '../../../src/game/gameObject/spells/Jhin_R';
import Root from '../../../src/game/gameObject/buffs/Root';
import AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  type TestGame,
} from '../spell/fixtures';

function unit(game: TestGame, x: number, teamId: string, pool = 100): AttackableUnit {
  const result = createUnit(game, x, teamId);
  result.collisionRadius = 1;
  result.stats.speed.baseValue = 10;
  result.stats.mana.baseValue = 100;
  result.stats.health.baseValue = pool;
  result.stats.maxHealth.baseValue = pool;
  result.animatedValues.displaySize = 20;
  return result;
}

function liveRoots(victim: AttackableUnit): number {
  let count = 0;
  for (const buff of victim.buffs) {
    if (buff instanceof Root && !buff.toRemove) count += 1;
  }
  return count;
}

function trapsOf(game: TestGame): Jhin_E_Trap[] {
  const found: Jhin_E_Trap[] = [];
  for (const object of game.objectManager._objectToBeAdd) {
    if (object instanceof Jhin_E_Trap) found.push(object);
  }
  for (const object of game.objectManager.objects) {
    if (object instanceof Jhin_E_Trap) found.push(object);
  }
  return found;
}

describe('Jhin spells', () => {
  let game: TestGame;
  let owner: AttackableUnit;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 250);
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    game = createGame();
    owner = unit(game, 0, 'blue');
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('Q escalates its damage per bounce and stops dead at the hit cap', () => {
    const victims = [
      unit(game, 200, 'red'),
      unit(game, 360, 'red'),
      unit(game, 520, 'red'),
      unit(game, 680, 'red'),
      unit(game, 840, 'red'),
    ];
    for (const victim of victims) game.objectManager.addObject(victim);
    game.objectManager.update();

    const grenade = new Jhin_Q_Object(owner);
    grenade.destination = createVector(200, 0);
    for (const victim of victims) grenade.onHit(victim);

    expect(JHIN_Q_MAX_HITS).toBe(JHIN_Q_DAMAGE.length);
    expect(victims[0].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[0]);
    expect(victims[1].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[1]);
    expect(victims[2].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[2]);
    expect(victims[3].stats.health.value).toBe(100 - JHIN_Q_DAMAGE[3]);
    // the fifth body is past the cap and never pays anything
    expect(victims[4].stats.health.value).toBe(100);
    // and the escalation is real, not just four equal blasts
    expect(victims[3].stats.health.value).toBeLessThan(victims[0].stats.health.value);
  });

  it('Q and E both hang the lotus mark, and it lapses after MARK_MS', () => {
    const shot = unit(game, 200, 'red');
    const stepped = unit(game, 400, 'red');
    game.objectManager.addObject(shot);
    game.objectManager.addObject(stepped);
    game.objectManager.update();

    new Jhin_Q_Object(owner).onHit(shot);
    expect(hasJhinMark(shot)).toBe(true);

    const trap = new Jhin_E_Trap(owner, createVector(400, 0));
    vi.stubGlobal('deltaTime', JHIN_E_ARM_MS);
    trap.update();
    expect(hasJhinMark(stepped)).toBe(true);

    vi.stubGlobal('deltaTime', 500);
    for (let tick = 0; tick <= JHIN_MARK_MS / 500 + 1; tick++) game.objectManager.update();
    expect(hasJhinMark(shot)).toBe(false);
    expect(hasJhinMark(stepped)).toBe(false);
  });

  it('W roots the marked body and leaves the unmarked one free, for the same damage', () => {
    const marked = unit(game, 200, 'red');
    const plain = unit(game, 300, 'red');
    game.objectManager.addObject(marked);
    game.objectManager.addObject(plain);
    game.objectManager.update();
    applyJhinMark(owner, marked);

    new Jhin_W(owner).onSpellCast();

    expect(marked.stats.health.value).toBe(100 - JHIN_W_DAMAGE);
    expect(plain.stats.health.value).toBe(100 - JHIN_W_DAMAGE);
    expect(liveRoots(marked)).toBe(1);
    expect(liveRoots(plain)).toBe(0);
  });

  it('W consumes the mark, so a second W finds nothing left to root', () => {
    const marked = unit(game, 200, 'red', 300);
    game.objectManager.addObject(marked);
    game.objectManager.update();
    applyJhinMark(owner, marked);

    const w = new Jhin_W(owner);
    w.onSpellCast();
    expect(hasJhinMark(marked)).toBe(false);
    expect(liveRoots(marked)).toBe(1);

    w.onSpellCast();
    expect(liveRoots(marked)).toBe(1);
    expect(marked.stats.health.value).toBe(300 - JHIN_W_DAMAGE - JHIN_W_DAMAGE);
  });

  it('E only bites once armed, and a fourth trap evicts the oldest', () => {
    const stepped = unit(game, 300, 'red');
    game.objectManager.addObject(stepped);
    game.objectManager.update();

    const trap = new Jhin_E_Trap(owner, createVector(300, 0));
    vi.stubGlobal('deltaTime', 250);
    trap.update();
    trap.update();
    expect(stepped.stats.health.value).toBe(100);
    trap.update();
    expect(stepped.stats.health.value).toBe(100 - JHIN_E_DAMAGE);
    expect(trap.toRemove).toBe(true);

    const e = new Jhin_E(owner);
    for (let index = 0; index < JHIN_E_MAX_TRAPS + 1; index++) {
      (game as any).worldMouse = createVector(120 + index * 30, 240);
      e.onSpellCast();
    }
    const planted = trapsOf(game);
    let alive = 0;
    for (const known of planted) {
      if (!known.toRemove) alive += 1;
    }
    expect(planted.length).toBe(JHIN_E_MAX_TRAPS + 1);
    expect(alive).toBe(JHIN_E_MAX_TRAPS);
    // the oldest planting is the one the fourth pushes out
    expect(planted[0].toRemove).toBe(true);
    expect(planted[JHIN_E_MAX_TRAPS].toRemove).toBe(false);
  });

  it("R's fourth shot pays the finale, closes the window and ignores a fifth recast", () => {
    const victim = unit(game, 300, 'red', 300);
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const r = new Jhin_R(owner);
    r.onActivate();
    expect(r.performing).toBe(true);

    r.onRecast();
    for (let shot = 0; shot < JHIN_R_SHOTS - 1; shot++) {
      vi.stubGlobal('deltaTime', JHIN_R_SHOT_GAP_MS + 50);
      r.update();
      r.onRecast();
    }

    expect(r.shotsFired).toBe(JHIN_R_SHOTS);
    expect(r.performing).toBe(false);
    expect(victim.stats.health.value).toBe(
      300 - JHIN_R_DAMAGE - JHIN_R_DAMAGE - JHIN_R_DAMAGE - JHIN_R_FINAL_DAMAGE
    );

    vi.stubGlobal('deltaTime', JHIN_R_SHOT_GAP_MS + 50);
    r.update();
    r.onRecast();
    expect(r.shotsFired).toBe(JHIN_R_SHOTS);
    expect(victim.stats.health.value).toBe(
      300 - JHIN_R_DAMAGE - JHIN_R_DAMAGE - JHIN_R_DAMAGE - JHIN_R_FINAL_DAMAGE
    );
  });

  it('two R recasts inside the shot gap fire only one shot', () => {
    const victim = unit(game, 300, 'red', 300);
    game.objectManager.addObject(victim);
    game.objectManager.update();

    const r = new Jhin_R(owner);
    r.onActivate();
    r.onRecast();
    r.onRecast();

    expect(r.shotsFired).toBe(1);
    expect(victim.stats.health.value).toBe(300 - JHIN_R_DAMAGE);
  });
});
