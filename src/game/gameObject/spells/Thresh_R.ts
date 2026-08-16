import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Slow from '../buffs/Slow';

export const RADIUS = 280;
export const DURATION = 4000;
export const DAMAGE = 30;
export const SLOW_PERCENT = 0.7;

/**
 * The Box. A cage of walls: standing inside costs nothing, *leaving* is what
 * breaks a wall and hurts. One break per victim, exactly as in League — which
 * is why `broken` is a list rather than a flag.
 */
export default class Thresh_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_thresh_r');
  name = 'Chiếc Hộp (Thresh_R)';
  description =
    `Dựng một chiếc lồng bán kính <span>${RADIUS}px</span> quanh mình trong` +
    ` <span class="time">${DURATION / 1000} giây</span>. Kẻ địch <span class="damage">bước ra khỏi lồng</span>` +
    ` nhận <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>` +
    ` — mỗi kẻ chỉ phá được một lần`;
  coolDown = 10000;
  manaCost = 70;

  onSpellCast() {
    this.game.objectManager.addObject(new Thresh_R_Object(this.owner));
  }

  drawPreview() {
    super.drawPreview(RADIUS);
  }
}

export class Thresh_R_Object extends SpellObject {
  position: p5.Vector = this.owner.position.copy();
  radius = RADIUS;
  visionRadius = RADIUS;
  lifeTime = DURATION;
  age = 0;
  /** Everyone currently inside, so leaving can be noticed. */
  inside = new Set<unknown>();
  /** Everyone who has already paid for one wall. */
  broken = new Set<unknown>();

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as any[];

    const nowInside = new Set<unknown>(enemies);
    for (const unit of this.inside) {
      if (nowInside.has(unit) || this.broken.has(unit)) continue;
      const escapee = unit as any;
      if (!escapee?.takeDamage || escapee.isDead) continue;
      this.broken.add(unit);
      escapee.takeDamage(DAMAGE, this.owner);
      const slow = new Slow(2000, this.owner, escapee);
      slow.percent = SLOW_PERCENT;
      escapee.addBuff(slow);
    }
    this.inside = nowInside;
  }

  draw() {
    const left = 1 - this.age / this.lifeTime;
    push();
    translate(this.position.x, this.position.y);
    // the walls: separate panels around the rim, each dimming once broken
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * TWO_PI + this.age / 2500;
      push();
      rotate(a);
      noStroke();
      fill(120, 255, 205, 90 * left);
      rect(this.radius - 8, -this.radius * 0.28, 10, this.radius * 0.56, 4);
      pop();
    }
    noFill();
    stroke(120, 255, 205, 130 * left);
    strokeWeight(2);
    circle(0, 0, this.radius * 2);
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
