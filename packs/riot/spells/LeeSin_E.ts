import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type LeeSin_E = InstanceType<ReturnType<typeof makeLeeSin_E>>;
type LeeSin_E_Object = InstanceType<ReturnType<typeof makeLeeSin_E_Object>>;



export const RANGE = 150;

export const DAMAGE = 20;

export const SLOW_PERCENT = 0.5;

export const SLOW_DURATION = 2000;

/** How long the shockwave takes to travel from his heel to the rim of the ring. */
export const SHOCKWAVE_DURATION = 260;

/** The dust and the cracks outlive the wave that made them. */
export const AFTERGLOW_DURATION = 640;

/** Clods of dust thrown up by the stomp. */
const DUST_COUNT = 14;

/** How long a ki burst lives at the spot the wave caught somebody. */
const MARK_LIFETIME = 300;


/**
 * Tempest. He stomps, and a ring of ki goes out along the ground.
 *
 * It used to damage and slow the whole circle on the frame of the cast and
 * *then* grow a ring outwards for another 800ms — so a target at the rim was
 * already slowed while the wave that supposedly hit them was still a dot under
 * Lee Sin's foot. The expanding wave now carries the hit: `LeeSin_E_Object`
 * tests its own front every frame and catches each enemy as it reaches them.
 */
function __buildLeeSin_E(api: ContentApi) {
  const Spell = api.Spell;
  const LeeSin_E_Object = makeLeeSin_E_Object(api);
  class LeeSin_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_leesin_e');
    name = 'Địa Chấn / Dư Chấn (LeeSin_E)';
    description =
      `Dẫm mạnh xuống đất, một vòng khí lan ra <span>${RANGE}px</span> gây` +
      ` <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>` +
      ` trong <span class="time">${SLOW_DURATION / 1000} giây</span> <i>khi sóng chạm tới từng kẻ địch</i>`;
    coolDown = 5000;
    manaCost = 30;

    range = RANGE;

    onSpellCast() {
      // No query here on purpose: the wave is the ability, and it does its own
      // hitting as it expands.
      const wave = new LeeSin_E_Object(this.owner);
      wave.range = this.range;
      wave.slowImage = this.image;
      this.game.objectManager.addObject(wave);
    }
  }
  return LeeSin_E;
}
const __cacheLeeSin_E = new WeakMap<ContentApi, ReturnType<typeof __buildLeeSin_E>>();
export default function makeLeeSin_E(api: ContentApi) {
  const cached = __cacheLeeSin_E.get(api);
  if (cached) return cached;
  const built = __buildLeeSin_E(api);
  __cacheLeeSin_E.set(api, built);
  return built;
}


interface KiMark {
  x: number;
  y: number;
  age: number;
}


interface Clod {
  angle: number;
  reach: number;
  size: number;
  hop: number;
}


