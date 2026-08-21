import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AssetManager from '../../../src/managers/AssetManager';
import { buildContentApi } from '../../../src/content/ContentApi';
import { makeVeigar_E_Object } from '../../../packs/riot/spells/Veigar_E';
const __api = buildContentApi();
const Veigar_E_Object = makeVeigar_E_Object(__api);

class Vector {
  constructor(
    public x = 0,
    public y = 0
  ) {}
  copy(): Vector {
    return new Vector(this.x, this.y);
  }
  dist(other: Vector): number {
    return Math.hypot(this.x - other.x, this.y - other.y);
  }
}

const owner = () => {
  const objects: unknown[] = [];
  return {
    position: new Vector(0, 0),
    teamId: 'blue',
    game: {
      objectManager: {
        addObject: (object: unknown) => objects.push(object),
        queryObjects: vi.fn(() => []),
      },
    },
    objects,
  };
};

describe('Veigar E', () => {
  beforeEach(() => {
    vi.stubGlobal('createVector', (x = 0, y = 0) => new Vector(x, y));
    vi.stubGlobal('deltaTime', 16);
    vi.stubGlobal('random', () => 1); // keep the particle spawn roll deterministic-off
  });
  afterEach(() => vi.unstubAllGlobals());

  it('stuns caught enemies with the CC icon rather than its own ability art', () => {
    const caster = owner();
    const enemyBuffs: Array<{ image: unknown; activateBuff?: () => void }> = [];
    const enemy = {
      position: new Vector(0, 150),
      addBuff: (buff: { image: unknown; activateBuff?: () => void }) => {
        enemyBuffs.push(buff);
        buff.activateBuff?.();
      },
    };
    caster.game.objectManager.queryObjects = vi.fn(() => [enemy]);

    const cage = new Veigar_E_Object(caster as never);
    cage.phase = Veigar_E_Object.PHASES.ACTIVE;

    cage.update();

    expect(enemyBuffs).toHaveLength(1);
    // Base Stun already defaults to the CC icon; Veigar E must not overwrite
    // it with its own ability art (spell_veigar_e) — the reported bug.
    expect(enemyBuffs[0].image).toBe(AssetManager.get('buff_stun'));
    expect(enemyBuffs[0].image).not.toBe(AssetManager.get('spell_veigar_e'));
  });
});
