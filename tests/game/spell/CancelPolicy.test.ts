import { describe, expect, it, vi } from 'vitest';

import StatusFlags from '../../../src/game/enums/StatusFlags';
import {
  SPELL_FORM_NAMES,
  SpellForm,
  foreignControlBuff,
  interruptSwitchFor,
  interruptsSuspended,
  isInterruptibleState,
  ownerInterruptReason,
  resolveInterrupts,
  snapshotOwnerMovement,
  spellFormNameOf,
  type InterruptibleOwner,
  type SpellFormName,
} from '../../../src/game/spell/runtime/CancelPolicy';
import {
  SpellRuntime,
  type SpellRuntimeDelegate,
} from '../../../src/game/spell/runtime/SpellRuntime';
import type { BuffConstructor } from '../../../src/game/gameObject/Buff';
import type {
  CancelReason,
  CastSpec,
  InterruptPolicy,
  SpellRuntimeState,
} from '../../../src/game/spell/runtime/types';

const caster = (overrides: Partial<InterruptibleOwner> = {}): InterruptibleOwner => ({
  isDead: false,
  canCast: true,
  status: StatusFlags.None,
  position: { x: 0, y: 0 },
  destination: { x: 0, y: 0 },
  movementRevision: 0,
  displacementRevision: 0,
  ...overrides,
});

/** A caster with no revision counters, which is the fallback comparison path. */
const countlessCaster = (
  position: { x: number; y: number },
  destination?: { x: number; y: number }
): InterruptibleOwner => ({
  isDead: false,
  canCast: true,
  status: StatusFlags.None,
  position,
  ...(destination ? { destination } : {}),
});

class ControlBuff {
  constructor(public sourceUnit: unknown) {}
}
class UnrelatedBuff {
  constructor(public sourceUnit: unknown) {}
}
const controlClasses = [ControlBuff as unknown as BuffConstructor];

const delegate = (): { delegate: SpellRuntimeDelegate; cancelled: CancelReason[] } => {
  const cancelled: CancelReason[] = [];
  return {
    cancelled,
    delegate: {
      canStart: () => true,
      commitResource: () => true,
      refundResource: () => undefined,
      onCastStart: () => undefined,
      onChargeUpdate: () => undefined,
      onRelease: () => undefined,
      onChannelTick: () => undefined,
      onActivate: () => undefined,
      onRecast: () => undefined,
      onCancel: (_context, reason) => cancelled.push(reason),
      onComplete: () => undefined,
    },
  };
};

const specFor = (form: SpellFormName, overrides: Partial<CastSpec> = {}): CastSpec => ({
  activation: 'PRESS',
  targeting: 'SELF',
  castTimeMs: 1_000,
  resource: { commitAt: 'start', refundOn: [] },
  cooldown: { startAt: 'end', durationMs: 0 },
  interrupts: SpellForm[form],
  ...overrides,
});

describe('cancel policy: the forms', () => {
  it('gives every form a table no other form has', () => {
    const tables = SPELL_FORM_NAMES.map(name => JSON.stringify(SpellForm[name]));

    expect(new Set(tables).size).toBe(SPELL_FORM_NAMES.length);
  });

  it('names every form back from its own table', () => {
    for (const name of SPELL_FORM_NAMES) {
      expect(spellFormNameOf(SpellForm[name])).toBe(name);
    }
  });

  it('treats an omitted table as HELD, the strictest form', () => {
    expect(resolveInterrupts(undefined)).toEqual(SpellForm.HELD);
    expect(spellFormNameOf(undefined)).toBe('HELD');
  });

  it('refuses to name a table that is not one of the forms', () => {
    expect(spellFormNameOf({ death: false })).toBeUndefined();
  });

  it('lets death through in every form, so nothing outlives its caster', () => {
    for (const name of SPELL_FORM_NAMES) {
      expect(SpellForm[name].death, name).toBe(true);
    }
  });

  it('governs exactly the five reasons a form can refuse', () => {
    const governed = (['DEATH', 'STUN', 'SILENCE', 'DISPLACEMENT', 'MOVE'] as const).map(
      interruptSwitchFor
    );
    const ungoverned: readonly CancelReason[] = [
      'PLAYER_CANCEL',
      'TARGET_INVALID',
      'OUT_OF_RANGE',
      'OUT_OF_RESOURCE',
      'MAX_DURATION',
      'EFFECT_ENDED',
      'SCENE_EXIT',
    ];

    expect(governed).toEqual(['death', 'stun', 'silence', 'displacement', 'move']);
    for (const reason of ungoverned) expect(interruptSwitchFor(reason), reason).toBeUndefined();
  });
});

