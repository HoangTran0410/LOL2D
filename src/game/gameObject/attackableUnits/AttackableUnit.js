import GameObject from '../GameObject.js';
import Stats from '../Stats.js';

export default class AttackableUnit extends GameObject {
  stats = new Stats();
  _buffEffectsToDisable = 0;
  _buffEffectsToEnable = 0;

  constructor({
    game,
    position = createVector(),
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });
  }

  setStatus(status, enabled) {
    let _statusBeforeApplyingBuffEfects = 0;
    if (enabled) _statusBeforeApplyingBuffEfects |= status;
    else _statusBeforeApplyingBuffEfects &= ~status;

    let status =
      (_statusBeforeApplyingBuffEfects & ~this._buffEffectsToDisable) | this._buffEffectsToEnable;

    this.stats.updateActionState(status);
  }
}
