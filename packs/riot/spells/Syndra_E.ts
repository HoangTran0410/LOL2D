import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { makeGroundedSpheres, makeSyndra_Burst, makeSyndra_Sphere } from './Syndra_Q';
import { SPHERE_CORE_RADIUS, SPHERE_DARK, SPHERE_EDGE, SPHERE_VIOLET } from './Syndra_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Syndra_E = InstanceType<ReturnType<typeof makeSyndra_E>>;
type Syndra_E_Cone = InstanceType<ReturnType<typeof makeSyndra_E_Cone>>;
type Syndra_E_Sphere = InstanceType<ReturnType<typeof makeSyndra_E_Sphere>>;
type Syndra_Burst = InstanceType<ReturnType<typeof makeSyndra_Burst>>;
type Syndra_Sphere = InstanceType<ReturnType<typeof makeSyndra_Sphere>>;



/**
 * Syndra E — a cone of force that shoves everyone out of it and, crucially,
 * launches every one of her grounded spheres that happens to be standing in it.
 *
 * The combo the champion is built on lives in the second half: one sphere in the
 * cone is 18 damage, three is 54, and the player has to be able to read which
 * spheres went. Each launched sphere therefore flies as its own streak.
 */

export const SYNDRA_E_DAMAGE = 18;

export const SYNDRA_E_LENGTH = 320;

export const SYNDRA_E_ARC_DEG = 90;

export const SYNDRA_E_PUSH = 250;

export const SYNDRA_E_PUSH_MS = 300;

export const SYNDRA_E_STUN_MS = 1_000;

export const SYNDRA_E_SPHERE_DAMAGE = 18;

export const SYNDRA_E_SPHERE_RANGE = 300;

export const SYNDRA_E_SPHERE_SPEED = 12;


const CONE_LIFE_MS = 340;

const PUSH_SPEED = (SYNDRA_E_PUSH * 16) / SYNDRA_E_PUSH_MS;


function halfArcRadians(): number {
  return (SYNDRA_E_ARC_DEG * Math.PI) / 360;
}


function insideCone(
  origin: { x: number; y: number },
  heading: number,
  reach: number,
  at: { x: number; y: number }
): boolean {
  const dx = at.x - origin.x;
  const dy = at.y - origin.y;
  const gap = Math.hypot(dx, dy);
  if (gap > reach) return false;
  if (gap < 1) return true;

  let delta = Math.atan2(dy, dx) - heading;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta) <= halfArcRadians();
}


