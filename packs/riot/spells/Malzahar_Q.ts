import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Silence = InstanceType<ContentApi['buffs']['Silence']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Malzahar_Q = InstanceType<ReturnType<typeof makeMalzahar_Q>>;
type Malzahar_Q_Object = InstanceType<ReturnType<typeof makeMalzahar_Q_Object>>;



// Exported so the suite asserts the rift's wiring rather than a copy of the
// numbers — retuning a value must not mean editing a test.
export const CAST_RANGE = 520;

/** How far apart the two portals open, measured across the cast direction. */
export const PORTAL_GAP = 240;

/** Half-width of the band between them: the actual hitbox. */
export const BAND_HALF_WIDTH = 46;

/** The tell. Long enough to walk out of, short enough to be worth aiming. */
export const DELAY_MS = 450;

export const DAMAGE = 26;

export const SILENCE_MS = 1_400;

/** How long the collapse is painted after the damage lands. */
export const COLLAPSE_MS = 300;

export const COOLDOWN_MS = 6_000;

export const MANA_COST = 60;


const VOID_DEEP: [number, number, number] = [42, 10, 66];

const VOID: [number, number, number] = [138, 62, 214];

const VOID_BRIGHT: [number, number, number] = [206, 255, 140];


/**
 * Tiếng Gọi Hư Không. Two portals open on either side of the aimed point, and
 * what stands between them is silenced.
 *
 * `POINT` targeting rather than `DIRECTION`: the ability is a placed shape, and
 * a thumb drag has to be able to choose both where and how far.
 */
function __buildMalzahar_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Malzahar_Q_Object = makeMalzahar_Q_Object(api);
  class Malzahar_Q extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_malzahar_q');
    name = 'Tiếng Gọi Hư Không (Malzahar_Q)';
    description =
      `Mở hai cánh cổng Hư Không cách nhau <span>${PORTAL_GAP}px</span>. Sau` +
      ` <span class="time">${DELAY_MS / 1000} giây</span>, kẻ địch đứng giữa hai cổng nhận` +
      ` <span class="damage">${DAMAGE} sát thương</span> và bị <span class="buff">Câm Lặng</span>` +
      ` trong <span class="time">${SILENCE_MS / 1000} giây</span>`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = CAST_RANGE;

    onSpellCast(): void {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        CAST_RANGE
      );

      // The pair opens *across* the line of the cast, so aiming down a lane puts
      // the band across it rather than along it.
      const along = Math.atan2(to.y - this.owner.position.y, to.x - this.owner.position.x);
      const across = along + HALF_PI;

      const rift = new Malzahar_Q_Object(this.owner);
      rift.center.set(to.x, to.y);
      rift.across = across;
      this.game.objectManager.addObject(rift);
    }
  }
  return Malzahar_Q;
}
const __cacheMalzahar_Q = new WeakMap<ContentApi, ReturnType<typeof __buildMalzahar_Q>>();
export default function makeMalzahar_Q(api: ContentApi) {
  const cached = __cacheMalzahar_Q.get(api);
  if (cached) return cached;
  const built = __buildMalzahar_Q(api);
  __cacheMalzahar_Q.set(api, built);
  return built;
}


/**
 * The pair of portals and the band between them.
 *
 * Damage is a single detonation over a hit set, so nothing can be caught twice
 * however the fight moves during the wind-up.
 */
