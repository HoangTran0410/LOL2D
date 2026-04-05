import GameObject from './GameObject';

export default class SpellObject extends GameObject {
  isMissile = false;
  owner: any;
  destination!: p5.Vector;

  constructor(owner: any) {
    super({
      game: owner?.game,
      position: owner?.position?.copy?.(),
      teamId: owner?.teamId,
    });
    this.owner = owner;
  }
}
