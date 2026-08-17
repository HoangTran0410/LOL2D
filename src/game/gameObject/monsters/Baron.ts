import { Circle, Rectangle } from '../../../libs/quadtree';
import { PredefinedFilters } from '../../managers/ObjectManager';
import MissileSpellObject from '../MissileSpellObject';
import SpellObject from '../SpellObject';
import AreaSpellObject from '../spellObjects/AreaSpellObject';
import Airborne from '../buffs/Airborne';
import DamageOverTime from '../buffs/DamageOverTime';
import Slow from '../buffs/Slow';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import type Champion from '../attackableUnits/Champion';
import type Monster from '../attackableUnits/Monster';
import type { MonsterAbility } from '../attackableUnits/Monster';
import type { Vec2 } from '../../spell/runtime/types';

/**
 * Baron's kit, and the first thing built on `MonsterAbility`.
 *
 * The whole design constraint is that a champion pool is 100 health. Baron's
 * bite is 12 and unavoidable; everything else here is dodgeable, and adds up to
 * a kill from full in about six seconds if you stand in all of it. That split —
 * a small tax you cannot escape, a large one you can — is what makes it worth
 * fighting rather than worth avoiding.
 *
 * Every effect is its own `SpellObject` rather than something drawn from
 * `Monster.draw()`. `ObjectManager.draw` skips a unit outside the camera, so an
 * effect that reaches past its caster's body drawn from the caster vanishes
 * while its damage still lands — the trap Lux R fell into. The slam's ring is
 * 260px against a 100px body, so it very much reaches past.
 */

const POISON_GREEN: [number, number, number] = [150, 255, 90];
const POISON_DARK: [number, number, number] = [30, 90, 20];

export const SPIT = {
  name: 'Nhổ Độc',
  cooldownMs: 8_000,
  /** On impact, before the poison starts. */
  damage: 18,
  /** What the poison adds over its whole life. */
  poisonTotal: 12,
  poisonDurationMs: 3_000,
  poisonTickMs: 500,
  speed: 6,
  size: 34,
} as const;

export const SLAM = {
  name: 'Quật Đuôi',
  cooldownMs: 12_000,
  /** The wind-up you get to walk out of. */
  telegraphMs: 600,
  radius: 260,
  damage: 22,
  airborneMs: 700,
  /** How long the burst stays on screen after it lands. */
  burstMs: 260,
} as const;

export const POOL = {
  name: 'Vũng Độc',
  cooldownMs: 10_000,
  radius: 140,
  durationMs: 5_000,
  tickMs: 1_000,
  damagePerTick: 6,
  /** Ticks over a full duration — the pool's total is this times the tick. */
  ticks: 5,
  /** A fraction, like every other `Slow.percent` in the tree: 0.35 is 35%. */
  slowPercent: 0.35,
} as const;

/** Hostile to Baron: every unit that is not on its side, minions included. */
const hostilesIn = (owner: AttackableUnit, center: Vec2, radius: number) =>
  owner.game.objectManager.queryObjects({
    area: new Circle({ x: center.x, y: center.y, r: radius }),
    filters: [PredefinedFilters.canTakeDamageFromTeam(owner.teamId)],
  }) as AttackableUnit[];

/**
 * A glob of acid. A plain skillshot: it flies at where you were standing, and
 * walking out of the line is the entire counterplay.
 */
export class BaronPoisonSpit extends MissileSpellObject {
  speed = SPIT.speed;
  size = SPIT.size;
  maxHitCount = 1;

  onHit(enemy: AttackableUnit): void {
    enemy.takeDamage(SPIT.damage, this.owner);

    const poison = new DamageOverTime(SPIT.poisonDurationMs, this.owner, enemy);
    poison.name = 'Độc Baron';
    poison.damagePerTick = SPIT.poisonTotal / (SPIT.poisonDurationMs / SPIT.poisonTickMs);
    poison.tickInterval = SPIT.poisonTickMs;
    poison.flameColor = POISON_GREEN;
    poison.emberColor = POISON_DARK;
    enemy.addBuff(poison);
  }

  draw(): void {
    const wobble = sin(frameCount * 0.3) * 2;

    push();
    translate(this.position.x, this.position.y);
    noStroke();
    fill(POISON_DARK[0], POISON_DARK[1], POISON_DARK[2], 200);
    circle(0, 0, this.size + wobble);
    fill(POISON_GREEN[0], POISON_GREEN[1], POISON_GREEN[2], 230);
    circle(0, 0, this.size * 0.6 + wobble);
    fill(230, 255, 200, 180);
    circle(-this.size * 0.12, -this.size * 0.12, this.size * 0.25);
    pop();
  }
}

/**
 * The tail. A ring around Baron that spends `telegraphMs` growing before it
 * does anything, so the whole ability is a question of whether you noticed.
 *
 * Centred on Baron at the moment it was cast rather than following it, which
 * costs nothing today (Baron cannot move) and means the warning circle is
 * honest for any camp that can.
 */
export class BaronTailSlam extends SpellObject {
  position = this.owner.position.copy();
  age = 0;
  landed = false;

  update(): void {
    this.age += deltaTime;

    if (!this.landed && this.age >= SLAM.telegraphMs) {
      this.landed = true;
      this.detonate();
    }

    if (this.age >= SLAM.telegraphMs + SLAM.burstMs) this.toRemove = true;
  }

