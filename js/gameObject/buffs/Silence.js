import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

export default class Silence extends Buff {
  image = ASSETS.Buffs.silence;
  buffAddType = BuffAddType.RENEW_EXISTING;

  onUpdate() {
    // apply silence every frame
    this.targetUnit.status &= ~StatusFlags.CanCast;
  }

  onDeactivate() {
    this.targetUnit.status |= StatusFlags.CanCast;
  }
}
