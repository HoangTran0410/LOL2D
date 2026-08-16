import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import DamageOverTime from '../buffs/DamageOverTime';

export const RANGE = 450;
export const BASE_DAMAGE = 10;
export const POISONED_DAMAGE = 26;

/**
 * Twin Fang. Cheap and fast, and more than twice as hard on a poisoned target —
 * the whole Cassiopeia rotation is "poison first, then spam this".
 */
export default class Cassiopeia_E extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_cassiopeia_e');
  name = 'Song Nha (Cassiopeia_E)';
  description =
    `Phun nọc vào kẻ địch gần nhất trong <span>${RANGE}px</span>: <span class="damage">${BASE_DAMAGE} sát thương</span>,` +
    ` hoặc <span class="damage">${POISONED_DAMAGE} sát thương</span> nếu mục tiêu <span class="damage">đang trúng độc</span>`;
  coolDown = 2500;
  manaCost = 12;

  range = RANGE;

  checkCastCondition() {
    return !!this._findTarget();
  }

  onSpellCast() {
    const target = this._findTarget() as any;
    if (!target) return;

    const poisoned = target.buffs?.some(
      (buff: DamageOverTime) => !buff.toRemove && buff instanceof DamageOverTime
    );
    target.takeDamage(poisoned ? POISONED_DAMAGE : BASE_DAMAGE, this.owner);

    const spit = new AoePulse(this.owner);
    spit.position = target.position.copy();
    spit.radius = poisoned ? 70 : 45;
    spit.lifeTime = 300;
    spit.color = poisoned ? [200, 255, 130] : [140, 200, 110];
    spit.style = 'shards';
    spit.spokes = 6;
    this.game.objectManager.addObject(spit);
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
