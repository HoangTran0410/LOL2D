import AssetManager from '../../../managers/AssetManager';
import { Circle } from '../../../libs/quadtree';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Champion from '../attackableUnits/Champion';
import Pet from '../attackableUnits/Pet';
import Spell from '../Spell';
import AoePulse from '../spellObjects/AoePulse';
import { createReveal } from '../buffs/TrueSight';
import type AttackableUnit from '../attackableUnits/AttackableUnit';

export const RANGE = 400;
export const BASE_DAMAGE = 30;
/** Wiki: "+25–35% of target's missing health", as true damage. */
export const MISSING_HEALTH_PERCENT = 0.35;
export const REVEAL_MS = 1000;

/**
 * Demacian Justice — the execute this game did not have.
 *
 * `docs/abilities/garen/r.json`: unit-targeted at an enemy *champion*, deals
 * **true damage** of `125–275 (+ 25–35% of target's missing health)` and
 * reveals them for 1 second.
 *
 * True damage has no meaning here yet (there is no armour to ignore), so the
 * part that survives the translation is the shape everyone remembers: the
 * lower the target is, the harder it hits. At full health it is a modest nuke;
 * on someone who has already lost most of their bar it is the sword out of the
 * sky. Champions only, exactly as the wiki says — you cannot execute a minion
 * with it.
 */
export default class Garen_R extends Spell {
  // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_garen_r');
  name = 'Công Lý Demacia (Garen_R)';
  description =
    `Giáng kiếm lên <span class="damage">tướng địch</span> yếu nhất trong <span>${RANGE}px</span>:` +
    ` <span class="damage">${BASE_DAMAGE} sát thương</span> cộng thêm` +
    ` <span class="damage">${MISSING_HEALTH_PERCENT * 100}% lượng máu đã mất</span> của mục tiêu,` +
    ` và <span class="buff">lộ diện</span> chúng trong <span class="time">${REVEAL_MS / 1000} giây</span>`;
  coolDown = 10000;
  manaCost = 60;

  range = RANGE;

  checkCastCondition() {
    return !!this.findVictim();
  }

  /**
   * The lowest-health champion in range, not the nearest one. An execute that
   * picks by distance would routinely kill the wrong person — the whole point
   * of the ability is finishing the one who is nearly dead.
   */
  findVictim(): AttackableUnit | null {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.type(Champion),
        PredefinedFilters.excludeType(Pet),
      ],
    }) as AttackableUnit[];

    let weakest: AttackableUnit | null = null;
    let lowest = Infinity;
    for (const candidate of candidates) {
      const health = candidate.stats.health.value;
      if (health >= lowest) continue;
      lowest = health;
      weakest = candidate;
    }
    return weakest;
  }

  onSpellCast() {
    const victim = this.findVictim();
    if (!victim) return;

    const max = victim.stats.maxHealth.value;
    const missing = max > 0 ? Math.max(0, max - victim.stats.health.value) : 0;
    victim.takeDamage(BASE_DAMAGE + missing * MISSING_HEALTH_PERCENT, this.owner);

    victim.addBuff(
      createReveal({
        durationMs: REVEAL_MS,
        source: this.owner,
        target: victim,
        stackId: 'garen_r_reveal',
      })
    );

    const strike = new AoePulse(this.owner);
    strike.position = victim.position.copy();
    strike.radius = 110;
    strike.lifeTime = 520;
    strike.color = [255, 250, 210];
    strike.style = 'columns';
    strike.spokes = 10;
    this.game.objectManager.addObject(strike);
  }

  drawPreview() {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}
