import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Speedup from '../buffs/Speedup';

export const RADIUS = 150;
export const DURATION = 4000;
export const DAMAGE_PER_TICK = 4;
export const TICK_INTERVAL = 500;

export default class Alistar_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_alistar_e');
  name = 'Giẫm Đạp (Alistar_E)';
  description =
    `Lồng lên trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+30% tốc chạy</span>` +
    ` và gây <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi` +
    ` <span class="time">${TICK_INTERVAL / 1000} giây</span> cho kẻ địch trong <span>${RADIUS}px</span>`;
  coolDown = 10000;
  manaCost = 30;

  onSpellCast() {
    const speed = new Speedup(DURATION, this.owner, this.owner);
    speed.stackId = 'alistar_e';
    speed.image = this.image;
    speed.percent = 0.3;
    this.owner.addBuff(speed);

    this.game.objectManager.addObject(new Alistar_E_Object(this.owner));
  }

  drawPreview() {
    super.drawPreview(RADIUS);
  }
}

export class Alistar_E_Object extends SpellObject {
  radius = RADIUS;
  visionRadius = RADIUS;
  lifeTime = DURATION;
  age = 0;
  sinceTick = 0;

  update() {
    this.position = this.owner.position.copy();
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    if (this.age >= this.lifeTime || this.owner.isDead) {
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
    push();
    translate(this.owner.position.x, this.owner.position.y);
    noFill();
    stroke(220, 180, 110, 130);
    strokeWeight(3);
    circle(0, 0, this.radius * 2);
    // dust kicked up under the hooves
    noStroke();
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TWO_PI - this.age / 300;
      const d = this.radius * (0.6 + 0.35 * Math.abs(Math.sin(this.age / 250 + i)));
      fill(210, 180, 130, 130);
      circle(cos(a) * d, sin(a) * d, 10);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.owner.position.x - this.radius,
      y: this.owner.position.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }
}
