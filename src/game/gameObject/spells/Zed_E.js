import { Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import ParticleSystem from '../helpers/ParticleSystem.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Zed_E extends Spell {
  image = AssetManager.getAsset('spell_zed_e');
  name = 'Đường kiếm bóng tối (Zed_E)';
  description =
    'Xoay lưỡi kiếm xung quanh bản thân. Gây <span class="damage">15 sát thương</span> và <span class="buff">Làm chậm 30%</span> các kẻ địch trong <span class="time">1 giây</span>';
  coolDown = 1000;

  onSpellCast() {
    const obj = new Zed_E_Object(this.owner);
    this.game.objectManager.addObject(obj);
  }
}

export class Zed_E_Object extends SpellObject {
  angle = 0;
  radius = 100;

  particleSystem = new ParticleSystem({
    getParticlePosFn: p => p.position,
    getParticleSizeFn: p => 10,
    isDeadFn: p => p.lifeSpan <= 0,
    updateFn: p => {
      p.position.add(p.velocity);
      p.lifeSpan -= deltaTime;
    },
    drawFn: p => {
      let alpha = map(p.lifeSpan, 0, p.lifeTime, 100, 255);
      stroke(255, 234, 79, alpha);
      strokeWeight(random(3, 8));
      let len = p.velocity.copy().setMag(random(5, 10));
      line(p.position.x, p.position.y, p.position.x + len.x, p.position.y + len.y);
    },
  });

  onAdded() {}
  onRemoved() {}
  update() {
    this.position.set(this.owner.position.x, this.owner.position.y);

    this.angle += 0.5;
    if (this.angle > 2 * Math.PI) {
      this.toRemove = true;
    }
  }

  draw() {
    // draw 2 blades on each side of the owner
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    fill(200);
    rect(-this.radius, -5, this.radius * 2, 10);

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.radius,
      y: this.position.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }
}
