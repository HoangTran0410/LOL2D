import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Morgana_W, {
  CAST_TIME_MS,
  DURATION_MS,
  MANA_COST,
  MAX_TICK_DAMAGE,
  MIN_TICK_DAMAGE,
  MONSTER_DAMAGE_MULTIPLIER,
  Morgana_W_Object,
  RADIUS,
  RANGE,
  TICK_EVERY_MS,
} from '../../../src/game/gameObject/spells/Morgana_W';
import Monster from '../../../src/game/gameObject/attackableUnits/Monster';
import type { CastContext } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
} from '../spell/fixtures';

const context = (owner: { position: { x: number; y: number } }, cursorWorld: { x: number; y: number }): CastContext =>
  Object.freeze({
    spellId: 'morgana-w',
    activationId: 'activation',
    startedAtMs: 0,
    caster: owner,
    origin: Object.freeze({ x: owner.position.x, y: owner.position.y }),
    cursorWorld: Object.freeze(cursorWorld),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

const releaseCast = (spell: Morgana_W): void => {
  vi.stubGlobal('deltaTime', CAST_TIME_MS);
  spell.update();
  vi.stubGlobal('deltaTime', 16);
};

describe('Morgana W (Tormented Shadow)', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('is wired to its exported tuning', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const spell = new Morgana_W(owner);

    expect(spell.manaCost).toBe(MANA_COST);
    expect(spell.range).toBe(RANGE);
    expect(spell.castSpec).toMatchObject({
      activation: 'PRESS',
      targeting: 'POINT',
      castTimeMs: CAST_TIME_MS,
      cooldown: { startAt: 'release', durationMs: spell.coolDown },
    });
  });

  it('clamps the cast point to its own range', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const spell = new Morgana_W(owner);

    spell.press(context(owner, { x: RANGE * 3, y: 0 }));
    releaseCast(spell);

    expect(spell.activeZone).toBeInstanceOf(Morgana_W_Object);
    expect(spell.activeZone?.center).toMatchObject({ x: RANGE, y: 0 });
  });

  it('places the zone directly under a cursor already in range', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const spell = new Morgana_W(owner);

    spell.press(context(owner, { x: 200, y: 0 }));
    releaseCast(spell);

    expect(spell.activeZone?.center).toMatchObject({ x: 200, y: 0 });
    expect(owner.stats.mana.value).toBe(500 - MANA_COST);
    expect(spell.currentCooldown).toBe(spell.coolDown);
  });

  it('damages an enemy standing in it immediately, then every tick, until duration ends', () => {
    const enemy = createUnit(createGame(), 0, 'red');
    enemy.stats.health.baseValue = 100;
    enemy.stats.maxHealth.baseValue = 100;
    const takeDamage = vi.spyOn(enemy, 'takeDamage');
    vi.spyOn(enemy.game.objectManager, 'queryObjects').mockReturnValue([enemy]);

    const zone = new Morgana_W_Object(enemy, { x: 0, y: 0 });
    zone.update(0); // on-cast tick

    expect(takeDamage).toHaveBeenCalledTimes(1);
    expect(takeDamage.mock.calls[0][0]).toBeCloseTo(MIN_TICK_DAMAGE);

    zone.update(TICK_EVERY_MS);
    expect(takeDamage).toHaveBeenCalledTimes(2);

    zone.update(DURATION_MS);
    expect(zone.toRemove).toBe(true);
  });

  it('scales damage up toward MAX_TICK_DAMAGE as the target loses health', () => {
    const enemy = createUnit(createGame(), 0, 'red');
    enemy.stats.health.baseValue = 20;
    enemy.stats.maxHealth.baseValue = 100;
    const takeDamage = vi.spyOn(enemy, 'takeDamage');
    vi.spyOn(enemy.game.objectManager, 'queryObjects').mockReturnValue([enemy]);

    const zone = new Morgana_W_Object(enemy, { x: 0, y: 0 });
    zone.update(0);

    // 80% missing health should land very close to the top of the range
    expect(takeDamage.mock.calls[0][0]).toBeCloseTo(
      MIN_TICK_DAMAGE + (MAX_TICK_DAMAGE - MIN_TICK_DAMAGE) * 0.8,
      5
    );
  });

  it('multiplies damage against monsters', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const monster = new Monster({ game });
    monster.position.set(0, 0);
    monster.stats.health.baseValue = monster.stats.maxHealth.value;
    const takeDamage = vi.spyOn(monster, 'takeDamage');
    vi.spyOn(game.objectManager, 'queryObjects').mockReturnValue([monster]);

    const zone = new Morgana_W_Object(owner, { x: 0, y: 0 });
    zone.update(0);

    expect(takeDamage.mock.calls[0][0]).toBeCloseTo(MIN_TICK_DAMAGE * MONSTER_DAMAGE_MULTIPLIER);
  });

  it('draws a procedural desecrated zone rather than blitting the ability icon, sized to cover its whole radius', () => {
    const spies = {
      circle: vi.fn(),
      triangle: vi.fn(),
      image: vi.fn(),
    };
    for (const [name, spy] of Object.entries(spies)) vi.stubGlobal(name, spy);
    for (const name of ['push', 'pop', 'translate', 'fill', 'noFill', 'stroke', 'noStroke', 'strokeWeight']) {
      vi.stubGlobal(name, vi.fn());
    }

    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    const zone = new Morgana_W_Object(owner, { x: 500, y: 500 });
    zone.elapsedMs = 1_200;

    zone.draw();

    expect(spies.image).not.toHaveBeenCalled();
    expect(spies.circle).toHaveBeenCalled();
    expect(spies.triangle).toHaveBeenCalled();

    const box = zone.getDisplayBoundingBox();
    expect(box.x).toBeLessThanOrEqual(500 - RADIUS);
    expect(box.y).toBeLessThanOrEqual(500 - RADIUS);
    expect(box.w).toBeGreaterThanOrEqual(RADIUS * 2);
    expect(box.h).toBeGreaterThanOrEqual(RADIUS * 2);
  });
});
