import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Fear from '../buffs/Fear';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const RANGE = 350;
export const DAMAGE = 22;
export const CHANNEL_MS = 1500;
export const FEAR_DURATION = 1500;
/** Past this the tether snaps and nobody is feared. */
export const LEASH_RANGE = 500;

/**
 * Unspeakable Horror. The fear is not instant — a tether goes up and *then*
 * pays out, so the victim gets the whole channel to break the leash by running.
 */
export default class Nocturne_E extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_nocturne_e');
  name = 'Nỗi Kinh Hoàng (Nocturne_E)';
  description =
    `Nối một sợi xích với kẻ địch gần nhất trong <span>${RANGE}px</span>, gây` +
    ` <span class="damage">${DAMAGE} sát thương</span>. Nếu sau <span class="time">${CHANNEL_MS / 1000} giây</span>` +
    ` xích chưa đứt (xa hơn <span>${LEASH_RANGE}px</span>), mục tiêu bị <span class="buff">Khiếp Sợ</span>` +
    ` trong <span class="time">${FEAR_DURATION / 1000} giây</span>`;
  coolDown = 10000;
  manaCost = 35;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget();
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    target.takeDamage(DAMAGE, this.owner);

    const tether = new Nocturne_E_Object(this.owner);
    tether.victim = target;
    this.game.objectManager.addObject(tether);
  }

  _findTarget() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    let nearest = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = this.owner.position.dist(enemy.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = enemy;
      }
    }
    return nearest;
  }

  drawPreview() {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

export class Nocturne_E_Object extends SpellObject {
  victim: AttackableUnit | null = null;
  age = 0;

  update() {
    this.age += deltaTime;
    const victim = this.victim as any;
    if (!victim || victim.isDead || this.owner.isDead) {
      this.toRemove = true;
      return;
    }
    // Snapped: walking out of the leash is the counterplay, so it must end the
    // tether without paying anything out.
    if (this.owner.position.dist(victim.position) > LEASH_RANGE) {
      this.toRemove = true;
      return;
    }
    if (this.age < CHANNEL_MS) return;

    this.toRemove = true;
    const fear = new Fear(FEAR_DURATION, this.owner, victim);
    fear.sourcePosition = this.owner.position.copy();
    victim.addBuff(fear);
  }

  draw() {
    const victim = this.victim as any;
    if (!victim) return;
    const t = constrain(this.age / CHANNEL_MS, 0, 1);
    push();
    // the chain, tightening as the channel completes
    stroke(150, 90, 230, 140 + 100 * t);
    strokeWeight(2 + 3 * t);
    noFill();
    const from = this.owner.position;
    const to = victim.position;
    beginShape();
    for (let i = 0; i <= 8; i++) {
      const p = i / 8;
      const sag = Math.sin(p * PI) * (1 - t) * 26;
      vertex(from.x + (to.x - from.x) * p, from.y + (to.y - from.y) * p + sag);
    }
    endShape();
    pop();
  }

  getDisplayBoundingBox() {
    const victim = this.victim as any;
    const other = victim?.position ?? this.owner.position;
    return new Rectangle({
      x: Math.min(this.owner.position.x, other.x) - 40,
      y: Math.min(this.owner.position.y, other.y) - 40,
      w: Math.abs(this.owner.position.x - other.x) + 80,
      h: Math.abs(this.owner.position.y - other.y) + 80,
      data: this,
    });
  }
}
