export default class SpellObject {
  toRemove = false;
  isMissile = true;

  constructor(owner) {
    this.owner = owner;
    this.game = owner.game;

    this.init();
  }

  init() {}

  update() {}

  draw() {}
}
