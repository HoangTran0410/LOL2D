import { Stat, StatModifier } from './Stat.js';

export default class Stats {
  constructor() {
    this.maxHealth = new Stat(100);
    this.health = new Stat(100);
    this.speed = new Stat(2);
    this.size = new Stat(50);
  }

  addModifier(modifier) {
    this.maxHealth.addModifier(modifier.maxHealth);
    this.health.addModifier(modifier.health);
    this.speed.addModifier(modifier.speed);
    this.size.addModifier(modifier.size);
  }

  removeModifier(modifier) {
    this.maxHealth.removeModifier(modifier.maxHealth);
    this.health.removeModifier(modifier.health);
    this.speed.removeModifier(modifier.speed);
    this.size.removeModifier(modifier.size);
  }
}
