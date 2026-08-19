import { describe, expect, it } from 'vitest';
import EventType from '../../../src/game/enums/EventType';
import Spell from '../../../src/game/gameObject/Spell';
import {
  SpellRuntime,
  type SpellRuntimeDelegate,
} from '../../../src/game/spell/runtime/SpellRuntime';
import type {
  CastContext,
  CastSpec,
  CooldownStartPoint,
} from '../../../src/game/spell/runtime/types';

const context: CastContext = Object.freeze({
  spellId: 'spell',
  activationId: 'activation',
  startedAtMs: 0,
  caster: {},
  origin: Object.freeze({ x: 1, y: 2 }),
  cursorWorld: Object.freeze({ x: 4, y: 6 }),
  direction: Object.freeze({ x: 3, y: 4 }),
});

const spec = (overrides: Partial<CastSpec> = {}): CastSpec => ({
  activation: 'PRESS',
  targeting: 'DIRECTION',
  resource: { commitAt: 'start', refundOn: [] },
  cooldown: { startAt: 'end', durationMs: 1_000 },
  ...overrides,
});

const fakeDelegate = () => {
  const events: string[] = [];
  const delegate: SpellRuntimeDelegate = {
    canStart: () => true,
    commitResource: (_context, point) => {
      events.push(`commit:${point}`);
      return true;
    },
    refundResource: (_context, reason) => events.push(`refund:${reason}`),
    onCastStart: () => events.push('castStart'),
    onChargeUpdate: (_context, elapsedMs, ratio) => events.push(`charge:${elapsedMs}:${ratio}`),
    onRelease: () => events.push('release'),
    onChannelTick: (_context, tickIndex) => events.push(`tick:${tickIndex}`),
    onActivate: () => events.push('activate'),
    onRecast: () => events.push('recast'),
    onCancel: (_context, reason) => events.push(`cancel:${reason}`),
    onComplete: () => events.push('complete'),
  };

  return { delegate, events };
};

