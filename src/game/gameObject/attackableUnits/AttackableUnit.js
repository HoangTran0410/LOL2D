import { hasFlag } from '../../../utils/index.js';
import ActionState from '../../enums/ActionState.js';
import BuffAddType from '../../enums/BuffAddType.js';
import StatusFlags from '../../enums/StatusFlags.js';
import GameObject from '../GameObject.js';
import Stats from '../Stats.js';
import CombatText from '../helpers/CombatText.js';

/// Base class for all attackable units.
/// AttackableUnits normally follow these guidelines of functionality: Death state, movements, Crowd Control, Stats (including modifiers), Buffs.
export default class AttackableUnit extends GameObject {
  buffs = [];
  _buffEffectsToEnable = 0;
  _buffEffectsToDisable = 0;
  status = 0;
  deathData = null;

  constructor({ game, position, collisionRadius, visionRadius, teamId, id, avatar, stats }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });

    this.avatar = avatar;
    this.destination = position.copy();
    this.stats = stats || new Stats();
    this.setStatus(StatusFlags.CanCast | StatusFlags.CanMove, true);

    this.animatedValues = {
      size: 10,
      height: 0,
      alpha: 255,
      displaySize: 10,
      visionRadius: 0,
    };
    this.isInsideBush = false;
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
    let isStealthed = hasFlag(this.stats.actionState, ActionState.STEALTHED);
    let alphaColor = this.isInsideBush ? 100 : isStealthed ? 20 : 255;

    let { size, height, alpha, visionRadius } = this.animatedValues;
    this.animatedValues = {
      displaySize: size + height,
      size: lerp(size, this.stats.size.value, 0.1), // higher height = bigger size
      height: lerp(height, this.stats.height.value, 0.3),
      visionRadius: lerp(visionRadius, this.stats.visionRadius.value, 0.1),
      alpha:
        alphaColor > alpha
          ? lerp(alpha || 0, alphaColor, 0.2) // smooth fade in
          : alphaColor, // instant fade out
    };
    this.visionRadius = this.animatedValues.visionRadius;
  }

  draw() {
    this.drawAvatar();
    this.drawBuffs();
  }

  drawAvatar() {
    let pos = this.position;
    let { displaySize: size, alpha } = this.animatedValues;

    push();

    // tint alpha for image
    if (alpha < 255) tint(255, alpha);
    noStroke();
    fill(240, alpha);
    image(this.avatar?.data, pos.x, pos.y, size, size);

    // draw circle around champion based on allies
    stroke(this.isAllied ? [0, 255, 0, alpha] : [255, 0, 0, alpha]);
    strokeWeight(2);
    noFill();
    circle(pos.x, pos.y, size);

    // draw direction to mouse
    if (!this.isDead && this.game.worldMouse) {
      let mouseDir = p5.Vector.sub(this.game.worldMouse, pos).setMag(size / 2 + 2);
      stroke(255, Math.min(alpha, 125));
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + mouseDir.x, pos.y + mouseDir.y);
    }

    if (this.isDead) {
      // draw black circle
      noStroke();
      fill(0, 200);
      circle(pos.x, pos.y, size);
    }
    pop();
  }

  drawBuffs() {
    this.buffs.forEach(buff => buff.draw?.());
  }

  drawHealthBar() {}

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

    this.setStatus(StatusFlags.None, true);
  }

  takeHeal(heal, healer) {
    if (this.isDead) return;

    let combatText = new CombatText(this);
    combatText.text = '+' + damage;
    combatText.textColor = [0, 255, 0];
    this.game.addObject(combatText);

    this.stats.health.baseValue = constrain(
      this.stats.health.baseValue + heal,
      0,
      this.stats.health.maxValue
    );
  }

  takeDamage(damage, attacker) {
    if (this.isDead) return;

    let combatText = new CombatText(this);
    combatText.text = '-' + damage;
    combatText.textColor = [255, 0, 0];
    this.game.addObject(combatText);

    this.stats.health.baseValue -= damage;
    if (this.stats.health.baseValue <= 0) {
      this.die({ attacker, reviveAfter: 5000 });
    }
  }

  die(deathData) {
    this.deathData = deathData;
    // TODO: more logic here ?
  }

  respawn() {
    this.stats.health.baseValue = this.stats.maxHealth.value;
    this.deathData = null;

    let spawnPoint = this.game.randomSpawnPoint();
    this.position.set(spawnPoint.x, spawnPoint.y);
    this.destination.set(spawnPoint.x, spawnPoint.y);
  }

  setStatus(status, enabled) {
    let _statusBeforeApplyingBuffEfects = 0;
    if (enabled) _statusBeforeApplyingBuffEfects |= status;
    else _statusBeforeApplyingBuffEfects &= ~status;

    this.status =
      (_statusBeforeApplyingBuffEfects & ~this._buffEffectsToDisable) | this._buffEffectsToEnable;

    this.stats.updateActionState(this.status);
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

  hasBuff(BuffClass) {
    return this.buffs.some(buff => buff instanceof BuffClass);
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