function __buildMalzahar_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Silence = api.buffs.Silence;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const AttackableUnit = api.units.AttackableUnit;
  class Malzahar_Q_Object extends SpellObject {
    center: p5.Vector = createVector();
    /** Heading of the line joining the two portals. */
    across = 0;
    age = 0;
    detonated = false;
    /** Multi-hit protection, even though one detonation cannot repeat today. */
    _hitTargets: AttackableUnit[] = [];

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(160, 90, 230, 0.7)',
      0.5
    );

    onAdded(): void {
      // The burst is emitted 450ms in, long after an auto-removing system would
      // have deleted itself on its first empty frame. See `useParticles`.
      this.useParticles(this.particleSystem);
    }

    /** One portal's centre, `side` being -1 or 1. */
    portal(side: number): { x: number; y: number } {
      return {
        x: this.center.x + (cos(this.across) * (side * PORTAL_GAP)) / 2,
        y: this.center.y + (sin(this.across) * (side * PORTAL_GAP)) / 2,
      };
    }

    update(): void {
      this.age += deltaTime;

      if (!this.detonated && this.age >= DELAY_MS) {
        this.detonated = true;
        this.detonate();
      }
      if (this.age >= DELAY_MS + COLLAPSE_MS) this.toRemove = true;
    }

    detonate(): void {
      // An area effect hits everything it overlaps — no vision filter here, on
      // purpose: the fog gates who a spell may *pick*, never who a blast lands on.
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.center.x,
          y: this.center.y,
          r: PORTAL_GAP / 2 + BAND_HALF_WIDTH,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      const a = this.portal(-1);
      const b = this.portal(1);

      for (const target of candidates) {
        if (this._hitTargets.indexOf(target) !== -1) continue;
        if (this.distanceToBand(target, a, b) > BAND_HALF_WIDTH + target.collisionRadius) continue;

        this._hitTargets.push(target);
        target.takeDamage(DAMAGE, this.owner);
        target.addBuff(new Silence(SILENCE_MS, this.owner, target));
      }

      for (let i = 0; i < 22; i++) {
        const t = random(0, 1);
        this.particleSystem.addParticle({
          x: a.x + (b.x - a.x) * t + random(-BAND_HALF_WIDTH, BAND_HALF_WIDTH),
          y: a.y + (b.y - a.y) * t + random(-BAND_HALF_WIDTH, BAND_HALF_WIDTH),
          r: random(3, 9),
        });
      }
    }

    /** Perpendicular distance from a unit to the segment joining the portals. */
    distanceToBand(
      target: AttackableUnit,
      a: { x: number; y: number },
      b: { x: number; y: number }
    ): number {
      const abx = b.x - a.x;
      const aby = b.y - a.y;
      const lengthSq = abx * abx + aby * aby;
      if (lengthSq === 0) return Math.hypot(target.position.x - a.x, target.position.y - a.y);
      let t = ((target.position.x - a.x) * abx + (target.position.y - a.y) * aby) / lengthSq;
      t = constrain(t, 0, 1);
      return Math.hypot(target.position.x - (a.x + abx * t), target.position.y - (a.y + aby * t));
    }

    draw(): void {
      const opening = constrain(this.age / DELAY_MS, 0, 1);
      const a = this.portal(-1);
      const b = this.portal(1);
      const [dr, dg, db] = VOID_DEEP;
      const [vr, vg, vb] = VOID;
      const [br, bg, bb] = VOID_BRIGHT;

      push();

      // The band, wound in from nothing over the delay: the whole telegraph.
      if (!this.detonated) {
        const wind = opening * opening;
        stroke(vr, vg, vb, 40 + 90 * wind);
        strokeWeight(BAND_HALF_WIDTH * 2 * wind);
        line(a.x, a.y, b.x, b.y);
        stroke(br, bg, bb, 60 + 120 * wind);
        strokeWeight(2);
        line(a.x, a.y, b.x, b.y);
      } else {
        // The collapse: the band snaps shut toward the middle and whites out.
        const t = constrain((this.age - DELAY_MS) / COLLAPSE_MS, 0, 1);
        const fade = 1 - t;
        const shrink = 1 - t;
        stroke(br, bg, bb, 220 * fade);
        strokeWeight(BAND_HALF_WIDTH * 2 * shrink + 2);
        line(
          a.x + (b.x - a.x) * (t * 0.35),
          a.y + (b.y - a.y) * (t * 0.35),
          b.x - (b.x - a.x) * (t * 0.35),
          b.y - (b.y - a.y) * (t * 0.35)
        );
        // the silence itself: a hard rim on the real hit radius
        noFill();
        stroke(vr, vg, vb, 200 * fade);
        strokeWeight(3);
        line(a.x, a.y, b.x, b.y);
      }

      // The two mouths. Rings of void turning against each other so the pair
      // reads as one mechanism rather than two coincidental circles.
      for (const side of [-1, 1]) {
        const portal = this.portal(side);
        const spin = (this.age / 420) * side;
        const grown = this.detonated ? 1 : 1 - (1 - opening) * (1 - opening);
        push();
        translate(portal.x, portal.y);
        rotate(spin);
        noStroke();
        fill(dr, dg, db, 190);
        circle(0, 0, 52 * grown);
        noFill();
        for (let ring = 0; ring < 3; ring++) {
          stroke(vr, vg, vb, 200 - ring * 45);
          strokeWeight(3 - ring * 0.7);
          arc(0, 0, (30 + ring * 14) * grown, (30 + ring * 14) * grown, ring * 1.1, ring * 1.1 + 4.4);
        }
        stroke(br, bg, bb, 230);
        strokeWeight(2);
        circle(0, 0, 14 * grown);
        pop();
      }

      pop();
    }

    getDisplayBoundingBox(): Rectangle {
      // Half the span plus a portal's own radius: the art reaches well past the
      // centre point, and a zero-area box would hide all of it at the screen edge.
      const r = PORTAL_GAP / 2 + BAND_HALF_WIDTH + 60;
      return new Rectangle({
        x: this.center.x - r,
        y: this.center.y - r,
        w: r * 2,
        h: r * 2,
        data: this,
      });
    }
  }
  return Malzahar_Q_Object;
}
const __cacheMalzahar_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMalzahar_Q_Object>>();
export function makeMalzahar_Q_Object(api: ContentApi) {
  const cached = __cacheMalzahar_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildMalzahar_Q_Object(api);
  __cacheMalzahar_Q_Object.set(api, built);
  return built;
}