function __buildSyndra_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const Stun = api.buffs.Stun;
  const Spell = api.Spell;
  const groundedSpheres = makeGroundedSpheres(api);
  const Syndra_Burst = makeSyndra_Burst(api);
  const Syndra_E_Cone = makeSyndra_E_Cone(api);
  const Syndra_E_Sphere = makeSyndra_E_Sphere(api);
  class Syndra_E extends Spell {
    image = api.asset('spell_syndra_e');
    name = 'Quét Tan Kẻ Yếu (Syndra_E)';
    description = `Quét một hình quạt ${SYNDRA_E_ARC_DEG}° dài ${SYNDRA_E_LENGTH}:
      <span class="damage">${SYNDRA_E_DAMAGE} sát thương</span>, đẩy lùi và làm choáng.
      <b>Mọi quả cầu trong hình quạt cũng bị bắn đi</b>, mỗi quả gây thêm
      <span class="damage">${SYNDRA_E_SPHERE_DAMAGE} sát thương</span> cho mục tiêu đầu tiên
      rồi nằm lại chỗ mới.`;
    coolDown = 10_000;
    manaCost = 40;
    range = SYNDRA_E_LENGTH;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: 160,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context?: CastContext): void {
      const aim = context
        ? this.firingDirection(context)
        : { x: this.aimPoint.x - this.owner.position.x, y: this.aimPoint.y - this.owner.position.y };
      const heading = Math.atan2(aim.y, aim.x);
      const reach = effectiveRange(this.range, this.owner);
      const origin = { x: this.owner.position.x, y: this.owner.position.y };

      this.game.objectManager.addObject(new Syndra_E_Cone(this.owner, heading, reach));

      const struck = new Set<AttackableUnit>();
      const victims = this.game.objectManager.queryObjects({
        area: new Circle({ x: origin.x, y: origin.y, r: reach }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of victims) {
        if (struck.has(victim)) continue;
        if (!insideCone(origin, heading, reach, victim.position)) continue;
        struck.add(victim);

        victim.takeDamage(SYNDRA_E_DAMAGE, this.owner);
        this.game.objectManager.addObject(
          new Syndra_Burst(this.owner, victim.position.x, victim.position.y, 40, 260)
        );
        this.shoveAway(victim, origin);
      }

      for (const sphere of groundedSpheres(this.owner)) {
        if (!insideCone(origin, heading, reach, sphere.position)) continue;
        const dx = sphere.position.x - origin.x;
        const dy = sphere.position.y - origin.y;
        const sphereHeading = Math.hypot(dx, dy) < 1 ? heading : Math.atan2(dy, dx);
        this.launchSphere(sphere, sphereHeading);
      }
    }

    /**
     * The knock-back, then the stun. Sequencing them is not cosmetic: `Stun` is in
     * `DASH_INTERRUPT_BUFFS`, so a stun applied first would cancel the very
     * displacement it is supposed to accompany.
     */
    private shoveAway(victim: AttackableUnit, origin: { x: number; y: number }): void {
      const dx = victim.position.x - origin.x;
      const dy = victim.position.y - origin.y;
      const gap = Math.hypot(dx, dy);
      const awayX = gap < 1 ? 1 : dx / gap;
      const awayY = gap < 1 ? 0 : dy / gap;

      const dash = new Dash(SYNDRA_E_PUSH_MS + 120, this.owner, victim);
      dash.dashDestination = createVector(
        victim.position.x + awayX * SYNDRA_E_PUSH,
        victim.position.y + awayY * SYNDRA_E_PUSH
      );
      dash.dashSpeed = PUSH_SPEED;
      dash.cancelable = false;
      dash.showTrail = false;
      dash.buffsToCheckCancel = [];

      let stunned = false;
      const stun = () => {
        if (stunned) return;
        stunned = true;
        if (victim.toRemove || victim.isDead) return;
        victim.addBuff(new Stun(SYNDRA_E_STUN_MS, this.owner, victim));
      };
      dash.onReachedDestination = stun;
      dash.onDeactivate = stun;

      victim.markDisplaced();
      victim.addBuff(dash);
    }

    private launchSphere(sphere: Syndra_Sphere, heading: number): void {
      const from = { x: sphere.position.x, y: sphere.position.y };
      sphere.toRemove = true;

      const missile = new Syndra_E_Sphere(this.owner);
      missile.position = createVector(from.x, from.y);
      missile.destination = createVector(
        from.x + Math.cos(heading) * SYNDRA_E_SPHERE_RANGE,
        from.y + Math.sin(heading) * SYNDRA_E_SPHERE_RANGE
      );
      this.game.objectManager.addObject(missile);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));

      const reach = effectiveRange(this.range, this.owner);
      const aim = this.aimPoint;
      const heading = Math.atan2(aim.y - this.owner.position.y, aim.x - this.owner.position.x);
      const half = halfArcRadians();

      push();
      translate(this.owner.position.x, this.owner.position.y);
      rotate(heading);
      noFill();
      stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 150);
      strokeWeight(2);
      line(0, 0, Math.cos(-half) * reach, Math.sin(-half) * reach);
      line(0, 0, Math.cos(half) * reach, Math.sin(half) * reach);
      arc(0, 0, reach * 2, reach * 2, -half, half);
      pop();
    }
  }
  return Syndra_E;
}
const __cacheSyndra_E = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_E>>();
export default function makeSyndra_E(api: ContentApi) {
  const cached = __cacheSyndra_E.get(api);
  if (cached) return cached;
  const built = __buildSyndra_E(api);
  __cacheSyndra_E.set(api, built);
  return built;
}


