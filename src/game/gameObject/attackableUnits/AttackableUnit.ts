import { Circle } from '@/libs/quadtree';
import { hasFlag } from '@/utils/index';
import ActionState from '@/game/enums/ActionState';
import BuffAddType from '@/game/enums/BuffAddType';
import StatusFlags from '@/game/enums/StatusFlags';
import GameObject from '@/game/gameObject/GameObject';
import type { GameObjectOptions, GameObjectRuntimeContext } from '@/game/gameObject/GameObject';
import Stats from '@/game/gameObject/Stats';
import CombatText from '@/game/gameObject/helpers/CombatText';
import MatchTally, { type KillCredit } from '@/game/combat/MatchTally';
import AssetManager, { type AssetHandle } from '@/managers/AssetManager';
import PathAgent from '@/game/nav/PathAgent';
import { NAV_MAX_TERRAIN_RADIUS } from '@/game/nav/NavGrid';
import type Buff from '@/game/gameObject/Buff';
import type { BuffConstructor, BuffStackId } from '@/game/gameObject/Buff';

export interface AttackableUnitOptions extends Omit<GameObjectOptions, 'game'> {
  game: GameObjectRuntimeContext;
  avatar?: AssetHandle;
  stats?: Stats;
}

export interface AttackableUnitRenderOptions {
  compactUnits?: boolean;
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

/**
 * How long a unit remembers the enemy that last hit it, in ms. Read by
 * `Turret.findTarget` for ally-protection aggro: a tower punishes an enemy
 * champion attacking an ally under it, and holds that aggro this long after the
 * last hit so a single stray shot does not pin the tower forever.
 */
export const RECENT_ATTACKER_MS = 1500;

export default class AttackableUnit extends GameObject {
  declare game: GameObjectRuntimeContext;

  /**
   * Whether **the player's team** currently has vision of this unit.
   *
   * Written once a frame by `FogOfWar.calculateSight`, which clears it on every
   * unit and re-lights it from `game.player.teamId`'s eyes. Read by the three
   * things that render the player's point of view — the draw cull, the minimap
   * and the debug overlay — and by nothing else.
   *
   * **It is not a targeting gate, and it is not a general "should I paint
   * this" flag.** It used to be called `willDraw` and lived on `GameObject`,
   * and both halves of that name were wrong: thirteen abilities read it as
   * "can my caster see this", which silently gated every bot's spell on what
   * the *human* could see — a bot could not target an enemy beside it in a
   * bush the player had not lit, and could target one across the map the
   * player had. `combat/Vision.ts` (`canSee` / `PredefinedFilters.visibleTo`)
   * answers that question per observer and is the only thing that may decide
   * what a unit is allowed to do; `tests/game/spells/target-vision-seam.test.ts`
   * keeps the old name from coming back.
   *
   * It lives here rather than on `GameObject` because the fog only ever
   * touches units — asking a particle system whether the player's team can see
   * it never meant anything.
   */
  visibleToPlayerTeam = true;

  /** Kills, deaths, farm and damage — the scoreboard. See `combat/MatchTally.ts`. */
  readonly tally = new MatchTally();

  /**
   * What killing this unit is worth to whoever did it. A lane minion and a
   * jungle camp are farm, which is the default; `Champion` is a kill, and
   * `Pet`/`Turret` are neither.
   */
  killCredit: KillCredit = 'minion';

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
   * The last enemy to damage this unit, warm for `RECENT_ATTACKER_MS`. Read by
   * `Turret.findTarget` so a tower prioritises an enemy champion attacking an
   * ally standing under it. Written in `takeDamage`, aged out in `update`.
   */
  recentAttacker: AttackableUnit | null = null;
  private _recentAttackerTtl = 0;

  /**
   * How far this unit lights fog for the player team, independent of combat
   * `visionRadius`. Champions reveal their own (wall-aware) sight; minions and
   * turrets carry `visionRadius = 0` — no combat sight of their own — and
   * override this to light a cheap circle for their team instead, so an ally
   * swarm reveals the map without a raycast per body. 0 reveals nothing.
   */
  get fogRevealRadius(): number {
    return this.visionRadius;
  }

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

