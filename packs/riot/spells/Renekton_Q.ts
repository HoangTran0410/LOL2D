import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { isEnraged } from './Renekton_R';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Renekton_Q = InstanceType<ReturnType<typeof makeRenekton_Q>>;
type Renekton_Q_Object = InstanceType<ReturnType<typeof makeRenekton_Q_Object>>;



/** The rear-swing before the blade comes round. Short — Q is his rhythm key. */
export const CAST_TIME_MS = 180;

export const RADIUS = 190;

export const ENRAGED_RADIUS = 235;

export const DAMAGE = 22;

export const ENRAGED_DAMAGE = 32;

export const HEAL_PER_UNIT = 3;

export const HEAL_PER_CHAMPION = 8;

export const HEAL_CAP = 15;

/** Reign of Anger doubles what each body is worth and more than doubles the cap. */
export const ENRAGED_HEAL_MULTIPLIER = 2;

export const ENRAGED_HEAL_CAP = 34;


/**
 * Cull the Meek: a cleave that pays him back for every body it touches.
 *
 * The healing, not the damage, is the ability — it is what lets him stand in a
 * wave and win a fight he should have lost. So the cap matters more than the
 * per-hit number, and both are stated on the spell rather than buried in the
 * sweep object.
 */
function __buildRenekton_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Champion = api.units.Champion;
  const AttackableUnit = api.units.AttackableUnit;
  const Renekton_Q_Object = makeRenekton_Q_Object(api);
  class Renekton_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_renekton_q');
    name = 'Vũ Điệu Cá Sấu (Renekton_Q)';
    description =
      `Chém một vòng quanh mình trong <span>${RADIUS}px</span> gây` +
      ` <span class="damage">${DAMAGE} sát thương</span>, <span class="buff">hồi ${HEAL_PER_UNIT} máu</span>` +
      ` mỗi mục tiêu và <span class="buff">${HEAL_PER_CHAMPION} máu</span> mỗi tướng trúng chiêu` +
      ` (tối đa ${HEAL_CAP}).` +
      ` <span class="buff">Cuồng Nộ</span>: <span>${ENRAGED_RADIUS}px</span>,` +
      ` <span class="damage">${ENRAGED_DAMAGE} sát thương</span>, hồi máu nhân đôi (tối đa ${ENRAGED_HEAL_CAP})`;
    coolDown = 5_000;
    manaCost = 25;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'SELF',
        castTimeMs: CAST_TIME_MS,
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    /** The reach of this cast, which Reign of Anger widens. */
    get radius(): number {
      return isEnraged(this.owner) ? ENRAGED_RADIUS : RADIUS;
    }

    onSpellCast(_context: CastContext): void {
      const enraged = isEnraged(this.owner);
      const radius = enraged ? ENRAGED_RADIUS : RADIUS;
      const damage = enraged ? ENRAGED_DAMAGE : DAMAGE;
      const multiplier = enraged ? ENRAGED_HEAL_MULTIPLIER : 1;
      const cap = enraged ? ENRAGED_HEAL_CAP : HEAL_CAP;

      const victims = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.owner.position.x, y: this.owner.position.y, r: radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      let owed = 0;
      for (const victim of victims) {
        victim.takeDamage(damage, this.owner);
        owed += (victim instanceof Champion ? HEAL_PER_CHAMPION : HEAL_PER_UNIT) * multiplier;
      }

      const healed = Math.min(cap, owed);
      if (healed > 0) this.owner.takeHeal(healed, this.owner);

      const sweep = new Renekton_Q_Object(this.owner);
      sweep.radius = radius;
      sweep.enraged = enraged;
      sweep.healed = healed;
      this.game.objectManager.addObject(sweep);
    }

    drawPreview() {
      super.drawPreview(this.radius);
    }
  }
  return Renekton_Q;
}
const __cacheRenekton_Q = new WeakMap<ContentApi, ReturnType<typeof __buildRenekton_Q>>();
export default function makeRenekton_Q(api: ContentApi) {
  const cached = __cacheRenekton_Q.get(api);
  if (cached) return cached;
  const built = __buildRenekton_Q(api);
  __cacheRenekton_Q.set(api, built);
  return built;
}


