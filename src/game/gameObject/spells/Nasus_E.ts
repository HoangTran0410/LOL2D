import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export const MAX_RANGE = 450;
export const RADIUS = 170;
export const DURATION = 4000;
export const DAMAGE_PER_TICK = 4;
export const TICK_INTERVAL = 500;

export default class Nasus_E extends Spell {
  targetingMode = 'POINT' as const;
  image = AssetManager.get('spell_nasus_e');
  name = 'Ngọn Lửa Linh Hồn (Nasus_E)';
  description =
    `Gọi một vùng lửa bán kính <span>${RADIUS}px</span> tồn tại <span class="time">${DURATION / 1000} giây</span>,` +
    ` gây <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi <span class="time">${TICK_INTERVAL / 1000} giây</span>` +
    ` cho kẻ địch đứng trong đó`;
  coolDown = 10000;
  manaCost = 30;

  maxRange = MAX_RANGE;

  onSpellCast() {
    const aim = this.aimPoint;
    const position = aim
      .copy()
      .sub(this.owner.position)
      .setMag(Math.min(this.maxRange, aim.dist(this.owner.position)))
      .add(this.owner.position);

    const fire = new Nasus_E_Object(this.owner);
    fire.position = position;
    this.game.objectManager.addObject(fire);
  }

  drawPreview() {
    super.drawPreview(this.maxRange);
  }
}

export class Nasus_E_Object extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = RADIUS;
  visionRadius = RADIUS;
  lifeTime = DURATION;
  age = 0;
  sinceTick = 0;

  update() {
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }
    if (this.sinceTick < TICK_INTERVAL) return;
    this.sinceTick -= TICK_INTERVAL;

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    enemies.forEach((enemy: any) => enemy.takeDamage(DAMAGE_PER_TICK, this.owner));
  }

  draw() {
    const t = this.age / this.lifeTime;
    const fade = t > 0.85 ? (1 - t) / 0.15 : 1;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(255, 140, 40, 40 * fade);
    circle(0, 0, this.radius * 2);
    noFill();
    stroke(255, 190, 90, 170 * fade);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);
    // tongues of flame licking around the rim, wandering with the clock
    noStroke();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TWO_PI + this.age / 400;
      const d = this.radius * (0.55 + 0.4 * Math.abs(Math.sin(this.age / 220 + i)));
      fill(255, 180 + i * 5, 60, 190 * fade);
      circle(cos(a) * d, sin(a) * d, 12 + 6 * Math.sin(this.age / 130 + i));
    }
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
