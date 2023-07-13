import { hasFlag, uuidv4 } from '../../../utils/index.js';
import ActionState from '../../enums/ActionState.js';
import StatusFlags from '../../enums/StatusFlags.js';
import GameObject from '../GameObject.js';
import Stats from '../Stats.js';

/// Base class for all attackable units.
/// AttackableUnits normally follow these guidelines of functionality: Death state, movements, Crowd Control, Stats (including modifiers), Buffs.
export default class AttackableUnit extends GameObject {
  stats = new Stats();
  buffs = [];
  _buffEffectsToEnable = 0;
  _buffEffectsToDisable = 0;
  status = 0;
  _deathData = null;

  constructor({
    game,
    position = createVector(),
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
    avatar,
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });

    this.avatar = avatar;
    this.destination = position.copy();
    this.setStatus(StatusFlags.CanCast | StatusFlags.CanMove, true);
  }

  update() {
    // update Buffs
    this.updateBuffs();

    // update Stats
    this.stats.update();

    // move
    if (this.canMove) this.move();

    // die
    if (this._deathData) {
      this._deathData.reviveAfter -= deltaTime;
      if (this._deathData.reviveAfter <= 0) {
        this.respawn();
      }
    }
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    if (this.avatar) {
      image(this.avatar, 0, 0, this.stats.size.value, this.stats.size.value);
    }
    pop();
  }

  addBuff(buff) {}

  takeHeal(heal, healer) {
    if (this.isDead) return;
    this.stats.health.baseValue = constrain(
      this.stats.health.baseValue + heal,
      0,
      this.stats.health.maxValue
    );
  }

  takeDamage(damage, attacker) {
    if (this.isDead) return;

    this.stats.health.baseValue -= damage;
    if (this.stats.health.baseValue <= 0) {
      die({ attacker, reviveAfter: 5000 });
    }
  }

  die(deathData) {
    this._deathData = deathData;
    // TODO: more logic here ?
  }

  respawn() {
    this.stats.health.baseValue = this.stats.health.maxValue;
    this._deathData = null;
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

    this.status =
      (_statusBeforeApplyingBuffEfects & ~this._buffEffectsToDisable) | this._buffEffectsToEnable;

    this.stats.updateActionState(status);
  }

  move() {
    if (!this.destination) return false;

    let distance = this.position.dist(this.destination);
    let speed = this.stats.speed.value;

    if (distance <= speed) {
      this.position.set(this.destination.x, this.destination.y);
    } else {
      let direction = p5.Vector.sub(this.destination, this.position).normalize();
      this.position.add(direction.mult(speed));
    }
    return true;
  }

  moveTo(x, y) {
    this.destination.set(x, y);
  }

  stopMovement() {
    this.destination.set(this.position.x, this.position.y);
  }

  get canCast() {
    return hasFlag(this.stats.actionState, ActionState.CAN_CAST);
  }
  get canMove() {
    return hasFlag(this.stats.actionState, ActionState.CAN_MOVE);
  }

  get isDead() {
    return this._deathData !== null;
  }
}
