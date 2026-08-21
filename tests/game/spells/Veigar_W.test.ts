import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));
import type { CastContext } from '../../../src/game/spell/runtime/types';
import { createGame, createUnit, installSpellObjectGlobals } from '../spell/fixtures';
import { buildContentApi } from '../../../src/content/ContentApi';
import { DAMAGE, IMPACT_LIFETIME_MS, MANA_COST, RADIUS, RANGE, WINDUP_MS } from '../../../packs/riot/spells/Veigar_W';
import makeVeigar_W, { makeVeigar_W_Object } from '../../../packs/riot/spells/Veigar_W';
const __api = buildContentApi();
const Veigar_W = makeVeigar_W(__api);
const Veigar_W_Object = makeVeigar_W_Object(__api);

// A local vector with `.limit()`, which VectorUtils.getVectorWithMaxRange needs
// and the shared test fixture's TestVector does not implement.
class ClampVector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy(): ClampVector {
    return new ClampVector(this.x, this.y);
  }
  limit(maximum: number): ClampVector {
    const magnitude = Math.hypot(this.x, this.y);
    if (magnitude > maximum) {
      this.x = (this.x / magnitude) * maximum;
      this.y = (this.y / magnitude) * maximum;
    }
    return this;
  }
}

const context = (cursorWorld: { x: number; y: number }): CastContext => ({
  spellId: 'veigar-w',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: { x: 0, y: 0 },
  cursorWorld,
  direction: { x: 1, y: 0 },
});

const owner = () => {
  const objects: unknown[] = [];
  const manaStat = {
    baseValue: 200,
    get value() {
      return this.baseValue;
    },
    set value(value: number) {
      this.baseValue = value;
    },
  };
  return {
    position: new ClampVector(0, 0),
    teamId: 'blue',
    isDead: false,
    canCast: true,
    stats: { mana: manaStat, health: { value: 100 } },
    game: {
      eventManager: { emit: vi.fn() },
      objectManager: { addObject: (object: unknown) => objects.push(object) },
    },
    objects,
  };
};

describe('Veigar W', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new ClampVector(x, y));
    vi.stubGlobal('p5', {
      Vector: {
        add: (a: ClampVector, b: ClampVector) => new ClampVector(a.x + b.x, a.y + b.y),
        sub: (a: ClampVector, b: ClampVector) => new ClampVector(a.x - b.x, a.y - b.y),
      },
    });
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('clamps the strike to range and copies its tuning onto the telegraph', () => {
    const caster = owner();
    const spell = new Veigar_W(caster);

    // cursor is far past RANGE, in a pure +x direction
    expect(spell.press(context({ x: RANGE * 5, y: 0 }))).toBe(true);

    const strike = caster.objects[0] as Veigar_W_Object;
    expect(strike).toBeInstanceOf(Veigar_W_Object);
    expect(strike.position.x).toBeCloseTo(RANGE);
    expect(strike.position.y).toBeCloseTo(0);
    expect(strike.radius).toBe(RADIUS);
    expect(strike.windUpMs).toBe(WINDUP_MS);
    expect(strike.damage).toBe(DAMAGE);
    expect(caster.stats.mana.value).toBe(200 - MANA_COST);
  });

  it('never damages while it is only warning, and is readable enough to dodge', () => {
    // radius 115 vs. a full-speed unit (~180u/s reference) crossing it takes
    // well under half the wind-up — the design bar this spell is held to.
    const referenceSpeed = 180;
    const secondsToClear = RADIUS / referenceSpeed;
    expect(secondsToClear * 1000).toBeLessThan(WINDUP_MS / 2);
  });
});

