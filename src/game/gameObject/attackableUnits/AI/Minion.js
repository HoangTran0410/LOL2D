import AttackableUnit from '../AttackableUnit.js';

export default class Minion extends AttackableUnit {
  constructor({ game, position, collisionRadius, visionRadius, teamId, id, stats, preset }) {
    super({
      game,
      position,
      collisionRadius,
      visionRadius,
      teamId,
      avatar: AssetManager.getAsset(preset.avatar),
      stats,
    });
  }
}
