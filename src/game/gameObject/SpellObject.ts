import GameObject from './GameObject';
import type AttackableUnit from './attackableUnits/AttackableUnit';

export default class SpellObject extends GameObject {
  isMissile = false;
  owner: AttackableUnit;
  destination!: p5.Vector;

  constructor(owner?: AttackableUnit) {
    super({
      game: owner?.game,
      position: owner?.position?.copy?.(),
      teamId: owner?.teamId,
    });
    this.owner = owner!;
  }
}
