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
import PathAgent from '../../nav/PathAgent';
import { NAV_MAX_TERRAIN_RADIUS } from '../../nav/NavGrid';
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

/**
 * Frames a displaced unit is left out of body separation for. Displacements
 * (Flash, a hook, a knockback) write `position` straight, so a push-out fighting
 * them reads as a stutter. Two frames covers the frame the displacement landed
 * on and the one after it, which is enough for the one-shot kind; a dash keeps
 * itself out for its whole duration through the Ghosted flag instead.
 */
export const DISPLACEMENT_GRACE_FRAMES = 2;

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

  /**
   * Bodies that push but never get pushed: turrets (anchored, and they rewrite
   * `position` after their buffs run) and camps that stand on their spot for
   * good. They hand their half of a separation to the other body.
   */
  isImmovable = false;

  /** Frames left in which body separation skips this unit. See markDisplaced(). */
  _separationGrace = 0;

  /**
   * The route this unit is walking, when it has one. Built on first use, so a
   * unit that never takes a `navigateTo` — turrets, fountains, every unit in a
   * headless spell test — never allocates one.
   */
  pathAgent: PathAgent | null = null;

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
    // ticked before the buffs run, so a displacement applied during this frame's
    // updateBuffs() still gets its full grace afterwards
    if (this._separationGrace > 0) this._separationGrace -= 1;

    this.updateBuffs();
    this.stats.update();

    // The route picks this frame's destination before the step is taken, so a
    // unit rounding a corner turns on the frame it arrives rather than the one
    // after it.
    this.pathAgent?.update(deltaTime);
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

    // Overlay, not world: see Camera.constantSize. The bar and its text
    // compensate together — 12px digits over a 39px bar is worse than either
    // extreme. `size` stays in world units: the bar hangs off a sprite that
    // really is that big.
    const k = this.game?.camera?.constantSize?.(1) ?? 1;

    let healthBarHeight = 6 * k;
    let healthBarWidth = 100 * k;
    let healthBarX = pos.x - healthBarWidth / 2;
    let healthBarY = pos.y - size / 2 - healthBarHeight - 15 * k;
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
    textSize(12 * k);
    text(`${healthBarValue} / ${healthBarMaxValue}`, pos.x, healthBarY - 10 * k);
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

    // whole points, for the same reason takeDamage rounds
    heal = Math.round(heal);
    if (heal <= 0) return;

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

    // Whole points, in and out. Damage is built from lerps, percentages and
    // unit-type multipliers, so it arrives as things like 23.799999999999997 —
    // which then landed in the floating combat text verbatim and left health
    // pools carrying a tail of binary noise. Rounded before the modifiers so
    // shields also deal in whole points, and again after, because a partial
    // absorb reintroduces a fraction.
    damage = Math.round(damage);
    if (damage <= 0) return;

    // shields and damage modifiers get first look; they may eat all of it
    for (const buff of this.buffs) {
      damage = buff.modifyIncomingDamage(damage, attacker);
      if (damage <= 0) return;
    }

    damage = Math.round(damage);
    if (damage <= 0) return;

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
    this.pathAgent?.clear();
    this.clearBuffs();
  }

  /**
   * Drops every buff on death instead of letting them ride the corpse (and
   * then respawn): each one is deactivated so `onDeactivate` hooks unwind
   * status flags and every spell-held reference (Twitch's stealth cloak,
   * Thresh's shackle, Blitzcrank's airborne) sees `toRemove` flip. Iterate a
   * copy — `deactivateBuff()` calls out to listeners that must not mutate
   * `this.buffs` out from under this loop.
   */
  private clearBuffs(): void {
    for (const buff of this.buffs.slice()) buff.deactivateBuff();
    this.buffs = [];
  }

  respawn() {
    this.stats.health.baseValue = this.stats.maxHealth.value;
    this.deathData = null;
    // a route planned from where the corpse fell means nothing at the fountain
    this.pathAgent?.clear();

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

  /**
   * Walk at a point in a straight line, ignoring terrain. Unchanged, and still
   * the right call for a dash, a hook, a displacement or a spell that writes a
   * destination — each of those means "go here now", not "plan a route". It
   * therefore *cancels* whatever route was running, so the two never fight.
   */
  moveTo(x: number, y: number) {
    this.pathAgent?.clear();
    if (this.destination.x !== x || this.destination.y !== y) this.movementRevision += 1;
    this.destination.set(x, y);
  }

  /**
   * Walk to a point, around terrain. This is the move *order*: what a right
   * click, a chase and a leash all want.
   *
   * With no navigation in the game context it is `moveTo` exactly, so a unit
   * built for a headless test behaves as it always did. `urgent` puts the
   * request at the front of the search queue — the local player's own orders
   * use it, because one frame of latency is invisible on a bot and is not on a
   * click.
   */
  navigateTo(x: number, y: number, urgent = false) {
    const navigation = this.game?.navigation;
    if (!navigation) {
      this.moveTo(x, y);
      return;
    }

    if (!this.pathAgent) this.pathAgent = new PathAgent(this, navigation);
    // A route is an order in its own right, so it bumps the same revision a
    // channelled spell watches for. Following the route does not — rounding a
    // corner is not a second order.
    if (this.destination.x !== x || this.destination.y !== y) this.movementRevision += 1;
    this.pathAgent.order(x, y, urgent);
  }

  teleportTo(x: number, y: number) {
    this.markDisplaced();
    this.pathAgent?.clear();
    this.position.set(x, y);
    this.destination.set(x, y);
  }

  markDisplaced() {
    this.displacementRevision += 1;
    this._separationGrace = DISPLACEMENT_GRACE_FRAMES;
  }

  stopMovement() {
    this.pathAgent?.clear();
    this.destination.set(this.position.x, this.position.y);
  }

  /** Speed in world units per frame. Read by the route follower. */
  get moveSpeed(): number {
    return this.stats.speed.value;
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
  /** Gate for basic attacks. Disarm, and every crowd control that takes over a
   *  unit, clear ActionState.CAN_ATTACK through Stats.updateActionState. */
  get canAttack() {
    return !this.isDead && hasFlag(this.stats.actionState, ActionState.CAN_ATTACK);
  }
  /** Total damage every shield on this unit can still absorb. */
  get shieldAmount(): number {
    let total = 0;
    for (const buff of this.buffs) total += buff.shieldAmount || 0;
    return total;
  }

  /**
   * Body radius for unit-on-unit separation. Deliberately `stats.size`, the same
   * circle TerrainMap pushes out of walls, rather than the lerped
   * `animatedValues.size` — a body that grows and shrinks while Cho'Gath eats
   * would make the separation it causes wobble too.
   */
  get bodyRadius(): number {
    return this.stats.size.value / 2;
  }

  /**
   * The radius *terrain* treats this body as — wall push-out
   * (`TerrainMap.pushOutOfWalls`) and route planning (`PathAgent`,
   * `NavGrid`), which have to agree or a route gets planned through a gap the
   * push-out then refuses.
   *
   * Capped at `NAV_MAX_TERRAIN_RADIUS`; see that constant for the measured
   * reason. Everything that is not terrain — the drawn body, the hitbox,
   * `combat/Reach.ts`, `UnitCollisionSystem`'s shove — deliberately keeps
   * reading `bodyRadius` and keeps scaling with the real size.
   */
  get terrainRadius(): number {
    return Math.min(this.bodyRadius, NAV_MAX_TERRAIN_RADIUS);
  }

  /**
   * Whether this unit takes part in body separation at all. Corpses do not, and
   * neither does a unit that is being displaced: a dash, a hook or a knockback
   * writes `position` directly and must win, so ghosted units are left out
   * entirely — they neither push nor get pushed. TerrainMap skips ghosted units
   * for walls on the same grounds.
   */
  get collidesWithUnits(): boolean {
    return (
      !this.isDead &&
      this._separationGrace <= 0 &&
      !hasFlag(this.stats.actionState, ActionState.IS_GHOSTED)
    );
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
