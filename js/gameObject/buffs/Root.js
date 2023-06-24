import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

// Trói chân
export default class Root extends Buff {
  image = ASSETS.Buffs.root;
  buffAddType = BuffAddType.RENEW_EXISTING;

  onUpdate() {
    // apply root every frame
    this.targetUnit.status &= ~StatusFlags.CanMove;
  }

  onDeactivate() {
    this.targetUnit.status |= StatusFlags.CanMove;
  }
}
