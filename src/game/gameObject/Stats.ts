// src/game/gameObject/Stats.ts

export class StatModifier {
  baseValue = 0;
  baseBonus = 0;
  flatBonus = 0;
  percentBonus = 0;
  percentBaseBonus = 0;

  constructor(
    baseValue = 0,
    baseBonus = 0,
    flatBonus = 0,
    percentBonus = 0,
    percentBaseBonus = 0
  ) {
    this.baseValue = baseValue;
    this.baseBonus = baseBonus;
    this.flatBonus = flatBonus;
    this.percentBonus = percentBonus;
    this.percentBaseBonus = percentBaseBonus;
  }

  add(modifier: StatModifier) {
    this.baseValue += modifier.baseValue;
    this.baseBonus += modifier.baseBonus;
    this.flatBonus += modifier.flatBonus;
    this.percentBonus += modifier.percentBonus;
    this.percentBaseBonus += modifier.percentBaseBonus;
  }

  remove(modifier: StatModifier) {
    this.baseValue -= modifier.baseValue;
    this.baseBonus -= modifier.baseBonus;
    this.flatBonus -= modifier.flatBonus;
    this.percentBonus -= modifier.percentBonus;
    this.percentBaseBonus -= modifier.percentBaseBonus;
  }
}

export class Stat {
  baseValue = 0;
  baseBonus = 0;
  flatBonus = 0;
  percentBonus = 0;
  percentBaseBonus = 0;

  /**
   * Ceiling applied to `value`. Defaults to no limit, so only the stats that
   * genuinely need one pay for it. Attack speed is the clearest case: its buffs
   * multiply, so two or three overlapping ones reach a swing per frame and no
   * amount of balancing on the buff side can prevent it.
   *
   * Clamping the read rather than the modifiers keeps it reversible: a buff that
   * pushed the total past the cap still subtracts cleanly when it expires, and
   * the value comes back down instead of sticking.
   */
  maxValue = Infinity;

  /**
   * Floor applied to `value`, for the same reasons and with the same reversible
   * read-time clamp as `maxValue`. Movement speed is the case that needs one:
   * `AttackableUnit.move()` steps along `destination - position` scaled by
   * speed, so a negative speed does not stop a unit, it walks it *backwards,
   * away from where it was sent*.
   *
   * That is one typo away at all times. `Slow.percent` is a fraction — 0.5 is
   * fifty percent — and a single caller writing `35` for "35%" turns a champion
   * into something that cannot walk towards the thing slowing it. Baron's
   * poison pool shipped with exactly that and read in game as the pool
   * physically shoving people out. Both values are numbers, so nothing in `tsc`
   * or in a type test can catch the next one; the floor is what makes it a
   * balance mistake instead of a physics one.
   */
  minValue = -Infinity;

  constructor(baseValue = 0, maxValue = Infinity, minValue = -Infinity) {
    this.baseValue = baseValue;
    this.maxValue = maxValue;
    this.minValue = minValue;
  }

  addModifier(modifier: StatModifier) {
    if (!(modifier instanceof StatModifier)) return;
    this.add(modifier);
  }

  removeModifier(modifier: StatModifier) {
    if (!(modifier instanceof StatModifier)) return;
    this.remove(modifier);
  }

  get value(): number {
    const total =
      ((this.baseValue + this.baseBonus) * (1 + this.percentBaseBonus) + this.flatBonus) *
      (1 + this.percentBonus);
    if (total > this.maxValue) return this.maxValue;
    return total < this.minValue ? this.minValue : total;
  }

  add(modifier: StatModifier) {
    this.baseValue += modifier.baseValue;
    this.baseBonus += modifier.baseBonus;
    this.flatBonus += modifier.flatBonus;
    this.percentBonus += modifier.percentBonus;
    this.percentBaseBonus += modifier.percentBaseBonus;
  }

  remove(modifier: StatModifier) {
    this.baseValue -= modifier.baseValue;
    this.baseBonus -= modifier.baseBonus;
    this.flatBonus -= modifier.flatBonus;
    this.percentBonus -= modifier.percentBonus;
    this.percentBaseBonus -= modifier.percentBaseBonus;
  }
}

