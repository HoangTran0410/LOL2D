import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';
import GameObject from '../GameObject';

// Cung cấp tầm nhìn
export default class TrueSight extends Buff {
  image: Buff['image'] = AssetManager.get('buff_truesight');
  name = 'Lộ Diện';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  statusFlagsToDisable = StatusFlags.Stealthed;

  visionRadius = 100;

  sightObj: GameObject | null = null;

  onCreate(): void {
    // share the live position vector so the sight follows the unit
    this.sightObj = new GameObject({
      game: this.game,
      position: this.targetUnit.position,
      teamId: this.sourceUnit.teamId,
      visionRadius: this.visionRadius,
    });
  }

  onActivate(): void {
    if (this.sightObj) this.game.objectManager.addObject(this.sightObj);
  }

  onDeactivate(): void {
    if (this.sightObj) this.sightObj.toRemove = true;
  }
}
