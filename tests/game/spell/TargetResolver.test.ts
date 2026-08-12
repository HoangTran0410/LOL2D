import { describe, expect, it, vi } from 'vitest';
import { TargetResolver, type TargetRequest } from '../../../src/game/spell/targeting/TargetResolver';

const baseRequest = (overrides: Partial<TargetRequest> = {}): TargetRequest => ({
  spellId: 'spell',
  activationId: 'activation',
  startedAtMs: 10,
  caster: {},
  casterTeamId: 'blue',
  origin: { x: 10, y: 20 },
  cursorWorld: { x: 13, y: 24 },
  ...overrides,
});

describe('TargetResolver', () => {
  it('snapshots origin cursor and normalized direction', () => {
    const origin = { x: 10, y: 20 };
    const cursorWorld = { x: 13, y: 24 };

    const result = TargetResolver.resolve('DIRECTION', baseRequest({ origin, cursorWorld }));
    origin.x = 100;
    cursorWorld.y = 200;

    expect(result).toEqual({
      ok: true,
      context: {
        spellId: 'spell',
        activationId: 'activation',
        startedAtMs: 10,
        caster: expect.anything(),
        origin: { x: 10, y: 20 },
        cursorWorld: { x: 13, y: 24 },
        direction: { x: 0.6, y: 0.8 },
      },
    });
    if (result.ok) {
      expect(Object.isFrozen(result.context)).toBe(true);
      expect(Object.isFrozen(result.context.origin)).toBe(true);
      expect(Object.isFrozen(result.context.cursorWorld)).toBe(true);
      expect(Object.isFrozen(result.context.direction)).toBe(true);
    }
  });

  it('selects the nearest valid UNIT target under the cursor', () => {
    const farther = { position: { x: 20, y: 20 }, teamId: 'red', targetable: true };
    const nearer = { position: { x: 14, y: 24 }, teamId: 'red', targetable: true };
    const queryCandidates = vi.fn(() => [farther, nearer]);

    const result = TargetResolver.resolve('UNIT', baseRequest({
      cursorWorld: { x: 13, y: 24 },
      range: 20,
      targetTeam: 'ENEMY',
      queryCandidates,
      getTargetInfo: candidate => candidate as typeof nearer,
      isTargetable: candidate => (candidate as typeof nearer).targetable,
    }));

    expect(queryCandidates).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, context: { target: nearer } });
  });

  it('rejects enemy, range, or targetability violations', () => {
    const enemy = { position: { x: 11, y: 20 }, teamId: 'red', targetable: true };
    const farAlly = { position: { x: 100, y: 20 }, teamId: 'blue', targetable: true };
    const hiddenAlly = { position: { x: 12, y: 20 }, teamId: 'blue', targetable: false };
    const request = baseRequest({
      cursorWorld: { x: 12, y: 20 },
      range: 20,
      targetTeam: 'ALLY',
      queryCandidates: () => [enemy, farAlly, hiddenAlly],
      getTargetInfo: candidate => candidate as typeof enemy,
      isTargetable: candidate => (candidate as typeof enemy).targetable,
    });

    expect(TargetResolver.resolve('UNIT', request)).toEqual({
      ok: false,
      reason: 'OUT_OF_RANGE',
    });
    expect(TargetResolver.resolve('UNIT', {
      ...request,
      queryCandidates: () => [enemy, hiddenAlly],
    })).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  });
});