describe('SpellRuntime', () => {
  it('moves a timed cast from READY through CASTING to COOLDOWN', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(spec({ castTimeMs: 100 }), delegate);

    expect(runtime.state).toBe('READY');
    runtime.press(context);
    expect(runtime.state).toBe('CASTING');

    runtime.update(99);
    expect(runtime.state).toBe('CASTING');
    runtime.update(1);

    expect(runtime.state).toBe('COOLDOWN');
    expect(events).toEqual(['commit:start', 'castStart', 'release', 'complete']);
  });

  it('commits start resources exactly once', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(spec({ castTimeMs: 100 }), delegate);

    runtime.press(context);
    runtime.press(context);
    runtime.hold(context);
    runtime.update(50);

    expect(events.filter(event => event === 'commit:start')).toHaveLength(1);
  });

  it('commits release resources only when a charge releases', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        activation: 'HOLD_RELEASE',
        charge: { maxDurationMs: 500, releaseAtMax: false },
        resource: { commitAt: 'release', refundOn: [] },
      }),
      delegate
    );

    runtime.press(context);
    runtime.update(200);
    expect(events).not.toContain('commit:release');

    runtime.release(context);
    runtime.release(context);

    expect(events.filter(event => event === 'commit:release')).toHaveLength(1);
    expect(events.filter(event => event === 'release')).toHaveLength(1);
  });

  it('refunds according to the cancel policy', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        castTimeMs: 100,
        resource: { commitAt: 'start', refundOn: ['STUN'] },
      }),
      delegate
    );

    runtime.press(context);
    runtime.cancel('STUN');
    runtime.cancel('STUN');

    expect(events.filter(event => event === 'refund:STUN')).toHaveLength(1);
  });

  it('starts cooldown at start, release, or end according to policy', () => {
    const makeRuntime = (startAt: CooldownStartPoint) => {
      const { delegate } = fakeDelegate();
      return new SpellRuntime(
        spec({
          activation: startAt === 'release' ? 'HOLD_RELEASE' : 'PRESS',
          castTimeMs: startAt === 'release' ? undefined : 100,
          charge: startAt === 'release' ? { maxDurationMs: 500, releaseAtMax: false } : undefined,
          cooldown: { startAt, durationMs: 1_000 },
        }),
        delegate
      );
    };
    const atStart = makeRuntime('start');
    const atRelease = makeRuntime('release');
    const atEnd = makeRuntime('end');

    atStart.press(context);
    atRelease.press(context);
    atEnd.press(context);
    expect(atStart.cooldownRemainingMs).toBe(1_000);
    expect(atRelease.cooldownRemainingMs).toBe(0);
    expect(atEnd.cooldownRemainingMs).toBe(0);

    atRelease.release(context);
    expect(atRelease.cooldownRemainingMs).toBe(1_000);

    atEnd.update(100);
    expect(atEnd.cooldownRemainingMs).toBe(1_000);
  });

  it('keeps an ACTIVE recast available until completion', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        activation: 'RECAST',
        active: { recastDelayMs: 100 },
        cooldown: { startAt: 'start', durationMs: 50 },
      }),
      delegate
    );

    runtime.press(context);
    expect(runtime.state).toBe('ACTIVE');
    runtime.update(50);
    expect(runtime.state).toBe('ACTIVE');

    runtime.press(context);
    expect(events).not.toContain('recast');
    runtime.update(50);
    runtime.press(context);

    expect(events.filter(event => event === 'recast')).toHaveLength(1);
    expect(events.filter(event => event === 'complete')).toHaveLength(1);
    expect(runtime.state).toBe('READY');
  });

  it('spends a whole recast budget before completing, gapping each one', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        activation: 'RECAST',
        active: { recastDelayMs: 100, recasts: 4 },
        cooldown: { startAt: 'end', durationMs: 50 },
      }),
      delegate
    );

    runtime.press(context);
    expect(runtime.state).toBe('ACTIVE');

    for (let shot = 1; shot <= 4; shot++) {
      // The gap is measured from the previous recast, so each one waits its own
      // 100ms rather than every press after the first being free.
      runtime.update(99);
      runtime.press(context);
      expect(events.filter(event => event === 'recast')).toHaveLength(shot - 1);

      runtime.update(1);
      runtime.press(context);
      expect(events.filter(event => event === 'recast')).toHaveLength(shot);
      expect(events.filter(event => event === 'complete')).toHaveLength(shot === 4 ? 1 : 0);
    }

    expect(runtime.state).toBe('COOLDOWN');

    // The budget is spent: the key does nothing more.
    runtime.press(context);
    expect(events.filter(event => event === 'recast')).toHaveLength(4);
  });

  /**
   * A recast is a *new* press by the player, so it has to be aimed by the
   * cursor of that press. `press()` was handed one and threw it away, calling
   * the delegate with `this.context` — the snapshot taken when the spell was
   * activated. Every recast therefore fired at wherever the cursor had been
   * when the window opened: Syndra W threw the sphere back to roughly where she
   * picked it up (she has to stand next to it to grab it), Riven R's wind slash
   * flew along the direction R was pressed rather than the one it was aimed,
   * and Renekton E carried a local workaround (`this.castContext ?? context`)
   * that was the only reason Dice went the right way.
   */
  it('aims a recast with the press that triggered it, not the one that opened it', () => {
    const seen: CastContext[] = [];
    const { delegate } = fakeDelegate();
    delegate.onRecast = context => void seen.push(context);

    const runtime = new SpellRuntime(
      spec({ activation: 'RECAST', active: { recastDelayMs: 0 } }),
      delegate
    );

    runtime.press(context);
    expect(runtime.state).toBe('ACTIVE');

    const elsewhere: CastContext = Object.freeze({
      ...context,
      cursorWorld: Object.freeze({ x: 900, y: -400 }),
      direction: Object.freeze({ x: 0, y: -1 }),
    });
    runtime.press(elsewhere);

    expect(seen).toHaveLength(1);
    expect(seen[0].cursorWorld).toEqual({ x: 900, y: -400 });
    expect(seen[0].direction).toEqual({ x: 0, y: -1 });
  });

  it('carries the recast context into the completion that follows it', () => {
    const seen: CastContext[] = [];
    const { delegate } = fakeDelegate();
    delegate.onComplete = context => void seen.push(context);

    const runtime = new SpellRuntime(
      spec({ activation: 'RECAST', active: { recastDelayMs: 0 } }),
      delegate
    );
    runtime.press(context);
    runtime.press(Object.freeze({ ...context, cursorWorld: Object.freeze({ x: 900, y: -400 }) }));

    expect(seen).toHaveLength(1);
    expect(seen[0].cursorWorld).toEqual({ x: 900, y: -400 });
  });

  it('ends an unspent recast budget when the active window lapses', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        activation: 'RECAST',
        active: { maxDurationMs: 500, recastDelayMs: 100, recasts: 4 },
        cooldown: { startAt: 'end', durationMs: 50 },
      }),
      delegate
    );

    runtime.press(context);
    runtime.update(100);
    runtime.press(context);
    expect(events.filter(event => event === 'recast')).toHaveLength(1);

    runtime.update(400);
    expect(events.filter(event => event === 'complete')).toHaveLength(1);
    expect(runtime.state).toBe('COOLDOWN');
  });

  it('refuses a recast budget that is not a positive whole number', () => {
    const { delegate } = fakeDelegate();
    for (const recasts of [0, -1, 1.5]) {
      expect(
        () => new SpellRuntime(spec({ activation: 'RECAST', active: { recasts } }), delegate)
      ).toThrow('active.recasts must be a positive integer');
    }
  });

  it('rejects an interrupt disabled by the spell override', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({ castTimeMs: 100, interrupts: { stun: false } }),
      delegate
    );

    runtime.press(context);
    runtime.cancel('STUN');

    expect(runtime.state).toBe('CASTING');
    expect(events).not.toContain('cancel:STUN');
  });

  it('runs cancel cleanup exactly once', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(spec({ castTimeMs: 100 }), delegate);

    runtime.press(context);
    runtime.cancel('PLAYER_CANCEL');
    runtime.cancel('PLAYER_CANCEL');

    expect(events.filter(event => event === 'cancel:PLAYER_CANCEL')).toHaveLength(1);
  });

  it('maps legacy cast to an immediate onSpellCast call', () => {
    const emitted: string[] = [];
    const owner = {
      game: {
        worldMouse: { x: 4, y: 6 } as { x: number; y: number } | undefined,
        eventManager: { emit: (event: string) => emitted.push(event) },
      },
      position: { x: 1, y: 2 },
      isDead: false,
      canCast: true,
      stats: { mana: { value: 100 }, health: { value: 100 } },
    };
    class LegacySpell extends Spell {
      targetingMode = 'DIRECTION' as const;
      coolDown = 500;
      manaCost = 20;
      healthCost = 10;
      casts = 0;
      receivedContext?: CastContext;
      onSpellCast(context: CastContext): void {
        this.casts += 1;
        this.receivedContext = context;
      }
    }
    const spell = new LegacySpell(owner);

    spell.cast();
    owner.game.worldMouse = undefined;
    expect(() => spell.cast()).not.toThrow();

    expect(spell.casts).toBe(1);
    expect(spell.state).toBe('COOLDOWN');
    expect(spell.currentCooldown).toBe(500);
    expect(owner.stats.mana.value).toBe(80);
    expect(owner.stats.health.value).toBe(90);
    expect(spell.receivedContext?.cursorWorld).toEqual({ x: 4, y: 6 });
    expect(emitted.filter(event => event === EventType.ON_PRE_CAST_SPELL)).toHaveLength(1);
    expect(emitted.filter(event => event === EventType.ON_POST_CAST_SPELL)).toHaveLength(1);

    spell.currentCooldown = 25;
    expect(spell.currentCooldown).toBe(25);
    spell.state = 'READY';
    expect(spell.state).toBe('READY');
  });

  it('emits pre and post cast events once for direct press', () => {
    const emitted: string[] = [];
    const owner = {
      game: { eventManager: { emit: (event: string) => emitted.push(event) } },
      position: { x: 1, y: 2 },
      isDead: false,
      canCast: true,
      stats: { mana: { value: 100 }, health: { value: 100 } },
    };
    class DirectSpell extends Spell {
      targetingMode = 'DIRECTION' as const;
      coolDown = 500;
    }
    const spell = new DirectSpell(owner);

    spell.press(context);
    spell.press(context);

    expect(emitted).toEqual([
      EventType.ON_PRE_CAST_SPELL,
      EventType.ON_POST_CAST_SPELL,
      EventType.ON_PRE_CAST_SPELL,
    ]);
  });

  it('does not run channel ticks after the channel duration', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({ channel: { durationMs: 1_000, tickEveryMs: 300 } }),
      delegate
    );

    runtime.press(context);
    runtime.update(2_000);

    expect(events.filter(event => event.startsWith('tick:'))).toEqual([
      'tick:1',
      'tick:2',
      'tick:3',
    ]);
    expect(events.filter(event => event === 'complete')).toHaveLength(1);
  });

  it.each([
    [
      'channel tick',
      spec({ channel: { durationMs: 1_000, tickEveryMs: 0 } }),
      'channel.tickEveryMs',
    ],
    [
      'resource tick',
      spec({
        active: {},
        resource: { commitAt: 'tick', refundOn: [], tickEveryMs: -1 },
      }),
      'resource.tickEveryMs',
    ],
  ])('rejects a non-progressing %s interval', (_name, invalidSpec, field) => {
    const { delegate } = fakeDelegate();

    expect(() => new SpellRuntime(invalidSpec, delegate)).toThrow(
      `${field} must be greater than 0`
    );
  });

  it('uses independent channel and resource tick cadences', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        channel: { durationMs: 1_000, tickEveryMs: 300 },
        resource: { commitAt: 'tick', refundOn: [], tickEveryMs: 250 },
      }),
      delegate
    );

    runtime.press(context);
    runtime.update(1_000);

    expect(events.filter(event => event.startsWith('tick:'))).toEqual([
      'tick:1',
      'tick:2',
      'tick:3',
    ]);
    expect(events.filter(event => event === 'commit:tick')).toHaveLength(4);
  });

  it('commits tick resources while ACTIVE', () => {
    const { delegate, events } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        activation: 'RECAST',
        active: { maxDurationMs: 1_000 },
        resource: { commitAt: 'tick', refundOn: [], tickEveryMs: 200 },
      }),
      delegate
    );

    runtime.press(context);
    runtime.update(600);

    expect(runtime.state).toBe('ACTIVE');
    expect(events.filter(event => event === 'commit:tick')).toHaveLength(3);
  });

  it('cancels ACTIVE when a tick resource commit fails', () => {
    const { delegate, events } = fakeDelegate();
    let commits = 0;
    delegate.commitResource = (_context, point) => {
      events.push(`commit:${point}`);
      commits += 1;
      return commits < 2;
    };
    const runtime = new SpellRuntime(
      spec({
        activation: 'RECAST',
        active: { maxDurationMs: 1_000 },
        resource: { commitAt: 'tick', refundOn: [], tickEveryMs: 200 },
      }),
      delegate
    );

    runtime.press(context);
    runtime.update(600);

    expect(events.filter(event => event === 'commit:tick')).toHaveLength(2);
    expect(events).toContain('cancel:OUT_OF_RESOURCE');
    expect(runtime.state).toBe('COOLDOWN');
  });

  it.each(['HOLD_RELEASE', 'TAP_OR_HOLD'] as const)(
    'requires charge configuration for %s activation',
    activation => {
      const { delegate } = fakeDelegate();

      expect(() => new SpellRuntime(spec({ activation }), delegate)).toThrow(
        `${activation} activation requires charge`
      );
    }
  );

  it('rejects charge configuration for PRESS activation', () => {
    const { delegate } = fakeDelegate();

    expect(
      () =>
        new SpellRuntime(
          spec({ activation: 'PRESS', charge: { maxDurationMs: 500, releaseAtMax: false } }),
          delegate
        )
    ).toThrow('PRESS activation does not support charge');
  });

  it.each(['RECAST', 'TOGGLE'] as const)(
    'rejects charge configuration for %s activation',
    activation => {
      const { delegate } = fakeDelegate();

      expect(
        () =>
          new SpellRuntime(
            spec({ activation, charge: { maxDurationMs: 500, releaseAtMax: false } }),
            delegate
          )
      ).toThrow(`${activation} activation does not support charge`);
    }
  );

  it('requires a cadence for tick resource commitment', () => {
    const { delegate } = fakeDelegate();

    expect(
      () =>
        new SpellRuntime(
          spec({ active: {}, resource: { commitAt: 'tick', refundOn: [] } }),
          delegate
        )
    ).toThrow('resource.tickEveryMs is required when commitAt is tick');
  });

  it('rejects resource tick cadence for non-tick commitment', () => {
    const { delegate } = fakeDelegate();

    expect(
      () =>
        new SpellRuntime(
          spec({ resource: { commitAt: 'start', refundOn: [], tickEveryMs: 100 } }),
          delegate
        )
    ).toThrow('resource.tickEveryMs is only valid when commitAt is tick');
  });

  it('enters CHARGING for TAP_OR_HOLD activation', () => {
    const { delegate } = fakeDelegate();
    const runtime = new SpellRuntime(
      spec({
        activation: 'TAP_OR_HOLD',
        charge: { maxDurationMs: 500, releaseAtMax: false },
      }),
      delegate
    );

    runtime.press(context);

    expect(runtime.state).toBe('CHARGING');
  });

  it('returns false when release resource commitment fails', () => {
    const { delegate, events } = fakeDelegate();
    delegate.commitResource = (_context, point) => {
      events.push(`commit:${point}`);
      return false;
    };
    const runtime = new SpellRuntime(
      spec({
        activation: 'HOLD_RELEASE',
        charge: { maxDurationMs: 500, releaseAtMax: false },
        resource: { commitAt: 'release', refundOn: [] },
      }),
      delegate
    );

    runtime.press(context);

    expect(runtime.release(context)).toBe(false);
    expect(events).toContain('cancel:OUT_OF_RESOURCE');
  });
});
