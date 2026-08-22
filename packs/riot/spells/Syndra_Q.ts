import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Syndra_Burst = InstanceType<ReturnType<typeof makeSyndra_Burst>>;
type Syndra_Q = InstanceType<ReturnType<typeof makeSyndra_Q>>;
type Syndra_Q_Fall = InstanceType<ReturnType<typeof makeSyndra_Q_Fall>>;
type Syndra_Q_Telegraph = InstanceType<ReturnType<typeof makeSyndra_Q_Telegraph>>;
type Syndra_Sphere = InstanceType<ReturnType<typeof makeSyndra_Sphere>>;



/**
 * Syndra Q, and with it the whole champion's resource: the grounded dark sphere.
 *
 * W, E and R all import `Syndra_Sphere` and `groundedSpheres` from here, so
 * "which spheres does she have, and where are they" is one question with one
 * answer instead of four slightly different ones. The registry is keyed on the
 * casting unit, so two Syndras never see each other's spheres and a dead one
 * takes her list with her.
 */

export const SPHERE_LIFETIME_MS = 6_000;

export const SPHERE_FADE_MS = 800;

export const SPHERE_SETTLE_MS = 250;

export const SPHERE_GRAB_RADIUS = 400;

export const MAX_SPHERES = 5;

export const SPHERE_CORE_RADIUS = 15;

export const SPHERE_FLIGHT_SPEED = 13;

/** Everything a sphere's own draw touches, smear included. */
export const SPHERE_PAINT_REACH = 150;


export const SYNDRA_Q_DAMAGE = 20;

export const SYNDRA_Q_RADIUS = 130;

export const SYNDRA_Q_RANGE = 420;

export const SYNDRA_Q_FALL_MS = 400;

export const SYNDRA_Q_FALL_HEIGHT = 300;


export const SPHERE_VIOLET: readonly [number, number, number] = [108, 92, 231];

export const SPHERE_DARK: readonly [number, number, number] = [38, 20, 66];

export const SPHERE_EDGE: readonly [number, number, number] = [238, 232, 255];


const Q_RIM_MS = 240;

const HELD_HEIGHT = 46;

const SMEAR_POINTS = 10;

const SMEAR_STEP = 9;


export type SyndraSphereMode = 'grounded' | 'held' | 'flying' | 'reeling';


