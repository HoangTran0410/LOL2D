import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Cassiopeia_E = InstanceType<ReturnType<typeof makeCassiopeia_E>>;
type Cassiopeia_E_Venom = InstanceType<ReturnType<typeof makeCassiopeia_E_Venom>>;



export const RANGE = 450;

export const BASE_DAMAGE = 10;

export const POISONED_DAMAGE = 26;

/** px per frame: the full 450px of reach crosses in ~19 frames — a spit, not a lob. */
export const SPIT_SPEED = 24;

export const SPLASH_RADIUS = 45;

export const POISONED_SPLASH_RADIUS = 70;

/**
 * A homing bolt chasing something faster than it would never arrive, and a
 * missile that never arrives never dies. Well past the time the full 450px
 * takes, so only a genuine runaway ever reaches it.
 */
export const MAX_FLIGHT_TIME = 1200;


/**
 * Any damage-over-time counts as "poisoned" — her Q pool and her W both leave
 * one, and Twin Fang is not supposed to care which of them landed it.
 */
function __buildisPoisoned(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const DamageOverTime = api.buffs.DamageOverTime;
  const isPoisoned = (unit: AttackableUnit): boolean =>
    unit.buffs.some(buff => !buff.toRemove && buff instanceof DamageOverTime);
  return isPoisoned;
}
const __cacheisPoisoned = new WeakMap<ContentApi, ReturnType<typeof __buildisPoisoned>>();
export function makeIsPoisoned(api: ContentApi) {
  const cached = __cacheisPoisoned.get(api);
  if (cached) return cached;
  const built = __buildisPoisoned(api);
  __cacheisPoisoned.set(api, built);
  return built;
}


/**
 * Twin Fang. Cheap and fast, and more than twice as hard on a poisoned target —
 * the whole Cassiopeia rotation is "poison first, then spam this".
 *
 * The spit is a real missile. It used to apply its damage the instant the key
 * went down and then draw a splash 450px away, so a target could die to a spell
 * whose visual had not left Cassiopeia's mouth; the flight now owns the hit, and
 * the poison bonus is decided where the venom lands rather than where it was
 * launched.
 */
function __buildCassiopeia_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const isPoisoned = makeIsPoisoned(api);
  const Cassiopeia_E_Venom = makeCassiopeia_E_Venom(api);
  class Cassiopeia_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_cassiopeia_e');
    name = 'Nanh Độc (Cassiopeia_E)';
    description =
      `Phun nọc vào kẻ địch gần nhất trong <span>${RANGE}px</span>: <span class="damage">${BASE_DAMAGE} sát thương</span>,` +
      ` hoặc <span class="damage">${POISONED_DAMAGE} sát thương</span> nếu mục tiêu <span class="damage">đang trúng độc</span>` +
      ` <i>khi nọc chạm tới</i>`;
    coolDown = 2500;
    manaCost = 12;

    range = RANGE;

    checkCastCondition() {
      return !!this._findTarget();
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      const spit = new Cassiopeia_E_Venom(this.owner);
      spit.target = target;
      spit.destination = target.position.copy();
      spit.poisoned = isPoisoned(target);
      this.game.objectManager.addObject(spit);
    }

    _findTarget(): AttackableUnit | null {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];
      let nearest: AttackableUnit | null = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = this.owner.position.dist(enemy.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = enemy;
        }
      }
      return nearest;
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Cassiopeia_E;
}
const __cacheCassiopeia_E = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_E>>();
export default function makeCassiopeia_E(api: ContentApi) {
  const cached = __cacheCassiopeia_E.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_E(api);
  __cacheCassiopeia_E.set(api, built);
  return built;
}


/**
 * The bolt of venom itself: two globs winding round each other all the way to
 * the target, which is where the ability's name comes from.
 */
