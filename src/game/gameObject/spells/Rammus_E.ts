import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import Disarm from '../buffs/Disarm';
import Slow from '../buffs/Slow';

export const RANGE = 300;
export const DAMAGE = 12;
export const DURATION = 1800;

/**
 * The taunt, adapted. There is no "walk at me" crowd control in this game and
 * inventing one is a target-acquisition feature, not a spell — so Frenzying
 * Taunt lands as what a taunt *costs* the victim instead: it cannot swing and
 * it cannot leave in a hurry.
 */
export default class Rammus_E extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_rammus_e');
  name = 'Khiêu Khích (Rammus_E)';
  description =
    `Chọc giận kẻ địch gần nhất trong <span>${RANGE}px</span>: gây <span class="damage">${DAMAGE} sát thương</span>,` +
    ` <span class="buff">Tước Vũ Khí</span> và <span class="buff">Làm Chậm 45%</span> trong` +
    ` <span class="time">${DURATION / 1000} giây</span>`;
  coolDown = 10000;
  manaCost = 25;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget();
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    target.takeDamage(DAMAGE, this.owner);
    target.addBuff(new Disarm(DURATION, this.owner, target));
    const slow = new Slow(DURATION, this.owner, target);
    slow.percent = 0.45;
    target.addBuff(slow);

    const ring = new AoePulse(this.owner);
    ring.position = target.position.copy();
    ring.radius = 65;
    ring.lifeTime = 450;
    ring.color = [255, 150, 90];
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
