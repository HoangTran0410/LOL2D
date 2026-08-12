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
      this.aimPoint,
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

interface Flake {
  /** Polar, so a flake keeps its place in the vortex as the storm widens. */
  angle: number;
  radiusRatio: number;
  spin: number;
  size: number;
  drift: number;
}

const FLAKE_COUNT = 34;

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
  /** Cosmetic: counts down from each damage tick so the storm can pulse. */
  _bitePulse = 0;
  _flakes: Flake[] = [];

  onAdded() {
    for (let i = 0; i < FLAKE_COUNT; i++) {
      this._flakes.push({
        angle: random(TWO_PI),
        radiusRatio: Math.sqrt(random(0.02, 1)), // even spread over the disc
        spin: random(0.6, 1.9) * (random() < 0.5 ? -1 : 1),
        size: random(2.5, 6),
        drift: random(-0.06, 0.06),
      });
    }
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    this.radius = map(this.age, 0, this.lifeTime, this.startRadius, this.endRadius);
    this.visionRadius = this.radius;
    this._swirl += deltaTime / 900;
    if (this._bitePulse > 0) this._bitePulse -= deltaTime;

    // the vortex keeps turning whether or not anyone is standing in it
    const step = deltaTime / 1000;
    for (const flake of this._flakes) {
      flake.angle += flake.spin * step;
      flake.radiusRatio += flake.drift * step;
      if (flake.radiusRatio > 1) flake.radiusRatio = 0.12;
      if (flake.radiusRatio < 0.1) flake.radiusRatio = 1;
    }

    this._timeSinceApply += deltaTime;
    if (this._timeSinceApply < this.applyInterval) return;
    this._timeSinceApply = 0;
    this._bitePulse = 220; // cosmetic: a flash of frost on every application

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
    const bite = this._bitePulse > 0 ? this._bitePulse / 220 : 0;

    push();
    translate(this.position.x, this.position.y);

    // the ground the storm covers, brightest at the freezing eye
    noStroke();
    fill(120, 185, 235, 60 * fade);
    circle(0, 0, this.radius * 2);
    fill(190, 230, 255, 45 * fade);
    circle(0, 0, this.radius * 1.15);

    // the edge, drawn twice so it survives on both light and dark ground —
    // this is the line between "taking damage" and "safe"
    noFill();
    stroke(25, 70, 115, 200 * fade);
    strokeWeight(7);
    circle(0, 0, this.radius * 2);
    stroke(225, 248, 255, (185 + 70 * bite) * fade);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);

    // teeth of frost biting inwards off that edge
    stroke(215, 245, 255, 150 * fade);
    strokeWeight(3);
    for (let i = 0; i < 16; i++) {
      const a = (TWO_PI * i) / 16 + this._swirl * 0.35;
      const inner = this.radius - 10 - 8 * bite;
      line(cos(a) * inner, sin(a) * inner, cos(a) * this.radius, sin(a) * this.radius);
    }

    // three spiral arms turning around the eye of the storm
    push();
    blendMode(ADD);
    noFill();
    for (let arm = 0; arm < 3; arm++) {
      const offset = this._swirl + (arm / 3) * TWO_PI;
      stroke(150, 210, 255, 120 * fade);
      strokeWeight(9);
      beginShape();
      for (let t = 0; t <= 1.001; t += 0.1) {
        const r = this.radius * (0.15 + t * 0.85);
        const a = offset + t * 2.4;
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape();
      stroke(240, 252, 255, 190 * fade);
      strokeWeight(3);
      beginShape();
      for (let t = 0; t <= 1.001; t += 0.1) {
        const r = this.radius * (0.15 + t * 0.85);
        const a = offset + t * 2.4;
        vertex(cos(a) * r, sin(a) * r);
      }
      endShape();
    }
    blendMode(BLEND);
    pop();

    // snow riding the vortex — the same flakes every frame, so it does not fizz
    noStroke();
    for (const flake of this._flakes) {
      const r = this.radius * flake.radiusRatio;
      fill(255, (140 + 90 * flake.radiusRatio) * fade);
      circle(cos(flake.angle) * r, sin(flake.angle) * r, flake.size);
    }

    // the eye: a cold core that flares each time the storm bites
    noStroke();
    fill(255, (110 + 100 * bite) * fade);
    circle(0, 0, 16 + 10 * bite);

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
