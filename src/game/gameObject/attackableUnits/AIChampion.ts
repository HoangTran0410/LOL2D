import AssetManager from '../../../managers/AssetManager';
import { getChampionPresetRandom } from '../../preset';
import Champion from './Champion';

export default class AIChampion extends Champion {
  _autoMove = true;
  _autoCast = true;
  _autoMoveOnTakeDamage = true;
  _autoMoveOnCollideWall = true;
  _autoMoveOnCollideMapEdge = true;
  _respawnWithNewPreset = true;

  constructor({
    game,
    position,
    collisionRadius,
    visionRadius,
    teamId,
    stats,
    avatar,
    preset,
  }: {
    game?: any;
    position?: p5.Vector;
    collisionRadius?: number;
    visionRadius?: number;
    teamId?: string;
    stats?: any;
    avatar?: any;
    preset?: any;
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, stats, avatar, preset });
  }

  update() {
    super.update();

    if (this._autoMove) {
      let distToDest = this.position.dist(this.destination);
      if (distToDest < this.stats.speed.value) {
        this.moveToRandomLocation();
      }
    }

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
    this.onCollideMapEdge?.();
    if (this._autoMoveOnCollideMapEdge) this.moveToRandomLocation();
  }

  onCollideWall() {
    this.onCollideWall?.();
    if (this._autoMoveOnCollideWall) this.moveToRandomLocation();
  }

  takeDamage(damage: number, attacker: any) {
    super.takeDamage(damage, attacker);
    if (this._autoMoveOnTakeDamage) this.moveToRandomLocation();
  }

  respawn() {
    super.respawn();

    if (this._respawnWithNewPreset) {
      let newPreset = getChampionPresetRandom();
      this.avatar = AssetManager.getAsset(newPreset.avatar);
      this.spells = newPreset.spells.map((Spell: any) => new Spell(this));
    }
  }
}