// ---------------------------------------------------------------------------
// Stats / StatsModifier — imports go here so Stat/StatModifier are first
// ---------------------------------------------------------------------------

import { hasFlag } from '../../utils/index';
import ActionState from '../enums/ActionState';
import StatusFlags from '../enums/StatusFlags';

export class StatsModifier {
  maxHealth = new StatModifier(0);
  health = new StatModifier(0);
  maxMana = new StatModifier(0);
  mana = new StatModifier(0);
  speed = new StatModifier(0);
  size = new StatModifier(0);
  height = new StatModifier(0);
  manaRegen = new StatModifier(0);
  healthRegen = new StatModifier(0);
  visionRadius = new StatModifier(0);
  attackDamage = new StatModifier(0);
  attackSpeed = new StatModifier(0);
  attackRange = new StatModifier(0);
  omnivamp = new StatModifier(0);
  onHitDamage = new StatModifier(0);
  critChance = new StatModifier(0);
  critDamage = new StatModifier(0);

  addModifier(modifier: StatsModifier) {
    if (!(modifier instanceof StatsModifier)) return;
    this.maxHealth.add(modifier.maxHealth);
    this.health.add(modifier.health);
    this.maxMana.add(modifier.maxMana);
    this.mana.add(modifier.mana);
    this.speed.add(modifier.speed);
    this.size.add(modifier.size);
    this.height.add(modifier.height);
    this.manaRegen.add(modifier.manaRegen);
    this.healthRegen.add(modifier.healthRegen);
    this.visionRadius.add(modifier.visionRadius);
    this.attackDamage.add(modifier.attackDamage);
    this.attackSpeed.add(modifier.attackSpeed);
    this.attackRange.add(modifier.attackRange);
    this.omnivamp.add(modifier.omnivamp);
    this.onHitDamage.add(modifier.onHitDamage);
    this.critChance.add(modifier.critChance);
    this.critDamage.add(modifier.critDamage);
  }

  removeModifier(modifier: StatsModifier) {
    if (!(modifier instanceof StatsModifier)) return;
    this.maxHealth.remove(modifier.maxHealth);
    this.health.remove(modifier.health);
    this.maxMana.remove(modifier.maxMana);
    this.mana.remove(modifier.mana);
    this.speed.remove(modifier.speed);
    this.size.remove(modifier.size);
    this.height.remove(modifier.height);
    this.manaRegen.remove(modifier.manaRegen);
    this.healthRegen.remove(modifier.healthRegen);
    this.visionRadius.remove(modifier.visionRadius);
    this.attackDamage.remove(modifier.attackDamage);
    this.attackSpeed.remove(modifier.attackSpeed);
    this.attackRange.remove(modifier.attackRange);
    this.omnivamp.remove(modifier.omnivamp);
    this.onHitDamage.remove(modifier.onHitDamage);
    this.critChance.remove(modifier.critChance);
    this.critDamage.remove(modifier.critDamage);
  }
}

/**
 * Body width of a champion that nothing has resized. Every ability range in the
 * game was authored against two of these standing next to each other, which is
 * why `Reach.ts` measures a body's excess against it rather than against zero.
 * Named so the two places that care read the same number.
 */
export const DEFAULT_UNIT_SIZE = 55;

/**
 * Ceiling on how big a unit's body can get, whatever stacks it. A champion is
 * 55 across, Baron is 100 and a turret 92, so three times base already makes a
 * unit the largest thing on the field. Past that the model stops fitting
 * through lane chokepoints, its fixed-width health bar detaches from it, and
 * Cho'Gath R — 6 size a stack, 99 stacks, permanent — would reach 649.
 */
export const MAX_UNIT_SIZE = 165;

/**
 * Hard ceiling on attacks per second. Attack speed buffs multiply, so two or
 * three overlapping ones would otherwise reach a swing per frame.
 */
