import AssetManager from '../../../managers/AssetManager.js';
import { getRandomChampionPreset } from '../../preset.js';
import Champion from './Champion.js';

export default class AIChampion extends Champion {
  isAllied = false;
  _autoMove = true;
  _autoCast = true;
  _autoMoveOnTakeDamage = true;
  _respawnWithNewPreset = true;

  update() {
    super.update();

    // auto move
    if (this._autoMove) {
      let distToDest = this.position.dist(this.destination);
      if (distToDest < this.stats.speed.value) {
        this.moveToRandomLocation();
      }
    }

    // random spell cast
    if (this._autoCast) {
      if (random() < 0.1) {
        let spellIndex = floor(random(this.spells.length));
        this.spells[spellIndex].cast();
      }
    }
  }

  moveToRandomLocation() {
    let x = random(this.game.terrainMap.size);
    let y = random(this.game.terrainMap.size);
    this.moveTo(x, y);
  }

  takeDamage(damage, source) {
    super.takeDamage(damage, source);
    if (this._autoMoveOnTakeDamage) this.moveToRandomLocation();
  }

  respawn() {
    super.respawn();

    if (this._respawnWithNewPreset) {
      let newPresset = getRandomChampionPreset();
      this.avatar = AssetManager.getAsset(newPresset.avatar);
      this.spells = newPresset.spells.map(Spell => new Spell(this));
    }
  }
}
