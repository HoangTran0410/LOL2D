import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class LeeSin_R extends Spell {
  image = AssetManager.getAsset('speel_leesin_r');
  name = 'Nộ Long Cước (LeeSin_R)';
  description =
    'Tung cước làm mục tiêu văng ra phía sau, gây 30 sát thương. Kẻ địch bị mục tiêu va trúng sẽ bị hất tung trong 0.5s và gây 30 sát thương mỗi kẻ địch.';
  coolDown = 1000;

  onSpellCast() {}

  onUpdate() {}
}

export class LeeSin_R_Buff extends Buff {
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

export class LeeSin_R_Object extends SpellObject {
  init() {}
  update() {}
  draw() {}
}