describe('cancel policy: the runtime honours the form it was given', () => {
  const reasons: readonly CancelReason[] = ['DEATH', 'STUN', 'SILENCE', 'DISPLACEMENT', 'MOVE'];

  for (const name of SPELL_FORM_NAMES) {
    for (const reason of reasons) {
      const key = interruptSwitchFor(reason) as keyof InterruptPolicy;
      const expected = SpellForm[name][key];

      it(`${name} ${expected ? 'ends on' : 'survives'} ${reason}`, () => {
        const { delegate: spellDelegate, cancelled } = delegate();
        const runtime = new SpellRuntime(specFor(name), spellDelegate);
        runtime.press({
          spellId: 'spell',
          activationId: 'activation',
          startedAtMs: 0,
          caster: {},
          origin: { x: 0, y: 0 },
          cursorWorld: { x: 1, y: 0 },
          direction: { x: 1, y: 0 },
        });

        expect(runtime.cancel(reason)).toBe(expected);
        expect(cancelled).toEqual(expected ? [reason] : []);
        expect(runtime.state).toBe(expected ? 'READY' : 'CASTING');
      });
    }
  }

  it('always allows a reason no form governs', () => {
    const { delegate: spellDelegate, cancelled } = delegate();
    const runtime = new SpellRuntime(specFor('INDEPENDENT'), spellDelegate);
    runtime.press({
      spellId: 'spell',
      activationId: 'activation',
      startedAtMs: 0,
      caster: {},
      origin: { x: 0, y: 0 },
      cursorWorld: { x: 1, y: 0 },
      direction: { x: 1, y: 0 },
    });

    expect(runtime.cancel('EFFECT_ENDED')).toBe(true);
    expect(cancelled).toEqual(['EFFECT_ENDED']);
  });

  it('rejects a refund promised for an interrupt the form never fires', () => {
    const { delegate: spellDelegate } = delegate();

    expect(
      () =>
        new SpellRuntime(
          specFor('INDEPENDENT', {
            resource: { commitAt: 'start', refundOn: ['STUN'] },
          }),
          spellDelegate
        )
    ).toThrow(/refundOn lists STUN/);
  });

  it('accepts a refund for an interrupt the form does fire', () => {
    const { delegate: spellDelegate } = delegate();

    expect(
      () =>
        new SpellRuntime(
          specFor('AIMED', { resource: { commitAt: 'start', refundOn: ['STUN', 'MAX_DURATION'] } }),
          spellDelegate
        )
    ).not.toThrow();
  });
});

