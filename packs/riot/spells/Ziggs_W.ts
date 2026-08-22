import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Ziggs_W = InstanceType<ReturnType<typeof makeZiggs_W>>;
type Ziggs_W_Blast = InstanceType<ReturnType<typeof makeZiggs_W_Blast>>;
type Ziggs_W_Object = InstanceType<ReturnType<typeof makeZiggs_W_Object>>;



export const W_RANGE = 400;

export const W_DAMAGE = 18;

export const W_RADIUS = 160;

export const W_FUSE_MS = 4_000;

export const W_PUSH = 260;

export const W_PUSH_MS = 320;

export const W_PUSH_SPEED = 14;

const WINDUP_MS = 160;

const RECAST_DELAY_MS = 150;


/**
 * Satchel Charge. Sticks at the point and arms; it goes off on recast or on its own fuse,
 * whichever comes first. The blast throws everything in the radius outward — Ziggs included,
 * and that self-throw is his only mobility, so he eats the displacement but never the damage.
 *
 * The form is INDEPENDENT because the satchel is out of his hands the moment it lands: it must
 * survive him walking, being stunned, and above all being knocked back by his own blast.
 */
function __buildZiggs_W(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const SpellForm = api.enums.SpellForm;
  const Spell = api.Spell;
  const Ziggs_W_Object = makeZiggs_W_Object(api);
  class Ziggs_W extends Spell {
    image = api.asset('spell_ziggs_w');
    name = 'Gói Chất Nổ (Ziggs_W)';
    description = `Đặt một gói chất nổ tự kích nổ sau ${W_FUSE_MS / 1000} giây, hoặc bấm lại để nổ ngay. Gây <span class="damage">${W_DAMAGE} sát thương</span> và đẩy mọi thứ trong bán kính ${W_RADIUS} ra xa ${W_PUSH} — kể cả Ziggs, nhưng anh ta không chịu sát thương.`;
    coolDown = 10_000;
    manaCost = 30;
    range = W_RANGE;

    /** The live charge, so a recast knows what to set off. */
    satchel: Ziggs_W_Object | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'RECAST',
        targeting: 'POINT',
        castTimeMs: WINDUP_MS,
        active: { maxDurationMs: W_FUSE_MS, recastDelayMs: RECAST_DELAY_MS },
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        interrupts: SpellForm.INDEPENDENT,
      };
    }

    onActivate(context: CastContext): void {
      if (this.satchel && !this.satchel.spent && !this.satchel.toRemove) return;
      const at = this.landingPoint(context);
      const satchel = new Ziggs_W_Object(this.owner, at);
      this.satchel = satchel;
      this.game.objectManager.addObject(satchel);
    }

    onRecast(): void {
      if (this.satchel) this.satchel.detonate();
    }

    onComplete(): void {
      if (this.satchel) this.satchel.detonate();
    }

    onCancel(): void {
      if (this.satchel) this.satchel.fizzle();
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
  return Ziggs_W;
}
const __cacheZiggs_W = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_W>>();
export default function makeZiggs_W(api: ContentApi) {
  const cached = __cacheZiggs_W.get(api);
  if (cached) return cached;
  const built = __buildZiggs_W(api);
  __cacheZiggs_W.set(api, built);
  return built;
}


/**
 * The armed charge. It draws its 160 rim from the frame it lands, not at detonation — that
 * circle is a standing threat the enemy has four seconds to walk out of, and the shortening
 * fuse spark is the clock telling them how long they have left.
 */