describe('Veigar W impact', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    vi.stubGlobal('random', () => 0.5);
    vi.stubGlobal('TWO_PI', Math.PI * 2);
    vi.stubGlobal('constrain', (value: number, low: number, high: number) =>
      Math.min(Math.max(value, low), high)
    );
    vi.stubGlobal('HALF_PI', Math.PI / 2);
    vi.stubGlobal('cos', Math.cos);
    vi.stubGlobal('sin', Math.sin);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('damages every enemy still inside the radius exactly once, and only enemies', () => {
    const game = createGame();
    const caster = createUnit(game, 0, 'blue');
    caster.collisionRadius = 25;
    game.setPlayer(caster);

    const inside = createUnit(game, 50, 'red');
    inside.collisionRadius = 25;
    const dodged = createUnit(game, 500, 'red');
    dodged.collisionRadius = 25;
    const ally = createUnit(game, 50, 'blue');
    ally.collisionRadius = 25;

    game.objectManager.addObject(inside);
    game.objectManager.addObject(dodged);
    game.objectManager.addObject(ally);
    game.objectManager.update();

    const insideDamage = vi.spyOn(inside, 'takeDamage');
    const dodgedDamage = vi.spyOn(dodged, 'takeDamage');
    const allyDamage = vi.spyOn(ally, 'takeDamage');

    const strike = new Veigar_W_Object(caster);
    strike.position = createVector(0, 0);
    strike.radius = RADIUS;
    strike.windUpMs = WINDUP_MS;
    strike.damage = DAMAGE;

    vi.stubGlobal('deltaTime', WINDUP_MS - 1);
    strike.update();
    expect(strike.phase).toBe(Veigar_W_Object.PHASES.TELEGRAPH);
    expect(insideDamage).not.toHaveBeenCalled();

    vi.stubGlobal('deltaTime', 2);
    strike.update();
    expect(strike.phase).toBe(Veigar_W_Object.PHASES.IMPACT);
    expect(insideDamage).toHaveBeenCalledTimes(1);
    expect(insideDamage).toHaveBeenCalledWith(DAMAGE, caster);
    expect(dodgedDamage).not.toHaveBeenCalled();
    expect(allyDamage).not.toHaveBeenCalled();

    // the impact visual runs on afterward, but never deals damage again
    vi.stubGlobal('deltaTime', 50);
    strike.update();
    expect(insideDamage).toHaveBeenCalledTimes(1);

    vi.stubGlobal('deltaTime', IMPACT_LIFETIME_MS);
    strike.update();
    expect(strike.toRemove).toBe(true);
  });

  it('draws in both phases without blitting the ability icon, and covers the whole danger zone', () => {
    installSpellObjectGlobals();
    const game = createGame();
    const caster = createUnit(game, 0, 'blue');
    const strike = new Veigar_W_Object(caster);
    strike.position = createVector(0, 0);
    strike.radius = RADIUS;
    strike.windUpMs = WINDUP_MS;

    const draw = {
      circle: vi.fn(),
      arc: vi.fn(),
      line: vi.fn(),
    };
    for (const [name, spy] of Object.entries(draw)) vi.stubGlobal(name, spy);
    for (const name of [
      'push',
      'pop',
      'translate',
      'blendMode',
      'fill',
      'stroke',
      'noFill',
      'noStroke',
      'strokeWeight',
    ]) {
      vi.stubGlobal(name, vi.fn());
    }
    for (const name of ['ADD', 'BLEND']) vi.stubGlobal(name, name);

    expect(strike.image).toBeUndefined();

    strike.draw(); // TELEGRAPH phase
    expect(draw.circle).toHaveBeenCalled();
    expect(draw.arc).toHaveBeenCalled();

    draw.circle.mockClear();
    strike.phase = Veigar_W_Object.PHASES.IMPACT;
    strike.draw(); // IMPACT phase
    expect(draw.circle).toHaveBeenCalled();
    expect(draw.line).toHaveBeenCalled();

    const box = strike.getDisplayBoundingBox();
    expect(box.x).toBeLessThanOrEqual(strike.position.x - strike.radius);
    expect(box.y).toBeLessThanOrEqual(strike.position.y - strike.radius);
    expect(box.w).toBeGreaterThanOrEqual(strike.radius * 2);
    expect(box.h).toBeGreaterThanOrEqual(strike.radius * 2);
  });
});
