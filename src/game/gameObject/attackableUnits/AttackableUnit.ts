import { Circle, Rectangle } from '../../../libs/quadtree';
import { hasFlag } from '../../../utils/index';
import ActionState from '../../enums/ActionState';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import GameObject from '../GameObject';
import Stats from '../Stats';
import CombatText from '../helpers/CombatText';

export default class AttackableUnit extends GameObject {
  buffs: any[] = [];
  _buffEffectsToEnable = 0;
  _buffEffectsToDisable = 0;
  _statusBeforeApplyingBuffEfects = 0;
  status = 0;
  deathData: { attacker?: any; reviveAfter: number } | null = null;
  reviveTime = 5000;

  avatar: any;
  destination: p5.Vector;
  stats: Stats;
  isInsideBush = false;

  animatedValues: {
    size: number;
    height: number;
    alpha: number;
    displaySize: number;
    visionRadius: number;
  };

  constructor({
    game,
    position,
    collisionRadius,
    visionRadius,
    teamId,
    id,
    avatar,
    stats,
  }: {
    game?: any;
    position?: p5.Vector;
    collisionRadius?: number;
    visionRadius?: number;
    teamId?: string;
    id?: string;
    avatar?: any;
    stats?: Stats;
  }) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });

    this.avatar = avatar;
    this.destination = (position ?? createVector()).copy();
    this.stats = stats || new Stats();
    this.setStatus(StatusFlags.CanCast | StatusFlags.CanMove | StatusFlags.Targetable, true);

    this.animatedValues = {
      size: 10,
      height: 0,
      alpha: 255,
      displaySize: 10,
      visionRadius: 0,
    };
  }

  update() {
    this.updateBuffs();
    this.stats.update();

    if (this.canMove) this.move();

    if (this.deathData) {
      this.deathData.reviveAfter -= deltaTime;
      if (this.deathData.reviveAfter <= 0) {
        this.respawn();
      }
    }

    let isStealthed = hasFlag(this.stats.actionState, ActionState.STEALTHED);
    let alphaColor = this.isInsideBush ? 100 : isStealthed ? 20 : 255;

    let { size, height, alpha, visionRadius } = this.animatedValues;
    this.animatedValues = {
      displaySize: size + height,
      size: lerp(size, this.stats.size.value, 0.1),
      height: lerp(height, this.stats.height.value, 0.3),
      visionRadius: lerp(visionRadius, this.stats.visionRadius.value, 0.1),
      alpha:
        alphaColor > alpha
          ? lerp(alpha || 0, alphaColor, 0.2)
          : alphaColor,
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
    if (alpha < 255) tint(255, alpha);
    noStroke();
    fill(240, alpha);
    image(this.avatar?.data, pos.x, pos.y, size, size);

    stroke(this.isAllied ? [0, 255, 0, alpha] : [255, 0, 0, alpha]);
    strokeWeight(2);
    noFill();
    circle(pos.x, pos.y, size);

    if (this.isDead) {
      noStroke();
      fill(0, 200);
      circle(pos.x, pos.y, size);
    }
    pop();
  }

  drawDir() {
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

    let healthBarHeight = 6;
    let healthBarWidth = 100;
    let healthBarX = pos.x - healthBarWidth / 2;
    let healthBarY = pos.y - size / 2 - healthBarHeight - 15;
    let healthBarColor = this.isAllied ? [67, 196, 29, alpha] : [196, 67, 29, alpha];
    let healthBarBgColor = [242, 242, 242, alpha];
    let healthBarValue = ~~this.stats.health.value;
    let healthBarMaxValue = ~~this.stats.maxHealth.value;
    let healthBarValuePercent = healthBarValue / healthBarMaxValue;

    noStroke();
    fill(healthBarBgColor);
    rect(healthBarX, healthBarY, healthBarWidth, healthBarHeight);

    fill(healthBarColor);
    rect(healthBarX, healthBarY, healthBarWidth * healthBarValuePercent, healthBarHeight);

    fill(180, alpha);
    textAlign(CENTER, CENTER);
    textSize(12);
    text(`${healthBarValue} / ${healthBarMaxValue}`, pos.x, healthBarY - 10);
    pop();
  }

  addBuff(buff: any) {
    if (this.isDead || !buff) return;

    let preBuffs = this.buffs.filter((_buff: any) => _buff.constructor === buff.constructor);

    switch (buff.buffAddType) {
      case BuffAddType.REPLACE_EXISTING:
        for (let b of preBuffs) b.deactivateBuff();
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
          buff.timeElapsed = preBuffs[0].timeElapsed;
          preBuffs[0].deactivateBuff();
        }
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.STACKS_AND_OVERLAPS:
        if (preBuffs.length >= buff.maxStacks) {
          preBuffs[0].deactivateBuff();
        }
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.STACKS_AND_RENEWS:
        for (let b of preBuffs) b.renewBuff();
        if (preBuffs.length >= buff.maxStacks) {
          preBuffs[0].deactivateBuff();
        }
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      default:
        break;
    }
  }

  updateBuffs() {
    this.buffs = this.buffs.filter(buff => !buff.toRemove);

    this._buffEffectsToEnable = 0;
    this._buffEffectsToDisable = 0;

    for (let buff of this.buffs) {
      buff.update();
      this._buffEffectsToEnable |= buff.statusFlagsToEnable;
      this._buffEffectsToDisable |= buff.statusFlagsToDisable;
    }

    this.setStatus(StatusFlags.None, true);
  }

  takeHeal(heal: number, healer: any) {
    if (this.isDead) return;

    let combatText = new CombatText(this);
    combatText.text = '+' + heal;
    combatText.textColor = [0, 255, 0];
    this.game.objectManager.addObject(combatText);

    this.stats.health.baseValue = constrain(
      this.stats.health.baseValue + heal,
      0,
      this.stats.maxHealth.value
    );
  }

  takeDamage(damage: number, attacker: any) {
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

  die(deathData: { attacker?: any; reviveAfter: number }) {
    this.deathData = deathData;
  }

  respawn() {
    this.stats.health.baseValue = this.stats.maxHealth.value;
    this.deathData = null;

    let spawnPoint = this.game.randomSpawnPoint();
    this.position.set(spawnPoint.x, spawnPoint.y);
    this.destination.set(spawnPoint.x, spawnPoint.y);
  }

  setStatus(status: number, enabled: boolean) {
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

  moveTo(x: number, y: number) {
    this.destination.set(x, y);
  }

  teleportTo(x: number, y: number) {
    this.position.set(x, y);
    this.destination.set(x, y);
  }

  stopMovement() {
    this.destination.set(this.position.x, this.position.y);
  }

  hasBuff(BuffClass: any) {
    return this.buffs.some((buff: any) => buff instanceof BuffClass);
  }

  getCollideBoundingBox(): any {
    let size = this.animatedValues.size;
    return new Circle({
      x: this.position.x,
      y: this.position.y,
      r: size / 2,
      data: this,
    });
  }

  getDisplayBoundingBox(): any {
    let size = this.isAllied ? this.visionRadius * 2 : this.animatedValues.size;
    return new Rectangle({
      x: this.position.x - size / 2,
      y: this.position.y - size / 2,
      w: size,
      h: size,
      data: this,
    });
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
