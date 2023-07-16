import GameObject from './GameObject.js';

export default class SpellObject extends GameObject {
  isMissile = false;

  constructor(owner) {
    super({
      game: owner?.game,
      position: owner?.position?.copy?.(),
      teamId: owner?.teamId,
    });
    this.owner = owner;
  }
}