  private detonate(): void {
    for (const target of hostilesIn(this.owner, this.position, SLAM.radius)) {
      target.takeDamage(SLAM.damage, this.owner);
      target.addBuff(new Airborne(SLAM.airborneMs, this.owner, target));
    }
  }

  draw(): void {
    push();
    translate(this.position.x, this.position.y);

    if (!this.landed) {
      // the warning: a ring closing in on the radius it will actually cover, so
      // the edge you are reading is the edge that will hit you
      const t = constrain(this.age / SLAM.telegraphMs, 0, 1);
      noFill();
      stroke(255, 120, 60, 90 + 90 * t);
      strokeWeight(3);
      circle(0, 0, SLAM.radius * 2);
      stroke(255, 200, 120, 220);
      strokeWeight(5);
      circle(0, 0, SLAM.radius * 2 * (0.25 + t * 0.75));
    } else {
      const t = constrain((this.age - SLAM.telegraphMs) / SLAM.burstMs, 0, 1);
      const fade = 1 - t;
      noFill();
      stroke(255, 235, 190, 240 * fade);
      strokeWeight(10 * fade + 2);
      circle(0, 0, SLAM.radius * 2 * (0.9 + t * 0.25));
      stroke(200, 120, 60, 160 * fade);
      strokeWeight(20 * fade);
      circle(0, 0, SLAM.radius * 1.4 * (0.8 + t * 0.3));
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = SLAM.radius + 40;
    return this.squareDisplayBoundingBox(r * 2);
  }
}

/**
 * Ground you have to leave. Slows on entry so walking out costs something, and
 * charges its damage per second rather than per frame, so the decision to cross
 * it is readable instead of instantly fatal.
 */
export class BaronPoisonPool extends AreaSpellObject {
  constructor(owner: AttackableUnit, center: Vec2) {
    super(owner, center, POOL.radius, {
      candidates: () => hostilesIn(owner, center, POOL.radius),
      tickEveryMs: POOL.tickMs,
      durationMs: POOL.durationMs,
      onEnter: target => this.soak(target),
      onTick: target => target.takeDamage(POOL.damagePerTick, this.owner),
      onExit: target => this.dry(target),
    });
  }

  private soak(target: AttackableUnit): void {
    const slow = new Slow(POOL.durationMs, this.owner, target);
    slow.name = 'Độc Baron';
    slow.percent = POOL.slowPercent;
    target.addBuff(slow);
  }

  /** The slow is the pool's, so it ends with the pool rather than outliving it. */
  private dry(target: AttackableUnit): void {
    for (const buff of target.buffs.slice()) {
      if (buff instanceof Slow && buff.sourceUnit === this.owner) buff.deactivateBuff();
    }
  }

  draw(): void {
    const fadeIn = constrain(this.elapsedMs / 250, 0, 1);
    const fadeOut = 1 - constrain((this.elapsedMs - (POOL.durationMs - 500)) / 500, 0, 1);
    const alpha = Math.min(fadeIn, fadeOut);

    push();
    translate(this.center.x, this.center.y);
    noStroke();
    fill(POISON_DARK[0], POISON_DARK[1], POISON_DARK[2], 120 * alpha);
    circle(0, 0, this.radius * 2);

    // bubbles surfacing, so the pool reads as boiling rather than as a decal
    fill(POISON_GREEN[0], POISON_GREEN[1], POISON_GREEN[2], 150 * alpha);
    for (let i = 0; i < 9; i++) {
      const a = (TWO_PI * i) / 9 + this.elapsedMs / 900;
      const r = this.radius * (0.25 + 0.6 * ((i % 3) / 3));
      const size = 8 + 6 * sin(this.elapsedMs / 240 + i);
      circle(cos(a) * r, sin(a) * r, size);
    }

    noFill();
    stroke(POISON_GREEN[0], POISON_GREEN[1], POISON_GREEN[2], 170 * alpha);
    strokeWeight(2);
    circle(0, 0, this.radius * 2);
    pop();
  }

  getDisplayBoundingBox() {
    const r = POOL.radius + 20;
    return new Rectangle({
      x: this.center.x - r,
      y: this.center.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}

/**
 * Tried in this order, one per frame: the spit opens from range, the slam
 * punishes standing on top of it, the pool takes away the ground it is standing
 * on. `range` is left at the camp's own `attackRange` for the two that should
 * reach as far as the bite; the slam declares its own, because casting it at
 * something outside the ring would be a wasted twelve seconds.
 */
export const BARON_ABILITIES: MonsterAbility[] = [
  {
    name: SPIT.name,
    cooldownMs: SPIT.cooldownMs,
    cast(monster: Monster, target: Champion) {
      const spit = new BaronPoisonSpit(monster);
      spit.position.set(monster.position.x, monster.position.y);
      spit.destination.set(target.position.x, target.position.y);
      monster.game.objectManager.addObject(spit);
    },
  },
  {
    name: SLAM.name,
    cooldownMs: SLAM.cooldownMs,
    range: SLAM.radius,
    cast(monster: Monster) {
      monster.game.objectManager.addObject(new BaronTailSlam(monster));
    },
  },
  {
    name: POOL.name,
    cooldownMs: POOL.cooldownMs,
    cast(monster: Monster, target: Champion) {
      monster.game.objectManager.addObject(
        new BaronPoisonPool(monster, { x: target.position.x, y: target.position.y })
      );
    },
  },
];
