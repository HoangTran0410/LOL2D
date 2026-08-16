import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { Rectangle } from '../../../libs/quadtree';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const RANGE = 700;
export const DAMAGE = 45;
export const FALLOFF = 10;

/**
 * Collateral Damage: one barrel, everything in the line. Damage falls off per
 * body so the shot rewards catching the front of a group rather than the back.
 */
export default class Graves_R extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_graves_r');
  name = 'Tổn Thất Ngoài Dự Kiến (Graves_R)';
  description =
    `Nã một phát đại bác xuyên thẳng <span>${RANGE}px</span>: <span class="damage">${DAMAGE} sát thương</span>` +
    ` cho mục tiêu đầu tiên, <span class="damage">giảm ${FALLOFF}</span> cho mỗi mục tiêu tiếp theo,` +
    ` kèm <span class="buff">Làm Chậm 40%</span>`;
  coolDown = 10000;
  manaCost = 60;

  range = RANGE;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
    const shot = new Graves_R_Object(this.owner);
    shot.destination = to;
    this.game.objectManager.addObject(shot);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Graves_R_Object extends MissileSpellObject {
  speed = 22;
  size = 34;
  /** Infinity: the shell does not stop at the first body, it goes through it. */
  maxHitCount = Infinity;

  onHit(enemy: AttackableUnit) {
    // `hitTargets` already contains this one, so the first victim pays full.
    const order = Math.max(0, this.hitTargets.length - 1);
    enemy.takeDamage(Math.max(10, DAMAGE - order * FALLOFF), this.owner);
    const slow = new Slow(1500, this.owner, enemy);
    slow.percent = 0.4;
    enemy.addBuff(slow);
  }

  draw() {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    noStroke();
    // a wide cone of shot, not a bullet
    fill(255, 170, 70, 90);
    triangle(-40, -18, -40, 18, 16, 0);
    fill(255, 230, 170, 230);
    triangle(-22, -8, -22, 8, 14, 0);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size * 1.5,
      y: this.position.y - this.size * 1.5,
      w: this.size * 3,
      h: this.size * 3,
      data: this,
    });
  }
}
