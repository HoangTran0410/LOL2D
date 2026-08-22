import EventType from '@/game/enums/EventType';
import MissileSpellObject from '@/game/gameObject/MissileSpellObject';
import SpellObject from '@/game/gameObject/SpellObject';
import TrailSystem from '@/game/gameObject/helpers/TrailSystem';
import AoePulse from '@/game/gameObject/spellObjects/AoePulse';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

/**
 * Basic attack delivery: the two objects that carry a swing from the attacker to
 * the victim, and the single function where a basic attack is allowed to become
 * damage.
 *
 * Nothing here decides *when* to attack — that is BasicAttackController. This
 * module only owns the part between the swing starting and the damage landing,
 * which is where every "did the target die / walk away / go untargetable in the
 * meantime" question has to be answered.
 */

/**
 * Projectile speed in world units per second. A champion is 55 units across and
 * walks 180 units/sec; minion bolts fly at 360 and read well at that scale, so a
 * champion bolt sits just above them and still crosses its own attack range in
 * well over half a second. Spell missiles move 780-1200 — a basic attack must
 * never be mistaken for one of those.
 */
export const RANGED_BOLT_UNITS_PER_SECOND = 420;
/** The engine steps missiles once per frame at 60fps. */
export const RANGED_BOLT_SPEED = RANGED_BOLT_UNITS_PER_SECOND / 60;
/** ms of wind-up before a melee swing resolves. Heavier than a minion's 130ms. */
export const MELEE_WINDUP_MS = 180;
/** Total ms a melee swing's visual lives, wind-up through fade. */
export const MELEE_SWING_TOTAL_MS = 380;
/**
 * attackRange at or below this is delivered as a melee swing, above it as a
 * travelling bolt. One number decides which a champion is, so a melee champion
 * is a stat edit rather than a subclass.
 */
export const MELEE_RANGE_THRESHOLD = 140;
/** A bolt that somehow never arrives fizzles rather than living forever. */
export const BOLT_MAX_LIFE_MS = 3_000;

/**
 * Payload of EventType.ON_ATTACK_HIT. This is the seam an on-hit passive (Toxic
 * Shot, a lifesteal item, an attack-speed-on-hit stack) subscribes to: it fires
 * once per landed basic attack, after the damage has been applied, so a listener
 * can read the real number that landed.
 *
 * EventType.ON_ATTACK is the other half and fires when the swing *starts*, with
 * the attacking unit as its whole payload — that shape predates this module
 * (a channel-breaking ultimate cancels on it) and is kept as it is.
 */
export interface BasicAttackHit {
  attacker: AttackableUnit;
  victim: AttackableUnit;
  /** Damage requested, before the victim's shields and modifiers see it. */
  damage: number;
  /** True for a bolt, false for a melee swing. */
  ranged: boolean;
  /** True when the crit roll came up. Absent on anything that predates the roll. */
  crit?: boolean;
}

/** A unit that can still be hit right now. */
export const canBeHit = (victim: AttackableUnit | null): victim is AttackableUnit =>
  !!victim && !victim.isDead && !victim.toRemove && !!victim.position && victim.targetable;

/**
 * The one place a basic attack turns into damage. Both delivery objects funnel
 * through here so the validity rules and the on-hit event can never drift apart.
 * Returns whether the attack actually landed.
 */
export function landBasicAttack(
  attacker: AttackableUnit,
  victim: AttackableUnit | null,
  damage: number,
  ranged: boolean
): boolean {
  if (attacker.isDead || !canBeHit(victim)) return false;

  // On-hit first, then the crit multiplier over the total — the order League
  // uses, and the one that makes stacking the two feel worth it. Both stats
  // sit at 0 by default, so a unit nobody has buffed swings for exactly what
  // it swung for before these existed.
  const bonus = attacker.stats?.onHitDamage?.value ?? 0;
  const crit = rollCrit(attacker);
  const total = (damage + bonus) * (crit ? (attacker.stats?.critDamage?.value ?? 1) : 1);

  victim.takeDamage(total, attacker);
  if (crit) showCritSpark(attacker, victim);
  attacker.game?.eventManager?.emit(EventType.ON_ATTACK_HIT, {
    attacker,
    victim,
    damage: total,
    ranged,
    crit,
  } satisfies BasicAttackHit);
  return true;
}

/**
 * The dice, in one place. `critChance` defaults to 0 and nothing in the base
 * game grants it, so this returns false — deterministically — for every unit
 * that has not been handed the stat, which is what keeps the combat tests from
 * having to seed a random.
 */
function rollCrit(attacker: AttackableUnit): boolean {
  const chance = attacker.stats?.critChance?.value ?? 0;
  return chance > 0 && Math.random() < chance;
}

/** A crit that looks like every other hit is not a crit. */
function showCritSpark(attacker: AttackableUnit, victim: AttackableUnit): void {
  const spark = new AoePulse(attacker);
  spark.position = victim.position.copy();
  spark.radius = 55;
  spark.lifeTime = 300;
  spark.color = [255, 205, 90];
  spark.style = 'shards';
  spark.spokes = 8;
  spark.fillAlpha = 0;
  attacker.game?.objectManager?.addObject?.(spark);
}

