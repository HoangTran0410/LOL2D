import { describe, expect, it, vi } from 'vitest';
import Champion, { ChampionStatusText } from '../../../src/game/gameObject/attackableUnits/Champion';
import TeamId from '../../../src/game/enums/TeamId';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeChoGath_R from '../../../packs/riot/spells/ChoGath_R';
import Root from '../../../src/game/gameObject/buffs/Root';
import { context } from '../practice/helpers';
import { stubGameGlobals } from '../fixtures';
const __api = buildContentApi();
const ChoGath_R = makeChoGath_R(__api);

/**
 * `drawHealthBar`'s crowd-control status line resolves every buff's
 * `STATUS_TEXT_BUFFS` slot with a prototype-chain walk
 * (`ChampionStatusText.indexOf`) — round 3's fix, O(N) instead of O(9N).
 * Still O(N) though, and N is not bounded at 99: `ChoGath_R.setStackCount`
 * does not actually cap live stacks at `maxStacks` for a burst call (see
 * `chogath-r-single-draw-call.test.ts`), so a cheat-console champion can
 * carry thousands of identical `ChoGath_R_Growth` instances. Every one of
 * them resolves to the exact same answer (-1, never a CC class) — so once
 * the first instance of a `singleRepresentativeDraw` stack's `stackId` has
 * been resolved, the walk should not repeat for the rest of that group.
 */

describe('Champion.drawHealthBar status text: skips the walk for duplicate singleRepresentativeDraw stacks', () => {
  it('calls ChampionStatusText.indexOf once for 500 identical Feast stacks, not 500 times', () => {
    const { player } = context();
    const spell = new ChoGath_R(player);
    spell.setStackCount(500);

    const indexOfSpy = vi.spyOn(ChampionStatusText, 'indexOf');
    player.drawHealthBar();

    expect(indexOfSpy).toHaveBeenCalledTimes(1);
  });

  it('still finds a real CC buff mixed in among many duplicate stacks, in the right order', () => {
    const { game, player } = context();
    const enemy = new Champion({ game, position: createVector(500, 500), teamId: TeamId.RED });
    stubGameGlobals();

    const spell = new ChoGath_R(player);
    spell.setStackCount(300);
    // A real status-effect buff, added *after* the 300 duplicates — the
    // duplicate-skip must not blind the loop to something that comes later
    // in `this.buffs` and is not part of the skipped group.
    player.addBuff(new Root(5000, enemy, player));

    const spies = stubGameGlobals();
    player.drawHealthBar();

    const statusText = spies.text.mock.calls
      .map(call => call[0])
      .find(text => typeof text === 'string' && text.includes('Trói'));
    expect(statusText).toBe('Trói');
  });
});
