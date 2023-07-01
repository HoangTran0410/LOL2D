import Champion from './Champion.js';

export default class AIChampion extends Champion {
  update() {
    super.update();

    // auto move
    let distToDest = this.position.dist(this.destination);
    if (distToDest < this.stats.speed.value) {
      this.moveToRandomLocation();
    }

    // random spell cast
    if (random() < 0.1) {
      let spellIndex = floor(random(this.spells.length));
      this.spells[spellIndex].cast();
    }
  }

  moveToRandomLocation() {
    let x = random(this.game.MAPSIZE);
    let y = random(this.game.MAPSIZE);
    this.moveTo(x, y);
  }

  takeDamage(damage, source) {
    super.takeDamage(damage, source);
    this.moveToRandomLocation();
  }

  die(source) {
    super.die(source);

    this.spells = this.getRandomSpells();
  }
}
