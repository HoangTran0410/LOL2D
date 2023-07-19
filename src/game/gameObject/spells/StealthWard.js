import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class StealthWard extends Spell {
  image = AssetManager.getAsset('spell_stealthward');
  name = 'Mắt Xanh (Stealth Ward)';
  description = 'Cắm một mắt xanh, cung cấp tầm nhìn 700px, tồn tại 20s.';
  coolDown = 10000;

  maxRange = 300;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.maxRange
    );

    let obj = new StealthWard_Object(this.owner);
    obj.position = to;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}

export class StealthWard_Object extends SpellObject {
  visionRadius = 350;
  size = 0;
  maxSize = 10;
  lifeTime = 20000;
  age = 0;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
    this.size = lerp(this.size, this.maxSize, 0.1);
  }

  draw() {
    push();
    noStroke();
    fill(250, 255, 0, 50);
    ellipse(this.position.x, this.position.y, this.size);
    pop();
  }
}
