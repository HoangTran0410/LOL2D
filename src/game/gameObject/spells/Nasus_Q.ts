import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export const RANGE = 150;
export const BASE_DAMAGE = 25;
export const DAMAGE_PER_STACK = 5;

const describe = (stacks: number): string =>
  `Chém kẻ địch gần nhất trong phạm vi <span>${RANGE}px</span>, gây ` +
  `<span class="damage">${BASE_DAMAGE + stacks * DAMAGE_PER_STACK} sát thương</span>` +
  ` <i>(${stacks} cộng dồn)</i>. Mỗi lần chém trúng, sát thương của chiêu này ` +
  `<span class="buff">vĩnh viễn tăng thêm ${DAMAGE_PER_STACK}</span>`;

export default class Nasus_Q extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_nasus_q');
  name = 'Chém Hủy Diệt (Nasus_Q)';
  // Rebuilt on every stack so the tooltip states the damage the next strike
  // will actually deal, not the value it had at level one.
  description = describe(0);
  coolDown = 3000;
  manaCost = 10;

  range = RANGE;
  baseDamage = BASE_DAMAGE;
  damagePerStack = DAMAGE_PER_STACK;
  /** Grows by one every time the strike connects; never resets. */
  stacks = 0;

  /** Surfaced to the HUD, which badges the icon with it. */
  get stackCount(): number {
    return this.stacks;
  }

  checkCastCondition() {
    return !!this._findNearestEnemy();
  }

  onSpellCast() {
    const target = this._findNearestEnemy();
    if (!target) return;

    target.takeDamage(this.baseDamage + this.stacks * this.damagePerStack, this.owner);
    this.stacks++;
    this.description = describe(this.stacks);

    const obj = new Nasus_Q_Object(this.owner);
    obj.targetPosition = target.position.copy();
    obj.angle = VectorUtils.getAngle(this.owner.position, target.position);
    obj.targetSize = target.animatedValues?.displaySize ?? 50;
    obj.stacks = this.stacks;
    obj.range = this.range;
    this.game.objectManager.addObject(obj);
  }

  _findNearestEnemy() {
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

export class Nasus_Q_Object extends SpellObject {
  targetPosition: p5.Vector = this.owner.position.copy();
  angle = 0;
  size = 90;
  lifeTime = 350;
  age = 0;

  /** All cosmetic: how big the victim is, how many stacks this swing carried,
   *  and how far the strike could reach — the last one is the telegraph. */
  targetSize = 50;
  stacks = 1;
  range = 150;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;
    // the swing gets visibly heavier as the stacks pile up
    const heft = 1 + Math.min(0.5, this.stacks * 0.02);

    // --- the reach of the strike, flashed on the caster -------------------
    push();
    translate(this.owner.position.x, this.owner.position.y);
    noFill();
    stroke(255, 205, 120, 150 * fade);
    strokeWeight(3 * fade + 1);
    circle(0, 0, this.range * 2);
    // the arm of the swing, from Nasus to the victim
    stroke(255, 225, 160, 190 * fade);
    strokeWeight(6 * fade + 1);
    const reach = this.owner.position.dist(this.targetPosition);
    const swing = this.angle + (1 - t) * 0.5 - 0.25;
    line(0, 0, cos(swing) * reach, sin(swing) * reach);
    pop();

    // --- the strike landing on the victim ---------------------------------
    push();
    translate(this.targetPosition.x, this.targetPosition.y);

    // white flash on the first frames, so the moment of contact is obvious
    if (t < 0.3) {
      blendMode(ADD);
      noStroke();
      fill(255, 220, 150, 170 * (1 - t / 0.3));
      circle(0, 0, this.targetSize * 1.4 * heft);
      blendMode(BLEND);
    }

    rotate(this.angle);

    // three claw gashes sweeping across the target
    const span = this.targetSize * (0.9 + 0.5 * t) * heft;
    for (let i = -1; i <= 1; i++) {
      const off = i * span * 0.22;
      stroke(255, 245, 210, 240 * fade);
      strokeWeight((5 - Math.abs(i) * 1.5) * fade + 1);
      noFill();
      arc(off * 0.4, off, span, span * 1.5, -PI / 2.6 + t * 0.4, PI / 2.6 + t * 0.4);
    }

    // the heavy leading edge of the staff
    stroke(255, 200, 110, 220 * fade);
    strokeWeight(8 * fade + 2);
    arc(0, 0, span * 1.25, span * 1.7, -PI / 3 + t * 0.4, PI / 3 + t * 0.4);

    // sand and grit knocked loose
    noStroke();
    fill(240, 210, 150, 200 * fade);
    for (let i = 0; i < 6; i++) {
      const a = -0.9 + i * 0.36;
      const d = span * 0.45 + 40 * t;
      circle(cos(a) * d, sin(a) * d, (6 - i * 0.4) * fade + 1);
    }

    pop();

    // --- the tally ---------------------------------------------------------
    // below the unit: the health bar and buff icons already own the space above
    push();
    // Overlay, not world — see Camera.constantSize. The plate and its number
    // compensate together, or the digits float off the plate at a small scale.
    const k = this.game?.camera?.constantSize?.(1) ?? 1;
    const ty = this.targetPosition.y + this.targetSize * 0.6 + (16 + t * 10) * k;
    textAlign(CENTER, CENTER);
    noStroke();
    fill(20, 12, 0, 150 * fade);
    rect(this.targetPosition.x - 24 * k, ty - 10 * k, 48 * k, 20 * k, 5 * k);
    fill(255, 225, 165, 245 * fade);
    textSize((15 + 7 * (1 - Math.min(1, t * 4))) * k);
    text(`Q ${this.stacks}`, this.targetPosition.x, ty);
    pop();
  }

  getDisplayBoundingBox() {
    // covers the victim, the swing arm and the range ring around Nasus
    const minX = Math.min(this.targetPosition.x, this.owner.position.x) - this.range;
    const minY = Math.min(this.targetPosition.y, this.owner.position.y) - this.range;
    return new Rectangle({
      x: minX,
      y: minY,
      w: Math.abs(this.targetPosition.x - this.owner.position.x) + this.range * 2,
      h: Math.abs(this.targetPosition.y - this.owner.position.y) + this.range * 2,
      data: this,
    });
  }
}
