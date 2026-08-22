import { describe, expect, it } from 'vitest';
import { buildContentApi } from '../../../src/content/ContentApi';
import makeChoGath_R from '../../../packs/riot/spells/ChoGath_R';
import { context } from '../practice/helpers';
import { stubGameGlobals } from '../fixtures';
const __api = buildContentApi();
const ChoGath_R = makeChoGath_R(__api);

/**
 * `Champion.drawHealthBar`'s buff-icon row groups instances by `stackId` and
 * badges the icon with a count — one icon, not N. That grouping used to
 * derive the count by incrementing once per *array entry* sharing the id,
 * which was correct when a stack was N buff instances. `ChoGath_R_Growth`
 * (and `Veigar_Q_Power`) are `countedStacks` now — at most one instance
 * ever exists, carrying the true count on `.stacks` — so the row has to sum
 * `.stacks` instead of counting entries, or a champion cheated to 500 Feast
 * stacks would show a badge reading "1".
 */
describe('Champion.drawHealthBar buff-icon row: counts stacks, not instances', () => {
  it('badges a countedStacks buff with its real stack count, not the instance count', () => {
    const { player } = context();
    const spell = new ChoGath_R(player);
    spell.setStackCount(500);

    const spies = stubGameGlobals();
    player.drawHealthBar();

    const badgeCounts = spies.text.mock.calls
      .map(call => call[0])
      .filter(value => typeof value === 'number');
    expect(badgeCounts).toContain(500);
  });
});