function distanceBetween(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
// SPHERE_REGISTRY / registryFor / Syndra_Sphere reference each other as real values both ways —
// see this file's own header comment on the codemod's cycle handling.
function __group0_SPHERE_REGISTRYBuild(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  /** A sphere in her hand or in flight is over the bodies, not under them. */
  const SPHERE_AIR_Z_INDEX = api.layers.SPELL_EFFECT_Z_INDEX;


  const SPHERE_REGISTRY = new WeakMap<object, Syndra_Sphere[]>();


  function registryFor(owner: AttackableUnit): Syndra_Sphere[] {
    let list = SPHERE_REGISTRY.get(owner);
    if (!list) {
      list = [];
      SPHERE_REGISTRY.set(owner, list);
    }
    return list;
  }


/**
 * A dark sphere. It drops from the sky when Q casts, it rolls slightly and
 * settles when it arrives, it rides over her head when she seizes it, and it
 * drags a ragged smear behind it when she moves it.
 */
  class Syndra_Sphere extends SpellObject {
    zIndex: number | null = GROUND_Z_INDEX;
    age = 0;
    settleMs = 0;
    spin = 0;
    mode: SyndraSphereMode = 'grounded';
    flightDestination: p5.Vector | null = null;
    shards: { angle: number; len: number; drift: number }[] = [];
    smear: { x: number; y: number }[] = [];
    private onFlightArrive: ((sphere: Syndra_Sphere) => void) | null = null;

    constructor(owner: AttackableUnit, at?: { x: number; y: number }) {
      super(owner);
      if (at) this.position = createVector(at.x, at.y);
      const list = registryFor(owner);
      list.push(this);
      enforceSphereCap(list);
    }

    onAdded(): void {
      super.onAdded();
      const count = 5;
      for (let i = 0; i < count; i++) {
        this.shards.push({
          angle: (TWO_PI * i) / count + random(-0.25, 0.25),
          len: random(9, 17),
          drift: random(0.6, 1.5),
        });
      }
    }

    onRemoved(): void {
      super.onRemoved();
      const list = SPHERE_REGISTRY.get(this.owner);
      if (!list) return;
      const index = list.indexOf(this);
      if (index >= 0) list.splice(index, 1);
    }

    /** W's first press: it lifts and reels smoothly toward her overhead. */
    seize(): void {
      this.mode = 'reeling';
      this.zIndex = SPHERE_AIR_Z_INDEX;
      this.smear.length = 0;
    }

    /** W's throw, and anything else that relocates a sphere it does not consume. */
    launchTo(destination: p5.Vector, onArrive?: (sphere: Syndra_Sphere) => void): void {
      this.mode = 'flying';
      this.zIndex = SPHERE_AIR_Z_INDEX;
      this.flightDestination = createVector(destination.x, destination.y);
      this.onFlightArrive = onArrive ?? null;
      this.smear.length = 0;
    }

    /** The window lapsed: she puts it down again where she stands. */
    dropAt(x: number, y: number): void {
      this.position.x = x;
      this.position.y = y;
      this.flightDestination = null;
      this.onFlightArrive = null;
      this.smear.length = 0;
      this.mode = 'grounded';
      this.zIndex = GROUND_Z_INDEX;
      this.settleMs = 0;
    }

    update(): void {
      const step = deltaTime;
      this.spin += step / 240;

      if (this.mode === 'held') {
        this.position.x = this.owner.position.x;
        this.position.y = this.owner.position.y - HELD_HEIGHT;
        this.smear.length = 0;
        return;
      }

      if (this.mode === 'reeling') {
        const targetX = this.owner.position.x;
        const targetY = this.owner.position.y - HELD_HEIGHT;
        const dx = targetX - this.position.x;
        const dy = targetY - this.position.y;
        const dist = Math.hypot(dx, dy);
        const reelSpeed = (24 * step) / 16;

        if (dist <= reelSpeed || dist < 2) {
          this.position.x = targetX;
          this.position.y = targetY;
          this.mode = 'held';
          this.smear.length = 0;
        } else {
          this.position.x += (dx / dist) * reelSpeed;
          this.position.y += (dy / dist) * reelSpeed;
          const last = this.smear[this.smear.length - 1];
          if (!last || distanceBetween(last, this.position) > SMEAR_STEP) {
            this.smear.push({ x: this.position.x, y: this.position.y });
            if (this.smear.length > SMEAR_POINTS) this.smear.shift();
          }
        }
        return;
      }

      if (this.mode === 'flying') {
        this.flyStep(step);
      } else {
        this.settleMs = Math.min(this.settleMs + step, SPHERE_SETTLE_MS);
        if (this.smear.length > 0) this.smear.shift();
      }

      this.age += step;
      if (this.age >= SPHERE_LIFETIME_MS) this.toRemove = true;
    }

    private flyStep(step: number): void {
      const destination = this.flightDestination;
      if (!destination) {
        this.dropAt(this.position.x, this.position.y);
        return;
      }

      const last = this.smear[this.smear.length - 1];
      if (!last || distanceBetween(last, this.position) > SMEAR_STEP) {
        this.smear.push({ x: this.position.x, y: this.position.y });
        if (this.smear.length > SMEAR_POINTS) this.smear.shift();
      }

      const dx = destination.x - this.position.x;
      const dy = destination.y - this.position.y;
      const remaining = Math.hypot(dx, dy);
      const travel = (SPHERE_FLIGHT_SPEED * step) / 16;

      if (remaining <= travel || remaining === 0) {
        this.position.x = destination.x;
        this.position.y = destination.y;
        const arrived = this.onFlightArrive;
        this.mode = 'grounded';
        this.zIndex = GROUND_Z_INDEX;
        this.flightDestination = null;
        this.onFlightArrive = null;
        this.settleMs = 0;
        this.smear.length = 0;
        if (arrived) arrived(this);
        return;
      }

      this.position.x += (dx / remaining) * travel;
      this.position.y += (dy / remaining) * travel;
    }

    draw(): void {
      const held = this.mode === 'held';
      const flying = this.mode === 'flying';
      const settled = constrain(this.settleMs / SPHERE_SETTLE_MS, 0, 1);
      const arrival = 1 - (1 - settled) * (1 - settled);
      const fade =
        held || flying ? 1 : constrain((SPHERE_LIFETIME_MS - this.age) / SPHERE_FADE_MS, 0, 1);
      const core = SPHERE_CORE_RADIUS * (0.45 + 0.55 * arrival) * (held ? 1.15 : 1);
      const alpha = 235 * fade;
      const lift = flying || held ? 0 : (1 - arrival) * 90;
      const cx = this.position.x;
      const cy = this.position.y - lift + sin(this.spin * 1.6) * 3;

      push();

      if (!held && this.smear.length > 1) {
        stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 130);
        for (let i = 1; i < this.smear.length; i++) {
          const ratio = i / this.smear.length;
          const jag = (i % 2 === 0 ? 1 : -1) * (1 - ratio) * 7;
          strokeWeight(core * 1.3 * ratio);
          line(this.smear[i - 1].x, this.smear[i - 1].y + jag, this.smear[i].x, this.smear[i].y);
        }
      }

      if (!held && !flying) {
        const reachable = distanceBetween(this.owner.position, this.position) <= SPHERE_GRAB_RADIUS;
        noFill();
        stroke(196, 178, 255, (reachable ? 100 : 28) * fade);
        strokeWeight(reachable ? 2 : 1);
        circle(this.position.x, this.position.y, (core + 18) * 2);
      }

      noStroke();
      for (const shard of this.shards) {
        const spun = shard.angle + this.spin * shard.drift * (held ? 2.6 : 1);
        const out = core + 6 + shard.len * (0.5 + 0.5 * arrival);
        push();
        translate(cx + cos(spun) * out, cy + sin(spun) * out);
        rotate(spun);
        fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], alpha);
        triangle(shard.len * 0.5, 0, -shard.len * 0.35, -3.5, -shard.len * 0.35, 3.5);
        pop();
      }

      noStroke();
      fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], alpha);
      circle(cx, cy, core * 2);
      fill(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], alpha * 0.85);
      circle(cx, cy, core * 1.35);
      noFill();
      stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], alpha);
      strokeWeight(held ? 2.2 : 1.6);
      circle(cx, cy, core * 2);

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(SPHERE_PAINT_REACH * 2);
    }
  }
  return { SPHERE_REGISTRY, registryFor, Syndra_Sphere };
}
const __group0_SPHERE_REGISTRYCache = new WeakMap<ContentApi, ReturnType<typeof __group0_SPHERE_REGISTRYBuild>>();
function __group0_SPHERE_REGISTRYBuilder(api: ContentApi) {
  const cached = __group0_SPHERE_REGISTRYCache.get(api);
  if (cached) return cached;
  const built = __group0_SPHERE_REGISTRYBuild(api);
  __group0_SPHERE_REGISTRYCache.set(api, built);
  return built;
}
export function makeSPHERE_REGISTRY(api: ContentApi) {
  return __group0_SPHERE_REGISTRYBuilder(api).SPHERE_REGISTRY;
}
export function makeRegistryFor(api: ContentApi) {
  return __group0_SPHERE_REGISTRYBuilder(api).registryFor;
}
export function makeSyndra_Sphere(api: ContentApi) {
  return __group0_SPHERE_REGISTRYBuilder(api).Syndra_Sphere;
}


