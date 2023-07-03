import AssetManager from '../../../managers/AssetManager.js';
import { getRandomChampionPreset } from '../../preset.js';
import Champion from './Champion.js';

export default class AIChampion extends Champion {
  constructor(game, x, y, preset) {
    super(game, x, y, preset);
    this.isAllied = false;
  }

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

  respawn() {
    super.respawn();

    let newPresset = getRandomChampionPreset();
    this.avatar = AssetManager.getAsset(newPresset.avatar);
    this.spells = newPresset.spells.map(Spell => new Spell(this));
  }
}