describe('cancel policy: reading the caster', () => {
  it('only watches a spell that is live', () => {
    const live: readonly SpellRuntimeState[] = ['CASTING', 'CHARGING', 'CHANNELING', 'ACTIVE'];
    const idle: readonly SpellRuntimeState[] = ['READY', 'COOLDOWN'];

    for (const state of live) expect(isInterruptibleState(state), state).toBe(true);
    for (const state of idle) expect(isInterruptibleState(state), state).toBe(false);
  });

  it('reports nothing while the caster is calm', () => {
    const owner = caster();

    expect(ownerInterruptReason(owner, snapshotOwnerMovement(owner))).toBeNull();
  });

  it.each([
    ['DEATH', caster({ isDead: true })],
    ['STUN', caster({ status: StatusFlags.Stunned })],
    ['STUN', caster({ status: StatusFlags.Suppressed })],
    ['SILENCE', caster({ status: StatusFlags.Silenced })],
    ['SILENCE', caster({ canCast: false })],
  ] as const)('reads %s off the caster', (reason, owner) => {
    expect(ownerInterruptReason(owner, snapshotOwnerMovement(owner))).toBe(reason);
  });

  it('reads a move order off the movement counter', () => {
    const owner = caster();
    const snapshot = snapshotOwnerMovement(owner);
    owner.movementRevision = 1;

    expect(ownerInterruptReason(owner, snapshot)).toBe('MOVE');
  });

  it('reads being shoved off the displacement counter, ahead of the move order', () => {
    const owner = caster();
    const snapshot = snapshotOwnerMovement(owner);
    owner.movementRevision = 1;
    owner.displacementRevision = 1;

    expect(ownerInterruptReason(owner, snapshot)).toBe('DISPLACEMENT');
  });

  it('puts losing control of the caster ahead of the caster moving', () => {
    const owner = caster({ status: StatusFlags.Stunned });
    const snapshot = snapshotOwnerMovement(owner);
    owner.movementRevision = 1;

    expect(ownerInterruptReason(owner, snapshot)).toBe('STUN');
  });

  it('falls back to position and destination for a caster with no counters', () => {
    const walking = countlessCaster({ x: 0, y: 0 }, { x: 100, y: 0 });
    const walkingSnapshot = snapshotOwnerMovement(walking);
    walking.position.x = 5;

    expect(ownerInterruptReason(walking, walkingSnapshot)).toBe('MOVE');

    const shoved = countlessCaster({ x: 0, y: 0 }, { x: 0, y: 0 });
    const shovedSnapshot = snapshotOwnerMovement(shoved);
    shoved.position.x = 5;

    expect(ownerInterruptReason(shoved, shovedSnapshot)).toBe('DISPLACEMENT');
  });

  it('advances the fallback snapshot, so one step is not read forever', () => {
    const owner = countlessCaster({ x: 0, y: 0 }, { x: 0, y: 0 });
    const snapshot = snapshotOwnerMovement(owner);
    owner.position.x = 5;

    expect(ownerInterruptReason(owner, snapshot)).toBe('DISPLACEMENT');
    expect(ownerInterruptReason(owner, snapshot)).toBeNull();
  });

  it('reports nothing without a snapshot to compare against', () => {
    expect(ownerInterruptReason(caster())).toBeNull();
  });
});

describe('cancel policy: suspension', () => {
  it('is off unless the spell named a buff', () => {
    expect(interruptsSuspended(caster(), undefined)).toBe(false);
    expect(interruptsSuspended(caster(), [])).toBe(false);
  });

  it('holds only while the caster actually has the named buff', () => {
    const has = vi.fn(() => true);
    const lacks = vi.fn(() => false);

    expect(interruptsSuspended(caster({ hasBuff: has }), controlClasses)).toBe(true);
    expect(interruptsSuspended(caster({ hasBuff: lacks }), controlClasses)).toBe(false);
    expect(has).toHaveBeenCalledWith(controlClasses[0]);
  });
});

describe('cancel policy: control applied by somebody else', () => {
  const source = { name: 'caster' };
  const enemy = { name: 'enemy' };

  it('finds control applied by another unit', () => {
    const self = new ControlBuff(source);
    const buffs = [self, new ControlBuff(enemy)];

    expect(foreignControlBuff(buffs, self, source, controlClasses)).toBe(buffs[1]);
  });

  it('ignores control this effect came with, so a spell cannot cancel itself', () => {
    const self = new ControlBuff(source);
    const buffs = [self, new ControlBuff(source)];

    expect(foreignControlBuff(buffs, self, source, controlClasses)).toBeUndefined();
  });

  it('ignores a buff of a class that is not on the list', () => {
    const self = new ControlBuff(source);
    const buffs: { sourceUnit: unknown }[] = [self, new UnrelatedBuff(enemy)];

    expect(foreignControlBuff(buffs, self, source, controlClasses)).toBeUndefined();
  });
});
