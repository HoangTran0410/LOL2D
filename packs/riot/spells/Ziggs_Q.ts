import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Ziggs_Q = InstanceType<ReturnType<typeof makeZiggs_Q>>;
type Ziggs_Q_Blast = InstanceType<ReturnType<typeof makeZiggs_Q_Blast>>;
type Ziggs_Q_Object = InstanceType<ReturnType<typeof makeZiggs_Q_Object>>;



export const Q_RANGE = 450;

export const Q_DAMAGE = 16;

export const Q_BLAST_RADIUS = 120;

export const Q_BOUNCE_STEP = 130;

export const Q_BOUNCE_GAP_MS = 180;

export const Q_BOUNCE_COUNT = 3;

export const Q_TRAVEL_MS = 300;

export const Q_HOP_HEIGHT = 46;

const WINDUP_MS = 170;


/**
 * Bouncing Bomb. Lands on the cursor point, then hops twice more down the same axis, one
 * blast per landing. Each blast keeps its own hit set on purpose: standing where two rims
 * overlap is supposed to cost twice, which is why the three rims are drawn separately.
 */
function __buildZiggs_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const Ziggs_Q_Object = makeZiggs_Q_Object(api);
  class Ziggs_Q extends Spell {
    image = api.asset('spell_ziggs_q');
    name = 'Bom Nảy (Ziggs_Q)';
    description = `Ném quả bom nảy ${Q_BOUNCE_COUNT} nhịp theo một đường thẳng, mỗi nhịp xa thêm ${Q_BOUNCE_STEP}. Mỗi vụ nổ gây <span class="damage">${Q_DAMAGE} sát thương</span> trong bán kính ${Q_BLAST_RADIUS}; đứng ở chỗ hai vụ nổ trùm nhau thì trúng cả hai.`;
    coolDown = 6_000;
    manaCost = 25;
    range = Q_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        castTimeMs: WINDUP_MS,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context?: CastContext): void {
      const landing = this.landingPoint(context);
      const axis = this.castAxis(context, landing);
      const landings: p5.Vector[] = [];
      for (let hop = 0; hop < Q_BOUNCE_COUNT; hop++) {
        landings.push(
          createVector(
            landing.x + axis.x * Q_BOUNCE_STEP * hop,
            landing.y + axis.y * Q_BOUNCE_STEP * hop
          )
        );
      }
      this.game.objectManager.addObject(new Ziggs_Q_Object(this.owner, landings));
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

    /** Unit-length hop axis. Never (0,0): firingDirection guards it, and so does the fallback. */
    private castAxis(context: CastContext | undefined, landing: p5.Vector) {
      const raw = context
        ? this.firingDirection(context)
        : { x: landing.x - this.owner.position.x, y: landing.y - this.owner.position.y };
      const span = Math.hypot(raw.x, raw.y);
      if (span >= 1e-4) return { x: raw.x / span, y: raw.y / span };
      const spun = VectorUtils.getVectorWithRange(this.owner.position, landing, Q_BOUNCE_STEP);
      const fx = spun.to.x - this.owner.position.x;
      const fy = spun.to.y - this.owner.position.y;
      const fallback = Math.hypot(fx, fy) || 1;
      return { x: fx / fallback, y: fy / fallback };
    }
  }
  return Ziggs_Q;
}
const __cacheZiggs_Q = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_Q>>();
export default function makeZiggs_Q(api: ContentApi) {
  const cached = __cacheZiggs_Q.get(api);
  if (cached) return cached;
  const built = __buildZiggs_Q(api);
  __cacheZiggs_Q.set(api, built);
  return built;
}


/**
 * The bomb in flight. It only ever paints a body and a shadow around its own centre; the
 * three blasts are separate objects so each rim owns an honest box at the real radius.
 */
