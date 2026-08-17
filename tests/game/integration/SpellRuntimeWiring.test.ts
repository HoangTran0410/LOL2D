import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import StatusFlags from '../../../src/game/enums/StatusFlags';
import Spell from '../../../src/game/gameObject/Spell';
import Stats from '../../../src/game/gameObject/Stats';
import type { CancelReason, CastContext, CastSpec } from '../../../src/game/spell/runtime/types';
import CastBar from '../../../src/game/vfx/CastBar';

const context = (owner: unknown): CastContext =>
  Object.freeze({
    spellId: 'spell',
    activationId: 'activation',
    startedAtMs: 0,
    caster: owner,
    origin: Object.freeze({ x: 0, y: 0 }),
    cursorWorld: Object.freeze({ x: 10, y: 0 }),
    direction: Object.freeze({ x: 1, y: 0 }),
  });

const owner = () => ({
  game: { eventManager: { emit: vi.fn() }, worldMouse: { x: 10, y: 0 } },
  position: { x: 0, y: 0 },
  destination: { x: 0, y: 0 },
  isDead: false,
  canCast: true,
  status: StatusFlags.CanCast | StatusFlags.CanMove,
  movementRevision: 0,
  displacementRevision: 0,
  stats: new Stats(),
});

class RuntimeSpell extends Spell {
  manaCost = 75;
  cancelled: CancelReason[] = [];
  completed = 0;
  get castSpec(): CastSpec {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: 100,
      resource: { commitAt: 'start', refundOn: ['STUN'] },
      cooldown: { startAt: 'end', durationMs: 500 },
    };
  }
  onCancel(_context: CastContext, reason: CancelReason) {
    this.cancelled.push(reason);
  }
  onComplete() {
    this.completed += 1;
  }
}

describe('Spell runtime production wiring', () => {
  beforeEach(() => vi.stubGlobal('deltaTime', 16));
  afterEach(() => vi.unstubAllGlobals());

  it('commits and refunds through real getter-only Stats storage exactly', () => {
    const caster = owner();
    const spell = new RuntimeSpell(caster);
    expect(() => spell.press(context(caster))).not.toThrow();
    expect(caster.stats.mana.value).toBe(425);
    caster.status |= StatusFlags.Stunned;
    spell.update();
    expect(caster.stats.mana.value).toBe(500);
    expect(spell.cancelled).toEqual(['STUN']);
  });

  it('interrupts once for movement while a cast is nonterminal', () => {
    const caster = owner();
    const spell = new RuntimeSpell(caster);
    spell.press(context(caster));
    caster.destination.x = 25;
    caster.movementRevision += 1;
    spell.update();
    spell.update();
    expect(spell.cancelled).toEqual(['MOVE']);
  });

  it.each([
    [
      'DEATH',
      (caster: ReturnType<typeof owner>) => {
        caster.isDead = true;
      },
    ],
    [
      'STUN',
      (caster: ReturnType<typeof owner>) => {
        caster.status |= StatusFlags.Stunned;
      },
    ],
    [
      'SILENCE',
      (caster: ReturnType<typeof owner>) => {
        caster.status |= StatusFlags.Silenced;
      },
    ],
    [
      'DISPLACEMENT',
      (caster: ReturnType<typeof owner>) => {
        caster.position.x = 25;
        caster.displacementRevision += 1;
      },
    ],
  ] as const)('routes owner state changes through %s policy once', (reason, interrupt) => {
    const caster = owner();
    const spell = new RuntimeSpell(caster);
    spell.press(context(caster));
    interrupt(caster);
    spell.update();
    spell.update();
    expect(spell.cancelled).toEqual([reason]);
  });

  it('cancels active runtime cleanup before deactivate resets cooldown', () => {
    const caster = owner();
    class ActiveSpell extends Spell {
      removed = 0;
      get castSpec(): CastSpec {
        return {
          activation: 'TOGGLE',
          targeting: 'POINT',
          active: {},
          resource: { commitAt: 'start', refundOn: [] },
          cooldown: { startAt: 'end', durationMs: 500 },
        };
      }
      onCancel() {
        this.removed += 1;
      }
    }
    const spell = new ActiveSpell(caster);
    spell.press(context(caster));
    spell.deactivate();
    spell.onRemoved();
    expect(spell.removed).toBe(1);
    expect(spell.currentCooldown).toBe(0);
  });

  it('retires CastBar when progress reaches one', () => {
    let progress = 0;
    const bar = new CastBar(context(owner()), () => progress);
    expect(bar.complete).toBe(false);
    progress = 1;
    expect(bar.complete).toBe(true);
  });
});
