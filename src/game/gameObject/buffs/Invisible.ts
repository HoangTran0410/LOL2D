import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import Buff from '../Buff';

export default class Invisible extends Buff {
  image: Buff['image'] = AssetManager.get('buff_invisible');
  name = 'Tàng Hình';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  statusFlagsToEnable = StatusFlags.Stealthed;
}