export const MAX_ATTACK_SPEED = 2.5;
/** Default crit multiplier — League's, so "+75%" reads the way a player expects. */
export const CRIT_MULTIPLIER = 1.75;

export default class Stats {
  maxHealth = new Stat(100);
  health = new Stat(100);
  maxMana = new Stat(500);
  mana = new Stat(500);
  // Floored at 0: a slow may root you, it may never reverse you. See `minValue`.
  speed = new Stat(3, Infinity, 0);
  size = new Stat(DEFAULT_UNIT_SIZE, MAX_UNIT_SIZE);
  height = new Stat(0);
  manaRegen = new Stat(0.1);
  healthRegen = new Stat(0.06);
  visionRadius = new Stat(500);

  /** Damage of one basic attack. */
  attackDamage = new Stat(0);
  /**
   * Basic attacks per second, not the period between them. A rate is what buffs
   * actually modify — "+30% attack speed" is a 1.3x on this number and composes
   * with the existing percentBonus machinery, while the same buff on a period
   * would have to be written as a division. It is also the direction a ceiling
   * makes sense in, so MAX_ATTACK_SPEED can be a plain maxValue.
   */
  attackSpeed = new Stat(0, MAX_ATTACK_SPEED);
  /** Surface-to-surface reach of a basic attack; decides melee versus ranged. */
  attackRange = new Stat(0);

  /* ------------------------------------------------ making a swing matter
     Four stats that exist so a basic attack is a build, not a filler action
     between cooldowns. They are read in exactly one place each —
     `landBasicAttack` for the three attack ones, `takeDamage` for the vamp —
     so an ability grants them the way it grants any other stat (a `StatAmp`
     with `omnivamp: { baseBonus: 0.3 }`) instead of hand-rolling its own
     `ON_ATTACK_HIT` listener. Four spells used to do exactly that, each with
     its own copy of the same subscribe/unsubscribe bookkeeping. */

  /**
   * Fraction of *all* damage this unit deals that returns as health — League's
   * omnivamp rather than its lifesteal, so a damage-over-time tick and a spell
   * feed it as readily as a swing does. Capped at 1: a unit may not profit
   * from hitting something.
   */
  omnivamp = new Stat(0, 1, 0);
  /** Flat damage added to every basic attack that lands, before the crit roll. */
  onHitDamage = new Stat(0);
  /** 0..1. Left at 0 by default, so nothing in the game rolls dice unless something granted this. */
  critChance = new Stat(0, 1, 0);
  /** What a crit multiplies the swing by. 1.75 is +75%, League's own number. */
  critDamage = new Stat(CRIT_MULTIPLIER);

  actionState =
    ActionState.CAN_CAST |
    ActionState.CAN_MOVE |
    ActionState.CAN_ATTACK |
    ActionState.TARGETABLE;

  addModifier(modifier: StatsModifier) {
    if (!(modifier instanceof StatsModifier)) return;
    this.maxHealth.addModifier(modifier.maxHealth);
    this.health.addModifier(modifier.health);
    this.maxMana.addModifier(modifier.maxMana);
    this.mana.addModifier(modifier.mana);
    this.speed.addModifier(modifier.speed);
    this.size.addModifier(modifier.size);
    this.height.addModifier(modifier.height);
    this.manaRegen.addModifier(modifier.manaRegen);
    this.healthRegen.addModifier(modifier.healthRegen);
    this.visionRadius.addModifier(modifier.visionRadius);
    this.attackDamage.addModifier(modifier.attackDamage);
    this.attackSpeed.addModifier(modifier.attackSpeed);
    this.attackRange.addModifier(modifier.attackRange);
    this.omnivamp.addModifier(modifier.omnivamp);
    this.onHitDamage.addModifier(modifier.onHitDamage);
    this.critChance.addModifier(modifier.critChance);
    this.critDamage.addModifier(modifier.critDamage);
  }

