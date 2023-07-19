import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';
import GameObject from '../GameObject.js';

// Cung cấp tầm nhìn
export default class TrueSight extends Buff {
  image = AssetManager.getAsset('buff_truesight');
  name = 'Lộ Diện';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToDisable = StatusFlags.Stealthed;

  visionRadius = 100;

  onCreate() {
    this.sightObj = new GameObject({
      game: this.game,
      position: this.targetUnit.position,
      teamId: this.sourceUnit.teamId,
      visionRadius: this.visionRadius,
    });
  }

  onActivate() {
    this.game.objectManager.addObject(this.sightObj);
  }

  onDeactivate() {
    this.sightObj.toRemove = true;
  }
}
