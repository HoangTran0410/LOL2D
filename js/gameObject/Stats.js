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
  }
}

export default class Stats {
  constructor() {
    this.maxHealth = new Stat(100);
    this.health = new Stat(50);
    this.maxMana = new Stat(500);
    this.mana = new Stat(500);
    this.speed = new Stat(3);
    this.size = new Stat(55);
    this.height = new Stat(0);

    this.manaRegen = new Stat(0.1);
    this.healthRegen = new Stat(0.1);
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