function prune(list: Syndra_Sphere[]): void {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].toRemove) list.splice(i, 1);
  }
}


function enforceSphereCap(list: Syndra_Sphere[]): void {
  prune(list);
  while (list.length > MAX_SPHERES) {
    const oldest = list.shift();
    if (oldest) oldest.toRemove = true;
  }
}


/** Her live grounded spheres, closest to her first. Held and flying ones are not grounded. */
function __buildgroundedSpheres(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SPHERE_REGISTRY = makeSPHERE_REGISTRY(api);
  function groundedSpheres(owner: AttackableUnit): Syndra_Sphere[] {
    const list = SPHERE_REGISTRY.get(owner);
    if (!list) return [];
    prune(list);

    const grounded: Syndra_Sphere[] = [];
    for (const candidate of list) {
      if (candidate.mode === 'grounded') grounded.push(candidate);
    }
    grounded.sort(
      (a, b) =>
        distanceBetween(owner.position, a.position) - distanceBetween(owner.position, b.position)
    );
    return grounded;
  }
  return groundedSpheres;
}
const __cachegroundedSpheres = new WeakMap<ContentApi, ReturnType<typeof __buildgroundedSpheres>>();
export function makeGroundedSpheres(api: ContentApi) {
  const cached = __cachegroundedSpheres.get(api);
  if (cached) return cached;
  const built = __buildgroundedSpheres(api);
  __cachegroundedSpheres.set(api, built);
  return built;
}


