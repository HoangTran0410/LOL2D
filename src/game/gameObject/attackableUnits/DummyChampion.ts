import AIChampion from './AIChampion';
import type { AIChampionOptions } from './AIChampion';

export type DummyChampionOptions = Pick<AIChampionOptions, 'game' | 'position' | 'preset'>;

export default class DummyChampion extends AIChampion {
  showName = true;
  respawnTime = 1000;
  _autoCast = false;
  _autoMove = false;
  /** A practice dummy stands there and takes it. */
  _autoAttack = false;
  _autoMoveOnTakeDamage = false;
  _autoMoveOnCollideWall = false;
  _respawnWithNewPreset = false;

  constructor({ game, position, preset }: DummyChampionOptions) {
    super({ game, position, preset });

    this.stats.healthRegen.baseValue = 0.1;
    this.name = 'Hình Nộm';
  }

  respawn() {
    this.stats.health.baseValue = this.stats.maxHealth.baseValue;
  }
}
