import { afterEach, describe, expect, it, vi } from 'vitest';
import Spell from '../../../src/game/gameObject/Spell';
import ImpactEffect from '../../../src/game/vfx/ImpactEffect';
import ParticleEmitter from '../../../src/game/vfx/ParticleEmitter';
import SpriteEffect from '../../../src/game/vfx/SpriteEffect';
import SpellVfx, { type VfxHandle } from '../../../src/game/vfx/SpellVfx';
import CastBar, { unitCastBarAnchor } from '../../../src/game/vfx/CastBar';
import CastTelegraph from '../../../src/game/vfx/CastTelegraph';
import ChargeRangeTelegraph from '../../../src/game/vfx/ChargeRangeTelegraph';
import VfxGroup from '../../../src/game/vfx/VfxGroup';
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

const completableHandle = () => {
  let complete = false;
  const effect: VfxHandle = {
    get complete() {
      return complete;
    },
    update: vi.fn(),
    draw: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    effect,
    complete: () => {
      complete = true;
    },
  };
};

class VfxSpell extends Spell {
  constructor(
    ownerValue: ReturnType<typeof owner>,
    private readonly spec: CastSpec
  ) {
    super(ownerValue);
  }

  get castSpec(): CastSpec {
    return this.spec;
  }
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
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads live anchors without mutating the frozen cast context', () => {
    const anchor = { x: 10, y: 20 };
    const renderBar = vi.fn();
    const renderCircle = vi.fn();
    const bar = new CastBar(
      context,
      () => 0.5,
      renderBar,
      () => anchor
    );
    const telegraph = new CastTelegraph(context, 100, renderCircle, () => anchor);

    anchor.x = 90;
    bar.draw();
    telegraph.draw();

