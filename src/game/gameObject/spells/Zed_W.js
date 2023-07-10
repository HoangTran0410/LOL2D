import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Zed_W extends Spell {
  image = AssetManager.getAsset('spell_zed_w');
  name = 'Phân Thân Bóng Tối (Zed_W)';
  description =
    'Tạo 1 phân thân lướt tới trước và đứng yên trong 5s, nó có thể bắt chước các kỹ năng bạn tung ra. Có thể tái kích hoạt kỹ nămg để đổi chỗ với phân thân.';
  coolDown = 1000;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      350
    );
  }

  onUpdate() {}
}

export class Zed_W_Object extends SpellObject {
  update() {}
  draw() {}
}