export const SWEEP_LIFETIME_MS = 340;

/** Chunks of ground torn up by the blade dragging through it. */
const DEBRIS_COUNT = 12;


/**
 * One enormous curved blade dragged through a full circle at ground level.
 *
 * Distinct from Garen's spinning sword (a thin blade going round several times)
 * and from Darius's axe (a band between two radii): this is a single thick
 * crescent, widest at the leading edge, that scrapes the floor and throws it up.
 */
function __buildRenekton_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Renekton_Q_Object extends SpellObject {
    radius = RADIUS;
    enraged = false;
    healed = 0;
    age = 0;

    debris: { angle: number; distance: number; size: number; rise: number }[] = [];

    onAdded(): void {
      for (let i = 0; i < DEBRIS_COUNT; i++) {
        this.debris.push({
          angle: random(0, TWO_PI),
          distance: random(this.radius * 0.45, this.radius),
          size: random(4, 12),
          rise: random(10, 34),
        });
      }
    }

    update(): void {
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
      if (this.age >= SWEEP_LIFETIME_MS) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / SWEEP_LIFETIME_MS, 0, 1);
      // snap-out: the blade is round most of the circle in the first third
      const out = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      const [r, g, b] = this.enraged ? [255, 120, 60] : [200, 45, 45];

      push();
      translate(this.owner.position.x, this.owner.position.y);

      // scraped ground
      noStroke();
      fill(r, g, b, 46 * fade);
      circle(0, 0, this.radius * 2);

      // hard rim on the real hit radius
      noFill();
      stroke(r, g, b, 210 * fade);
      strokeWeight(3);
      circle(0, 0, this.radius * 2);

      // the crescent: a thick wedge that has already passed, tapering behind the
      // leading edge, so the direction of travel is unmistakable
      const lead = -HALF_PI + TWO_PI * out;
      noStroke();
      for (let i = 0; i < 7; i++) {
        const back = lead - i * 0.34;
        fill(255, 230 - i * 18, 200 - i * 22, (180 - i * 22) * fade);
        arc(
          0,
          0,
          this.radius * (1.96 - i * 0.045),
          this.radius * (1.96 - i * 0.045),
          back - 0.3,
          back,
          PIE
        );
      }

      // the blade itself, held out at the leading edge
      push();
      rotate(lead);
      stroke(150, 120, 90, 230 * fade);
      strokeWeight(6);
      line(this.radius * 0.2, 0, this.radius * 0.5, 0);
      noStroke();
      fill(240, 246, 252, 240 * fade);
      beginShape();
      vertex(this.radius * 0.5, -6);
      vertex(this.radius * 0.99, -22);
      vertex(this.radius * 1.0, 4);
      vertex(this.radius * 0.5, 8);
      endShape(CLOSE);
      fill(r, g, b, 200 * fade);
      beginShape();
      vertex(this.radius * 0.55, -3);
      vertex(this.radius * 0.9, -14);
      vertex(this.radius * 0.9, 1);
      vertex(this.radius * 0.55, 4);
      endShape(CLOSE);
      pop();

      // ground thrown up behind the drag
      noStroke();
      for (const chunk of this.debris) {
        fill(110, 78, 58, 220 * fade);
        circle(
          cos(chunk.angle) * chunk.distance,
          sin(chunk.angle) * chunk.distance - chunk.rise * out,
          chunk.size * fade + 1
        );
      }

      // what he took back, drawn as blood running inward to him
      if (this.healed <= 0) {
        pop();
        return;
      }
      stroke(120, 235, 140, 190 * fade);
      strokeWeight(3);
      noFill();
      circle(0, 0, this.radius * 2 * (1 - out) + 18);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius + 50;
      return new Rectangle({
        x: this.owner.position.x - r,
        y: this.owner.position.y - r,
        w: r * 2,
        h: r * 2,
        data: this,
      });
    }
  }
  return Renekton_Q_Object;
}
const __cacheRenekton_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildRenekton_Q_Object>>();
export function makeRenekton_Q_Object(api: ContentApi) {
  const cached = __cacheRenekton_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildRenekton_Q_Object(api);
  __cacheRenekton_Q_Object.set(api, built);
  return built;
}