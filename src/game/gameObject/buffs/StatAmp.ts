import BuffAddType from '@/game/enums/BuffAddType';
import Buff from '@/game/gameObject/Buff';
import { StatsModifier } from '@/game/gameObject/Stats';

/**
 * Every stat a buff can modify, derived from StatsModifier rather than listed
 * again. It was a hand-written union and it fell behind the moment attack stats
 * were added — the compiler then rejected a perfectly valid attackSpeed debuff.
 * Deriving it means adding a stat is one edit, in one place.
 */
export type StatName = {
  [K in keyof StatsModifier]: StatsModifier[K] extends { baseValue: number } ? K : never;
}[keyof StatsModifier];

/**
 * Which slot of the stat formula the bonus lands in:
 * `((baseValue + baseBonus) * (1 + percentBaseBonus) + flatBonus) * (1 + percentBonus)`
 */
export type BonusKind =
  'baseValue' | 'baseBonus' | 'flatBonus' | 'percentBonus' | 'percentBaseBonus';

/**
 * Changes selected stats for as long as it lasts, then puts them back. `Slow` and
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
    this.applyBonuses();
  }

  /**
   * Builds `statsModifier` from `bonuses`, scaled by `this.stacks`. A no-op
   * change for every ordinary StatAmp — `stacks` stays at `Buff`'s default of
   * 1, so `bonus * 1` is exactly the old unscaled value. It only matters for
   * a `countedStacks` buff, where one instance stands in for N and its
   * modifier has to carry N stacks' worth, not one's.
   */
  private applyBonuses(): void {
    for (const stat of Object.keys(this.bonuses) as StatName[]) {
      const modifier = this.statsModifier[stat];
      const bonus = this.bonuses[stat];
      if (!modifier || !bonus) continue;

      for (const kind of Object.keys(bonus) as BonusKind[]) {
        modifier[kind] += (bonus[kind] ?? 0) * this.stacks;
      }
    }
  }

  onActivate(): void {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }

  /**
   * `countedStacks` only: `AttackableUnit.addBuff()` calls this after
   * changing `stacks` on an already-active instance. The modifier already
   * applied to `targetUnit.stats` was built for the *old* stack count, so it
   * has to come off before a fresh one — scaled for the new count — goes on;
   * there is no "just add the delta" shortcut here because `bonuses` can
   * carry percent terms, which do not compose by addition.
   */
  onStacksChanged(): void {
    this.targetUnit.stats.removeModifier(this.statsModifier);
    this.statsModifier = new StatsModifier();
    this.applyBonuses();
    this.targetUnit.stats.addModifier(this.statsModifier);
  }
}
