import { hasFlag, uuidv4 } from '../../../utils/index.js';
import ActionState from '../../enums/ActionState.js';
import StatusFlags from '../../enums/StatusFlags.js';
import GameObject from '../GameObject.js';
import Stats from '../Stats.js';

/// Base class for all attackable units.
/// AttackableUnits normally follow these guidelines of functionality: Death state, movements, Crowd Control, Stats (including modifiers), Buffs.
export default class AttackableUnit extends GameObject {
  buffs = [];
  _buffEffectsToEnable = 0;
  _buffEffectsToDisable = 0;
  status = 0;
  deathData = null;

  constructor({
    game,
    position = createVector(),
    collisionRadius = 25,
    visionRadius = 0,
    teamId = uuidv4(),
    id = uuidv4(),
    avatar,
    stats,
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });

    this.avatar = avatar;
    this.destination = position.copy();
    this.stats = stats || new Stats();
    this.setStatus(StatusFlags.CanCast | StatusFlags.CanMove, true);

    this.animatedValues = {
      size: 10,
      height: 0,
      alpha: 255,
    };
  }

  update() {
    // update Buffs
    this.updateBuffs();

    // update Stats
    this.stats.update();

    // move
    if (this.canMove) this.move();

    // die
    if (this.deathData) {
      this.deathData.reviveAfter -= deltaTime;
      if (this.deathData.reviveAfter <= 0) {
        this.respawn();
      }
    }

    // animated
    let isInsideBush = hasFlag(this.status, StatusFlags.InBush);
    let isStealthed = hasFlag(this.stats.actionState, ActionState.STEALTHED);
    let alphaColor = isInsideBush ? 100 : isStealthed ? 20 : 255;
    this.animatedValues = {
      size: lerp(this.animatedValues.size, this.stats.size.value, 0.1),
      height: lerp(this.animatedValues.height, this.stats.height.value, 0.3),
      alpha:
        alphaColor > this.animatedAlphaColor
          ? lerp(this.animatedAlphaColor || 0, alphaColor, 0.2) // smooth fade in
          : alphaColor, // instant fade out
    };
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    if (this.avatar) {
      let size = this.animatedValues.size + this.animatedValues.height;
      if (this.animatedValues.alpha < 255) tint(255, this.animatedValues.alpha);
      image(this.avatar?.data || this.avatar, -size / 2, -size / 2, size, size);
    }
    pop();
  }

  addBuff(buff) {
    if (this.isDead || !buff) return;

    let preBuffs = this.buffs.filter(_buff => _buff.constructor === buff.constructor);

    switch (buff.buffAddType) {
      case BuffAddType.REPLACE_EXISTING:
        // remove all buffs with the same name
        for (let b of preBuffs) b.deactivateBuff();
        // add new buff
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.RENEW_EXISTING:
        if (preBuffs.length > 0) {
          preBuffs[0].renewBuff();
        } else {
          this.buffs.push(buff);
          buff.activateBuff();
        }
        break;

      case BuffAddType.STACKS_AND_CONTINUE:
        if (preBuffs.length >= buff.maxStacks) {
          buff.timeElapsed = preBuffs[0].timeElapsed; // continue from current timeElapsed
          preBuffs[0].deactivateBuff();
        }
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.STACKS_AND_OVERLAPS:
        // remove oldest buff
        if (preBuffs.length >= buff.maxStacks) {
          preBuffs[0].deactivateBuff();
        }

        // add new buff
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.STACKS_AND_RENEWS:
        // renew preBuffs
        for (let b of preBuffs) b.renewBuff();

        // remove oldest buff (if maxStacks is reached)
        if (preBuffs.length >= buff.maxStacks) {
          preBuffs[0].deactivateBuff();
        }

        // add new buff
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      default:
        break;
    }
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
    this.deathData = deathData;
    // TODO: more logic here ?
  }

  respawn() {
    this.stats.health.baseValue = this.stats.health.maxValue;
    this.deathData = null;
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
    return !this.isDead && hasFlag(this.stats.actionState, ActionState.CAN_CAST);
  }
  get canMove() {
    return !this.isDead && hasFlag(this.stats.actionState, ActionState.CAN_MOVE);
  }

  get isDead() {
    return this.deathData !== null;
  }

  get isAllied() {
    return this.teamId === this.game.player.teamId;
  }
}