function __buildSyndra_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const groundedSpheres = makeGroundedSpheres(api);
  const Syndra_Q_Telegraph = makeSyndra_Q_Telegraph(api);
  const Syndra_Q_Fall = makeSyndra_Q_Fall(api);
  class Syndra_Q extends Spell {
    image = api.asset('spell_syndra_q');
    name = 'Quả Cầu Bóng Tối (Syndra_Q)';
    description = `Triệu hồi một quả cầu bóng tối rơi xuống điểm chỉ định, gây
      <span class="damage">${SYNDRA_Q_DAMAGE} sát thương</span> trong bán kính ${SYNDRA_Q_RADIUS}.
      Quả cầu <b>nằm lại trên mặt đất</b> để W, E và R sử dụng.`;
    coolDown = 6_000;
    manaCost = 25;
    range = SYNDRA_Q_RANGE;

    /** The HUD badge is the number the player is actually tracking for R. */
    get stackCount(): number {
      return groundedSpheres(this.owner).length;
    }

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context?: CastContext): void {
      const cursor = context?.cursorWorld ?? this.aimPoint;
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        createVector(cursor.x, cursor.y),
        effectiveRange(this.range, this.owner)
      );

      this.game.objectManager.addObject(new Syndra_Q_Telegraph(this.owner, to.x, to.y));
      this.game.objectManager.addObject(new Syndra_Q_Fall(this.owner, to.x, to.y));
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Syndra_Q;
}
const __cacheSyndra_Q = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_Q>>();
export default function makeSyndra_Q(api: ContentApi) {
  const cached = __cacheSyndra_Q.get(api);
  if (cached) return cached;
  const built = __buildSyndra_Q(api);
  __cacheSyndra_Q.set(api, built);
  return built;
}


/**
 * The ground half of Q: a shadow that grows to exactly the damage radius while
 * the sphere is still in the air, then a hard rim on that same radius when it
 * lands. The enemy knows the size before it arrives.
 */
function __buildSyndra_Q_Telegraph(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Syndra_Q_Telegraph extends SpellObject {
    zIndex: number | null = GROUND_Z_INDEX;
    lifeTime = SYNDRA_Q_FALL_MS + Q_RIM_MS;
    age = 0;

    constructor(owner: AttackableUnit, x: number, y: number) {
      super(owner);
      this.position = createVector(x, y);
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const falling = constrain(this.age / SYNDRA_Q_FALL_MS, 0, 1);
      push();

      noStroke();
      fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 70 + 60 * falling);
      circle(this.position.x, this.position.y, SYNDRA_Q_RADIUS * 2 * falling);

      noFill();
      stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 150);
      strokeWeight(2);
      circle(this.position.x, this.position.y, SYNDRA_Q_RADIUS * 2 * falling);

      if (falling >= 1) {
        const flash = constrain((this.age - SYNDRA_Q_FALL_MS) / Q_RIM_MS, 0, 1);
        stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 240 * (1 - flash));
        strokeWeight(5 * (1 - flash) + 1);
        circle(this.position.x, this.position.y, SYNDRA_Q_RADIUS * 2);
      }

      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((SYNDRA_Q_RADIUS + 40) * 2);
    }
  }
  return Syndra_Q_Telegraph;
}
const __cacheSyndra_Q_Telegraph = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_Q_Telegraph>>();
export function makeSyndra_Q_Telegraph(api: ContentApi) {
  const cached = __cacheSyndra_Q_Telegraph.get(api);
  if (cached) return cached;
  const built = __buildSyndra_Q_Telegraph(api);
  __cacheSyndra_Q_Telegraph.set(api, built);
  return built;
}


