import { describe, expect, it, vi } from 'vitest';
import Spell from '../../../src/game/gameObject/Spell';
import ParticleEmitter from '../../../src/game/vfx/ParticleEmitter';
import SpriteEffect from '../../../src/game/vfx/SpriteEffect';
import type { VfxHandle } from '../../../src/game/vfx/SpellVfx';
import type { CastContext, CastSpec } from '../../../src/game/spell/runtime/types';

const context: CastContext = Object.freeze({
  spellId: 'spell',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: Object.freeze({ x: 1, y: 2 }),
  cursorWorld: Object.freeze({ x: 4, y: 6 }),
  direction: Object.freeze({ x: 3, y: 4 }),
});

const owner = () => ({
  game: { eventManager: { emit: vi.fn() } },
  position: { x: 1, y: 2 },
  isDead: false,
  canCast: true,
  stats: { mana: { value: 100 }, health: { value: 100 } },
});

const handle = (): VfxHandle => ({
  update: vi.fn(),
  draw: vi.fn(),
  dispose: vi.fn(),
});

class VfxSpell extends Spell {
  constructor(ownerValue: ReturnType<typeof owner>, private readonly spec: CastSpec) {
    super(ownerValue);
  }

  protected get castSpec(): CastSpec { return this.spec; }
}

const spec = (vfx: CastSpec['vfx'], sfx?: CastSpec['sfx']): CastSpec => ({
  activation: 'HOLD_RELEASE',
  targeting: 'DIRECTION',
  charge: { maxDurationMs: 1_000, releaseAtMax: false },
  resource: { commitAt: 'start', refundOn: [] },
  cooldown: { startAt: 'end', durationMs: 0 },
  vfx,
  sfx,
});

describe('Spell VFX lifecycle', () => {
  it('reads subclass castSpec lazily and only once', () => {
    class LazySpecSpell extends Spell {
      initialized = true;
      reads = 0;

      protected get castSpec(): CastSpec {
        expect(this.initialized).toBe(true);
        this.reads += 1;
        return spec(undefined);
      }
    }
    const spell = new LazySpecSpell(owner());

    expect(spell.reads).toBe(0);
    spell.press(context);
    spell.press(context);

    expect(spell.reads).toBe(1);
  });

  it.each([
    ['release', (spell: VfxSpell) => spell.release(context)],
    ['cancel', (spell: VfxSpell) => spell.cancel('PLAYER_CANCEL')],
    ['scene exit', (spell: VfxSpell) => spell.cancel('SCENE_EXIT')],
  ])('disposes looping VFX once on %s', (_name, finish) => {
    const loop = handle();
    const spell = new VfxSpell(owner(), spec({ castLoop: () => loop }));

    spell.press(context);
    spell.update();
    spell.drawVfx();
    finish(spell);
    finish(spell);

    expect(loop.update).toHaveBeenCalled();
    expect(loop.draw).toHaveBeenCalledOnce();
    expect(loop.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['release', (spell: VfxSpell) => spell.release(context)],
    ['cancel', (spell: VfxSpell) => spell.cancel('PLAYER_CANCEL')],
    ['death', (spell: VfxSpell, spellOwner: ReturnType<typeof owner>) => {
      spellOwner.isDead = true;
      spell.update();
    }],
    ['scene exit', (spell: VfxSpell) => spell.cancel('SCENE_EXIT')],
    ['deactivate', (spell: VfxSpell) => spell.deactivate()],
    ['object removal', (spell: VfxSpell) => spell.onRemoved()],
  ])('stops looping audio once on %s', (_name, finish) => {
    const stop = vi.fn();
    const spellOwner = owner();
    const spell = new VfxSpell(spellOwner, spec(undefined, {
      castLoop: () => ({ play: vi.fn(), stop }),
    }));

    spell.press(context);
    finish(spell, spellOwner);
    finish(spell, spellOwner);

    expect(stop).toHaveBeenCalledOnce();
  });

  it('uses procedural VFX when no asset key is configured', () => {
    const fallback = new ParticleEmitter({ x: 0, y: 0 });
    const effect = new SpriteEffect(undefined, fallback);

    expect(effect.effect).toBe(fallback);
  });
});
