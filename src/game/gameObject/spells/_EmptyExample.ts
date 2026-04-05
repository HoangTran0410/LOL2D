import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';
import ParticleSystem from '../helpers/ParticleSystem';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export default class SpellName extends Spell {
  image = AssetManager.getAsset('spell_name');
  name = '';
  description = 'Spell description';
  coolDown = 1000;

  onSpellCast() {}
  onUpdate() {}
}

export class SpellName_Buff extends Buff {
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

export class SpellName_Object extends SpellObject {
  onAdded() {}
  onRemoved() {}
  update() {}
  draw() {}
  getDisplayBoundingBox(): any {}
}
