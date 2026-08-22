import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Ziggs_R = InstanceType<ReturnType<typeof makeZiggs_R>>;
type Ziggs_R_Blast = InstanceType<ReturnType<typeof makeZiggs_R_Blast>>;
type Ziggs_R_Object = InstanceType<ReturnType<typeof makeZiggs_R_Object>>;



export const R_RANGE = 900;

export const R_FLIGHT_MS = 1_100;

export const R_INNER_RADIUS = 150;

export const R_OUTER_RADIUS = 300;

export const R_INNER_DAMAGE = 48;

export const R_OUTER_DAMAGE = 30;

export const R_DROP_HEIGHT = 420;


/**
 * Mega Inferno Bomb. Artillery: it reaches most of the screen and the flight time is the
 * counterplay, so what the victims get for that second is a shadow growing to exactly the
 * radius that will hurt them.
 */
function __buildZiggs_R(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const Ziggs_R_Object = makeZiggs_R_Object(api);
  class Ziggs_R extends Spell {
    image = api.asset('spell_ziggs_r');
    name = 'Siêu Bom Địa Ngục (Ziggs_R)';
    description = `Nã một siêu bom bay ${R_FLIGHT_MS / 1000} giây rồi rơi xuống điểm chỉ định: <span class="damage">${R_INNER_DAMAGE} sát thương</span> trong lõi bán kính ${R_INNER_RADIUS}, <span class="damage">${R_OUTER_DAMAGE} sát thương</span> ở vành ngoài tới ${R_OUTER_RADIUS}. Cái bóng lớn dần trên mặt đất là thời gian để tránh.`;
    coolDown = 10_000;
    manaCost = 100;
    range = R_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        castTimeMs: 340,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context?: CastContext): void {
      const at = this.landingPoint(context);
      this.game.objectManager.addObject(new Ziggs_R_Object(this.owner, at));
    }

    /** The cursor point, clamped to the cast range through Reach. */
    private landingPoint(context?: CastContext): p5.Vector {
      const cursor = context ? context.cursorWorld : this.aimPoint;
      const dx = cursor.x - this.owner.position.x;
      const dy = cursor.y - this.owner.position.y;
      const reach = effectiveRange(this.range, this.owner);
      const away = Math.hypot(dx, dy);
      if (away <= reach || away < 1e-4) return createVector(cursor.x, cursor.y);
      return createVector(
        this.owner.position.x + (dx / away) * reach,
        this.owner.position.y + (dy / away) * reach
      );
    }
  }
  return Ziggs_R;
}
const __cacheZiggs_R = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_R>>();
export default function makeZiggs_R(api: ContentApi) {
  const cached = __cacheZiggs_R.get(api);
  if (cached) return cached;
  const built = __buildZiggs_R(api);
  __cacheZiggs_R.set(api, built);
  return built;
}


/**
 * The shell on its way down. Ground art — the shadow and both rims are painted on the floor, so
 * it takes `GROUND_Z_INDEX` explicitly: an un-overridden SpellObject subclass
 * would otherwise resolve to `SPELL_EFFECT_Z_INDEX`, above the champions standing in the blast.
 */
