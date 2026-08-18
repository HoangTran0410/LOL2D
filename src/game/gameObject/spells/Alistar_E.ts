import { Circle, Rectangle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import Speedup from '@/game/gameObject/buffs/Speedup';

export const RADIUS = 150;
export const DURATION = 4000;
export const DAMAGE_PER_TICK = 4;
export const TICK_INTERVAL = 500;

export default class Alistar_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_alistar_e');
  name = 'Giày Xéo (Alistar_E)';
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
    const stamp = Math.abs(Math.sin(this.age / 150));
    push();
    translate(this.owner.position.x, this.owner.position.y);

    // A broken ring, stamping in time with the hooves — an unbroken circle is
    // what Amumu's aura and every ground effect already draws.
    noFill();
    stroke(220, 180, 110, 90 + 90 * stamp);
    strokeWeight(4 + 3 * stamp);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI - this.age / 700;
      arc(0, 0, this.radius * 2, this.radius * 2, a, a + 0.45);
    }

    // hoofprints scuffed into the dirt inside it
    noStroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TWO_PI + this.age / 1100;
      const d = this.radius * 0.62;
      push();
      translate(cos(a) * d, sin(a) * d);
      rotate(a);
      fill(150, 120, 80, 120);
      ellipse(-3, -4, 9, 7);
      ellipse(-3, 4, 9, 7);
      pop();
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
