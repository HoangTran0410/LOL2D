import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Dash from '../buffs/Dash';
import Stun from '../buffs/Stun';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const RANGE = 550;
export const LEAP_SPEED = 24;
export const SUPPRESS_MS = 1500;
export const DAMAGE_PER_TICK = 9;
export const TICK_INTERVAL = 300;

/**
 * Infinite Duress: he crosses the gap and pins them there. The damage is paid
 * out over the pin rather than up front, so killing Warwick mid-ultimate is a
 * real save for the victim's team.
 */
export default class Warwick_R extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_warwick_r');
  name = 'Trói Buộc Vô Tận (Warwick_R)';
  description =
    `Nhảy tới kẻ địch gần nhất trong <span>${RANGE}px</span>, ghim chúng` +
    ` <span class="buff">Choáng</span> trong <span class="time">${SUPPRESS_MS / 1000} giây</span>` +
    ` và cắn <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi nhịp`;
  coolDown = 10000;
  manaCost = 70;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget() && Dash.CanDash(this.owner);
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    const leap = new Dash(1500, this.owner, this.owner);
    leap.image = this.image;
    leap.dashDestination = target.position.copy();
    leap.dashSpeed = LEAP_SPEED;
    leap.showTrail = true;
    leap.cancelable = false;
    this.owner.addBuff(leap);

    target.addBuff(new Stun(SUPPRESS_MS, this.owner, target));

    const pin = new Warwick_R_Object(this.owner);
    pin.victim = target;
    this.game.objectManager.addObject(pin);
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

export class Warwick_R_Object extends SpellObject {
  victim: AttackableUnit | null = null;
  age = 0;
  sinceTick = 0;

  update() {
    this.age += deltaTime;
    this.sinceTick += deltaTime;
    const victim = this.victim as any;
    // Nothing in this game outlives its caster: killing Warwick ends the pin.
    if (!victim || victim.isDead || this.owner.isDead || this.age >= SUPPRESS_MS) {
      this.toRemove = true;
      return;
    }
    if (this.sinceTick < TICK_INTERVAL) return;
    this.sinceTick -= TICK_INTERVAL;
    victim.takeDamage(DAMAGE_PER_TICK, this.owner);
  }

  draw() {
    const victim = this.victim as any;
    if (!victim) return;
    push();
    translate(victim.position.x, victim.position.y);
    // teeth closing on the victim
    noFill();
    stroke(255, 120, 100, 220);
    strokeWeight(3);
    const bite = 6 + 5 * Math.abs(Math.sin(this.age / 120));
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TWO_PI;
      const d = 26 + bite;
      line(cos(a) * d, sin(a) * d, cos(a) * (d - 12), sin(a) * (d - 12));
    }
    pop();
  }

  getDisplayBoundingBox() {
    const victim = this.victim as any;
    const at = victim?.position ?? this.owner.position;
    return new Rectangle({ x: at.x - 60, y: at.y - 60, w: 120, h: 120, data: this });
  }
}
