import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Ziggs_E = InstanceType<ReturnType<typeof makeZiggs_E>>;
type Ziggs_E_Object = InstanceType<ReturnType<typeof makeZiggs_E_Object>>;
type Ziggs_E_Pop = InstanceType<ReturnType<typeof makeZiggs_E_Pop>>;



export const E_RANGE = 420;

export const E_MINE_COUNT = 7;

export const E_SCATTER_RADIUS = 180;

export const E_ARM_MS = 500;

export const E_LIFETIME_MS = 10_000;

export const E_TRIGGER_RADIUS = 55;

export const E_DAMAGE = 12;

export const E_SLOW = 0.4;

export const E_SLOW_MS = 1_500;

export const E_MAX_TRIPS_PER_UNIT = 2;


/**
 * Hexagonal Minefield. Seven plates scatter over a disc, unfold, and then sit there as a place
 * you should not walk. The cap is the whole balance of the ability: without it one champion
 * crossing all seven eats 84, so trips are counted per unit across the entire field, not per
 * mine, and a unit already at its cap walks over a plate without setting it off for anyone.
 */
function __buildZiggs_E(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const Ziggs_E_Object = makeZiggs_E_Object(api);
  class Ziggs_E extends Spell {
    image = api.asset('spell_ziggs_e');
    name = 'Bãi Mìn (Ziggs_E)';
    description = `Rải ${E_MINE_COUNT} quả mìn lục giác quanh điểm chỉ định. Mìn kích hoạt sau ${E_ARM_MS / 1000} giây và tồn tại ${E_LIFETIME_MS / 1000} giây; ai bước vào sẽ chịu <span class="damage">${E_DAMAGE} sát thương</span> và bị làm chậm ${Math.round(E_SLOW * 100)}% trong ${E_SLOW_MS / 1000} giây. Mỗi mục tiêu chỉ đạp được tối đa ${E_MAX_TRIPS_PER_UNIT} quả.`;
    coolDown = 10_000;
    manaCost = 40;
    range = E_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        castTimeMs: 200,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context?: CastContext): void {
      const at = this.landingPoint(context);
      this.game.objectManager.addObject(new Ziggs_E_Object(this.owner, at));
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
  return Ziggs_E;
}
const __cacheZiggs_E = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_E>>();
export default function makeZiggs_E(api: ContentApi) {
  const cached = __cacheZiggs_E.get(api);
  if (cached) return cached;
  const built = __buildZiggs_E(api);
  __cacheZiggs_E.set(api, built);
  return built;
}


export interface ZiggsMine {
  position: p5.Vector;
  consumed: boolean;
  blink: number;
  spin: number;
}


/**
 * The whole field is one object, because the trip cap is a property of the field and not of any
 * single plate. Ground art, so it takes `GROUND_Z_INDEX` explicitly: an un-overridden
 * SpellObject subclass resolves to `SPELL_EFFECT_Z_INDEX` instead, and would cover the
 * feet of everyone standing on it.
 */
function __buildZiggs_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const Ziggs_E_Pop = makeZiggs_E_Pop(api);
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Ziggs_E_Object extends SpellObject {
    zIndex = GROUND_Z_INDEX;
    radius = E_SCATTER_RADIUS + E_TRIGGER_RADIUS;
    age = 0;
    lifeTime = E_ARM_MS + E_LIFETIME_MS;
    /** Seeded once in onAdded — random() inside draw() re-rolls every frame and flickers. */
    readonly mines: ZiggsMine[] = [];
    private readonly trips = new Map<AttackableUnit, number>();

    constructor(owner: AttackableUnit, center: p5.Vector) {
      super(owner);
      this.position = center;
    }

    get armed(): boolean {
      return this.age >= E_ARM_MS;
    }

    onAdded(): void {
      if (this.mines.length) return;
      for (let i = 0; i < E_MINE_COUNT; i++) {
        const angle = (i / E_MINE_COUNT) * TWO_PI + random(-0.32, 0.32);
        const reach = E_SCATTER_RADIUS * (0.35 + 0.65 * random());
        this.mines.push({
          position: createVector(
            this.position.x + Math.cos(angle) * reach,
            this.position.y + Math.sin(angle) * reach
          ),
          consumed: false,
          blink: random(0, TWO_PI),
          spin: random(-0.45, 0.45),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      if (!this.armed) return;
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: E_SCATTER_RADIUS + E_TRIGGER_RADIUS,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      if (!candidates.length) return;

      let live = 0;
      for (const mine of this.mines) {
        if (mine.consumed) continue;
        let tripped = false;
        for (const walker of candidates) {
          if ((this.trips.get(walker) ?? 0) >= E_MAX_TRIPS_PER_UNIT) continue;
          const gap = Math.hypot(
            walker.position.x - mine.position.x,
            walker.position.y - mine.position.y
          );
          if (gap > E_TRIGGER_RADIUS) continue;
          this.trip(mine, walker);
          tripped = true;
          break;
        }
        if (!tripped) live++;
      }
      if (live === 0) this.toRemove = true;
    }

    private trip(mine: ZiggsMine, walker: AttackableUnit): void {
      mine.consumed = true;
      this.trips.set(walker, (this.trips.get(walker) ?? 0) + 1);
      walker.takeDamage(E_DAMAGE, this.owner);
      const slow = new Slow(E_SLOW_MS, this.owner, walker);
      slow.percent = E_SLOW;
      slow.stackId = 'ziggs_minefield_slow';
      walker.addBuff(slow);
      this.game.objectManager.addObject(new Ziggs_E_Pop(this.owner, mine.position.copy()));
    }

    /** A hexagon, closed by repeating the first corner so no p5 shape constant is needed. */
    private hexAt(x: number, y: number, size: number, spin: number): void {
      beginShape();
      for (let i = 0; i <= 6; i++) {
        const corner = spin + ((i % 6) / 6) * TWO_PI;
        vertex(x + cos(corner) * size, y + sin(corner) * size);
      }
      endShape();
    }

    draw(): void {
      const arming = constrain(this.age / E_ARM_MS, 0, 1);
      const unfolded = 1 - (1 - arming) * (1 - arming);
      const worn = constrain((this.age - E_ARM_MS) / E_LIFETIME_MS, 0, 1);
      const fade = 1 - worn * worn;
      push();
      for (const mine of this.mines) {
        if (mine.consumed) continue;
        const plate = 12 + 10 * unfolded;
        noStroke();
        fill(31, 38, 46, 195 * fade);
        this.hexAt(mine.position.x, mine.position.y, plate, mine.spin);
        noFill();
        stroke(32, 191, 107, (arming < 1 ? 110 : 225) * fade);
        strokeWeight(2);
        this.hexAt(mine.position.x, mine.position.y, plate, mine.spin);
        // A folded plate shows no light and claims no ground; an armed one does both.
        if (arming >= 1) {
          const pulse = 0.5 + 0.5 * sin(mine.blink + this.age / 170);
          noStroke();
          fill(249, 202, 36, (80 + 160 * pulse) * fade);
          circle(mine.position.x, mine.position.y, 5 + 6 * pulse);
          noFill();
          stroke(32, 191, 107, (50 + 75 * pulse) * fade);
          strokeWeight(1.5);
          circle(mine.position.x, mine.position.y, E_TRIGGER_RADIUS * 2);
        }
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Ziggs_E_Object;
}
const __cacheZiggs_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_E_Object>>();
export function makeZiggs_E_Object(api: ContentApi) {
  const cached = __cacheZiggs_E_Object.get(api);
  if (cached) return cached;
  const built = __buildZiggs_E_Object(api);
  __cacheZiggs_E_Object.set(api, built);
  return built;
}


/** One plate going off, on the body that stepped on it. */
function __buildZiggs_E_Pop(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Ziggs_E_Pop extends SpellObject {
    radius = E_TRIGGER_RADIUS;
    lifeTime = 260;
    age = 0;

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      push();
      noStroke();
      fill(249, 202, 36, 190 * fade * fade);
      circle(this.position.x, this.position.y, this.radius * 1.1 * opened);
      fill(255, 248, 220, 220 * fade * fade);
      circle(this.position.x, this.position.y, this.radius * 0.45 * opened);
      noFill();
      stroke(32, 191, 107, 235 * fade);
      strokeWeight(3.5 * fade + 1.5);
      circle(this.position.x, this.position.y, this.radius * 2 * opened);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 30) * 2);
    }
  }
  return Ziggs_E_Pop;
}
const __cacheZiggs_E_Pop = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_E_Pop>>();
export function makeZiggs_E_Pop(api: ContentApi) {
  const cached = __cacheZiggs_E_Pop.get(api);
  if (cached) return cached;
  const built = __buildZiggs_E_Pop(api);
  __cacheZiggs_E_Pop.set(api, built);
  return built;
}