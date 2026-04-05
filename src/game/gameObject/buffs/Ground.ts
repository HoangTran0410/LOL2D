// TODO: https://leagueoflegends.fandom.com/wiki/Ground

import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';

export default class Ground extends Buff {
  image = AssetManager.getAsset('buff_ground');
  name = 'Ghìm';
  buffAddType = BuffAddType.REPLACE_EXISTING;
}
