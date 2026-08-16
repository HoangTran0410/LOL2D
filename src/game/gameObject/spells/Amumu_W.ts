import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export const RADIUS = 170;
export const DURATION = 5000;
export const DAMAGE_PER_TICK = 4;
export const TICK_INTERVAL = 500;

export default class Amumu_W extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_amumu_w');
  name = 'Tuyệt Vọng (Amumu_W)';
  description =
    `Tỏa ra nỗi buồn trong <span class="time">${DURATION / 1000} giây</span>, gây` +
    ` <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi <span class="time">${TICK_INTERVAL / 1000} giây</span>` +
    ` cho mọi kẻ địch trong <span>${RADIUS}px</span>`;
  coolDown = 10000;
  manaCost = 25;

  onSpellCast() {
    this.game.objectManager.addObject(new Amumu_W_Object(this.owner));
  }
}

export class Amumu_W_Object extends SpellObject {
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
    const pulse = 0.9 + 0.1 * Math.sin(this.age / 180);
    push();
    translate(this.owner.position.x, this.owner.position.y);
    noStroke();
    fill(90, 60, 140, 45);
    circle(0, 0, this.radius * 2 * pulse);
    noFill();
    stroke(150, 110, 220, 150);
    strokeWeight(2);
    circle(0, 0, this.radius * 2 * pulse);
    // tears falling inside the aura
    noStroke();
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI + this.age / 900;
      const d = this.radius * 0.5;
      const drop = (this.age / 6 + i * 30) % (this.radius * 0.7);
      fill(170, 200, 255, 170);
      ellipse(cos(a) * d, sin(a) * d + drop, 5, 9);
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