    if (this._recentAttackerTtl > 0) {
      this._recentAttackerTtl -= deltaTime;
      if (
        this._recentAttackerTtl <= 0 ||
        this.recentAttacker?.isDead ||
        this.recentAttacker?.toRemove
      ) {
        this.recentAttacker = null;
      }
    }

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

  /**
   * Make this unit fight `attacker`, overruling whatever it had decided.
   *
   * The seam a taunt needs, and the reason it is here rather than inside the
   * `Taunt` buff: "who am I attacking" is stored somewhere different in every
   * subclass — a `Champion` has a `BasicAttackController` holding a standing
   * order, a `Minion` and a `Monster` each have a `targetLock` plus a phase.
   * A buff that reached into all three would have to know all three, and the
   * next unit type would silently be immune to taunts.
   *
   * The base does nothing: a unit with no notion of a target cannot be taunted,
   * and that is a fact about the unit rather than a failure.
   */
  forceAttackTarget(_attacker: AttackableUnit): void {}

  // hook called by TerrainMap when this unit hits a wall
  onCollideWall() {}

  // hook for units colliding with the map edge (old JS: super.onCollideMapEdge?.())
  onCollideMapEdge() {}

  draw({ compactUnits = false }: AttackableUnitRenderOptions = {}) {
    this.drawAvatar();
    if (!compactUnits) this.drawDir();
    this.drawBuffs(compactUnits);
    this.drawHealthBar(compactUnits);
  }

