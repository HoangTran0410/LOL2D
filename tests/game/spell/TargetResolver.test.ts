import { describe, expect, it, vi } from 'vitest';
import {
  TargetResolver,
  type TargetRequest,
} from '../../../src/game/spell/targeting/TargetResolver';

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
    const farther = {
      position: { x: 20, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 8,
    };
    const nearer = {
      position: { x: 14, y: 24 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 8,
    };
    const queryCandidates = vi.fn(() => [farther, nearer]);

    const result = TargetResolver.resolve(
      'UNIT',
      baseRequest({
        cursorWorld: { x: 13, y: 24 },
        range: 20,
        targetTeam: 'ENEMY',
        queryCandidates,
        getTargetInfo: candidate => candidate as typeof nearer,
        isTargetable: candidate => (candidate as typeof nearer).targetable,
      })
    );

    expect(queryCandidates).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ ok: true, context: { target: nearer } });
  });

  it('honours a spell that asks for a tighter acquisition radius than the shared one', () => {
    // `acquisitionRadius` decides when the player counts as *aiming at* someone,
    // which is when aim wins outright. It no longer decides whether the cast is
    // allowed at all — that is range's job. With a radius of 0 only a direct hit
    // counts as aim, so the far enemy loses to the one under the cursor.
    const under = {
      position: { x: 10, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 0,
    };
    const away = {
      position: { x: 30, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(
      TargetResolver.resolve(
        'UNIT',
        baseRequest({
          cursorWorld: { x: 10, y: 20 },
          range: 100,
          targetTeam: 'ENEMY',
          acquisitionRadius: 0,
          queryCandidates: () => [away, under],
          getTargetInfo: candidate => candidate as typeof under,
          isTargetable: candidate => (candidate as typeof under).targetable,
        })
      )
    ).toMatchObject({ ok: true, context: { target: under } });
  });

  it('acquires a unit the cursor is merely near, the way an attack order does', () => {
    const enemy = {
      position: { x: 210, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(
      TargetResolver.resolve(
        'UNIT',
        baseRequest({
          origin: { x: 10, y: 20 },
          cursorWorld: { x: 10, y: 20 },
          range: 500,
          targetTeam: 'ENEMY',
          queryCandidates: () => [enemy],
          getTargetInfo: candidate => candidate as typeof enemy,
          isTargetable: candidate => (candidate as typeof enemy).targetable,
        })
      )
    ).toMatchObject({ ok: true, context: { target: enemy } });
  });

  it('reaches a unit in range that the cursor is nowhere near', () => {
    // The reported bug: a minion well inside the spell's range but on the far
    // side of the caster from the cursor was dropped by the acquisition circle,
    // so the key did nothing at all. Range is the gate; the cursor only ranks.
    const enemy = {
      position: { x: 400, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(
      TargetResolver.resolve(
        'UNIT',
        baseRequest({
          origin: { x: 10, y: 20 },
          cursorWorld: { x: -300, y: 20 },
          range: 900,
          targetTeam: 'ENEMY',
          queryCandidates: () => [enemy],
          getTargetInfo: candidate => candidate as typeof enemy,
          isTargetable: candidate => (candidate as typeof enemy).targetable,
        })
      )
    ).toMatchObject({ ok: true, context: { target: enemy } });
  });

  it('still refuses when the only unit in the world is out of range', () => {
    const enemy = {
      position: { x: 4_000, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(
      TargetResolver.resolve(
        'UNIT',
        baseRequest({
          origin: { x: 10, y: 20 },
          cursorWorld: { x: 10, y: 20 },
          range: 500,
          targetTeam: 'ENEMY',
          queryCandidates: () => [enemy],
          getTargetInfo: candidate => candidate as typeof enemy,
          isTargetable: candidate => (candidate as typeof enemy).targetable,
        })
      )
    ).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  });

  it('never lets the fallback overrule a unit the player is actually pointing at', () => {
    const aimedAt = {
      position: { x: 60, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };
    const behind = {
      position: { x: -400, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(
      TargetResolver.resolve(
        'UNIT',
        baseRequest({
          origin: { x: 10, y: 20 },
          cursorWorld: { x: 70, y: 20 },
          range: 900,
          targetTeam: 'ENEMY',
          queryCandidates: () => [behind, aimedAt],
          getTargetInfo: candidate => candidate as typeof aimedAt,
          isTargetable: candidate => (candidate as typeof aimedAt).targetable,
        })
      )
    ).toMatchObject({ ok: true, context: { target: aimedAt } });
  });

  it('lets a spell choose for itself when the cursor is on nobody', () => {
    const near = {
      position: { x: 60, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };
    const far = {
      position: { x: 800, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };
    const pickWithoutAim = vi.fn(
      (candidates: readonly unknown[], _nearestToCursor: unknown) => candidates[1]
    );

    const result = TargetResolver.resolve(
      'UNIT',
      baseRequest({
        origin: { x: 10, y: 20 },
        cursorWorld: { x: -900, y: 20 },
        range: 2_000,
        targetTeam: 'ENEMY',
        queryCandidates: () => [near, far],
        getTargetInfo: candidate => candidate as typeof near,
        isTargetable: candidate => (candidate as typeof near).targetable,
        pickWithoutAim,
      })
    );

    expect(pickWithoutAim).toHaveBeenCalledTimes(1);
    // handed everything in range, plus the answer it would have got by default
    expect(pickWithoutAim.mock.calls[0][0]).toEqual([near, far]);
    expect(pickWithoutAim.mock.calls[0][1]).toBe(near);
    expect(result).toMatchObject({ ok: true, context: { target: far } });
  });

  it('does not consult that choice when the player is aiming at someone', () => {
    const aimedAt = {
      position: { x: 60, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };
    const pickWithoutAim = vi.fn(() => undefined);

    TargetResolver.resolve(
      'UNIT',
      baseRequest({
        origin: { x: 10, y: 20 },
        cursorWorld: { x: 65, y: 20 },
        range: 900,
        targetTeam: 'ENEMY',
        queryCandidates: () => [aimedAt],
        getTargetInfo: candidate => candidate as typeof aimedAt,
        isTargetable: candidate => (candidate as typeof aimedAt).targetable,
        pickWithoutAim,
      })
    );

    expect(pickWithoutAim).not.toHaveBeenCalled();
  });

  it('keeps picking the unit nearest the cursor when both are inside the acquisition radius', () => {
    const farther = {
      position: { x: 210, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };
    const nearer = {
      position: { x: 110, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(
      TargetResolver.resolve(
        'UNIT',
        baseRequest({
          origin: { x: 10, y: 20 },
          cursorWorld: { x: 10, y: 20 },
          range: 500,
          targetTeam: 'ENEMY',
          queryCandidates: () => [farther, nearer],
          getTargetInfo: candidate => candidate as typeof nearer,
          isTargetable: candidate => (candidate as typeof nearer).targetable,
        })
      )
    ).toMatchObject({ ok: true, context: { target: nearer } });
  });

  it('reports OUT_OF_RANGE for a unit the cursor acquires but the spell cannot reach', () => {
    const enemy = {
      position: { x: 600, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 5,
    };

    expect(
      TargetResolver.resolve(
        'UNIT',
        baseRequest({
          origin: { x: 10, y: 20 },
          cursorWorld: { x: 500, y: 20 },
          range: 200,
          targetTeam: 'ENEMY',
          queryCandidates: () => [enemy],
          getTargetInfo: candidate => candidate as typeof enemy,
          isTargetable: candidate => (candidate as typeof enemy).targetable,
        })
      )
    ).toEqual({ ok: false, reason: 'OUT_OF_RANGE' });
  });

  it('rejects enemy, range, or targetability violations', () => {
    const enemy = {
      position: { x: 11, y: 20 },
      teamId: 'red',
      targetable: true,
      selectionRadius: 20,
    };
    const farAlly = {
      position: { x: 100, y: 20 },
      teamId: 'blue',
      targetable: true,
      selectionRadius: 100,
    };
    const hiddenAlly = {
      position: { x: 12, y: 20 },
      teamId: 'blue',
      targetable: false,
      selectionRadius: 20,
    };
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
    expect(
      TargetResolver.resolve('UNIT', {
        ...request,
        queryCandidates: () => [enemy, hiddenAlly],
      })
    ).toEqual({ ok: false, reason: 'TARGET_INVALID' });
  });

  it('rejects candidates without explicit targetable=true by default', () => {
    const spellObject = {
      position: { x: 12, y: 20 },
      teamId: 'red',
      // No targetable property (e.g. SpellObject, ParticleSystem)
    };
    const deadUnit = {
      position: { x: 12, y: 20 },
      teamId: 'red',
      targetable: false,
    };
    const removedUnit = {
      position: { x: 12, y: 20 },
      teamId: 'red',
      targetable: true,
      toRemove: true,
    };

    const request = baseRequest({
      cursorWorld: { x: 12, y: 20 },
      range: 100,
      targetTeam: 'ENEMY',
      queryCandidates: () => [spellObject, deadUnit, removedUnit],
    });

    expect(TargetResolver.resolve('UNIT', request)).toEqual({
      ok: false,
      reason: 'TARGET_INVALID',
    });
  });
});
