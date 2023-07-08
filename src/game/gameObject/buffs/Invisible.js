import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import Buff from '../Buff.js';

export default class Invisible extends Buff {
  image = AssetManager.getAsset('buff_invisible');
  name = 'Tàng Hình';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  statusFlagsToEnable = StatusFlags.Stealthed;
}
