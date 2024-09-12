import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import Nearsight from '../buffs/Nearsight.js';
import Slow from '../buffs/Slow.js';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Graves_W extends Spell {
  image = AssetManager.getAsset('spell_graves_w');
  name = 'Bom mù (Graves_W)';
  description =
    'Tạo một làn khói tại khu vực chỉ định trong <span class="time">5 giây</span>, <span class="buff">Giảm tầm nhìn</span> và <span class="buff">Làm chậm 40%</span> tất cả kẻ địch / đồng minh trong khu vực';
  coolDown = 5000;

  range = 350;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    let obj = new Graves_W_Object(this.owner);
    obj.position = to;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Graves_W_Object extends SpellObject {
  position = createVector();
  range = 100;
  curRange = 0;
  lifeTime = 5000;
  age = 0;

  particleSystem = PredefinedParticleSystems.smoke([200, 200, 200], 0.8, 0.5);

  onAdded() {
    this.game.objectManager.addObject(this.particleSystem);

    let pos = this.position;
    let size = this.range / 2;
    for (let i = 0; i < 10; i++) {
      this.particleSystem.addParticle({
        x: pos.x + random(-size, size),
        y: pos.y + random(-size, size),
        size: random(15, 30),
        opacity: random(100, 200),
      });
    }
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      this.particleSystem.toRemove = true;
    }

    this.curRange = lerp(this.curRange, this.range, 0.08);

    let enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.curRange,
      }),
      filters: [
        PredefinedFilters.canTakeDamage,
        // PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
      ],
    });

    enemies.forEach(enemy => {
      if (!enemy.hasBuff(Nearsight)) {
        let nearsight = new Nearsight(500, this.owner, enemy);
        nearsight.newVisionRadius = this.range;
        enemy.addBuff(nearsight);

        let slow = new Slow(500, this.owner, enemy);
        slow.percent = 0.4;
        enemy.addBuff(slow);
      }
    });
  }
  draw() {
    push();
    stroke(100);
    fill(100, 40);
    circle(this.position.x, this.position.y, this.curRange * 2);
    pop();
  }
  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.range,
      y: this.position.y - this.range,
      w: this.range * 2,
      h: this.range * 2,
      data: this,
    });
  }
}
