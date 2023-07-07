import AIChampion from './AIChampion.js';

export default class DummyChampion extends AIChampion {
  isAllied = false;
  showName = true;
  respawnTime = 1000;
  _autoCast = false;
  _autoMove = false;
  _autoMoveOnTakeDamage = false;
  _autoMoveOnCollideWall = false;
  _respawnWithNewPreset = false;

  constructor(game, x, y, preset) {
    super(game, x, y, preset);

    this.stats.healthRegen.baseValue = 0.1;
    this.name = 'Hình nộm';
  }

  respawn() {
    this.stats.health.baseValue = this.stats.maxHealth.value;
  }
}
