import Champion from './Champion.js';

export default class DummyChampion extends Champion {
  isAllied = false;
  respawnTime = 1000;

  constructor(game, x, y, preset) {
    super(game, x, y, preset);
    this.stats.healthRegen.baseValue = 0.5;
  }

  respawn() {
    this.stats.health.baseValue = this.stats.maxHealth.value;
  }
}