function __buildZiggs_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Dash = api.buffs.Dash;
  const Ziggs_W_Blast = makeZiggs_W_Blast(api);
  class Ziggs_W_Object extends SpellObject {
    radius = W_RADIUS;
    age = 0;
    spent = false;
    /** Seeded once in onAdded — random() inside draw() re-rolls every frame and flickers. */
    sparks: { angle: number; reach: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      if (this.sparks.length) return;
      for (let i = 0; i < 7; i++) {
        this.sparks.push({ angle: (i / 7) * TWO_PI + random(-0.5, 0.5), reach: random(0.5, 1) });
      }
    }

    get fuseLeft(): number {
      return constrain(1 - this.age / W_FUSE_MS, 0, 1);
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= W_FUSE_MS) this.detonate();
    }

    /** Idempotent: recast and fuse both land here, and only the first one pays out. */
    detonate(): void {
      if (this.spent) return;
      this.spent = true;
      const hit = new Set<AttackableUnit>();
      const victims = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: W_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];
      for (const victim of victims) {
        if (hit.has(victim)) continue;
        hit.add(victim);
        victim.takeDamage(W_DAMAGE, this.owner);
        this.shove(victim);
      }
      const own = Math.hypot(
        this.owner.position.x - this.position.x,
        this.owner.position.y - this.position.y
      );
      if (own <= W_RADIUS && !this.owner.isDead) this.shove(this.owner);
      this.game.objectManager.addObject(new Ziggs_W_Blast(this.owner, this.position.copy()));
      this.toRemove = true;
    }

    /** Cancelled with the spell: the charge just goes away, it does not pay out. */
    fizzle(): void {
      this.spent = true;
      this.toRemove = true;
    }

    private shove(unit: AttackableUnit): void {
      // getVectorWithRange randomises a zero-length aim, which is the (0,0) guard for a unit
      // standing exactly on the charge — the common case for Ziggs himself.
      const away = VectorUtils.getVectorWithRange(this.position, unit.position, W_PUSH);
      const axisX = away.to.x - this.position.x;
      const axisY = away.to.y - this.position.y;
      const knock = new Dash(W_PUSH_MS, this.owner, unit);
      knock.dashDestination = createVector(unit.position.x + axisX, unit.position.y + axisY);
      knock.dashSpeed = W_PUSH_SPEED;
      knock.stayAtDestination = true;
      knock.cancelable = false;
      knock.showTrail = false;
      unit.markDisplaced();
      unit.addBuff(knock);
    }

    draw(): void {
      const burn = this.fuseLeft;
      const tick = 1 - burn;
      const flash = 0.5 + 0.5 * sin(this.age / (40 + 120 * burn));
      push();
      // The standing threat: the rim on the real blast radius, up from the first frame.
      noFill();
      stroke(32, 191, 107, 90 + 110 * tick);
      strokeWeight(2 + 2 * tick);
      circle(this.position.x, this.position.y, W_RADIUS * 2);
      stroke(32, 191, 107, 40 + 60 * tick);
      strokeWeight(1.5);
      circle(this.position.x, this.position.y, W_RADIUS * 2 * (0.35 + 0.4 * tick));
      // The charge itself.
      noStroke();
      fill(16, 22, 28, 100);
      ellipse(this.position.x, this.position.y + 12, 40, 16);
      fill(47, 54, 64);
      circle(this.position.x, this.position.y, 34);
      fill(32, 191, 107, 60 + 70 * flash * tick);
      circle(this.position.x - 5, this.position.y - 5, 15);
      noFill();
      stroke(32, 191, 107, 240);
      strokeWeight(3);
      circle(this.position.x, this.position.y, 34);
      // The fuse: its spark rides down a visibly shortening wick across the whole four seconds.
      const wick = 8 + 26 * burn;
      stroke(206, 216, 210, 220);
      strokeWeight(2);
      line(
        this.position.x + 8,
        this.position.y - 12,
        this.position.x + 12,
        this.position.y - 12 - wick
      );
      noStroke();
      fill(249, 202, 36, 200 + 55 * flash);
      circle(this.position.x + 12, this.position.y - 12 - wick, 6 + 5 * flash);
      for (const spark of this.sparks) {
        const reach = spark.reach * (5 + 9 * flash);
        fill(255, 248, 220, 190 * flash);
        circle(
          this.position.x + 12 + cos(spark.angle) * reach,
          this.position.y - 12 - wick + sin(spark.angle) * reach,
          2.5
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Ziggs_W_Object;
}
const __cacheZiggs_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_W_Object>>();
export function makeZiggs_W_Object(api: ContentApi) {
  const cached = __cacheZiggs_W_Object.get(api);
  if (cached) return cached;
  const built = __buildZiggs_W_Object(api);
  __cacheZiggs_W_Object.set(api, built);
  return built;
}


/** The blast. It draws outward, the way the shove it applies moves. */
function __buildZiggs_W_Blast(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Ziggs_W_Blast extends SpellObject {
    radius = W_RADIUS;
    lifeTime = 380;
    age = 0;
    /** Seeded once in onAdded — random() inside draw() re-rolls every frame and flickers. */
    spokes: { angle: number; reach: number }[] = [];

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      if (this.spokes.length) return;
      for (let i = 0; i < 12; i++) {
        this.spokes.push({ angle: (i / 12) * TWO_PI + random(-0.2, 0.2), reach: random(0.75, 1) });
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
      fill(249, 202, 36, 150 * fade * fade);
      circle(this.position.x, this.position.y, this.radius * 1.2 * opened);
      fill(255, 248, 220, 200 * fade * fade);
      circle(this.position.x, this.position.y, this.radius * 0.45 * opened);
      noFill();
      stroke(32, 191, 107, 240 * fade);
      strokeWeight(5 * fade + 2);
      circle(this.position.x, this.position.y, this.radius * 2);
      // Outward chevrons: the picture moves the way the knockback moves.
      stroke(255, 246, 210, 230 * fade);
      strokeWeight(3 * fade + 1);
      for (const spoke of this.spokes) {
        const head = this.radius * spoke.reach * opened;
        const tail = head - this.radius * 0.3;
        const hx = this.position.x + cos(spoke.angle) * head;
        const hy = this.position.y + sin(spoke.angle) * head;
        line(
          this.position.x + cos(spoke.angle) * tail,
          this.position.y + sin(spoke.angle) * tail,
          hx,
          hy
        );
        line(hx, hy, hx - cos(spoke.angle - 0.5) * 14, hy - sin(spoke.angle - 0.5) * 14);
        line(hx, hy, hx - cos(spoke.angle + 0.5) * 14, hy - sin(spoke.angle + 0.5) * 14);
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Ziggs_W_Blast;
}
const __cacheZiggs_W_Blast = new WeakMap<ContentApi, ReturnType<typeof __buildZiggs_W_Blast>>();
export function makeZiggs_W_Blast(api: ContentApi) {
  const cached = __cacheZiggs_W_Blast.get(api);
  if (cached) return cached;
  const built = __buildZiggs_W_Blast(api);
  __cacheZiggs_W_Blast.set(api, built);
  return built;
}