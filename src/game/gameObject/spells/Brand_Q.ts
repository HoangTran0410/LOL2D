import AssetManager, { type AssetHandle } from '../../../managers/AssetManager';
import Spell from '../Spell';
import MissileSpellObject from '../MissileSpellObject';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import DamageOverTime from '../buffs/DamageOverTime';
import Stun from '../buffs/Stun';
import TrailSystem from '../helpers/TrailSystem';
import type { CastContext } from '../../spell/runtime/types';

/**
 * Sear, and the Blaze mechanic the whole kit is built on.
 *
 * Brand has no passive slot here, so *Ablaze* lives in this file — the burn is
 * a `DamageOverTime` under one shared `stackId`, applied by every one of his
 * abilities and read back by every one of them for its bonus. Q's bonus is the
 * stun, which is why the burn's identity belongs next to it.
 *
 * The order matters everywhere it is used: ask `isAblaze` **before** calling
 * `applyAblaze`, or every spell pays its own bonus out to itself on first hit.
 */
export const ABLAZE_STACK_ID = 'brand_ablaze';
export const ABLAZE_DURATION_MS = 4_000;
export const ABLAZE_DAMAGE_PER_TICK = 2;
export const ABLAZE_TICK_INTERVAL_MS = 500;

/** Whether this unit is already burning — the gate on every Blaze bonus. */
export const isAblaze = (unit: AttackableUnit): boolean =>
  unit.buffs.some(buff => buff.stackId === ABLAZE_STACK_ID && !buff.toRemove);

/**
 * Set a unit alight. `DamageOverTime` renews by default, so re-igniting an
 * already-burning target pushes its remaining duration back instead of stacking
 * a second fire on it.
 *
 * Ability art rather than the generic burn icon on purpose: Ablaze is Brand's
 * own state, the thing the player is tracking to know whether the next cast
 * stuns — not a crowd-control indicator.
 */
export const applyAblaze = (
  source: AttackableUnit,
  target: AttackableUnit,
  image: AssetHandle | null | undefined
): void => {
  const burn = new DamageOverTime(ABLAZE_DURATION_MS, source, target);
  burn.stackId = ABLAZE_STACK_ID;
  burn.name = 'Bỏng';
  burn.image = image;
  burn.damagePerTick = ABLAZE_DAMAGE_PER_TICK;
  burn.tickInterval = ABLAZE_TICK_INTERVAL_MS;
  burn.flameColor = [255, 225, 120];
  burn.emberColor = [200, 45, 15];
  target.addBuff(burn);
};

export const COOLDOWN_MS = 6_000;
export const MANA_COST = 30;
export const RANGE = 480;
export const MISSILE_SPEED = 11;
export const MISSILE_SIZE = 34;
export const DAMAGE = 26;
/** Blaze bonus: only an already-burning target is stunned. */
export const STUN_DURATION_MS = 1_250;

export default class Brand_Q extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_brand_q');
  name = 'Vệt Lửa (Brand_Q)';
  description = `Phóng một quả cầu lửa, gây <span class="damage">${DAMAGE} sát thương</span> cho kẻ địch đầu tiên trúng phải và <span class="buff">Thiêu Đốt</span> mục tiêu. Nếu mục tiêu <span class="buff">đã bị Thiêu Đốt</span> từ trước, nó bị <span class="buff">Choáng</span> trong <span class="time">${STUN_DURATION_MS / 1000} giây</span>.`;
  coolDown = COOLDOWN_MS;
  manaCost = MANA_COST;

  range = RANGE;

  onSpellCast(context: CastContext) {
    const direction = this.firingDirection(context);

    const missile = new Brand_Q_Missile(this.owner);
    missile.destination = createVector(
      this.owner.position.x + direction.x * this.range,
      this.owner.position.y + direction.y * this.range
    );
    this.game.objectManager.addObject(missile);
  }
}

export class Brand_Q_Missile extends MissileSpellObject {
  image = AssetManager.get('spell_brand_q');
  speed = MISSILE_SPEED;
  size = MISSILE_SIZE;
  /** A bolt, not a wave: it burns out on the first body it touches. */
  maxHitCount = 1;

  visualWidth = MISSILE_SIZE * 1.6;
  visualHeight = MISSILE_SIZE;

  trailSystem: TrailSystem | null = new TrailSystem({
    owner: this,
    maxLength: 16,
    trailColor: '#F63A',
    trailSize: MISSILE_SIZE * 0.7,
    trailLifeTime: 260,
  });

  age = 0;
  /** Seeded once: `random()` in draw re-rolls every frame and flickers. */
  _tongues: { phase: number; length: number }[] = [];

  onAdded() {
    super.onAdded();
    for (let i = 0; i < 7; i++) {
      this._tongues.push({ phase: random(TWO_PI), length: random(0.55, 1.25) });
    }
  }

  onAfterMove() {
    this.age += deltaTime;
  }

  onHit(enemy: AttackableUnit) {
    // asked before igniting, or the bolt would stun off its own burn
    const wasAblaze = isAblaze(enemy);

    enemy.takeDamage(DAMAGE, this.owner);
    applyAblaze(this.owner, enemy, this.image);

    if (wasAblaze) enemy.addBuff(new Stun(STUN_DURATION_MS, this.owner, enemy));
  }

  draw() {
    const angle = Math.atan2(
      this.destination.y - this.position.y,
      this.destination.x - this.position.x
    );
    const flicker = 1 + 0.12 * sin(this.age / 55);

    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    noStroke();

    // tongues of flame streaming backwards off the bolt
    for (const tongue of this._tongues) {
      const wobble = sin(this.age / 90 + tongue.phase);
      const length = this.size * tongue.length * (1 + 0.2 * wobble);
      fill(220, 70, 20, 110);
      ellipse(-length * 0.55, wobble * this.size * 0.22, length, this.size * 0.45);
    }

    // the bolt: an outer ember shell, a hot body, a white core
    fill(190, 40, 10, 190);
    ellipse(0, 0, this.size * 1.7 * flicker, this.size * 1.05 * flicker);
    fill(255, 140, 30, 235);
    ellipse(this.size * 0.08, 0, this.size * 1.1 * flicker, this.size * 0.7 * flicker);
    fill(255, 245, 200, 250);
    ellipse(this.size * 0.16, 0, this.size * 0.5 * flicker, this.size * 0.34 * flicker);

    pop();
  }

  getDisplayBoundingBox() {
    // the tongues stream well behind the missile's own body
    const r = this.size * 1.6;
    return this.squareDisplayBoundingBox(r * 2);
  }
}
