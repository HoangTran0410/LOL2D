import ASSETS from '../../../assets/index.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

export default class Silence extends Buff {
  image = ASSETS.Buffs.silence;

  onActivate() {
    this.targetUnit.status &= ~StatusFlags.CanCast;
  }

  onDeactivate() {
    this.targetUnit.status |= StatusFlags.CanCast;
  }
}