/** The sphere itself, falling. It owns the landing: the damage, then the resource. */
function __buildSyndra_Q_Fall(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const Syndra_Sphere = makeSyndra_Sphere(api);
  const Syndra_Burst = makeSyndra_Burst(api);
  class Syndra_Q_Fall extends SpellObject {
    age = 0;
    landed = false;
    shards: { angle: number; len: number; drift: number }[] = [];

    constructor(owner: AttackableUnit, x: number, y: number) {
      super(owner);
      this.position = createVector(x, y);
    }

    onAdded(): void {
      super.onAdded();
      const count = 6;
      for (let i = 0; i < count; i++) {
        this.shards.push({
          angle: (TWO_PI * i) / count + random(-0.3, 0.3),
          len: random(10, 20),
          drift: random(0.8, 1.8),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age < SYNDRA_Q_FALL_MS) return;
      if (!this.landed) this.land();
      this.toRemove = true;
    }

    private land(): void {
      this.landed = true;

      // An area effect: it lands on whoever is standing there, lit or not.
      const struck = new Set<AttackableUnit>();
      const victims = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: SYNDRA_Q_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of victims) {
        if (struck.has(victim)) continue;
        struck.add(victim);
        victim.takeDamage(SYNDRA_Q_DAMAGE, this.owner);
        this.game.objectManager.addObject(
          new Syndra_Burst(this.owner, victim.position.x, victim.position.y, 38, 260)
        );
      }

      this.game.objectManager.addObject(new Syndra_Sphere(this.owner, this.position));
    }

    draw(): void {
      const t = constrain(this.age / SYNDRA_Q_FALL_MS, 0, 1);
      const drop = t * t;
      const cx = this.position.x;
      const cy = this.position.y - SYNDRA_Q_FALL_HEIGHT * (1 - drop);
      const core = SPHERE_CORE_RADIUS * (0.7 + 0.5 * drop);

      push();

      stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 140 * (1 - drop) + 40);
      strokeWeight(core * 0.5);
      line(cx, cy - 40 - 120 * (1 - drop), cx, cy);

      noStroke();
      for (const shard of this.shards) {
        const spun = shard.angle + this.spinOf(shard.drift);
        const out = core + 5 + shard.len;
        push();
        translate(cx + cos(spun) * out, cy + sin(spun) * out);
        rotate(spun);
        fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 235);
        triangle(shard.len * 0.55, 0, -shard.len * 0.35, -4, -shard.len * 0.35, 4);
        pop();
      }

      fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 240);
      circle(cx, cy, core * 2);
      fill(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 220);
      circle(cx, cy, core * 1.3);
      noFill();
      stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 235);
      strokeWeight(1.8);
      circle(cx, cy, core * 2);

      pop();
    }

    private spinOf(drift: number): number {
      return (this.age / 150) * drift;
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((SYNDRA_Q_FALL_HEIGHT + 60) * 2);
    }
  }
  return Syndra_Q_Fall;
}
const __cacheSyndra_Q_Fall = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_Q_Fall>>();
export function makeSyndra_Q_Fall(api: ContentApi) {
  const cached = __cacheSyndra_Q_Fall.get(api);
  if (cached) return cached;
  const built = __buildSyndra_Q_Fall(api);
  __cacheSyndra_Q_Fall.set(api, built);
  return built;
}


/**
 * Her impact mark, shared by W, E and R: a hard rim on the real hit radius plus
 * the fracture spikes of the motif, planted on the body that took the hit.
 */
function __buildSyndra_Burst(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Syndra_Burst extends SpellObject {
    zIndex: number | null = GROUND_Z_INDEX;
    radius: number;
    lifeTime: number;
    age = 0;
    spikes: { angle: number; len: number }[] = [];

    constructor(owner: AttackableUnit, x: number, y: number, radius: number, lifeTime = 320) {
      super(owner);
      this.position = createVector(x, y);
      this.radius = radius;
      this.lifeTime = lifeTime;
    }

    onAdded(): void {
      super.onAdded();
      const count = 9;
      for (let i = 0; i < count; i++) {
        this.spikes.push({
          angle: (TWO_PI * i) / count + random(-0.25, 0.25),
          len: this.radius * random(0.22, 0.42),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const shown = 1 - t;

      push();
      noStroke();
      fill(SPHERE_DARK[0], SPHERE_DARK[1], SPHERE_DARK[2], 100 * shown);
      circle(this.position.x, this.position.y, this.radius * 2 * opened);

      noFill();
      stroke(SPHERE_EDGE[0], SPHERE_EDGE[1], SPHERE_EDGE[2], 240 * shown);
      strokeWeight(3 * shown + 1);
      circle(this.position.x, this.position.y, this.radius * 2);

      stroke(SPHERE_VIOLET[0], SPHERE_VIOLET[1], SPHERE_VIOLET[2], 225 * shown);
      strokeWeight(2);
      for (const spike of this.spikes) {
        const inner = this.radius * (0.62 + 0.32 * opened);
        const outer = inner + spike.len * opened;
        line(
          this.position.x + cos(spike.angle) * inner,
          this.position.y + sin(spike.angle) * inner,
          this.position.x + cos(spike.angle) * outer,
          this.position.y + sin(spike.angle) * outer
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 60) * 2);
    }
  }
  return Syndra_Burst;
}
const __cacheSyndra_Burst = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_Burst>>();
export function makeSyndra_Burst(api: ContentApi) {
  const cached = __cacheSyndra_Burst.get(api);
  if (cached) return cached;
  const built = __buildSyndra_Burst(api);
  __cacheSyndra_Burst.set(api, built);
  return built;
}