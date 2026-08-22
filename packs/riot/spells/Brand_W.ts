import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { makeApplyAblaze } from './Brand_Q';
import { isAblaze } from './Brand_Q';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Brand_W = InstanceType<ReturnType<typeof makeBrand_W>>;
type Brand_W_Object = InstanceType<ReturnType<typeof makeBrand_W_Object>>;



/**
 * Pillar of Flame. The delay is the ability: a ring cracks open on the ground,
 * everyone standing in it has just over half a second to leave, and then the
 * column comes up. Nothing is dealt until the eruption — the telegraph is
 * telegraph only.
 */
export const COOLDOWN_MS = 8_000;

export const MANA_COST = 35;

export const CAST_RANGE = 450;

export const RADIUS = 110;

/** The window to walk out. Shorter and the ability stops being dodgeable. */
export const ERUPT_DELAY_MS = 620;

export const DAMAGE = 28;

/** Blaze bonus: a burning target takes a quarter again. */
export const ABLAZE_DAMAGE_BONUS = 0.25;


function __buildBrand_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Brand_W_Object = makeBrand_W_Object(api);
  class Brand_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_brand_w');
    name = 'Cột Lửa (Brand_W)';
    description = `Sau <span class="time">${ERUPT_DELAY_MS / 1000} giây</span>, một cột lửa phun lên tại vị trí chỉ định, gây <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Thiêu Đốt</span> mọi kẻ địch trong vùng. Mục tiêu <span class="buff">đã bị Thiêu Đốt</span> nhận <span class="damage">${Math.round(DAMAGE * (1 + ABLAZE_DAMAGE_BONUS))} sát thương</span>.`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    castRange = CAST_RANGE;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.castRange
      );

      const pillar = new Brand_W_Object(this.owner);
      pillar.position = to;
      this.game.objectManager.addObject(pillar);
    }

    drawPreview() {
      super.drawPreview(this.castRange);
    }
  }
  return Brand_W;
}
const __cacheBrand_W = new WeakMap<ContentApi, ReturnType<typeof __buildBrand_W>>();
export default function makeBrand_W(api: ContentApi) {
  const cached = __cacheBrand_W.get(api);
  if (cached) return cached;
  const built = __buildBrand_W(api);
  __cacheBrand_W.set(api, built);
  return built;
}


interface Jet {
  angle: number;
  distance: number;
  height: number;
  width: number;
  phase: number;
  delay: number;
}


const JET_COUNT = 15;


