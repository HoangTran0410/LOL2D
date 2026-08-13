import GameObject from './GameObject';
import type AttackableUnit from './attackableUnits/AttackableUnit';
import type { GameObjectRuntimeContext } from './GameObject';

export default class SpellObject extends GameObject {
  declare game: GameObjectRuntimeContext;
  isMissile = false;
  owner: AttackableUnit;
  destination!: p5.Vector;

  constructor(owner: AttackableUnit) {
    super({
      game: owner.game,
      position: owner.position.copy(),
      teamId: owner.teamId,
    });
    this.owner = owner;
  }
}
