import AssetManager from '../../../managers/AssetManager.js';
import { getPresetRandom } from '../../preset.js';
import Champion from './Champion.js';

export default class AIChampion extends Champion {
  _autoMove = true;
  _autoCast = true;
  _autoMoveOnTakeDamage = true;
  _autoMoveOnCollideWall = true;
  _autoMoveOnCollideMapEdge = true;
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
    let x = random(this.game.mapSize);
    let y = random(this.game.mapSize);
    this.moveTo(x, y);
  }

  onCollideMapEdge() {
    super.onCollideMapEdge?.();
    if (this._autoMoveOnCollideMapEdge) this.moveToRandomLocation();
  }

  onCollideWall() {
    super.onCollideWall?.();
    if (this._autoMoveOnCollideWall) this.moveToRandomLocation();
  }

  takeDamage(damage, attacker) {
    super.takeDamage(damage, attacker);
    if (this._autoMoveOnTakeDamage) this.moveToRandomLocation();
  }

  respawn() {
    super.respawn();

    if (this._respawnWithNewPreset) {
      let newPresset = getPresetRandom();
      this.avatar = AssetManager.getAsset(newPresset.avatar);
      this.spells = newPresset.spells.map(Spell => new Spell(this));
    }
  }
}
