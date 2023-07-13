import StatusFlags from '../../enums/StatusFlags.js';
import GameObject from '../GameObject.js';
import Stats from '../Stats.js';

export default class AttackableUnit extends GameObject {
  stats = new Stats();
  buffs = [];
  _buffEffectsToEnable = 0;
  _buffEffectsToDisable = 0;

  status = 0;

  constructor({
    game,
    position = createVector(),
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });

    this.setStatus(StatusFlags.CanCast | StatusFlags.CanMove, true);
  }

  update() {
    // update Buffs
    this.updateBuffs();

    // update Stats
    this.stats.update();

    // move

    // die
  }

  updateBuffs() {
    this.buffs = this.buffs.filter(buff => !buff.toRemove);

    // Combine the status effects of all the buffs
    this._buffEffectsToEnable = 0;
    this._buffEffectsToDisable = 0;

    for (let buff of this.buffs) {
      buff.update();

      this._buffEffectsToEnable |= buff.statusFlagsToEnable;
      this._buffEffectsToDisable |= buff.statusFlagsToDisable;
    }

    // If the effect should be enabled, it overrides disable.
    this._buffEffectsToDisable &= ~this._buffEffectsToEnable;

    this.setStatus(StatusFlags.None, true);
  }

  setStatus(status, enabled) {
    let _statusBeforeApplyingBuffEfects = 0;
    if (enabled) _statusBeforeApplyingBuffEfects |= status;
    else _statusBeforeApplyingBuffEfects &= ~status;

    let status =
      (_statusBeforeApplyingBuffEfects & ~this._buffEffectsToDisable) | this._buffEffectsToEnable;

    this.stats.updateActionState(status);
  }

  get isDead() {
    return false;
  }
}