function __buildZiggs_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Ziggs_Q_Blast = makeZiggs_Q_Blast(api);
  class Ziggs_Q_Object extends SpellObject {
    readonly landings: p5.Vector[];
    readonly origin: p5.Vector;
    radius = Q_HOP_HEIGHT + 56;
    age = 0;
    blastsFired = 0;
    legProgress = 0;

    constructor(owner: AttackableUnit, landings: p5.Vector[]) {
      super(owner);
      this.landings = landings;
      this.origin = owner.position.copy();
      this.position = this.origin.copy();
    }

    update(): void {
      this.age += deltaTime;
      while (
        this.blastsFired < Q_BOUNCE_COUNT &&
        this.age >= Q_TRAVEL_MS + this.blastsFired * Q_BOUNCE_GAP_MS
      ) {
        this.blast(this.blastsFired);
        this.blastsFired += 1;
      }
      if (this.blastsFired >= Q_BOUNCE_COUNT) {
        this.toRemove = true;
        return;
      }
      const from = this.blastsFired === 0 ? this.origin : this.landings[this.blastsFired - 1];
      const to = this.landings[this.blastsFired];
      const legMs = this.blastsFired === 0 ? Q_TRAVEL_MS : Q_BOUNCE_GAP_MS;
      const legAge =
        this.blastsFired === 0
          ? this.age
          : this.age - (Q_TRAVEL_MS + (this.blastsFired - 1) * Q_BOUNCE_GAP_MS);
      this.legProgress = constrain(legAge / legMs, 0, 1);
      this.position.x = lerp(from.x, to.x, this.legProgress);
      this.position.y = lerp(from.y, to.y, this.legProgress);
    }

    private blast(index: number): void {
      const at = this.landings[index];
      const hit = new Set<AttackableUnit>();
      const victims = this.game.objectManager.queryObjects({
        area: new Circle({ x: at.x, y: at.y, r: Q_BLAST_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      for (const victim of victims) {
        if (hit.has(victim)) continue;
        hit.add(victim);
        victim.takeDamage(Q_DAMAGE, this.owner);
      }
      this.game.objectManager.addObject(new Ziggs_Q_Blast(this.owner, at.copy()));
    }

    draw(): void {
      const hop = sin(PI * this.legProgress);
      const lift = hop * Q_HOP_HEIGHT;
      const squash = 1 - 0.3 * hop;
      const bx = this.position.x;
      const by = this.position.y - lift;
      const burn = 1 - this.legProgress;
      const fuseTip = 20 + 10 * burn;
      push();
      noStroke();
      fill(16, 22, 28, 95 * squash);
      ellipse(this.position.x, this.position.y, 36 * squash, 17 * squash);
      fill(47, 54, 64);
      circle(bx, by, 30);
      fill(32, 191, 107, 70);
      circle(bx - 5, by - 5, 13);
      noFill();
      stroke(32, 191, 107, 235);
      strokeWeight(3);
      circle(bx, by, 30);
      stroke(206, 216, 210, 210);
      strokeWeight(2);
      line(bx + 7, by - 11, bx + 11, by - fuseTip);
      noStroke();
      fill(249, 202, 36, 245);
      circle(bx + 11, by - fuseTip, 5 + 5 * burn);
      fill(255, 248, 220, 210);
      circle(bx + 11, by - fuseTip, 2 + 2 * burn);
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Ziggs_Q_Object;
}
const __cacheZiggs_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_Q_Object>>();
export function makeZiggs_Q_Object(api: ContentApi) {
  const cached = __cacheZiggs_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildZiggs_Q_Object(api);
  __cacheZiggs_Q_Object.set(api, built);
  return built;
}


/** One of the three blasts. The hard rim sits on the real 120 hit radius from frame one. */
function __buildZiggs_Q_Blast(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Ziggs_Q_Blast extends SpellObject {
    radius = Q_BLAST_RADIUS;
    lifeTime = 300;
    age = 0;
    /** Seeded once in onAdded — random() inside draw() re-rolls every frame and flickers. */
    shards: { angle: number; reach: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      if (this.shards.length) return;
      for (let i = 0; i < 9; i++) {
        this.shards.push({ angle: (i / 9) * TWO_PI + random(-0.3, 0.3), reach: random(0.68, 1) });
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
      push();
      noStroke();
      fill(249, 202, 36, 165 * fade * fade);
      circle(this.position.x, this.position.y, this.radius * 1.4 * opened);
      fill(255, 248, 220, 200 * fade * fade);
      circle(this.position.x, this.position.y, this.radius * 0.5 * opened);
      noFill();
      stroke(32, 191, 107, 235 * fade);
      strokeWeight(4 * fade + 1.5);
      circle(this.position.x, this.position.y, this.radius * 2);
      stroke(255, 246, 210, 225 * fade);
      strokeWeight(2.5 * fade + 1);
      for (const shard of this.shards) {
        const inner = this.radius * 0.25 * opened;
        const outer = this.radius * shard.reach * opened;
        line(
          this.position.x + cos(shard.angle) * inner,
          this.position.y + sin(shard.angle) * inner,
          this.position.x + cos(shard.angle) * outer,
          this.position.y + sin(shard.angle) * outer
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Ziggs_Q_Blast;
}
const __cacheZiggs_Q_Blast = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_Q_Blast>>();
export function makeZiggs_Q_Blast(api: ContentApi) {
  const cached = __cacheZiggs_Q_Blast.get(api);
  if (cached) return cached;
  const built = __buildZiggs_Q_Blast(api);
  __cacheZiggs_Q_Blast.set(api, built);
  return built;
}