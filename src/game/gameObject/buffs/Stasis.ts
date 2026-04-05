// TODO: https://leagueoflegends.fandom.com/wiki/Stasis

import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';

export default class Stasis extends Buff {
  image = AssetManager.getAsset('buff_stasis');
  name = 'Trạng Thái';
  buffAddType = BuffAddType.REPLACE_EXISTING;
}
