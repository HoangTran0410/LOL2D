import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Airborne from '../buffs/Airborne';
import Slow from '../buffs/Slow';

export const RANGE = 160;
export const DAMAGE = 28;
export const THROW_DISTANCE = 130;

export default class Singed_E extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_singed_e');
  name = 'Quăng Người (Singed_E)';
  description =
    `Quăng kẻ địch gần nhất trong <span>${RANGE}px</span> ra sau lưng, gây` +
    ` <span class="damage">${DAMAGE} sát thương</span>, <span class="buff">Hất Tung</span> và` +
    ` <span class="buff">Làm Chậm 40%</span> chúng`;
  coolDown = 9000;
  manaCost = 25;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget();
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    target.takeDamage(DAMAGE, this.owner);
    target.addBuff(new Airborne(700, this.owner, target));
    const slow = new Slow(1500, this.owner, target);
    slow.percent = 0.4;
    target.addBuff(slow);

    // Thrown over the shoulder: from Singed's position, on past him.
    const away = target.position.copy().sub(this.owner.position);
    if (away.magSq() === 0) away.set(1, 0);
    target.position.add(away.setMag(THROW_DISTANCE));

    const ring = new AoePulse(this.owner);
    ring.position = target.position.copy();
    ring.radius = 70;
    ring.lifeTime = 400;
    ring.color = [180, 130, 220];
    this.game.objectManager.addObject(ring);
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