function __buildCassiopeia_E_Venom(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AoePulse = api.AoePulse;
  const AttackableUnit = api.units.AttackableUnit;
  const TrailSystem = api.helpers.TrailSystem;
  const isPoisoned = makeIsPoisoned(api);
  class Cassiopeia_E_Venom extends MissileSpellObject {
    speed = SPIT_SPEED;
    size = 22;
    /**
     * Target-locked, so `0` collisions in flight: Twin Fang picks its victim at
     * cast and the spit follows that body. A bystander walking through the line
     * must not eat a bolt that was never aimed at them.
     */
    maxHitCount = 0;
    target: AttackableUnit | null = null;
    /** Re-read every frame, so a poison landing mid-flight still upgrades the hit. */
    poisoned = false;
    /**
     * The last heading that had a length. A homing missile's destination sits on
     * top of its position on the final frame, and atan2(0, 0) would snap the bolt
     * flat east for exactly the frame the player is watching it land.
     */
    _heading = 0;
    _flightTime = 0;

    trailSystem = new TrailSystem({
      trailColor: 'rgba(126, 214, 86, 0.33)',
      trailSize: 11,
      trailLifeTime: 240,
    });

    onBeforeMove(): void {
      this._flightTime += deltaTime;
      if (this._flightTime > MAX_FLIGHT_TIME) {
        // Out of chase: it spends itself where it is, on nobody.
        this.target = null;
        this.destination = this.position.copy();
        return;
      }

      const target = this.target;
      if (target && !target.isDead && !target.toRemove) {
        // homing: the fangs follow the body they were spat at
        this.destination = target.position.copy();
        this.poisoned = isPoisoned(target);
      } else {
        // they died or left mid-flight — the venom still lands where they stood
        this.target = null;
      }

      const dx = this.destination.x - this.position.x;
      const dy = this.destination.y - this.position.y;
      if (dx * dx + dy * dy > 1) this._heading = Math.atan2(dy, dx);
    }

    onArrive(): void {
      const target = this.target;
      if (target && !target.isDead && !target.toRemove) {
        target.takeDamage(this.poisoned ? POISONED_DAMAGE : BASE_DAMAGE, this.owner);
      }

      // The splash is the hit, not a report of it: same frame, same point.
      const pool = new AoePulse(this.owner);
      pool.position = this.position.copy();
      pool.radius = this.poisoned ? POISONED_SPLASH_RADIUS : SPLASH_RADIUS;
      pool.lifeTime = 380;
      pool.color = this.poisoned ? [200, 255, 130] : [140, 200, 110];
      pool.style = 'venom';
      pool.spokes = 8;
      this.game.objectManager.addObject(pool);
    }

    draw(): void {
      // A homing bolt has no lifetime to normalize against, so the twist runs off
      // frameCount — the one clock it does have. Both globs read the same clock
      // half a turn apart, which is what keeps them crossing rather than drifting.
      const swirl = frameCount * 0.34;
      const venom = this.poisoned ? 1 : 0;
      const half = this.size / 2;

      push();
      translate(this.position.x, this.position.y);
      rotate(this._heading);

      // The venom's own light, additive so it reads over dark ground. It grows
      // with the poison, so a lethal Twin Fang looks lethal before it arrives.
      blendMode(ADD);
      noStroke();
      fill(120, 225, 90, 26 + 34 * venom);
      circle(0, 0, this.size * (2.1 + 0.25 * Math.sin(swirl * 2)));
      fill(190, 130, 235, 34 * venom);
      circle(0, 0, this.size * 1.5);
      blendMode(BLEND);

      // The twin fangs: two globs on the same helix, half a turn apart, so they
      // cross at the centre line twice a revolution. `depth` fakes the third
      // dimension — the one in front is drawn larger, and they swap.
      for (const side of [1, -1]) {
        const phase = swirl + (side > 0 ? 0 : PI);
        const across = Math.sin(phase) * half * 0.9;
        const depth = Math.cos(phase);
        const glob = half * (0.62 + 0.22 * depth);

        push();
        translate(half * 0.2 * depth, across);
        noStroke();
        // dark rind, bright core: a droplet, not a dot
        fill(58, 128, 46, 225);
        ellipse(0, 0, glob * 2.3, glob * 1.9);
        fill(150 + 70 * venom, 238, 108 + 92 * venom, 250);
        ellipse(0, 0, glob * 1.5, glob * 1.2);
        // stretched backwards: it is being spat, and spit does not fly round
        fill(120, 215, 95, 140);
        triangle(-glob * 0.6, -glob * 0.55, -glob * 0.6, glob * 0.55, -glob * 2.6, 0);
        pop();
      }

      // Two fangs at the leading edge. It is a bite arriving, not a bullet.
      noStroke();
      fill(246, 255, 232, 235);
      for (const side of [-1, 1]) {
        triangle(
          half * 0.2,
          side * half * 0.42,
          half * 0.2,
          side * half * 0.1,
          half * 1.5,
          side * half * 0.04
        );
      }

      // Venom dripping off the back and falling out of the flight line.
      fill(126, 214, 86, 165);
      for (let i = 0; i < 3; i++) {
        const drip = (frameCount / 22 + i / 3) % 1;
        circle(-half * (1.4 + drip * 3.2), Math.sin(swirl + i * 2.1) * 7 * drip, 6 * (1 - drip) + 2);
      }

      pop();
    }

    /** The glow and the drips reach well past `size`, so the box has to as well. */
    getDisplayBoundingBox() {
      const pad = this.size * 2.5;
      return this.squareDisplayBoundingBox(pad * 2);
    }
  }
  return Cassiopeia_E_Venom;
}
const __cacheCassiopeia_E_Venom = new WeakMap<ContentApi, ReturnType<typeof __buildCassiopeia_E_Venom>>();
export function makeCassiopeia_E_Venom(api: ContentApi) {
  const cached = __cacheCassiopeia_E_Venom.get(api);
  if (cached) return cached;
  const built = __buildCassiopeia_E_Venom(api);
  __cacheCassiopeia_E_Venom.set(api, built);
  return built;
}