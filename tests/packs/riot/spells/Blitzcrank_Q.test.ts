/**
 * The grab, and the one thing about it that was outside every rule in the game.
 *
 * `Blitzcrank_Q_Object.update` wrote `champToGrab.position.set(...)` straight
 * onto the victim every frame, on top of the `Dash` buff it had already applied
 * for the same pull. A raw write to `position` answers to nothing: not to the
 * displacement seam, not to `markDisplaced`, and not to Morgana's Black Shield
 * — which killed the Dash exactly as it was supposed to and then watched the
 * hook keep hauling the champion in anyway. That is the shape of the bug
 * reported as "E chặn mọi khống chế nhưng vẫn bị Blitz kéo".
 *
 * The Dash buff is the seam, and it was already there doing the same job.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../../src/game/gameObject/attackableUnits/Champion';
import Dash from '../../../../src/game/gameObject/buffs/Dash';
import blitzSource from '../../../../packs/riot/spells/Blitzcrank_Q.ts?raw';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../../../game/fixtures';
import { buildContentApi } from '../../../../src/content/ContentApi';
import { makeBlitzcrank_Q_Object } from '../../../../packs/riot/spells/Blitzcrank_Q';
import { makeMorgana_E_BlackShield } from '../../../../packs/riot/spells/Morgana_E';
const __api = buildContentApi();
const Blitzcrank_Q_Object = makeBlitzcrank_Q_Object(__api);
const Morgana_E_BlackShield = makeMorgana_E_BlackShield(__api);

let game: TestGame;

/** Blitzcrank at the origin, a victim 400px east. Nothing thrown yet. */
const world = () => {
  const blitz = new Champion({ game, teamId: 'blitz' });
  const victim = new Champion({ game, teamId: 'victim' });
  blitz.position.set(0, 0);
  victim.position.set(400, 0);
  victim.destination.set(400, 0);
  indexObjects(game, [blitz, victim]);
  return { blitz, victim };
};

/** One real frame: the hook flies, then the victim's buffs run. */
const frame = (hook: Blitzcrank_Q_Object, victim: Champion, frames: number) => {
  for (let i = 0; i < frames; i++) {
    hook.update();
    victim.update();
  }
};

/**
 * Throws the hand and flies it until it catches, rather than calling `onHit`
 * by hand: `MissileSpellObject.update` is what records the hit in `hitTargets`,
 * and a test that skips it re-hits the victim every single frame — which reads
 * as the fix not working when what is actually happening is five fresh Dashes.
 */
const launch = (blitz: Champion, victim: Champion) => {
  const hook = new Blitzcrank_Q_Object(blitz);
  hook.position.set(blitz.position.x, blitz.position.y);
  hook.destination.set(500, 0);

  for (let i = 0; i < 120 && !hook.champToGrab; i++) frame(hook, victim, 1);
  if (!hook.champToGrab) throw new Error('The hand never caught anyone.');
  return hook;
};

describe('Blitzcrank Q drags its victim through the displacement seam', () => {
  beforeEach(() => {
    stubGameGlobals();
    game = createGame();
    game.setPlayer(new Champion({ game, teamId: 'player-uuid' }));
  });
  afterEach(() => vi.unstubAllGlobals());

  it('still hauls an unprotected champion in', () => {
    const { blitz, victim } = world();
    const hook = launch(blitz, victim);
    const start = victim.position.x;

    frame(hook, victim, 10);

    expect(victim.position.x).toBeLessThan(start - 50);
  });

  it('does it with the Dash buff, not by writing position itself', () => {
    const { blitz, victim } = world();
    const hook = launch(blitz, victim);

    const dash = victim.buffs.find(b => b instanceof Dash) as Dash;
    if (!dash) throw new Error('The grab must apply a Dash.');
    dash.deactivateBuff();
    const start = victim.position.x;

    frame(hook, victim, 10);

    expect(victim.position.x).toBe(start);
  });

  it('cannot drag a champion whose Black Shield ate the grab', () => {
    const { blitz, victim } = world();
    const shield = new Morgana_E_BlackShield(5_000, victim, victim);
    shield.amount = 500; // far more than the grab's 20, so only the block is under test
    victim.addBuff(shield);
    victim.updateBuffs();

    const hook = launch(blitz, victim);
    const start = victim.position.x;
    frame(hook, victim, 20);

    expect(shield.blockedCount).toBeGreaterThan(0);
    expect(victim.position.x).toBe(start);
  });

  it('lets go instead of holding a victim it can no longer pull', () => {
    const { blitz, victim } = world();
    const hook = launch(blitz, victim);

    const dash = victim.buffs.find(b => b instanceof Dash) as Dash;
    dash.deactivateBuff();
    frame(hook, victim, 2);

    expect(hook.champToGrab).toBeNull();
  });

  it('never writes a victim position directly again', () => {
    const code = blitzSource
      .split('\n')
      .map(line => (line.trim().startsWith('*') || line.trim().startsWith('//') ? '' : line))
      .join('\n');

    expect(code).not.toMatch(/champToGrab\s*[!?.]*\s*\.position\.set\(/);
  });
});