/**
 * The ranged basic attack. Homes on one unit and damages it on arrival, nothing
 * on the way — `maxHitCount = 0` switches MissileSpellObject's in-flight
 * collision off entirely, the same trick TurretBolt uses.
 *
 * A disarm landing while this is in the air does not stop it: the shot has left
 * the bow. Only the victim going away can.
 */
export class BasicAttackBolt extends MissileSpellObject {
  speed = RANGED_BOLT_SPEED;
  size = 16;
  maxHitCount = 0;
  removeOnArrive = true;
  damage = 0;
  target: AttackableUnit | null = null;
  color: number[] = [255, 236, 190];
  _life = BOLT_MAX_LIFE_MS;

  trailSystem: TrailSystem | null = new TrailSystem({
    trailColor: '#ffe9bcaa',
    trailSize: 6,
    maxLength: 9,
    trailLifeTime: 180,
  });

  onBeforeMove(): void {
    this._life -= deltaTime;
    if (this._life <= 0) {
      this.toRemove = true;
      return;
    }
    // keep homing while the target lives; once it is gone the bolt finishes its
    // flight to the last known point and lands on nobody
    if (this.target && !this.target.isDead && !this.target.toRemove) {
      this.destination.set(this.target.position.x, this.target.position.y);
    }
  }

  onArrive(): void {
    landBasicAttack(this.owner, this.target, this.damage, true);
  }

  draw(): void {
    const pos = this.position;
    const [r, g, b] = this.color;
    push();
    noStroke();
    fill(r, g, b, 90);
    circle(pos.x, pos.y, this.size * 1.9);
    fill(255, 255, 255, 230);
    circle(pos.x, pos.y, this.size * 0.6);
    pop();
  }
}

/**
 * The melee basic attack. Nothing travels, so this is a plain SpellObject: a
 * wind-up, then a fan-shaped swipe that resolves on contact. The wind-up is what
 * makes a melee exchange readable, and it is also a real window — a disarm, a
 * death, or the target walking out of reach during it all cancel the strike.
 */
export class BasicAttackSwing extends SpellObject {
  target: AttackableUnit | null;
  damage = 0;
  /** Surface-to-surface reach, re-checked at the strike instant. */
  reach = 0;
  color: number[] = [255, 220, 160];
  age = 0;
  struck = false;

  constructor(owner: AttackableUnit, target: AttackableUnit) {
    super(owner);
    this.target = target;
  }

  update(): void {
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    if (!this.struck && this.age >= MELEE_WINDUP_MS) {
      this.struck = true;
      this.strike();
    }
    if (this.age >= MELEE_SWING_TOTAL_MS) this.toRemove = true;
  }

  strike(): boolean {
    const target = this.target;
    // the wind-up is a real window: the attacker can be disarmed or killed and
    // the target can die, go untargetable or simply walk out of reach inside it
    if (!this.owner.canAttack || !canBeHit(target)) return false;
    if (p5.Vector.dist(this.owner.position, target.position) > this.reach) return false;
    return landBasicAttack(this.owner, target, this.damage, false);
  }

  draw(): void {
    const pos = this.owner.position;
    const target = this.target;
    let dirX = 1;
    let dirY = 0;
    if (target?.position) {
      const dx = target.position.x - pos.x;
      const dy = target.position.y - pos.y;
      const length = Math.hypot(dx, dy);
      if (length > 0) {
        dirX = dx / length;
        dirY = dy / length;
      }
    }
    const bodyRadius = this.owner.stats.size.value / 2;
    const [r, g, b] = this.color;

    push();
    translate(pos.x, pos.y);
    rotate(Math.atan2(dirY, dirX));
    noStroke();

    if (this.age < MELEE_WINDUP_MS) {
      // wind-up: a glow pulling back behind the attacker, brightening as it charges
      const charge = this.age / MELEE_WINDUP_MS;
      fill(r, g, b, 60 + 120 * charge);
      circle(-bodyRadius * 0.55, 0, 8 + 9 * charge);
    } else {
      // strike: a wide fan sweeping out past the body, fading over the rest of life
      const swept = constrain(
        (this.age - MELEE_WINDUP_MS) / (MELEE_SWING_TOTAL_MS - MELEE_WINDUP_MS),
        0,
        1
      );
      const fade = 1 - swept;
      const innerRadius = bodyRadius * 0.65;
      const outerRadius = bodyRadius + this.reach * 0.9;
      const halfAngle = 0.62;

      fill(r, g, b, 210 * fade);
      beginShape();
      for (let i = 0; i <= 5; i++) {
        const a = -halfAngle + 2 * halfAngle * (i / 5);
        vertex(Math.cos(a) * outerRadius, Math.sin(a) * outerRadius);
      }
      for (let i = 5; i >= 0; i--) {
        const a = -halfAngle + 2 * halfAngle * (i / 5);
        vertex(Math.cos(a) * innerRadius, Math.sin(a) * innerRadius);
      }
      endShape(CLOSE);
    }
    pop();
  }
}
