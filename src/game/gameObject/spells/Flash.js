import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';

export default class Flash extends Spell {
  name = 'Tốc Biến (Flash)';
  image = AssetManager.getAsset('spell_flash');
  description =
    '<span class="buff">Lập tức dich chuyển</span> tới vị trí con trỏ, tối đa 180px khoảng cách';
  coolDown = 5000;
  manaCost = 100;

  onSpellCast() {
    let maxDistance = 180;

    let oldPos = this.owner.position.copy();
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      maxDistance
    );
    this.owner.teleportTo(to.x, to.y);

    // add smoke effect
    let newPosEffect = new Flash_Object(this.owner);
    this.game.objectManager.addObject(newPosEffect);

    let oldPosEffect = new Flash_Object(this.owner, oldPos);
    oldPosEffect.position = oldPos;
    this.game.objectManager.addObject(oldPosEffect);
  }
}

export class Flash_Object extends SpellObject {
  particleSystem = PredefinedParticleSystems.smoke([255, 255, 100]);

  onAdded() {
    this.game.objectManager.addObject(this.particleSystem);

    let pos = this.position;
    let size = this.owner.stats.size.value / 2;
    for (let i = 0; i < 10; i++) {
      this.particleSystem.addParticle({
        x: pos.x + random(-size, size),
        y: pos.y + random(-size, size),
        size: random(10, 20),
        opacity: random(100, 200),
      });
    }

    this.toRemove = true;
  }
}
