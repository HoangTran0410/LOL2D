import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';

export const RANGE = 170;
export const DAMAGE = 40;
export const HEALTH_COST = 8;

/**
 * Reckless Swing: the biggest single hit in the game for its cooldown, and it
 * costs Olaf health rather than mana — the reason to keep W up.
 */
export default class Olaf_E extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_olaf_e');
  name = 'Chém Liều Mạng (Olaf_E)';
  description =
    `Bổ rìu vào kẻ địch gần nhất trong <span>${RANGE}px</span>: <span class="damage">${DAMAGE} sát thương</span>,` +
    ` đổi lại Olaf <span class="damage">tự mất ${HEALTH_COST} máu</span>`;
  coolDown = 5000;
  manaCost = 0;

  range = RANGE;

  checkCastCondition() {
    // Never lethal to its own caster: a cost is a cost, not a suicide button.
    return !!this._findTarget() && this.owner.stats.health.value > HEALTH_COST;
  }

  onSpellCast() {
    const target = this._findTarget();
    if (!target) return;

    target.takeDamage(DAMAGE, this.owner);
    this.owner.stats.health.baseValue = Math.max(
      1,
      this.owner.stats.health.baseValue - HEALTH_COST
    );

    const hit = new AoePulse(this.owner);
    hit.position = target.position.copy();
    hit.radius = 70;
    hit.lifeTime = 360;
    hit.color = [255, 90, 70];
    hit.style = 'shards';
    hit.spokes = 6;
    this.game.objectManager.addObject(hit);
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
