import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import DamageOverTime from '../buffs/DamageOverTime';
import Slow from '../buffs/Slow';

const FROST_COLOR: [number, number, number] = [150, 220, 255];

export default class Anivia_R extends Spell {
  image = AssetManager.getAsset('spell_anivia_r');
  name = 'Bão Tuyết (Anivia_R)';
  description =
    'Triệu hồi một cơn bão tuyết tại vị trí chỉ định trong <span class="time">5 giây</span>, bão lớn dần theo thời gian. Kẻ địch bên trong bị <span class="buff">Làm Chậm 50%</span> và nhận <span class="damage">4 sát thương mỗi 0.5 giây</span>';
  coolDown = 15000;
  manaCost = 60;

  range = 450;
  duration = 5000;
  startRadius = 70;
  endRadius = 190;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Anivia_R_Object(this.owner);
    obj.position = to;
    obj.lifeTime = this.duration;
    obj.startRadius = this.startRadius;
    obj.endRadius = this.endRadius;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

/** A circular zone whose radius ramps from `startRadius` to `endRadius` over its life. */
export class Anivia_R_Object extends SpellObject {
  position = this.owner.position.copy();

  lifeTime = 5000;
  age = 0;
  startRadius = 70;
  endRadius = 190;
  radius = 70;

  slowPercent = 0.5;
  damagePerTick = 4;
  tickInterval = 500;

  applyInterval = 250;
  _timeSinceApply = 0;
  _swirl = 0;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    this.radius = map(this.age, 0, this.lifeTime, this.startRadius, this.endRadius);
    this.visionRadius = this.radius;
    this._swirl += deltaTime / 900;

    this._timeSinceApply += deltaTime;
    if (this._timeSinceApply < this.applyInterval) return;
    this._timeSinceApply = 0;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.radius,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    enemies.forEach((enemy: any) => {
      const slowBuff = new Slow(this.applyInterval * 2, this.owner, enemy);
      slowBuff.percent = this.slowPercent;
      slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      slowBuff.image = AssetManager.getAsset('spell_anivia_r');
      enemy.addBuff(slowBuff);

      const frostBite = new DamageOverTime(this.applyInterval * 3, this.owner, enemy);
      frostBite.stackId = 'anivia_r_frost';
      frostBite.damagePerTick = this.damagePerTick;
      frostBite.tickInterval = this.tickInterval;
      frostBite.flameColor = FROST_COLOR;
      frostBite.name = 'Tê Cóng';
      frostBite.image = AssetManager.getAsset('spell_anivia_r');
      enemy.addBuff(frostBite);
    });
  }

  draw() {
    const fade =
      this.age > this.lifeTime - 600 ? map(this.age, this.lifeTime - 600, this.lifeTime, 1, 0) : 1;

    push();
    translate(this.position.x, this.position.y);

    noStroke();
    fill(150, 210, 245, 45 * fade);
    circle(0, 0, this.radius * 2);

    strokeWeight(2);
    stroke(220, 245, 255, 140 * fade);
    noFill();
    circle(0, 0, this.radius * 2);

    // three spiral arms turning around the eye of the storm
    stroke(255, 170 * fade);
    strokeWeight(2);
    for (let arm = 0; arm < 3; arm++) {
      const offset = this._swirl + (arm / 3) * TWO_PI;
      beginShape();
      for (let t = 0; t <= 1.001; t += 0.1) {
        const r = this.radius * (0.15 + t * 0.85);
        const a = offset + t * 2.4;
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape();
    }

    // drifting snow flecks
    noStroke();
    fill(255, 200 * fade);
    for (let i = 0; i < 8; i++) {
      const a = random(TWO_PI);
      const r = random(this.radius);
      circle(cos(a) * r, sin(a) * r, random(2, 5));
    }

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.endRadius,
      y: this.position.y - this.endRadius,
      w: this.endRadius * 2,
      h: this.endRadius * 2,
      data: this,
    });
  }
}
