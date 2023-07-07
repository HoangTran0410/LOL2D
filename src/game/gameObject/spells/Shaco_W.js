import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Shaco_W extends Spell {
  image = AssetManager.getAsset('spell_shaco_w');
  name = 'Hộp Hề Ma Quái (Shaco_W)';
  description =
    'Tạo một Hộp Hề Ma Quái ẩn. Khi kẻ địch tới gần, nó sẽ gây hoảng sợ và tấn công các kẻ địch xung quanh, gây 7 sát thương mỗi lần tấn công, tối đa 3 lần.';
  coolDown = 1000;

  onSpellCast() {}
  onUpdate() {}
}

export class Shaco_W_Buff extends Buff {
  image = AssetManager.getAsset('buff_name');
  description = '';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;
  onCreate() {}
  onActivate() {}
  onDeactivate() {}
  onUpdate() {}
  draw() {}
}

export class Shaco_W_Object extends SpellObject {
  update() {}
  draw() {}
}
