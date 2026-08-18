import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import { issuePointerOrder } from '../../../src/game/input/PointerOrders';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import ActionState from '../../../src/game/enums/ActionState';
import { createGame, indexObjects, stubGameGlobals, type TestGame } from '../fixtures';

const ATTACK = { damage: 12, attacksPerSecond: 1, range: 300 };

function champion(game: TestGame, x: number, teamId: string): Champion {
  const unit = new Champion({
    game,
    position: createVector(x, 1_000),
    teamId,
    preset: { attack: ATTACK },
  });
  // The real game has already settled this lerp by the time a player can click
  // a body. Pin it here so the test probes the authored 55px body, not the 10px
  // constructor animation's first frame.
  unit.animatedValues.size = unit.stats.size.value;
  unit.animatedValues.displaySize = unit.stats.size.value;
  return unit;
}

function rig(target?: { teamId: string; hidden?: boolean; stealthed?: boolean }) {
  const game = createGame();
  const player = champion(game, 1_000, 'team-blue');
  game.setPlayer(player);
  const unit = target ? champion(game, 1_120, target.teamId) : undefined;
  if (unit && target?.hidden) unit.isInsideBush = true;
  if (unit && target?.stealthed) unit.stats.setActionState(ActionState.STEALTHED, true);
  indexObjects(game, unit ? [player, unit] : [player]);

  return {
    game,
    player,
    unit,
    attack: vi.spyOn(player, 'orderAttack'),
    move: vi.spyOn(player, 'orderMove'),
  };
}

describe('right-click pointer orders', () => {
  beforeEach(stubGameGlobals);
  afterEach(() => vi.unstubAllGlobals());

  it('orders an attack when the small pointer circle touches a visible enemy body', () => {
    const { game, player, unit, attack, move } = rig({ teamId: 'team-red' });
    if (!unit) throw new Error('expected an enemy');
    // Twenty pixels off-centre is still visibly inside the 55px champion body.
    const point = { x: unit.position.x + 20, y: unit.position.y };

    const selected = issuePointerOrder(player, game.objectManager, point);

    expect(selected).toBe(unit);
    expect(attack).toHaveBeenCalledOnce();
    expect(attack).toHaveBeenCalledWith(unit);
    expect(move).not.toHaveBeenCalled();
  });

  it('moves instead of attacking when the body under the pointer is allied', () => {
    const { game, player, unit, attack, move } = rig({ teamId: 'team-blue' });
    if (!unit) throw new Error('expected an ally');
    const point = { x: unit.position.x, y: unit.position.y };

    expect(issuePointerOrder(player, game.objectManager, point)).toBeNull();
    expect(attack).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith(point.x, point.y, true);
  });

  it('moves to empty ground', () => {
    const { game, player, attack, move } = rig();
    const point = { x: 1_500, y: 1_400 };

    expect(issuePointerOrder(player, game.objectManager, point)).toBeNull();
    expect(attack).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith(point.x, point.y, true);
  });

  it('moves instead of acquiring an enemy hidden from the player', () => {
    const { game, player, unit, attack, move } = rig({ teamId: 'team-red', hidden: true });
    if (!unit) throw new Error('expected a hidden enemy');
    const point = { x: unit.position.x, y: unit.position.y };

    expect(issuePointerOrder(player, game.objectManager, point)).toBeNull();
    expect(attack).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith(point.x, point.y, true);
  });

  it('moves instead of acquiring an actively stealthed enemy', () => {
    const { game, player, unit, attack, move } = rig({
      teamId: 'team-red',
      stealthed: true,
    });
    if (!unit) throw new Error('expected a stealthed enemy');
    const point = { x: unit.position.x, y: unit.position.y };

    expect(issuePointerOrder(player, game.objectManager, point)).toBeNull();
    expect(attack).not.toHaveBeenCalled();
    expect(move).toHaveBeenCalledWith(point.x, point.y, true);
  });
});