  drawAvatar() {
    let pos = this.position;
    let { displaySize: size, alpha } = this.animatedValues;

    push();
    noStroke();
    fill(240, alpha);

    // Avatars arrive in two shapes: pre-cut circles and raw square portraits from
    // the wiki importer. Clipping here makes every avatar round, so new art does
    // not have to be cut to a circle before it can be used.
    drawingContext.save();
    drawingContext.globalAlpha = alpha / 255;
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

  drawBuffs(compact = false) {
    // `singleRepresentativeDraw` buffs (see `Buff.ts`) are a data count with
    // one shared visual, not one drawable per instance — so past the first
    // live stack of a given `stackId`, skip straight past `.draw()` with a
    // property read and a `Set` check instead of calling into it. A champion
    // cheated to hundreds of Feast stacks used to mean hundreds of function
    // calls a frame to paint one ring.
    let seenSingleDraw: Set<BuffStackId> | null = null;
    for (const buff of this.buffs) {
      if (buff.singleRepresentativeDraw) {
        seenSingleDraw ??= new Set();
        if (seenSingleDraw.has(buff.stackId)) continue;
        seenSingleDraw.add(buff.stackId);
      }
      if (!compact || (buff.statusFlagsToEnable | buff.statusFlagsToDisable) !== 0) {
        buff.draw?.();
      }
    }
  }

  drawHealthBar(_compact = false) {
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

    // A permanent, uniform stack (`Buff.countedStacks`) is one instance
    // carrying a counter, not one instance per stack: grow the existing
    // live instance's `stacks` instead of
    // pushing a new one. Short-circuits ahead of `buffAddType` entirely,
    // since representation (one instance vs. N) is a different axis from
    // that switch's semantics (replace/renew/stack), and every other buff in
    // the game leaves `countedStacks` at its default `false` and never
    // reaches this branch.
    if (buff.countedStacks) {
      const existing = preBuffs.find(_buff => !_buff.toRemove);
      if (existing) {
        // Capped going up, but never clawed back down: a cheat can set
        // `stacks` on a live instance straight past `maxStacks` (the
        // practice panel's write side, which a pack's spell implements), and a later
        // real-play stack must not silently erase that — it only ever adds
        // up to the cap from where the count already stood.
        const grown = Math.min(existing.stacks + buff.stacks, existing.maxStacks);
        existing.stacks = Math.max(existing.stacks, grown);
        existing.renewBuff();
        existing.onStacksChanged();
        return;
      }
      this.buffs.push(buff);
      buff.activateBuff();
      return;
    }

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
    // Compact in place, and only when something actually expired. This was a
    // `.filter`, which built a fresh array per unit per frame to almost always
    // hand back the same list — buffs expire on events, not on the clock.
    // Same two-pointer shape ObjectManager and MinionSpawner use, and it keeps
    // insertion order, which `modifyIncomingDamage` depends on.
    let removed = 0;
    for (let i = 0; i < this.buffs.length; i++) {
      if (this.buffs[i].toRemove) {
        removed++;
        continue;
      }
      if (removed > 0) this.buffs[i - removed] = this.buffs[i];
    }
    if (removed > 0) this.buffs.length -= removed;

    this._buffEffectsToEnable = 0;
    this._buffEffectsToDisable = 0;

    for (let buff of this.buffs) {
      buff.update();
      this._buffEffectsToEnable |= buff.statusFlagsToEnable;
      this._buffEffectsToDisable |= buff.statusFlagsToDisable;
    }

    this.setStatus(StatusFlags.None, true);
  }

  /**
   * Give mana back. `takeHeal`'s counterpart, and the seam a spell has to use.
   *
   * `tests/game/spells/mana-spend-seam.test.ts` forbids anything under
   * `spells/`, `spellObjects/` or `buffs/` from naming `stats.mana` at all,
   * because URF's `manaFree` has to be one flip rather than a per-spell edit.
   * That rule is about *billing* a caster, and it is right that a refill is not
   * subject to it — the seam test's own header says a refill must not be zeroed
   * by URF. So the granting side lives out here on the unit, next to the health
   * equivalent, where nothing about `MatchRules` applies.
   *
   * Clamped to the pool rather than allowed to overfill, and rounded to whole
   * points for the same reason `takeHeal` rounds.
   */
  restoreMana(amount: number): void {
    if (this.isDead) return;

    amount = Math.round(amount);
    if (amount <= 0) return;

    const max = this.stats.maxMana.value;
    if (max <= 0) return;

    this.stats.mana.baseValue = constrain(this.stats.mana.baseValue + amount, 0, max);
  }

  takeHeal(heal: number, _healer?: HealSource): void {
    if (this.isDead) return;

    // whole points, for the same reason takeDamage rounds
    heal = Math.round(heal);
    if (heal <= 0) return;

    CombatText.show(this, 'heal', heal, [0, 255, 0]);

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

    // What was aimed at this unit, before anything ate it. Retaliation is
    // measured on this rather than on what got through: "he hit me for 50, he
    // takes 40" is the sentence, and a shield eating the 50 does not make the
    // swing smaller.
    const swung = damage;

    // Remember who is hitting us, for the turret's ally-protection aggro
    // (`recentAttacker`). An enemy swing counts even when a shield eats it — a
    // tower answers the attack, not the damage that gets through.
    if (attacker && attacker !== this && attacker.teamId !== this.teamId) {
      this.recentAttacker = attacker;
      this._recentAttackerTtl = RECENT_ATTACKER_MS;
    }

    // shields and damage modifiers get first look; they may eat all of it
    for (const buff of this.buffs) {
      damage = buff.modifyIncomingDamage(damage, attacker);
      if (damage <= 0) break;
    }

    damage = Math.max(0, Math.round(damage));
    // Nothing reached health — but something was still swung, so the reaction
    // pass below still owes an answer. Only the health side is skipped.
    if (damage <= 0) {
      this.reactToDamage(swung, 0, attacker);
      return;
    }

    CombatText.show(this, 'damage', damage, [255, 0, 0]);

    // What actually landed, for the scoreboard: capped at the pool that was
    // there to take it, so a 200-damage execute on a 12-health minion is 12
    // damage dealt rather than 200. Read before the subtraction, because after
    // it the pool is already negative.
    const landed = Math.min(damage, Math.max(0, this.stats.health.baseValue));
    this.tally.damageTaken += landed;
    if (attacker && attacker !== this) attacker.tally.damageDealt += landed;

    this.stats.health.baseValue -= damage;

    // Omnivamp, and the only place it is paid. `takeDamage` is the one funnel
    // every source of damage already goes through — a swing, a spell, a poison
    // tick — so the stat covers all of them without a single one of them
    // knowing it exists. Paid on the damage that actually landed, i.e. after
    // shields ate their share, and before the death check so the kill still
    // heals. Self-damage (a self-inflicted cost spell) is excluded: a cost that refunds itself is
    // not a cost.
    if (attacker && attacker !== this && !attacker.isDead) {
      const vamp = attacker.stats?.omnivamp?.value ?? 0;
      if (vamp > 0) attacker.takeHeal(damage * vamp, attacker);
    }

    // Before the death check, for the same reason omnivamp is: a hit that kills
    // still happened, and a reflect buff on the victim still returns it.
    this.reactToDamage(swung, damage, attacker);

    if (this.stats.health.baseValue <= 0) {
      this.die({ attacker, reviveAfter: this.reviveTime });
    }
  }

  /**
   * Hands every live buff the hit that just resolved. Separate from the
   * mitigation loop above so a buff that only *reacts* is not sensitive to
   * where it sits in `buffs` — see `Buff.onDamageTaken`.
   *
   * Iterated over a copy: a reflect re-enters `takeDamage` on the attacker, and
   * a buff that expires during the pass would otherwise mutate the list being
   * walked.
   */
  private reactToDamage(swung: number, landed: number, attacker?: AttackableUnit): void {
    for (const buff of [...this.buffs]) {
      if (buff.toRemove) continue;
      buff.onDamageTaken(swung, landed, attacker);
    }
  }

  die(deathData: UnitDeathData): void {
    // `die` is reachable on a corpse — `Champion.die` runs cleanup that is safe
    // to repeat — so the ledger is only touched on the transition.
    if (!this.isDead) {
      this.tally.deaths++;
      const killer = deathData.attacker;
      if (killer && killer !== this) {
        if (this.killCredit === 'champion') killer.tally.kills++;
        else if (this.killCredit === 'minion') killer.tally.minionsKilled++;
      }
    }
    this.deathData = deathData;
    this.pathAgent?.clear();
    this.clearBuffs();
  }

  /**
   * Drops every buff on death instead of letting them ride the corpse (and
   * then respawn): each one is deactivated so `onDeactivate` hooks unwind
   * status flags and every spell-held reference (a stealth cloak,
   * a leashing shackle, a knock-up hold) sees `toRemove` flip. Iterate a
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
    // A route planned from where the corpse fell means nothing at its team fountain.
    this.pathAgent?.clear();

    const spawnPoint = this.game.randomSpawnPoint(this.teamId);
    this.position.set(spawnPoint.x, spawnPoint.y);
    this.destination.set(spawnPoint.x, spawnPoint.y);
    // The corpse and the fountain are the whole map apart: draw the respawn at
    // the fountain, not sliding there. (The 150px net would catch it anyway;
    // this states it at the source.)
    this.snapRenderOrigin();
  }

  setStatus(status: number, enabled: boolean) {
    if (enabled) this._statusBeforeApplyingBuffEfects |= status;
    else this._statusBeforeApplyingBuffEfects &= ~status;

    // Disable wins. It used to be the other way round — enable was OR'd on last,
    // so a flag one buff turned on could not be turned off by another — which
    // made `TrueSight` unable to do the one thing it exists for: `Invisible`
    // enables `Stealthed`, `TrueSight` disables it, and the reveal simply lost.
    // Nobody noticed while stealth had no effect on anything; it does now.
    //
    // Safe in the other direction because nothing in the tree *enables* a
    // permission — `statusFlagsToEnable` is always a condition being applied
    // (Stealthed, Stunned, Suppressed, Ghosted) and `statusFlagsToDisable` is
    // always a permission being taken away (CanMove, CanCast, Targetable) or
    // this one reveal. So the two sets never met before, and this is what they
    // should do when they do.
    this.status =
      (this._statusBeforeApplyingBuffEfects | this._buffEffectsToEnable) &
      ~this._buffEffectsToDisable;

    this.stats.updateActionState(this.status);
  }

  move() {
    // Written out rather than as `p5.Vector.sub(...).normalize().mult(speed)`,
    // which allocated a vector per moving unit per frame. The arithmetic is
    // deliberately in p5's own order — normalize multiplies by `1 / len`, it
    // does not divide — so this is bit-identical to what it replaced, not
    // merely equivalent to within rounding.
    const dx = this.destination.x - this.position.x;
    const dy = this.destination.y - this.position.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const speed = this.stats.speed.value;

    if (distance <= speed) {
      this.position.set(this.destination.x, this.destination.y);
    } else {
      // `distance > speed >= 0` here, so it is never zero and normalize's own
      // zero-length guard has nothing to protect.
      const inverseDistance = 1 / distance;
      this.position.x += dx * inverseDistance * speed;
      this.position.y += dy * inverseDistance * speed;
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
    // Overrides GameObject.teleportTo, so the render-origin snap has to be
    // re-stated here — a blink must not be drawn as a slide across the map.
    this.snapRenderOrigin();
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

  /**
   * `GameObject` memoises both bounding boxes and explains why; these two
   * overrides used to allocate unconditionally, which quietly opted the most
   * numerous object on the board out of that cache. Units are the ones it
   * matters most for: each box is rebuilt for the quadtree every tick, again
   * by the draw cull, and again for every candidate of every targeting query
   * in the same frame.
   *
   * Keyed on the *computed* size rather than on `isAllied`/`visionRadius`
   * separately, because the box is fully determined by centre plus size — if
   * a team change flips which size applies, the key moves with it.
   */
  private _unitCollideBB: Circle | null = null;
  private _unitCollideBBX = NaN;
  private _unitCollideBBY = NaN;
  private _unitCollideBBSize = NaN;

  getCollideBoundingBox() {
    const size = this.animatedValues.size;
    if (
      this._unitCollideBB &&
      this._unitCollideBBX === this.position.x &&
      this._unitCollideBBY === this.position.y &&
      this._unitCollideBBSize === size
    ) {
      return this._unitCollideBB;
    }
    this._unitCollideBBX = this.position.x;
    this._unitCollideBBY = this.position.y;
    this._unitCollideBBSize = size;
    this._unitCollideBB = new Circle({
      x: this.position.x,
      y: this.position.y,
      r: size / 2,
      data: this,
    });
    return this._unitCollideBB;
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox(
      this.isAllied ? this.visionRadius * 2 : this.animatedValues.size
    );
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
   * `animatedValues.size` — a body that grows and shrinks while a stacking
   * self-buff feeds
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
      // Either phasing flag clears bodies. Only IS_GHOSTED clears terrain, and
      // that split lives in TerrainMap.pushOutOfWalls, not here.
      !hasFlag(this.stats.actionState, ActionState.IS_GHOSTED) &&
      !hasFlag(this.stats.actionState, ActionState.PHASES_UNITS)
    );
  }

  /** Grounded units keep walking but cannot use their own movement abilities. */
  get grounded() {
    return hasFlag(this.stats.actionState, ActionState.GROUNDED);
  }
  /**
   * Hidden by an active stealth. Nothing that picks targets on its own may
   * acquire one of these — see `PredefinedFilters.excludeStealthed`.
   *
   * There is no observer side to this: a reveal is `TrueSight`, which strips
   * `StatusFlags.Stealthed` from the hidden unit itself, so a revealed champion
   * is simply no longer stealthed.
   */
  get isStealthed() {
    return hasFlag(this.stats.actionState, ActionState.STEALTHED);
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
