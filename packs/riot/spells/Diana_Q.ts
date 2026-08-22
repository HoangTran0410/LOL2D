import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Buff = InstanceType<ContentApi['buffs']['Buff']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Diana_Q = InstanceType<ReturnType<typeof makeDiana_Q>>;
type Diana_Q_Cut = InstanceType<ReturnType<typeof makeDiana_Q_Cut>>;
type Diana_Q_Sweep = InstanceType<ReturnType<typeof makeDiana_Q_Sweep>>;
type Moonlight = InstanceType<ReturnType<typeof makeMoonlight>>;



export const Q_DAMAGE = 22;

export const Q_RADIUS = 380;

export const Q_ARC_DEG = 180;

export const Q_SWEEP_MS = 480;

/** Radial half-width of the swept corridor: how far off the blade's own reach still gets cut. */
export const Q_BAND = 55;

/** How long a Moonlight mark rides its victim before Diana loses the reset. */
export const MOONLIGHT_MS = 4_000;


const Q_WINDUP_MS = 140;

const Q_FADE_MS = 250;

const Q_CUT_RADIUS = 65;


/** Moonlight. Pale silver-blue, cold cyan core, indigo night. Nothing here is warm. */
export const MOON_PALE = [223, 230, 245] as const;

export const MOON_CORE = [116, 185, 255] as const;

export const MOON_NIGHT = [58, 70, 120] as const;


/**
 * Diana's one shape: a thick arc with a sharp outer lip and two tapering tails.
 * Shared by all four spells so the kit reads as one champion.
 */
export function drawCrescent(
  cx: number,
  cy: number,
  radius: number,
  facing: number,
  span: number,
  weight: number,
  tone: readonly number[],
  shade: number
): void {
  const segCount = 14;
  for (let i = 0; i < segCount; i++) {
    const f0 = i / segCount;
    const f1 = (i + 1) / segCount;
    const taper = sin(0.1 * Math.PI + f0 * Math.PI * 0.9);
    stroke(tone[0], tone[1], tone[2], shade * (0.28 + 0.72 * taper));
    strokeWeight(Math.max(0.7, weight * (0.16 + 0.84 * taper)));
    const a0 = facing - span / 2 + span * f0;
    const a1 = facing - span / 2 + span * f1;
    line(
      cx + cos(a0) * radius,
      cy + sin(a0) * radius,
      cx + cos(a1) * radius,
      cy + sin(a1) * radius
    );
  }
}


/**
 * The mark Q leaves behind. A small crescent turning slowly over the victim's head,
 * because Diana_E's cooldown reset reads exactly this buff and the player has to be able
 * to pick the marked target out of a fight without opening the HUD.
 */
function __buildMoonlight(api: ContentApi) {
  const Buff = api.buffs.Buff;
  class Moonlight extends Buff {
    name = 'Ánh Trăng';
    description = 'Bị đánh dấu bởi ánh trăng của Diana.';
    image = api.asset('spell_diana_q');

    draw(): void {
      const victim = this.targetUnit;
      if (!victim) return;
      const spent = constrain(this.timeElapsed / Math.max(this.duration, 1), 0, 1);
      const spin = (this.timeElapsed / 1100) * TWO_PI;
      const bob = sin(this.timeElapsed / 260) * 3;
      const lift = 24 + (victim.animatedValues?.displaySize ?? 40) * 0.5;
      const shade = 235 * (1 - spent * 0.4);

      push();
      translate(victim.position.x, victim.position.y - lift + bob);
      rotate(spin);
      noFill();
      drawCrescent(0, 0, 12, 0, Math.PI * 1.1, 5, MOON_PALE, shade);
      drawCrescent(0, 0, 8, 0, Math.PI * 0.8, 2.5, MOON_CORE, shade * 0.8);
      pop();
    }
  }
  return Moonlight;
}
const __cacheMoonlight = new WeakMap<ContentApi, ReturnType<typeof __buildMoonlight>>();
export function makeMoonlight(api: ContentApi) {
  const cached = __cacheMoonlight.get(api);
  if (cached) return cached;
  const built = __buildMoonlight(api);
  __cacheMoonlight.set(api, built);
  return built;
}


