import BuffAddType from '../../enums/BuffAddType';
import Buff from '../Buff';
import { StatsModifier } from '../Stats';

export type StatName =
  | 'maxHealth'
  | 'health'
  | 'maxMana'
  | 'mana'
  | 'speed'
  | 'size'
  | 'height'
  | 'manaRegen'
  | 'healthRegen'
  | 'visionRadius';

/**
 * Which slot of the stat formula the bonus lands in:
 * `((baseValue + baseBonus) * (1 + percentBaseBonus) + flatBonus) * (1 + percentBonus)`
 */
export type BonusKind =
  | 'baseValue'
  | 'baseBonus'
  | 'flatBonus'
  | 'percentBonus'
  | 'percentBaseBonus';

/**
 * Changes any stats for as long as it lasts, then puts them back. `Slow` and
 * `Speedup` are the speed-only special cases of this.
 *
 *   const buff = new StatAmp(5000, caster, target);
 *   buff.bonuses = {
 *     speed: { percentBaseBonus: 0.3 },  // +30% move speed
 *     maxHealth: { baseBonus: 200 },     // +200 max health
 *   };
 *   target.addBuff(buff);
 *
 * Negative numbers work too, so this covers debuffs as well.
 */
export default class StatAmp extends Buff {
  name = 'Tăng Chỉ Số';
  buffAddType = BuffAddType.STACKS_AND_CONTINUE;
  maxStacks = 1;

  bonuses: Partial<Record<StatName, Partial<Record<BonusKind, number>>>> = {};

  statsModifier: StatsModifier = new StatsModifier();

  onCreate(): void {
    // built here rather than at construction so callers can set `bonuses` first
    this.statsModifier = new StatsModifier();

    for (const stat of Object.keys(this.bonuses) as StatName[]) {
      const modifier = this.statsModifier[stat];
      const bonus = this.bonuses[stat];
      if (!modifier || !bonus) continue;

      for (const kind of Object.keys(bonus) as BonusKind[]) {
        modifier[kind] += bonus[kind] ?? 0;
      }
    }
  }

  onActivate(): void {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}
