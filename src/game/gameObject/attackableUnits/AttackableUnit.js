import { Circle, Rectangle } from '../../../../libs/quadtree.js';
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
  _statusBeforeApplyingBuffEfects = 0;
  status = 0;
  deathData = null;
  reviveTime = 5000;

  constructor({ game, position, collisionRadius, visionRadius, teamId, id, avatar, stats }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });

    this.avatar = avatar;
    this.destination = position.copy();
    this.stats = stats || new Stats();
    this.setStatus(StatusFlags.CanCast | StatusFlags.CanMove | StatusFlags.Targetable, true);

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
    this.drawDir();
    this.drawBuffs();
    this.drawHealthBar();
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

    if (this.isDead) {
      // draw black circle
      noStroke();
      fill(0, 200);
      circle(pos.x, pos.y, size);
    }
    pop();
  }

  drawDir() {
    // draw direction to mouse
    if (!this.isDead && this.game.worldMouse) {
      let pos = this.position;
      let { displaySize: size, alpha } = this.animatedValues;

      push();
      let mouseDir = p5.Vector.sub(this.game.worldMouse, pos).setMag(size / 2 + 2);
      stroke(255, Math.min(alpha, 125));
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + mouseDir.x, pos.y + mouseDir.y);
      pop();
    }
  }

  drawBuffs() {
    this.buffs.forEach(buff => buff.draw?.());
  }

  drawHealthBar() {
    push();
    let pos = this.position;
    let { displaySize: size, alpha } = this.animatedValues;

    // draw health bar
    let healthBarHeight = 6;
    let healthBarWidth = 100;
    let healthBarX = pos.x - healthBarWidth / 2;
    let healthBarY = pos.y - size / 2 - healthBarHeight - 15;
    let healthBarColor = this.isAllied ? [67, 196, 29, alpha] : [196, 67, 29, alpha];
    let healthBarBgColor = [242, 242, 242, alpha];
    let healthBarValue = ~~this.stats.health.value;
    let healthBarMaxValue = ~~this.stats.maxHealth.value;
    let healthBarValuePercent = healthBarValue / healthBarMaxValue;

    // draw background
    noStroke();
    fill(healthBarBgColor);
    rect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);

    // draw health
    fill(healthBarColor);
    rect(healthBarX, healthBarY, healthBarWidth * healthBarValuePercent, healthBarHeight);

    // draw health text
    fill(180, alpha);
    textAlign(CENTER, CENTER);
    textSize(12);
    text(`${healthBarValue} / ${healthBarMaxValue}`, pos.x, healthBarY - 10);
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

    this.setStatus(StatusFlags.None, true);
  }

  takeHeal(heal, healer) {
    if (this.isDead) return;

    let combatText = new CombatText(this);
    combatText.text = '+' + damage;
    combatText.textColor = [0, 255, 0];
    this.game.objectManager.addObject(combatText);

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
    this.game.objectManager.addObject(combatText);

    this.stats.health.baseValue -= damage;
    if (this.stats.health.baseValue <= 0) {
      this.die({ attacker, reviveAfter: this.reviveTime });
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
    if (enabled) this._statusBeforeApplyingBuffEfects |= status;
    else this._statusBeforeApplyingBuffEfects &= ~status;

    this.status =
      (this._statusBeforeApplyingBuffEfects & ~this._buffEffectsToDisable) |
      this._buffEffectsToEnable;

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

  teleportTo(x, y) {
    this.position.set(x, y);
    this.destination.set(x, y);
  }

  stopMovement() {
    this.destination.set(this.position.x, this.position.y);
  }

  hasBuff(BuffClass) {
    return this.buffs.some(buff => buff instanceof BuffClass);
  }

  getCollideBoundingBox() {
    let size = this.animatedValues.size;
    return new Circle({
      x: this.position.x,
      y: this.position.y,
      r: size / 2,
      data: this,
    });
  }

  getDisplayBoundingBox() {
    let size = this.isAllied ? this.visionRadius * 2 : this.animatedValues.size;
    // let size = this.animatedValues.size;
    return new Rectangle({
      x: this.position.x - size / 2,
      y: this.position.y - size / 2,
      w: size,
      h: size,
      data: this,
    });
    // return new Circle({
    //   x: this.position.x,
    //   y: this.position.y,
    //   r: size / 2,
    //   data: this,
    // });
  }

  get canCast() {
    return !this.isDead && hasFlag(this.stats.actionState, ActionState.CAN_CAST);
  }
  get canMove() {
    return !this.isDead && hasFlag(this.stats.actionState, ActionState.CAN_MOVE);
  }
  get targetable() {
    return !this.isDead && hasFlag(this.stats.actionState, ActionState.TARGETABLE);
  }
  get isDead() {
    return this.deathData !== null;
  }
  get isAllied() {
    return this.teamId === this.game.player.teamId;
  }
}