/** The live mark on a unit, or null. A plain loop: filter cannot narrow here. */
function __buildmoonlightOn(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const Moonlight = makeMoonlight(api);
  function moonlightOn(unit: AttackableUnit): Moonlight | null {
    const carried = unit.buffs;
    for (let i = 0; i < carried.length; i++) {
      const buff = carried[i];
      if (buff instanceof Moonlight && !buff.toRemove) return buff;
    }
    return null;
  }
  return moonlightOn;
}
const __cachemoonlightOn = new WeakMap<ContentApi, ReturnType<typeof __buildmoonlightOn>>();
export function makeMoonlightOn(api: ContentApi) {
  const cached = __cachemoonlightOn.get(api);
  if (cached) return cached;
  const built = __buildmoonlightOn(api);
  __cachemoonlightOn.set(api, built);
  return built;
}


function __buildDiana_Q(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const Spell = api.Spell;
  const Diana_Q_Sweep = makeDiana_Q_Sweep(api);
  class Diana_Q extends Spell {
    image = api.asset('spell_diana_q');
    name = 'Trăng Lưỡi Liềm (Diana_Q)';
    description = `Bắn ra một vệt ánh trăng hình lưỡi liềm uốn lượn tới điểm chỉ định, gây
      <span class="damage">${Q_DAMAGE} sát thương</span> cho kẻ địch trên đường bay và tại điểm đích,
      đồng thời đánh dấu Ánh Trăng trong ${MOONLIGHT_MS / 1000} giây.`;
    coolDown = 8_000;
    manaCost = 30;
    range = Q_RADIUS;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: Q_WINDUP_MS,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(context?: CastContext): void {
      const origin = { x: this.owner.position.x, y: this.owner.position.y };
      let aimX = 1;
      let aimY = 0;
      let dist = this.range;

      if (context) {
        const aim = this.firingDirection(context);
        aimX = aim.x;
        aimY = aim.y;
        const cursorX = context.cursorWorld?.x ?? origin.x + aimX * this.range;
        const cursorY = context.cursorWorld?.y ?? origin.y + aimY * this.range;
        const span = Math.hypot(cursorX - origin.x, cursorY - origin.y);
        dist = Math.min(Math.max(span, 100), effectiveRange(this.range, this.owner));
      } else {
        const heading = this.owner.direction;
        if (heading && (heading.x !== 0 || heading.y !== 0)) {
          aimX = heading.x;
          aimY = heading.y;
        }
      }

      const headingAngle = Math.atan2(aimY, aimX);
      const target = {
        x: origin.x + Math.cos(headingAngle) * dist,
        y: origin.y + Math.sin(headingAngle) * dist,
      };

      const sweep = new Diana_Q_Sweep(this.owner, origin, target);
      this.game.objectManager.addObject(sweep);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Diana_Q;
}
const __cacheDiana_Q = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_Q>>();
export default function makeDiana_Q(api: ContentApi) {
  const cached = __cacheDiana_Q.get(api);
  if (cached) return cached;
  const built = __buildDiana_Q(api);
  __cacheDiana_Q.set(api, built);
  return built;
}


/**
 * The crescent projectile. Curves from Diana's launch position to the target destination
 * along a quadratic Bézier path, leaving a luminous moonlight trail and detonating at the tip.
 */
function __buildDiana_Q_Sweep(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const Moonlight = makeMoonlight(api);
  const Diana_Q_Cut = makeDiana_Q_Cut(api);
  class Diana_Q_Sweep extends SpellObject {
    age = 0;
    readonly p0: { x: number; y: number };
    readonly p1: { x: number; y: number };
    readonly p2: { x: number; y: number };
    private readonly cut = new Set<AttackableUnit>();
    private motes: { t: number; radial: number; phase: number }[] = [];
    private detonated = false;

    constructor(owner: AttackableUnit, p0: { x: number; y: number }, p2: { x: number; y: number }) {
      super(owner);
      this.p0 = p0;
      this.p2 = p2;
      this.position = createVector(p0.x, p0.y);

      const dx = p2.x - p0.x;
      const dy = p2.y - p0.y;
      const dist = Math.hypot(dx, dy) || 1;
      // Perpendicular normal pointing outward to the right
      const nx = -dy / dist;
      const ny = dx / dist;
      const midX = (p0.x + p2.x) / 2;
      const midY = (p0.y + p2.y) / 2;
      // Deep semicircular crescent curve
      const bow = dist * 1.0;
      this.p1 = { x: midX + nx * bow, y: midY + ny * bow };
    }

    pointAt(t: number): { x: number; y: number } {
      const k = constrain(t, 0, 1);
      const u = 1 - k;
      return {
        x: u * u * this.p0.x + 2 * u * k * this.p1.x + k * k * this.p2.x,
        y: u * u * this.p0.y + 2 * u * k * this.p1.y + k * k * this.p2.y,
      };
    }

    tangentAt(t: number): number {
      const k = constrain(t, 0, 1);
      const u = 1 - k;
      const dx = 2 * u * (this.p1.x - this.p0.x) + 2 * k * (this.p2.x - this.p1.x);
      const dy = 2 * u * (this.p1.y - this.p0.y) + 2 * k * (this.p2.y - this.p1.y);
      return Math.atan2(dy, dx);
    }

    onAdded(): void {
      for (let i = 0; i < 18; i++) {
        this.motes.push({
          t: random(0.05, 0.95),
          radial: random(-Q_BAND * 0.4, Q_BAND * 0.4),
          phase: random(0, TWO_PI),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      const progress = Math.min(this.age / Q_SWEEP_MS, 1);
      this.applyCuts(progress);

      if (progress >= 1 && !this.detonated) {
        this.detonated = true;
        this.detonate();
      }

      if (this.age >= Q_SWEEP_MS + Q_FADE_MS) this.toRemove = true;
    }

    private applyCuts(progress: number): void {
      if (progress <= 0) return;

      const sampleCount = Math.max(4, Math.floor(progress * 24));
      const sampledPoints: { x: number; y: number }[] = [];
      for (let i = 0; i <= sampleCount; i++) {
        sampledPoints.push(this.pointAt((i / sampleCount) * progress));
      }

      const currentHead = sampledPoints[sampledPoints.length - 1];
      this.position.set(currentHead.x, currentHead.y);

      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: currentHead.x,
          y: currentHead.y,
          r: Q_BAND + 80,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of candidates) {
        if (this.cut.has(victim) || victim.isDead || victim.toRemove) continue;

        let minDistance = Number.POSITIVE_INFINITY;
        for (const pt of sampledPoints) {
          const d = Math.hypot(victim.position.x - pt.x, victim.position.y - pt.y);
          if (d < minDistance) minDistance = d;
        }

        if (minDistance <= Q_BAND + (victim.collisionRadius || 20)) {
          this.cut.add(victim);
          victim.takeDamage(Q_DAMAGE, this.owner);
          victim.addBuff(new Moonlight(MOONLIGHT_MS, this.owner, victim));
          this.game.objectManager.addObject(new Diana_Q_Cut(this.owner, victim.position.copy()));
        }
      }
    }

    private detonate(): void {
      this.game.objectManager.addObject(
        new Diana_Q_Cut(this.owner, createVector(this.p2.x, this.p2.y))
      );

      const victims = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.p2.x,
          y: this.p2.y,
          r: Q_CUT_RADIUS + 20,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const victim of victims) {
        if (this.cut.has(victim) || victim.isDead || victim.toRemove) continue;
        this.cut.add(victim);
        victim.takeDamage(Q_DAMAGE, this.owner);
        victim.addBuff(new Moonlight(MOONLIGHT_MS, this.owner, victim));
      }
    }

    draw(): void {
      const progress = Math.min(this.age / Q_SWEEP_MS, 1);
      const tail =
        this.age <= Q_SWEEP_MS ? 1 : constrain(1 - (this.age - Q_SWEEP_MS) / Q_FADE_MS, 0, 1);
      if (tail <= 0) return;

      push();
      noFill();

      // 1. Draw glowing crescent moonlight corridor along the Bézier curve
      const samples = 28;
      const stepCount = Math.max(2, Math.floor(progress * samples));

      // Outer soft lunar aura
      stroke(MOON_CORE[0], MOON_CORE[1], MOON_CORE[2], 90 * tail);
      strokeWeight(14);
      beginShape();
      for (let i = 0; i <= stepCount; i++) {
        const pt = this.pointAt((i / samples) * progress);
        vertex(pt.x, pt.y);
      }
      endShape();

      // Inner bright beam
      stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 220 * tail);
      strokeWeight(4.5);
      beginShape();
      for (let i = 0; i <= stepCount; i++) {
        const pt = this.pointAt((i / samples) * progress);
        vertex(pt.x, pt.y);
      }
      endShape();

      // 2. Sparkling motes along the path
      for (const mote of this.motes) {
        if (mote.t > progress) continue;
        const pt = this.pointAt(mote.t);
        const angle = this.tangentAt(mote.t) + HALF_PI;
        const mx = pt.x + Math.cos(angle) * mote.radial;
        const my = pt.y + Math.sin(angle) * mote.radial;
        const twinkle = 0.4 + 0.6 * Math.abs(sin(mote.phase + this.age / 110));
        stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 200 * tail * twinkle);
        strokeWeight(2.5);
        point(mx, my);
      }

      // 3. Leading crescent blade at head
      const headPt = this.pointAt(progress);
      const headAngle = this.tangentAt(progress);
      const bow = 28;

      push();
      translate(headPt.x, headPt.y);
      rotate(headAngle);
      // Outer crescent
      drawCrescent(0, 0, bow, 0, 1.6, 9, MOON_PALE, 250 * tail);
      drawCrescent(0, 0, bow - 6, 0, 1.2, 5, MOON_CORE, 230 * tail);
      // Glowing lunar star core
      fill(255, 255, 255, 240 * tail);
      noStroke();
      circle(0, 0, 8);
      pop();

      pop();
    }

    getDisplayBoundingBox() {
      const minX = Math.min(this.p0.x, this.p1.x, this.p2.x) - Q_BAND - 50;
      const maxX = Math.max(this.p0.x, this.p1.x, this.p2.x) + Q_BAND + 50;
      const minY = Math.min(this.p0.y, this.p1.y, this.p2.y) - Q_BAND - 50;
      const maxY = Math.max(this.p0.y, this.p1.y, this.p2.y) + Q_BAND + 50;
      return new Rectangle({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        data: this,
      });
    }
  }
  return Diana_Q_Sweep;
}
const __cacheDiana_Q_Sweep = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_Q_Sweep>>();
export function makeDiana_Q_Sweep(api: ContentApi) {
  const cached = __cacheDiana_Q_Sweep.get(api);
  if (cached) return cached;
  const built = __buildDiana_Q_Sweep(api);
  __cacheDiana_Q_Sweep.set(api, built);
  return built;
}


/** The cut, on the body that took it. */
function __buildDiana_Q_Cut(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Diana_Q_Cut extends SpellObject {
    lifeTime = 300;
    age = 0;
    private lean = 0;

    constructor(owner: AttackableUnit, at: p5.Vector) {
      super(owner);
      this.position = at;
    }

    onAdded(): void {
      this.lean = random(0, TWO_PI);
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const opened = 1 - (1 - t) * (1 - t);
      push();
      noFill();
      // The hard rim sits on the radius the cut really reached.
      stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 220 * (1 - t));
      strokeWeight(3.5 * (1 - t) + 1);
      circle(this.position.x, this.position.y, 16 + (Q_CUT_RADIUS * 2 - 16) * opened);
      drawCrescent(
        this.position.x,
        this.position.y,
        Q_CUT_RADIUS * 0.62 * opened + 6,
        this.lean,
        2.1,
        7 * (1 - t) + 1,
        MOON_CORE,
        230 * (1 - t)
      );
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((Q_CUT_RADIUS + 30) * 2);
    }
  }
  return Diana_Q_Cut;
}
const __cacheDiana_Q_Cut = new WeakMap<ContentApi, ReturnType<typeof __buildDiana_Q_Cut>>();
export function makeDiana_Q_Cut(api: ContentApi) {
  const cached = __cacheDiana_Q_Cut.get(api);
  if (cached) return cached;
  const built = __buildDiana_Q_Cut(api);
  __cacheDiana_Q_Cut.set(api, built);
  return built;
}