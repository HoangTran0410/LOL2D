import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Root from '../buffs/Root';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const RANGE = 600;
export const DAMAGE = 35;
export const ROOT_DURATION = 1800;
export const SPREAD_RADIUS = 220;

/**
 * Chain of Corruption: the tendril roots whoever it catches, then jumps from
 * that body to everyone standing near them. Grouping up is the mistake.
 */
export default class Varus_R extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_varus_r');
  name = 'Xích Sắt Hư Không (Varus_R)';
  description =
    `Phóng một dây leo: mục tiêu đầu tiên trúng phải nhận <span class="damage">${DAMAGE} sát thương</span>` +
    ` và bị <span class="buff">Trói Chân</span> trong <span class="time">${ROOT_DURATION / 1000} giây</span>,` +
    ` rồi lan sang mọi kẻ địch trong <span>${SPREAD_RADIUS}px</span> quanh nó`;
  coolDown = 10000;
  manaCost = 70;

  range = RANGE;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
    const chain = new Varus_R_Object(this.owner);
    chain.destination = to;
    this.game.objectManager.addObject(chain);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Varus_R_Object extends MissileSpellObject {
  speed = 12;
  size = 26;
  maxHitCount = 1;

  onHit(enemy: AttackableUnit) {
    this.corrupt(enemy);

    // ...and on to everyone standing with them.
    const nearby = this.game.objectManager.queryObjects({
      area: new Circle({ x: enemy.position.x, y: enemy.position.y, r: SPREAD_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    nearby.forEach((other: any) => {
      if (other !== enemy) this.corrupt(other);
    });

    const spread = new AoePulse(this.owner);
    spread.position = enemy.position.copy();
    spread.radius = SPREAD_RADIUS;
    spread.lifeTime = 600;
    spread.color = [170, 110, 240];
    spread.style = 'bandage';
    spread.spokes = 14;
    this.game.objectManager.addObject(spread);
  }

  corrupt(victim: AttackableUnit) {
    victim.takeDamage(DAMAGE, this.owner);
    victim.addBuff(new Root(ROOT_DURATION, this.owner, victim));
  }

  draw() {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    noFill();
    stroke(180, 110, 240, 230);
    strokeWeight(5);
    // a writhing tendril rather than a bolt
    beginShape();
    for (let i = 0; i <= 8; i++) {
      const p = i / 8;
      vertex(-30 + p * 40, Math.sin(p * PI * 3 + frameCount / 4) * 7);
    }
    endShape();
    pop();
  }
}
