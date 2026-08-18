import AssetManager from '@/managers/AssetManager';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import Buff from '@/game/gameObject/Buff';

export default class Invisible extends Buff {
  image: Buff['image'] = AssetManager.get('buff_invisible');
  name = 'Tàng Hình';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  statusFlagsToEnable = StatusFlags.Stealthed;
}