  removeModifier(modifier: StatsModifier) {
    if (!(modifier instanceof StatsModifier)) return;
    this.maxHealth.removeModifier(modifier.maxHealth);
    this.health.removeModifier(modifier.health);
    this.maxMana.removeModifier(modifier.maxMana);
    this.mana.removeModifier(modifier.mana);
    this.speed.removeModifier(modifier.speed);
    this.size.removeModifier(modifier.size);
    this.height.removeModifier(modifier.height);
    this.manaRegen.removeModifier(modifier.manaRegen);
    this.healthRegen.removeModifier(modifier.healthRegen);
    this.visionRadius.removeModifier(modifier.visionRadius);
    this.attackDamage.removeModifier(modifier.attackDamage);
    this.attackSpeed.removeModifier(modifier.attackSpeed);
    this.attackRange.removeModifier(modifier.attackRange);
    this.omnivamp.removeModifier(modifier.omnivamp);
    this.onHitDamage.removeModifier(modifier.onHitDamage);
    this.critChance.removeModifier(modifier.critChance);
    this.critDamage.removeModifier(modifier.critDamage);
  }

  getActionState(state: number): boolean {
    return hasFlag(this.actionState, state);
  }

  setActionState(state: number, enabled: boolean) {
    if (enabled) {
      this.actionState |= state;
    } else {
      this.actionState &= ~state;
    }
  }

  updateActionState(statusFlag: number) {
    this.setActionState(ActionState.CHARMED, hasFlag(statusFlag, StatusFlags.Charmed));
    this.setActionState(ActionState.FEARED, hasFlag(statusFlag, StatusFlags.Feared));
    this.setActionState(ActionState.IS_GHOSTED, hasFlag(statusFlag, StatusFlags.Ghosted));
    this.setActionState(ActionState.GROUNDED, hasFlag(statusFlag, StatusFlags.Grounded));
    this.setActionState(ActionState.IS_NEAR_SIGHTED, hasFlag(statusFlag, StatusFlags.NearSighted));
    this.setActionState(ActionState.NO_RENDER, hasFlag(statusFlag, StatusFlags.NoRender));
    this.setActionState(ActionState.STEALTHED, hasFlag(statusFlag, StatusFlags.Stealthed));
    this.setActionState(ActionState.TARGETABLE, hasFlag(statusFlag, StatusFlags.Targetable));

    this.setActionState(
      ActionState.CAN_MOVE,
      !(
        hasFlag(statusFlag, StatusFlags.Charmed) ||
        hasFlag(statusFlag, StatusFlags.Feared) ||
        hasFlag(statusFlag, StatusFlags.Immovable) ||
        hasFlag(statusFlag, StatusFlags.Rooted) ||
        hasFlag(statusFlag, StatusFlags.Stunned) ||
        hasFlag(statusFlag, StatusFlags.Suppressed)
      )
    );

    this.setActionState(
      ActionState.CAN_CAST,
      !(
        hasFlag(statusFlag, StatusFlags.Silenced) ||
        hasFlag(statusFlag, StatusFlags.Charmed) ||
        hasFlag(statusFlag, StatusFlags.Feared) ||
        hasFlag(statusFlag, StatusFlags.Stunned) ||
        hasFlag(statusFlag, StatusFlags.Suppressed)
      )
    );

    // Disarm is the dedicated flag, but everything that takes control of a unit
    // stops its swings too — a stunned or fleeing champion attacking nothing in
    // particular would read as a bug.
    this.setActionState(
      ActionState.CAN_ATTACK,
      !(
        hasFlag(statusFlag, StatusFlags.Disarmed) ||
        hasFlag(statusFlag, StatusFlags.Charmed) ||
        hasFlag(statusFlag, StatusFlags.Feared) ||
        hasFlag(statusFlag, StatusFlags.Stunned) ||
        hasFlag(statusFlag, StatusFlags.Suppressed)
      )
    );
  }

  update() {
    this.health.baseValue = constrain(
      this.health.value + this.healthRegen.value,
      0,
      this.maxHealth.value
    );
    this.mana.baseValue = constrain(
      this.mana.value + this.manaRegen.value,
      0,
      this.maxMana.value
    );
  }
}