function __buildZiggs_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Ziggs_R_Blast = makeZiggs_R_Blast(api);
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Ziggs_R_Object extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    radius = R_OUTER_RADIUS;
    age = 0;
    detonated = false;
    /** Seeded once in onAdded — random() inside draw() re-rolls every frame and flickers. */
    scorches: { angle: number; reach: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      if (this.scorches.length) return;
      for (let i = 0; i < 14; i++) {
        this.scorches.push({ angle: (i / 14) * TWO_PI + random(-0.2, 0.2), reach: random(0.7, 1) });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.detonated || this.age < R_FLIGHT_MS) return;
      this.detonate();
    }

    /** Two zones, one hit each: the distance at detonation decides which number a unit takes. */
    detonate(): void {
      if (this.detonated) return;
      this.detonated = true;
      const hit = new Set<AttackableUnit>();
      const victims = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: R_OUTER_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      for (const victim of victims) {
        if (hit.has(victim)) continue;
        const gap = Math.hypot(
          victim.position.x - this.position.x,
          victim.position.y - this.position.y
        );
        if (gap > R_OUTER_RADIUS) continue;
        hit.add(victim);
        victim.takeDamage(gap <= R_INNER_RADIUS ? R_INNER_DAMAGE : R_OUTER_DAMAGE, this.owner);
      }
      this.game.objectManager.addObject(new Ziggs_R_Blast(this.owner, this.position.copy()));
      this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / R_FLIGHT_MS, 0, 1);
      const swell = t * t;
      const fallen = t * t * t;
      push();
      // The growing shadow: how long is left, read off the floor.
      noStroke();
      fill(10, 16, 20, 60 + 70 * t);
      circle(this.position.x, this.position.y, R_OUTER_RADIUS * 2 * swell);
      // Both rims at their true radii from the first frame — which region you stand in matters.
      noFill();
      stroke(32, 191, 107, 80 + 130 * t);
      strokeWeight(2 + 1.5 * t);
      circle(this.position.x, this.position.y, R_OUTER_RADIUS * 2);
      stroke(249, 202, 36, 70 + 150 * t);
      strokeWeight(2.5 + 1.5 * t);
      circle(this.position.x, this.position.y, R_INNER_RADIUS * 2);
      stroke(249, 202, 36, 50 + 90 * t);
      strokeWeight(1);
      for (const scorch of this.scorches) {
        line(
          this.position.x + cos(scorch.angle) * R_INNER_RADIUS,
          this.position.y + sin(scorch.angle) * R_INNER_RADIUS,
          this.position.x + cos(scorch.angle) * R_OUTER_RADIUS * scorch.reach,
          this.position.y + sin(scorch.angle) * R_OUTER_RADIUS * scorch.reach
        );
      }
      // The shell dropping in, fuse first.
      const by = this.position.y - (1 - fallen) * R_DROP_HEIGHT;
      const shell = 26 + 30 * fallen;
      noStroke();
      fill(47, 54, 64);
      circle(this.position.x, by, shell);
      fill(32, 191, 107, 70);
      circle(this.position.x - shell * 0.18, by - shell * 0.18, shell * 0.42);
      noFill();
      stroke(32, 191, 107, 245);
      strokeWeight(3.5);
      circle(this.position.x, by, shell);
      stroke(206, 216, 210, 220);
      strokeWeight(2.5);
      line(
        this.position.x + shell * 0.28,
        by - shell * 0.4,
        this.position.x + shell * 0.42,
        by - shell * 0.4 - (14 + 16 * (1 - t))
      );
      noStroke();
      fill(249, 202, 36, 245);
      circle(this.position.x + shell * 0.42, by - shell * 0.4 - (14 + 16 * (1 - t)), 7 + 7 * (1 - t));
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((Math.max(this.radius, R_DROP_HEIGHT) + 40) * 2);
    }
  }
  return Ziggs_R_Object;
}
const __cacheZiggs_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_R_Object>>();
export function makeZiggs_R_Object(api: ContentApi) {
  const cached = __cacheZiggs_R_Object.get(api);
  if (cached) return cached;
  const built = __buildZiggs_R_Object(api);
  __cacheZiggs_R_Object.set(api, built);
  return built;
}


/**
 * The detonation. Two rules, two regions: a filled hot core with a hard rim at 150, and an open
 * band from 150 out to a hard rim at 300. Never one disc with a faint line in it.
 */
function __buildZiggs_R_Blast(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Ziggs_R_Blast extends SpellObject {
    radius = R_OUTER_RADIUS;
    lifeTime = 520;
    age = 0;
    /** Seeded once in onAdded — random() inside draw() re-rolls every frame and flickers. */
    shards: { angle: number; reach: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      if (this.shards.length) return;
      for (let i = 0; i < 18; i++) {
        this.shards.push({ angle: (i / 18) * TWO_PI + random(-0.15, 0.15), reach: random(0.7, 1) });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      const band = R_OUTER_RADIUS - R_INNER_RADIUS;
      push();
      // THE BAND: a green-tinged annulus laid on with one thick stroke, 150 out to 300.
      noFill();
      stroke(32, 191, 107, 65 * fade);
      strokeWeight(band);
      circle(this.position.x, this.position.y, R_INNER_RADIUS + R_OUTER_RADIUS);
      stroke(200, 240, 210, 200 * fade);
      strokeWeight(2.5 * fade + 1);
      for (const shard of this.shards) {
        const outer = R_INNER_RADIUS + band * shard.reach * opened;
        line(
          this.position.x + cos(shard.angle) * R_INNER_RADIUS,
          this.position.y + sin(shard.angle) * R_INNER_RADIUS,
          this.position.x + cos(shard.angle) * outer,
          this.position.y + sin(shard.angle) * outer
        );
      }
      stroke(32, 191, 107, 240 * fade);
      strokeWeight(5 * fade + 2);
      circle(this.position.x, this.position.y, R_OUTER_RADIUS * 2);
      // THE CORE: a filled hot disc, its own region, with its own hard rim at 150.
      noStroke();
      fill(249, 202, 36, 205 * fade);
      circle(this.position.x, this.position.y, R_INNER_RADIUS * 2 * opened);
      fill(255, 250, 226, 235 * fade * fade);
      circle(this.position.x, this.position.y, R_INNER_RADIUS * 1.05 * opened);
      noFill();
      stroke(255, 246, 210, 250 * fade);
      strokeWeight(5 * fade + 2);
      circle(this.position.x, this.position.y, R_INNER_RADIUS * 2);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Ziggs_R_Blast;
}
const __cacheZiggs_R_Blast = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_R_Blast>>();
export function makeZiggs_R_Blast(api: ContentApi) {
  const cached = __cacheZiggs_R_Blast.get(api);
  if (cached) return cached;
  const built = __buildZiggs_R_Blast(api);
  __cacheZiggs_R_Blast.set(api, built);
  return built;
}