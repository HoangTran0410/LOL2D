import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';

// Cung cấp tầm nhìn
export default class TrueSight extends Buff {
  image = AssetManager.getAsset('buff_truesight');
  name = 'Lộ Diện';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToDisable = StatusFlags.Stealthed;

  visionRadius = 100;

  sightObj: any = null;

  onCreate(): void {
    this.sightObj = new (this.game.objectManager.ObjectClasses.GameObject)({
      game: this.game,
      position: this.targetUnit.position.copy(),
      teamId: this.sourceUnit.teamId,
      visionRadius: this.visionRadius,
    });
  }

  onActivate(): void {
    this.game.objectManager.addObject(this.sightObj);
  }

  onDeactivate(): void {
    this.sightObj.toRemove = true;
  }
}
