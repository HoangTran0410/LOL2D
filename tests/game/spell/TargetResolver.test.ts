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
    const farther = { position: { x: 20, y: 20 }, teamId: 'red', targetable: true, selectionRadius: 8 };
    const nearer = { position: { x: 14, y: 24 }, teamId: 'red', targetable: true, selectionRadius: 8 };
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

  it('honours a spell that asks for a tighter acquisition radius than the shared one', () => {
    const enemy = {
      position: { x: 30, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(TargetResolver.resolve('UNIT', baseRequest({
      cursorWorld: { x: 10, y: 20 },
      range: 100,
      targetTeam: 'ENEMY',
      acquisitionRadius: 0,
      queryCandidates: () => [enemy],
      getTargetInfo: candidate => candidate as typeof enemy,
      isTargetable: candidate => (candidate as typeof enemy).targetable,
    }))).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  });

  it('acquires a unit the cursor is merely near, the way an attack order does', () => {
    const enemy = {
      position: { x: 210, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(TargetResolver.resolve('UNIT', baseRequest({
      origin: { x: 10, y: 20 },
      cursorWorld: { x: 10, y: 20 },
      range: 500,
      targetTeam: 'ENEMY',
      queryCandidates: () => [enemy],
      getTargetInfo: candidate => candidate as typeof enemy,
      isTargetable: candidate => (candidate as typeof enemy).targetable,
    }))).toMatchObject({ ok: true, context: { target: enemy } });
  });

  it('still refuses when every unit is beyond the acquisition radius', () => {
    const enemy = {
      position: { x: 400, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(TargetResolver.resolve('UNIT', baseRequest({
      origin: { x: 10, y: 20 },
      cursorWorld: { x: 10, y: 20 },
      range: 900,
      targetTeam: 'ENEMY',
      queryCandidates: () => [enemy],
      getTargetInfo: candidate => candidate as typeof enemy,
      isTargetable: candidate => (candidate as typeof enemy).targetable,
    }))).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  });

  it('keeps picking the unit nearest the cursor when both are inside the acquisition radius', () => {
    const farther = { position: { x: 210, y: 20 }, teamId: 'red', targetable: true, selectionRadius: 5 };
    const nearer = { position: { x: 110, y: 20 }, teamId: 'red', targetable: true, selectionRadius: 5 };

    expect(TargetResolver.resolve('UNIT', baseRequest({
      origin: { x: 10, y: 20 },
      cursorWorld: { x: 10, y: 20 },
      range: 500,
      targetTeam: 'ENEMY',
      queryCandidates: () => [farther, nearer],
      getTargetInfo: candidate => candidate as typeof nearer,
      isTargetable: candidate => (candidate as typeof nearer).targetable,
    }))).toMatchObject({ ok: true, context: { target: nearer } });
  });

  it('reports OUT_OF_RANGE for a unit the cursor acquires but the spell cannot reach', () => {
    const enemy = {
      position: { x: 600, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(TargetResolver.resolve('UNIT', baseRequest({
      origin: { x: 10, y: 20 },
      cursorWorld: { x: 500, y: 20 },
      range: 200,
      targetTeam: 'ENEMY',
      queryCandidates: () => [enemy],
      getTargetInfo: candidate => candidate as typeof enemy,
      isTargetable: candidate => (candidate as typeof enemy).targetable,
    }))).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  });

  it('rejects enemy, range, or targetability violations', () => {
    const enemy = { position: { x: 11, y: 20 }, teamId: 'red', targetable: true, selectionRadius: 20 };
    const farAlly = { position: { x: 100, y: 20 }, teamId: 'blue', targetable: true, selectionRadius: 100 };
    const hiddenAlly = { position: { x: 12, y: 20 }, teamId: 'blue', targetable: false, selectionRadius: 20 };
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
