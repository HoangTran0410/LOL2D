import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Dash from '../buffs/Dash';
import Slow from '../buffs/Slow';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

/** Half the length of the sweep box, measured from Thresh outwards — it reaches behind him too. */
export const HALF_LENGTH = 220;
/** Half the width of the box, across the swing. */
export const HALF_WIDTH = 90;
export const DAMAGE = 18;
export const SWEEP_DISTANCE = 160;
export const SLOW_PERCENT = 0.4;

/**
 * Flay.
 *
 * Two things this had wrong, and they are the whole ability:
 *
 *   - **The area was a circle around Thresh.** Flay is a *sweep*: the chain
 *     comes across in one direction, so the shape is a rectangle centred on
 *     him and turned to face the cursor. A circle catches the people standing
 *     behind him at right angles to the swing, who should be untouched.
 *   - **Everyone was shoved along the same vector, so a clump scattered.**
 *     They were, in fact, all given the same offset — but from *their own*
 *     positions, so the body-separation system pushed them apart on arrival
 *     and it read as a radial knock. They are swept to the far edge of the box
 *     now: one direction, one line, the way a chain across the shins works.
 */
export default class Thresh_E extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_thresh_e');
  name = 'Quét Xích (Thresh_E)';
  description =
    `Quất xích thành một <span class="buff">vệt quét hình chữ nhật</span> dài <span>${HALF_LENGTH * 2}px</span>` +
    ` rộng <span>${HALF_WIDTH * 2}px</span>, tâm ở Thresh và xoay theo hướng con trỏ:` +
    ` <span class="damage">${DAMAGE} sát thương</span>, <span class="buff">quét</span> kẻ địch` +
    ` <span>${SWEEP_DISTANCE}px</span> theo đúng hướng quất và <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>`;
  coolDown = 8000;
  manaCost = 30;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, HALF_LENGTH);
    const heading = Math.atan2(to.y - this.owner.position.y, to.x - this.owner.position.x);
    const along = createVector(Math.cos(heading), Math.sin(heading));

    for (const enemy of this.enemiesInBox(heading)) {
      enemy.takeDamage(DAMAGE, this.owner);
      const slow = new Slow(1500, this.owner, enemy);
      slow.percent = SLOW_PERCENT;
      enemy.addBuff(slow);

      // A Dash rather than a position write: walls, cancellation and the
      // travel are all the displacement system's job (see Singed E).
      const shove = new Dash(1000, this.owner, enemy);
      shove.dashDestination = enemy.position.copy().add(along.copy().mult(SWEEP_DISTANCE));
      shove.dashSpeed = 16;
      shove.cancelable = false;
      shove.showTrail = false;
      enemy.addBuff(shove);
    }

    const swing = new Thresh_E_Object(this.owner);
    swing.heading = heading;
    this.game.objectManager.addObject(swing);
  }

  /**
   * The box, tested in Thresh's own frame: rotate each candidate back by the
   * heading and it is two comparisons. The circle query around it is only the
   * broad phase — a quadtree hands back candidates, never members.
   */
  enemiesInBox(heading: number): AttackableUnit[] {
    const reach = Math.hypot(HALF_LENGTH, HALF_WIDTH);
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: reach }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const cos = Math.cos(-heading);
    const sin = Math.sin(-heading);
    const inside: AttackableUnit[] = [];
    for (const enemy of candidates) {
      const dx = enemy.position.x - this.owner.position.x;
      const dy = enemy.position.y - this.owner.position.y;
      const along = dx * cos - dy * sin;
      const across = dx * sin + dy * cos;
      const body = enemy.collisionRadius ?? 0;
      if (Math.abs(along) > HALF_LENGTH + body) continue;
      if (Math.abs(across) > HALF_WIDTH + body) continue;
      inside.push(enemy);
    }
    return inside;
  }

  drawPreview() {
    super.drawPreview(HALF_LENGTH);
  }
}

/** The swing: a box wiping across in the direction it was aimed. */
export class Thresh_E_Object extends SpellObject {
  heading = 0;
  lifeTime = 320;
  age = 0;
  visionRadius = HALF_LENGTH;

  update() {
    this.position = this.owner.position.copy();
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const fade = 1 - t;

    push();
    translate(this.owner.position.x, this.owner.position.y);
    rotate(this.heading);

    // the box that was actually tested — the player should be able to learn it
    noFill();
    stroke(120, 255, 205, 140 * fade);
    strokeWeight(2);
    rect(-HALF_LENGTH, -HALF_WIDTH, HALF_LENGTH * 2, HALF_WIDTH * 2, 6);

    // the chain wiping through it, back to front, in one direction
    const wipe = -HALF_LENGTH + HALF_LENGTH * 2 * t;
    stroke(180, 255, 225, 240 * fade);
    strokeWeight(7 * fade + 2);
    line(wipe, -HALF_WIDTH, wipe, HALF_WIDTH);
    stroke(120, 255, 205, 120 * fade);
    strokeWeight(3);
    line(wipe - 26, -HALF_WIDTH * 0.7, wipe - 26, HALF_WIDTH * 0.7);

    // the direction it is sending them, drawn as arrowheads on the leading edge
    noStroke();
    fill(200, 255, 235, 220 * fade);
    for (let i = -1; i <= 1; i++) {
      const y = i * HALF_WIDTH * 0.55;
      triangle(wipe + 6, y - 7, wipe + 6, y + 7, wipe + 22, y);
    }
    pop();
  }

  getDisplayBoundingBox() {
    const span = Math.hypot(HALF_LENGTH, HALF_WIDTH);
    return new Rectangle({
      x: this.owner.position.x - span,
      y: this.owner.position.y - span,
      w: span * 2,
      h: span * 2,
      data: this,
    });
  }
}