function __buildBrand_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const applyAblaze = makeApplyAblaze(api);
  class Brand_W_Object extends SpellObject {
    image = api.asset('spell_brand_w');
    position: p5.Vector = this.owner.position.copy();

    radius = RADIUS;
    delay = ERUPT_DELAY_MS;
    eruptTime = 520;
    age = 0;

    hasErupted = false;

    _jets: Jet[] = [];
    /** Where the ground splits, seeded once so the cracks do not crawl. */
    _cracks: { angle: number; length: number }[] = [];

    onAdded() {
      for (let i = 0; i < JET_COUNT; i++) {
        this._jets.push({
          angle: (TWO_PI * i) / JET_COUNT + random(-0.2, 0.2),
          distance: random(0, this.radius * 0.85),
          height: random(this.radius * 0.9, this.radius * 1.9),
          width: random(this.radius * 0.28, this.radius * 0.55),
          phase: random(TWO_PI),
          delay: random(0, 0.22),
        });
      }
      for (let i = 0; i < 9; i++) {
        this._cracks.push({
          angle: random(TWO_PI),
          length: random(this.radius * 0.45, this.radius * 0.95),
        });
      }
    }

    update() {
      this.age += deltaTime;

      if (!this.hasErupted && this.age >= this.delay) {
        this.hasErupted = true;
        this._erupt();
      }

      if (this.age >= this.delay + this.eruptTime) this.toRemove = true;
    }

    _erupt() {
      // An area effect hits everyone it overlaps; the vision gate belongs on
      // spells that *pick* a unit, not on a blast that covers ground.
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      for (const enemy of enemies) {
        // read before igniting, or the pillar amplifies off its own burn
        const damage = isAblaze(enemy) ? DAMAGE * (1 + ABLAZE_DAMAGE_BONUS) : DAMAGE;
        enemy.takeDamage(damage, this.owner);
        applyAblaze(this.owner, enemy, this.image);
      }

      // embers thrown by the eruption, so the landing reads off screen edges too
      const embers = PredefinedParticleSystems.smoke([255, 170, 60], 0.4, 8);
      this.useParticles(embers);
      for (let i = 0; i < 22; i++) {
        const angle = random(TWO_PI);
        const distance = random(this.radius);
        embers.addParticle({
          x: this.position.x + cos(angle) * distance,
          y: this.position.y + sin(angle) * distance,
          size: random(10, 22),
          opacity: 230,
        });
      }
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);

      if (!this.hasErupted) {
        const t = constrain(this.age / this.delay, 0, 1);
        // t*t: the glow builds slowly and then rushes, so the last beat is loud
        const heat = t * t;

        // scorched ground, brightening as the pressure builds
        noStroke();
        fill(60, 18, 8, 120 + 90 * heat);
        circle(0, 0, this.radius * 2);

        // cracks opening, lit from underneath
        stroke(255, 120 + 100 * heat, 40, 120 + 130 * heat);
        strokeWeight(2 + 4 * heat);
        for (const crack of this._cracks) {
          const length = crack.length * (0.35 + 0.65 * heat);
          line(0, 0, cos(crack.angle) * length, sin(crack.angle) * length);
        }

        // hard rim on the exact damage radius — this is what has to be dodged
        noFill();
        stroke(30, 10, 5, 220);
        strokeWeight(7);
        circle(0, 0, this.radius * 2);
        stroke(255, 150, 50, 230);
        strokeWeight(2 + 2 * heat);
        circle(0, 0, this.radius * 2);

        // a closing ring: how long is left, read at a glance
        stroke(255, 235, 190, 235);
        strokeWeight(4);
        circle(0, 0, this.radius * 2 * (1 - heat * 0.85) + 6);

        pop();
        return;
      }

      const t = constrain((this.age - this.delay) / this.eruptTime, 0, 1);
      // 1-(1-t)^2: the column leaps up, then sinks back
      const out = 1 - (1 - t) * (1 - t);
      const alpha = 255 * (1 - t * t);

      noStroke();

      // the base of the fire, sitting on the damage radius
      fill(255, 110, 25, alpha * 0.35);
      circle(0, 0, this.radius * 2);
      fill(255, 205, 90, alpha * 0.3);
      circle(0, 0, this.radius * 1.35);

      // the column: jets of different heights, rising and tapering
      for (const jet of this._jets) {
        const u = constrain((t - jet.delay) / (1 - jet.delay), 0, 1);
        if (u <= 0) continue;
        const rise = jet.height * (1 - (1 - u) * (1 - u));
        const sway = sin(this.age / 110 + jet.phase) * jet.width * 0.2;
        const x = cos(jet.angle) * jet.distance;
        const base = sin(jet.angle) * jet.distance * 0.45;

        // outer ember body
        fill(200, 45, 12, alpha * 0.55 * (1 - u * 0.5));
        ellipse(x + sway * 0.5, base - rise * 0.5, jet.width * 1.05, rise);
        // hot middle
        fill(255, 140, 35, alpha * 0.65 * (1 - u * 0.55));
        ellipse(x + sway * 0.7, base - rise * 0.45, jet.width * 0.62, rise * 0.85);
        // white tip, only near the top of the leap
        fill(255, 240, 195, alpha * 0.7 * (1 - u));
        ellipse(x + sway, base - rise * 0.75, jet.width * 0.3, rise * 0.35);
      }

      // shockwave ring, gone in the first fifth of the eruption
      if (t < 0.2) {
        const flash = 1 - t / 0.2;
        noFill();
        stroke(255, 245, 215, 235 * flash);
        strokeWeight(6 * flash + 1);
        circle(0, 0, this.radius * 2 * (1 + out * 0.35));
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the jets rise roughly two radii above the ring they stand on
      const r = this.radius * 2.2 + 40;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Brand_W_Object;
}
const __cacheBrand_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildBrand_W_Object>>();
export function makeBrand_W_Object(api: ContentApi) {
  const cached = __cacheBrand_W_Object.get(api);
  if (cached) return cached;
  const built = __buildBrand_W_Object(api);
  __cacheBrand_W_Object.set(api, built);
  return built;
}