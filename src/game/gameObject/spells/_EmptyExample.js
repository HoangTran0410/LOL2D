import ASSETS from '../../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class SpellName extends Spell {
  image = ASSETS.Spells.spell_name;
  name = '';
  description = 'Spell description';
  coolDown = 1000;

  onSpellCast() {}
  onUpdate() {}
}

export class SpellName_Buff extends Buff {
  image = ASSETS.Buffs.buff_name;
  description = '';
  buffAddType = BuffAddType.REPLACE_EXISTING;
  maxStacks = 1;
  onCreate() {}
  onActivate() {}
  onDeactivate() {}
  onUpdate() {}
  draw() {}
}

export class SpellName_Object extends SpellObject {
  init() {}
  update() {}
  draw() {}
}
