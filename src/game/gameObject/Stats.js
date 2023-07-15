import { hasFlag } from '../../utils/index.js';
import ActionState from '../enums/ActionState.js';
import StatusFlags from '../enums/StatusFlags.js';
import { Stat, StatModifier } from './Stat.js';

export class StatsModifier {
  constructor() {
    this.maxHealth = new StatModifier(0);
    this.health = new StatModifier(0);
    this.maxMana = new StatModifier(0);
    this.mana = new StatModifier(0);
    this.speed = new StatModifier(0);
    this.size = new StatModifier(0);
    this.height = new StatModifier(0);
    this.manaRegen = new StatModifier(0);
    this.healthRegen = new StatModifier(0);
    this.visionRadius = new StatModifier(0);
  }
}

export default class Stats {
  constructor() {
    this.maxHealth = new Stat(100);
    this.health = new Stat(100);
    this.maxMana = new Stat(500);
    this.mana = new Stat(500);
    this.speed = new Stat(3);
    this.size = new Stat(55);
    this.height = new Stat(0);
    this.manaRegen = new Stat(0.1);
    this.healthRegen = new Stat(0.06);
    this.visionRadius = new Stat(600);

    this.actionState = ActionState.CAN_CAST | ActionState.CAN_MOVE | ActionState.TARGETABLE;
  }

  addModifier(modifier) {
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

  removeModifier(modifier) {
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

  getActionState(state) {
    return hasFlag(this.actionState, state);
  }

  setActionState(state, enabled) {
    if (enabled) {
      this.actionState = this.actionState |= state;
    } else {
      this.actionState = this.actionState &= ~state;
    }
  }

  updateActionState(statusFlag) {
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

    this.mana.baseValue = constrain(this.mana.value + this.manaRegen.value, 0, this.maxMana.value);
  }
}