    expect(renderBar).toHaveBeenCalledWith(context, 0.5, { x: 90, y: 20 });
    expect(renderCircle).toHaveBeenCalledWith(context, 100, { x: 90, y: 20 });
    expect(context.origin).toEqual({ x: 1, y: 2 });
  });

  it('anchors cast bars above the live unit sprite', () => {
    const unit = { position: { x: 100, y: 200 }, animatedValues: { displaySize: 80 } };

    expect(unitCastBarAnchor(unit)).toEqual({ x: 100, y: 160 });

    unit.position.y = 260;
    expect(unitCastBarAnchor(unit)).toEqual({ x: 100, y: 220 });
  });

  it('samples live charge geometry and groups VFX lifecycle calls', () => {
    const origin = { x: 5, y: 6 };
    let range = 100;
    const render = vi.fn();
    const rangeEffect = new ChargeRangeTelegraph(
      () => origin,
      () => ({ x: 1, y: 0 }),
      () => range,
      () => range / 200,
      render
    );
    const sibling = handle();
    const group = new VfxGroup([rangeEffect, sibling]);

    group.draw();
    range = 200;
    group.update(16);
    group.draw();
    group.dispose();

    expect(render.mock.calls).toEqual([
      [{ x: 5, y: 6 }, { x: 1, y: 0 }, 100, 0.5],
      [{ x: 5, y: 6 }, { x: 1, y: 0 }, 200, 1],
    ]);
    expect(sibling.update).toHaveBeenCalledWith(16);
    expect(sibling.draw).toHaveBeenCalledTimes(2);
    expect(sibling.dispose).toHaveBeenCalledOnce();
  });

  it('reads subclass castSpec lazily and only once', () => {
    class LazySpecSpell extends Spell {
      initialized = true;
      reads = 0;

      get castSpec(): CastSpec {
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
    [
      'death',
      (spell: VfxSpell, spellOwner: ReturnType<typeof owner>) => {
        spellOwner.isDead = true;
        spell.update();
      },
    ],
    ['scene exit', (spell: VfxSpell) => spell.cancel('SCENE_EXIT')],
    ['deactivate', (spell: VfxSpell) => spell.deactivate()],
    ['object removal', (spell: VfxSpell) => spell.onRemoved()],
  ])('stops looping audio once on %s', (_name, finish) => {
    const stop = vi.fn();
    const spellOwner = owner();
    const spell = new VfxSpell(
      spellOwner,
      spec(undefined, {
        castLoop: () => ({ play: vi.fn(), stop }),
      })
    );

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

  it.each(['idle', 'loading', 'error'] as const)(
    'uses procedural VFX while a stable asset handle is %s',
    status => {
      const fallback = handle();
      const asset = { status, data: null, url: '', path: '' };
      const effect = new SpriteEffect(asset, fallback);

      effect.update(16);
      effect.draw();

      expect(fallback.update).toHaveBeenCalledWith(16);
      expect(fallback.draw).toHaveBeenCalledOnce();
    }
  );

  it('draws sprite data only when its stable handle is ready', () => {
    const sprite = { id: 'sprite' };
    const asset = { status: 'ready' as const, data: sprite, url: '', path: '' };
    const fallback = handle();
    const renderAsset = vi.fn();
    const effect = new SpriteEffect(asset, fallback, renderAsset);

    effect.draw();

    expect(renderAsset).toHaveBeenCalledWith(sprite);
    expect(fallback.draw).not.toHaveBeenCalled();
  });

  it('replaces repeated one-shot phases and retires completed handles', () => {
    let complete = false;
    const first = handle();
    const second = {
      ...handle(),
      get complete() {
        return complete;
      },
    };
    const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
    const lifecycle = new SpellVfx({ impact: factory });

    lifecycle.impact(context);
    lifecycle.impact(context);
    lifecycle.draw();

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(first.draw).not.toHaveBeenCalled();
    expect(second.draw).toHaveBeenCalledOnce();

    complete = true;
    lifecycle.update(16);
    lifecycle.draw();

    expect(second.dispose).toHaveBeenCalledOnce();
    expect(second.draw).toHaveBeenCalledOnce();
  });

  it('lets built-in procedural sprite and impact effects expire', () => {
    const fallback = new ParticleEmitter({ x: 0, y: 0 }, 10);
    const sprite = new SpriteEffect(
      { status: 'ready', data: {}, url: '', path: '' },
      fallback,
      () => undefined,
      10
    );
    const impact = new ImpactEffect({ x: 0, y: 0 });

    fallback.update(10);
    sprite.update(10);
    impact.update(180);

    expect(fallback.complete).toBe(true);
    expect(sprite.complete).toBe(true);
    expect(impact.complete).toBe(true);
  });

  it('starts channel loop only after post-charge cast time enters CHANNELING', () => {
    const channelLoop = vi.fn(() => handle());
    const releaseEffect = vi.fn(() => handle());
    const spell = new VfxSpell(owner(), {
      ...spec({ channelLoop, release: releaseEffect }),
      castTimeMs: 100,
      channel: { durationMs: 1_000, tickEveryMs: 100 },
    });

    spell.press(context);
    spell.release(context);

    expect(spell.state).toBe('CASTING');
    expect(releaseEffect).toHaveBeenCalledOnce();
    expect(channelLoop).not.toHaveBeenCalled();

    vi.stubGlobal('deltaTime', 99);
    spell.update();
    expect(channelLoop).not.toHaveBeenCalled();
    vi.stubGlobal('deltaTime', 1);
    spell.update();
    spell.update();

    expect(spell.state).toBe('CHANNELING');
    expect(channelLoop).toHaveBeenCalledOnce();
  });

  it('does not restart an uninterruptible channel VFX while its owner remains dead', () => {
    const firstLoop = handle();
    const secondLoop = handle();
    const stopFirst = vi.fn();
    const stopSecond = vi.fn();
    const channelLoop = vi.fn().mockReturnValueOnce(firstLoop).mockReturnValueOnce(secondLoop);
    const channelSound = vi
      .fn()
      .mockReturnValueOnce({ play: vi.fn(), stop: stopFirst })
      .mockReturnValueOnce({ play: vi.fn(), stop: stopSecond });
    const spellOwner = owner();
    const spell = new VfxSpell(spellOwner, {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      channel: { durationMs: 1_000, tickEveryMs: 100 },
      interrupts: { death: false },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: 0 },
      vfx: { channelLoop },
      sfx: { channelLoop: channelSound },
    });
    vi.stubGlobal('deltaTime', 16);

    spell.press(context);
    spellOwner.isDead = true;
    spell.update();
    spell.update();

    expect(spell.state).toBe('CHANNELING');
    expect(channelLoop).toHaveBeenCalledOnce();
    expect(firstLoop.dispose).toHaveBeenCalledOnce();
    expect(stopFirst).toHaveBeenCalledOnce();

    spellOwner.isDead = false;
    spell.update();

    expect(channelLoop).toHaveBeenCalledTimes(2);
    expect(secondLoop.dispose).not.toHaveBeenCalled();
    expect(stopSecond).not.toHaveBeenCalled();
  });

  it('suppresses effects created when a dead uninterruptible cast enters ACTIVE', () => {
    const castStart = handle();
    const release = handle();
    const activeLoop = handle();
    const play = vi.fn();
    const stop = vi.fn();
    const releaseFactory = vi.fn(() => release);
    const activeLoopFactory = vi.fn(() => activeLoop);
    const spellOwner = owner();
    const spell = new VfxSpell(spellOwner, {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: 100,
      active: { maxDurationMs: 1_000 },
      interrupts: { death: false },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: 0 },
      vfx: {
        castStart: () => castStart,
        release: releaseFactory,
        activeLoop: activeLoopFactory,
      },
      sfx: { activeLoop: () => ({ play, stop }) },
    });
    vi.stubGlobal('deltaTime', 100);

    spell.press(context);
    spellOwner.isDead = true;
    spell.update();
    spell.drawVfx();

    expect(spell.state).toBe('ACTIVE');
    expect(releaseFactory).toHaveBeenCalledOnce();
    expect(activeLoopFactory).toHaveBeenCalledOnce();
    expect(castStart.dispose).toHaveBeenCalledOnce();
    expect(release.dispose).toHaveBeenCalledOnce();
    expect(activeLoop.dispose).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(castStart.draw).not.toHaveBeenCalled();
    expect(release.draw).not.toHaveBeenCalled();
    expect(activeLoop.draw).not.toHaveBeenCalled();

    spell.update();

    expect(releaseFactory).toHaveBeenCalledOnce();
    expect(activeLoopFactory).toHaveBeenCalledOnce();
    expect(release.dispose).toHaveBeenCalledOnce();
    expect(activeLoop.dispose).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
  });

  it('keeps instant cast-start and release effects alive through completion', () => {
    const castStart = completableHandle();
    const release = completableHandle();
    const spell = new VfxSpell(owner(), {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: 0 },
      vfx: {
        castStart: () => castStart.effect,
        release: () => release.effect,
      },
    });

    spell.press(context);
    spell.drawVfx();

    expect(castStart.effect.draw).toHaveBeenCalledOnce();
    expect(release.effect.draw).toHaveBeenCalledOnce();
    expect(castStart.effect.dispose).not.toHaveBeenCalled();
    expect(release.effect.dispose).not.toHaveBeenCalled();

    castStart.complete();
    release.complete();
    spell.update();

    expect(castStart.effect.dispose).toHaveBeenCalledOnce();
    expect(release.effect.dispose).toHaveBeenCalledOnce();
  });

  it.each([
    ['CHANNELING', { channel: { durationMs: 1_000, tickEveryMs: 100 } }],
    ['ACTIVE', { active: { maxDurationMs: 1_000 } }],
  ] as const)('keeps transition effects alive after PRESS enters %s', (_state, phaseSpec) => {
    const castStart = completableHandle();
    const release = completableHandle();
    const spell = new VfxSpell(owner(), {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      ...phaseSpec,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: 0 },
      vfx: {
        castStart: () => castStart.effect,
        release: () => release.effect,
      },
    });

    spell.press(context);
    spell.drawVfx();

    expect(spell.state).toBe(_state);
    expect(castStart.effect.draw).toHaveBeenCalledOnce();
    expect(release.effect.draw).toHaveBeenCalledOnce();

    castStart.complete();
    release.complete();
    spell.update();

    expect(castStart.effect.dispose).toHaveBeenCalledOnce();
    expect(release.effect.dispose).toHaveBeenCalledOnce();
  });

  it('starts ACTIVE loop once while active updates continue', () => {
    const activeLoop = vi.fn(() => handle());
    const spell = new VfxSpell(owner(), {
      activation: 'RECAST',
      targeting: 'DIRECTION',
      active: { maxDurationMs: 1_000 },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: 0 },
      vfx: { activeLoop },
    });

    spell.press(context);
    spell.update();
    spell.update();

    expect(spell.state).toBe('ACTIVE');
    expect(activeLoop).toHaveBeenCalledOnce();
  });
});