function __buildLeeSin_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const ParticleSystem = api.helpers.ParticleSystem;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class LeeSin_E_Object extends SpellObject {
    position = this.owner.position.copy();
    range = RANGE;
    lifeTime = AFTERGLOW_DURATION;
    age = 0;
    /** The buff icon the spell hands down, so the slow shows Tempest's own art. */
    slowImage: Spell['image'] | null = null;

    /** Hit already — the wave passes each body once, however wide it gets. */
    _struck: AttackableUnit[] = [];
    /** Where the wave caught somebody, for the burst drawn at that spot. */
    _marks: KiMark[] = [];
    _clods: Clod[] = [];

    particleSystem: ParticleSystem = PredefinedParticleSystems.smoke([214, 168, 92], 0.45, 4);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // Seeded here rather than in the constructor: an empty system added to the
      // manager removes itself on its very first update.
      for (let i = 0; i < DUST_COUNT; i++) {
        const a = random(TWO_PI);
        const r = random(0, this.range * 0.35);
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * r,
          y: this.position.y + sin(a) * r * 0.6,
          size: random(12, 26),
          opacity: random(70, 130),
        });
      }

      for (let i = 0; i < DUST_COUNT; i++) {
        this._clods.push({
          angle: (TWO_PI * i) / DUST_COUNT + random(-0.2, 0.2),
          reach: random(0.7, 1.05),
          size: random(6, 13),
          hop: random(6, 18),
        });
      }
    }

    /**
     * The radius of the ki front. Eased out — the stomp is a shove, hard at the
     * start and dying at the rim — and read by both `_expand()` and `draw()`, so
     * the ring the player sees is the ring that hits.
     */
    get front(): number {
      const t = Math.min(1, this.age / SHOCKWAVE_DURATION);
      return this.range * (1 - (1 - t) * (1 - t));
    }

    update() {
      this.age += deltaTime;
      // Only while the wave is still travelling: once it has spent itself on the
      // rim it is a scorch mark, not a hitbox.
      if (this.age <= SHOCKWAVE_DURATION) this._expand();
      for (const mark of this._marks) mark.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    _expand() {
      const front = this.front;
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.range }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      for (const enemy of enemies) {
        if (this._struck.includes(enemy)) continue;

        const body = enemy.collisionRadius ?? 0;
        const distance = this.position.dist(enemy.position);
        if (distance - body > front) continue; // the front is still inside them

        this._struck.push(enemy);
        const slow = new Slow(SLOW_DURATION, this.owner, enemy);
        if (this.slowImage) slow.image = this.slowImage;
        slow.percent = SLOW_PERCENT;
        slow.buffAddType = BuffAddType.RENEW_EXISTING;
        enemy.addBuff(slow);
        enemy.takeDamage(DAMAGE, this.owner);

        this._marks.push({ x: enemy.position.x, y: enemy.position.y, age: 0 });
      }
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const wave = constrain(this.age / SHOCKWAVE_DURATION, 0, 1);
      const fade = 1 - t;
      const live = 1 - wave;
      const front = this.front;

      push();
      translate(this.position.x, this.position.y);

      // The ground he cracked, staying put after the wave has gone: the ability's
      // range should be learnable from the mark it leaves.
      noStroke();
      fill(226, 168, 60, 34 * fade);
      circle(0, 0, this.range * 2);

      // Ki racing outward. Amber-gold and low to the ground, so the ring reads as
      // force travelling through dirt rather than a bubble of light.
      noFill();
      stroke(255, 214, 120, 240 * live + 60 * fade);
      strokeWeight(9 * live + 2);
      circle(0, 0, front * 2);
      stroke(255, 248, 214, 250 * live);
      strokeWeight(3 * live + 1);
      circle(0, 0, front * 2);
      // one echo lagging behind the front, so the wave has thickness
      const echo = front - this.range * 0.16;
      if (echo > 0) {
        stroke(230, 160, 50, 150 * live * fade);
        strokeWeight(5 * live + 1);
        circle(0, 0, echo * 2);
      }

      // Cracks opening under the front, kinked rather than straight.
      stroke(150, 96, 30, 190 * fade);
      strokeWeight(2.5 * fade + 1);
      for (let i = 0; i < 8; i++) {
        const a = (TWO_PI * i) / 8 + 0.2;
        const inner = front * 0.55;
        const outer = front * (0.95 + 0.1 * Math.sin(i * 2.7));
        const kink = a + 0.16 * Math.sin(i * 1.9);
        line(cos(a) * inner, sin(a) * inner, cos(kink) * outer, sin(kink) * outer);
      }

      // Clods of earth kicked up by the heel and dropping back — the parabola is
      // what separates dirt thrown up from light spreading out.
      noStroke();
      for (const clod of this._clods) {
        const d = front * clod.reach;
        const lift = sin(constrain(wave, 0, 1) * PI) * clod.hop;
        fill(198, 148, 78, 225 * fade);
        ellipse(
          cos(clod.angle) * d,
          sin(clod.angle) * d * 0.75 - lift,
          clod.size * (1 - wave * 0.4),
          clod.size * 0.7 * (1 - wave * 0.4)
        );
      }

      // The stomp itself: a hard flash under his heel on the first frames.
      const stomp = 1 - constrain(this.age / 120, 0, 1);
      if (stomp > 0) {
        blendMode(ADD);
        fill(255, 236, 180, 220 * stomp);
        circle(0, 0, 46 * stomp + 14);
        blendMode(BLEND);
      }
      pop();

      // Where the wave actually landed: a ki burst at the body it caught, drawn in
      // world space so it stays with the ground rather than the ring.
      push();
      for (const mark of this._marks) {
        const m = constrain(mark.age / MARK_LIFETIME, 0, 1);
        if (m >= 1) continue;
        const out = 1 - m;
        noFill();
        stroke(255, 226, 150, 240 * out);
        strokeWeight(4 * out + 1);
        circle(mark.x, mark.y, 24 + 44 * m);
        stroke(255, 250, 220, 200 * out);
        strokeWeight(2);
        for (let i = 0; i < 4; i++) {
          const a = (TWO_PI * i) / 4 + PI / 4;
          const inner = 10 + 16 * m;
          line(
            mark.x + cos(a) * inner,
            mark.y + sin(a) * inner,
            mark.x + cos(a) * (inner + 16 * out),
            mark.y + sin(a) * (inner + 16 * out)
          );
        }
      }
      pop();
    }

    /**
     * Sized from `range`, never from a value the draw pass computes. The old box
     * measured a `size` field that only grew inside `draw()`, so on the frame the
     * effect was created it reported a zero-area box and could be culled before it
     * had ever drawn anything.
     */
    getDisplayBoundingBox() {
      const span = this.range + 60;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return LeeSin_E_Object;
}
const __cacheLeeSin_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildLeeSin_E_Object>>();
export function makeLeeSin_E_Object(api: ContentApi) {
  const cached = __cacheLeeSin_E_Object.get(api);
  if (cached) return cached;
  const built = __buildLeeSin_E_Object(api);
  __cacheLeeSin_E_Object.set(api, built);
  return built;
}