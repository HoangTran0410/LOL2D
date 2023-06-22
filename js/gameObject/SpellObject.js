export default class SpellObject {
  toRemove = false;

  constructor(owner) {
    this.owner = owner;
    this.game = owner.game;

    this.init();
  }

  init() {}

  update() {}

  draw() {}
}
