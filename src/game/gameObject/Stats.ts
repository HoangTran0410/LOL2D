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

  constructor(baseValue = 0) {
    this.baseValue = baseValue;
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
    return ((this.baseValue + this.baseBonus) * (1 + this.percentBaseBonus) + this.flatBonus) * (1 + this.percentBonus);
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
  }
}

export default class Stats {
  maxHealth = new Stat(100);
  health = new Stat(100);
  maxMana = new Stat(500);
  mana = new Stat(500);
  speed = new Stat(3);
  size = new Stat(55);
  height = new Stat(0);
  manaRegen = new Stat(0.1);
  healthRegen = new Stat(0.06);
  visionRadius = new Stat(500);

  actionState =
    ActionState.CAN_CAST | ActionState.CAN_MOVE | ActionState.TARGETABLE;

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
