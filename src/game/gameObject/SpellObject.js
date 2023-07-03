export default class SpellObject {
  toRemove = false;
  isMissile = false;

  constructor(owner) {
    this.owner = owner;
    this.game = owner.game;
  }

  update() {}

  draw() {}

  onBeforeRemove() {}
}
