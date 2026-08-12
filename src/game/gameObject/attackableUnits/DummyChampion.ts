import AIChampion from './AIChampion';
import type { ChampionPresetData } from './Champion';

export default class DummyChampion extends AIChampion {
  showName = true;
  respawnTime = 1000;
  _autoCast = false;
  _autoMove = false;
  _autoMoveOnTakeDamage = false;
  _autoMoveOnCollideWall = false;
  _respawnWithNewPreset = false;

  constructor({ game, position, preset }: {
    game: any;
    position: p5.Vector;
    preset?: ChampionPresetData;
  }) {
    super({ game, position, preset });

    this.stats.healthRegen.baseValue = 0.1;
    this.name = 'Hình Nộm';
  }

  respawn() {
    this.stats.health.baseValue = this.stats.maxHealth.baseValue;
  }
}
