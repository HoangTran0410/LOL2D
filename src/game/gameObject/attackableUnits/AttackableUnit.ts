import { Circle, Rectangle } from '../../../libs/quadtree';
import { hasFlag } from '../../../utils/index';
import ActionState from '../../enums/ActionState';
import BuffAddType from '../../enums/BuffAddType';
import StatusFlags from '../../enums/StatusFlags';
import GameObject from '../GameObject';
import type { GameObjectOptions, GameObjectRuntimeContext } from '../GameObject';
import Stats from '../Stats';
import CombatText from '../helpers/CombatText';
import AssetManager, { type AssetHandle } from '../../../managers/AssetManager';
import type Buff from '../Buff';
import type { BuffConstructor } from '../Buff';

export interface AttackableUnitOptions extends Omit<GameObjectOptions, 'game'> {
  game: GameObjectRuntimeContext;
  avatar?: AssetHandle;
  stats?: Stats;
}

export interface UnitDeathData {
  attacker?: AttackableUnit;
  reviveAfter: number;
}

export type HealSource = GameObject;

export default class AttackableUnit extends GameObject {
  declare game: GameObjectRuntimeContext;
  buffs: Buff[] = [];
  _buffEffectsToEnable = 0;
  _buffEffectsToDisable = 0;
  _statusBeforeApplyingBuffEfects = 0;
  status = 0;
  deathData: UnitDeathData | null = null;
  reviveTime = 5000;

  avatar: AssetHandle | undefined;
  destination: p5.Vector;
  movementRevision = 0;
  displacementRevision = 0;
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
  }: AttackableUnitOptions) {
    super({ game, position, collisionRadius, visionRadius, teamId, id });

    this.game = game;
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

    // mutate in place to avoid allocating a new object every frame per unit
    const av = this.animatedValues;
    const { size, height, alpha, visionRadius } = av;
    av.displaySize = size + height; // PREVIOUS frame's size/height, keep this ordering
    av.size = lerp(size, this.stats.size.value, 0.1);
    av.height = lerp(height, this.stats.height.value, 0.3);
    av.visionRadius = lerp(visionRadius, this.stats.visionRadius.value, 0.1);
    av.alpha = alphaColor > alpha ? lerp(alpha || 0, alphaColor, 0.2) : alphaColor;
    this.visionRadius = av.visionRadius;
  }

  // hook called by TerrainMap when this unit hits a wall
  onCollideWall() {}

  // hook for units colliding with the map edge (old JS: super.onCollideMapEdge?.())
  onCollideMapEdge() {}

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

    // Avatars arrive in two shapes: pre-cut circles and raw square portraits from
    // the wiki importer. Clipping here makes every avatar round, so new art does
    // not have to be cut to a circle before it can be used.
    drawingContext.save();
    drawingContext.beginPath();
    drawingContext.arc(pos.x, pos.y, size / 2, 0, TWO_PI);
    drawingContext.clip();
    image(AssetManager.renderable(this.avatar), pos.x, pos.y, size, size);
    drawingContext.restore();

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

    // Shields sit to the right of current health, since they are eaten first.
    // On a healthy unit there is no room there, so the segment slides left and
    // overlays the health instead — a shield must never be invisible.
    const shield = this.shieldAmount;
    if (shield > 0) {
      const filled = healthBarWidth * healthBarValuePercent;
      const shieldW = Math.min((shield / healthBarMaxValue) * healthBarWidth, healthBarWidth);
      const shieldX = Math.min(filled, healthBarWidth - shieldW);
      fill(225, 230, 238, alpha * 0.85);
      rect(healthBarX + shieldX, healthBarY, shieldW, healthBarHeight);
    }

    fill(180, alpha);
    textAlign(CENTER, CENTER);
    textSize(12);
    text(`${healthBarValue} / ${healthBarMaxValue}`, pos.x, healthBarY - 10);
    pop();
  }

  addBuff(buff: Buff): void {
    if (this.isDead || !buff) return;

    // group by stackId when a buff declares one, so two spells applying the same
    // generic class (StatAmp, DamageOverTime) do not evict each other
    const stackKey = buff.stackId;
    const preBuffs = this.buffs.filter(_buff => _buff.stackId === stackKey);

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

  updateBuffs(): void {
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

  takeHeal(heal: number, _healer?: HealSource): void {
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

  takeDamage(damage: number, attacker?: AttackableUnit): void {
    if (this.isDead) return;

    // shields and damage modifiers get first look; they may eat all of it
    for (const buff of this.buffs) {
      damage = buff.modifyIncomingDamage(damage, attacker);
      if (damage <= 0) return;
    }

    let combatText = new CombatText(this);
    combatText.text = '-' + damage;
    combatText.textColor = [255, 0, 0];
    this.game.objectManager.addObject(combatText);

    this.stats.health.baseValue -= damage;
    if (this.stats.health.baseValue <= 0) {
      this.die({ attacker, reviveAfter: this.reviveTime });
    }
  }

  die(deathData: UnitDeathData): void {
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
    if (this.destination.x !== x || this.destination.y !== y) this.movementRevision += 1;
    this.destination.set(x, y);
  }

  teleportTo(x: number, y: number) {
    this.markDisplaced();
    this.position.set(x, y);
    this.destination.set(x, y);
  }

  markDisplaced() {
    this.displacementRevision += 1;
  }

  stopMovement() {
    this.destination.set(this.position.x, this.position.y);
  }

  hasBuff(BuffClass: BuffConstructor): boolean {
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
  /** Total damage every shield on this unit can still absorb. */
  get shieldAmount(): number {
    let total = 0;
    for (const buff of this.buffs) total += buff.shieldAmount || 0;
    return total;
  }

  /** Grounded units keep walking but cannot use their own movement abilities. */
  get grounded() {
    return hasFlag(this.stats.actionState, ActionState.GROUNDED);
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
