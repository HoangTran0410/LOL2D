import AssetManager from '../../../../managers/AssetManager.js';
import AttackableUnit from '../AttackableUnit.js';

export default class Champion extends AttackableUnit {
  constructor({ game, position, collisionRadius, visionRadius, teamId, id, stats, preset }) {
    super({
      game,
      position,
      collisionRadius,
      visionRadius,
      teamId,
      id,
      avatar: AssetManager.getAsset(preset.avatar)?.data,
      stats,
    });

    this.name = preset.name;
    this.spells = preset.spells.map(spell => new spell(this));
  }

  onAdded() {}

  onRemoved() {}

  update() {
    super.update();
    this.spells.forEach(spell => spell.update());
  }

  draw() {
    super.draw();
  }
}