/** The sweep itself: exactly the authored length and exactly the authored arc. */
function __buildSyndra_E_Cone(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Syndra_E_Cone extends SpellObject {
    zIndex: number | null = 2;
    heading: number;
    reach: number;
    lifeTime = CONE_LIFE_MS;
    age = 0;

    constructor(owner: AttackableUnit, heading: number, reach: number) {
      super(owner);
      this.position = createVector(owner.position.x, owner.position.y);
      this.heading = heading;
      this.reach = reach;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const shown = 1 - t * t;
      const swept = this.reach * opened;
      const half = halfArcRadians();
      const segments = 16;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      noStroke();
      fill(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 55 * shown);
      for (let i = 0; i < segments; i++) {
        const a1 = -half + (half * 2 * i) / segments;
        const a2 = a1 + (half * 2) / segments;
        triangle(0, 0, cos(a1) * swept, sin(a1) * swept, cos(a2) * swept, sin(a2) * swept);
      }

      noFill();
      stroke(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 210 * shown);
      strokeWeight(2.5);
      line(0, 0, cos(-half) * this.reach, sin(-half) * this.reach);
      line(0, 0, cos(half) * this.reach, sin(half) * this.reach);
      arc(0, 0, this.reach * 2, this.reach * 2, -half, half);

      stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 235 * shown);
      strokeWeight(5 * shown + 1);
      arc(0, 0, swept * 2, swept * 2, -half, half);

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.reach + 40) * 2);
    }
  }
  return Syndra_E_Cone;
}
const __cacheSyndra_E_Cone = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_E_Cone>>();
export function makeSyndra_E_Cone(api: ContentApi) {
  const cached = __cacheSyndra_E_Cone.get(api);
  if (cached) return cached;
  const built = __buildSyndra_E_Cone(api);
  __cacheSyndra_E_Cone.set(api, built);
  return built;
}


/** A sphere she kicked out of the cone: one enemy, then back on the floor. */
function __buildSyndra_E_Sphere(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const TrailSystem = api.helpers.TrailSystem;
  const MissileSpellObject = api.MissileSpellObject;
  const Syndra_Burst = makeSyndra_Burst(api);
  const Syndra_Sphere = makeSyndra_Sphere(api);
  class Syndra_E_Sphere extends MissileSpellObject {
    speed = SYNDRA_E_SPHERE_SPEED;
    size = 28;
    maxHitCount = 1;
    age = 0;
    settled = false;
    shards: { angle: number; len: number; drift: number }[] = [];
    trailSystem = new TrailSystem({
      trailSize: this.size * 0.7,
      trailColor: '#6c5ce799',
      trailLifeTime: 300,
      maxLength: 14,
    });

    onAdded(): void {
      super.onAdded();
      const count = 5;
      for (let i = 0; i < count; i++) {
        this.shards.push({
          angle: (TWO_PI * i) / count + random(-0.25, 0.25),
          len: random(9, 16),
          drift: random(0.7, 1.6),
        });
      }
    }

    onAfterMove(): void {
      this.age += deltaTime;
    }

    onHit(enemy: AttackableUnit): void {
      enemy.takeDamage(SYNDRA_E_SPHERE_DAMAGE, this.owner);
      this.game.objectManager.addObject(
        new Syndra_Burst(this.owner, enemy.position.x, enemy.position.y, 42, 280)
      );
      this.settle();
    }

    onArrive(): void {
      this.settle();
    }

    /** Wherever it stopped, it is a grounded sphere again. */
    private settle(): void {
      if (this.settled) return;
      this.settled = true;
      this.game.objectManager.addObject(
        new Syndra_Sphere(this.owner, { x: this.position.x, y: this.position.y })
      );
    }

    draw(): void {
      const spun = this.age / 90;
      const core = SPHERE_CORE_RADIUS * 1.1;

      push();
      noStroke();
      for (const shard of this.shards) {
        const angle = shard.angle + spun * shard.drift;
        const out = core + 5 + shard.len;
        push();
        translate(this.position.x + cos(angle) * out, this.position.y + sin(angle) * out);
        rotate(angle);
        fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 235);
        triangle(shard.len * 0.55, 0, -shard.len * 0.35, -4, -shard.len * 0.35, 4);
        pop();
      }

      fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 240);
      circle(this.position.x, this.position.y, core * 2);
      fill(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 225);
      circle(this.position.x, this.position.y, core * 1.35);
      noFill();
      stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 240);
      strokeWeight(2);
      circle(this.position.x, this.position.y, core * 2);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.size + 80) * 2);
    }
  }
  return Syndra_E_Sphere;
}
const __cacheSyndra_E_Sphere = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_E_Sphere>>();
export function makeSyndra_E_Sphere(api: ContentApi) {
  const cached = __cacheSyndra_E_Sphere.get(api);
  if (cached) return cached;
  const built = __buildSyndra_E_Sphere(api);
  __cacheSyndra_E_Sphere.set(api, built);
  return built;
}