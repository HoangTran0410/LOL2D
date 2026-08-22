import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Singed_E = InstanceType<ReturnType<typeof makeSinged_E>>;
type Singed_E_Impact = InstanceType<ReturnType<typeof makeSinged_E_Impact>>;



export const RANGE = 160;

export const DAMAGE = 28;

/** How far behind Singed the victim lands, measured from his own feet. */
export const THROW_DISTANCE = 150;

export const THROW_SPEED = 14;

export const AIRBORNE_DURATION = 700;

export const SLOW_DURATION = 1500;

export const SLOW_PERCENT = 0.4;

export const IMPACT_LIFETIME = 560;

/** Gouts of chemical thrown clear when the body lands in the mess. */
const SPLAT_COUNT = 14;

/** Fume puffs boiling off the spill. */
const FUME_COUNT = 12;


function __buildSinged_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Slow = api.buffs.Slow;
  const Singed_E_Impact = makeSinged_E_Impact(api);
  class Singed_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_singed_e');
    name = 'Hất (Singed_E)';
    description =
      `Túm kẻ địch gần nhất trong <span>${RANGE}px</span> và quăng qua đầu mình,` +
      ` <span class="buff">Hất Tung</span> chúng và đáp xuống <span>${THROW_DISTANCE}px</span> phía sau lưng Singed.` +
      ` <i>Khi tiếp đất</i>: <span class="damage">${DAMAGE} sát thương</span> và` +
      ` <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>`;
    coolDown = 9000;
    manaCost = 25;

    range = RANGE;

    checkCastCondition() {
      return !!this._findTarget();
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      // The knock-up is the flight itself, so it starts at the grab. The damage
      // does not: a fling that hurts before the victim has left the ground reads
      // as an invisible punch, and the whole point of Fling is the landing.
      target.addBuff(new Airborne(AIRBORNE_DURATION, this.owner, target));

      // Over the shoulder, not away. The victim's current side of Singed is
      // `owner -> target`; a fling puts them on the *opposite* side, measured
      // from Singed's feet rather than from theirs — pushing along that vector
      // (what this used to do) is a shove, and leaves them exactly where they
      // were relative to him, only further out.
      const heading = target.position.copy().sub(this.owner.position);
      if (heading.magSq() === 0) heading.set(1, 0);
      const landing = this.owner.position.copy().sub(heading.copy().setMag(THROW_DISTANCE));

      // A Dash rather than a teleport: the body travels, walls and the arc are
      // the engine's problem, and the arriving flight is what sells the throw.
      // `cancelable = false` because the Airborne above is Singed's own and must
      // not abort his own displacement (see DASH_INTERRUPT_BUFFS).
      const throwDash = new Dash(1500, this.owner, target);
      throwDash.dashDestination = landing;
      throwDash.dashSpeed = THROW_SPEED;
      throwDash.cancelable = false;
      throwDash.stayAtDestination = true;

      // Wired before `addBuff`: a dash can be deactivated inside that call, and a
      // listener attached afterwards would miss the only landing there will be.
      let landed = false;
      const land = () => {
        if (landed) return;
        landed = true;
        this._impact(target);
      };
      throwDash.onReachedDestination = land;
      throwDash.addDeactivateListener(land);

      target.addBuff(throwDash);
    }

    /** The victim hits the ground, in Singed's own spill. Everything lands here. */
    _impact(target: AttackableUnit) {
      const splat = new Singed_E_Impact(this.owner);
      splat.position = target.position.copy();
      this.game.objectManager.addObject(splat);

      if (target.isDead || target.toRemove) return;

      target.takeDamage(DAMAGE, this.owner);
      const slow = new Slow(SLOW_DURATION, this.owner, target);
      slow.percent = SLOW_PERCENT;
      target.addBuff(slow);
    }

    _findTarget(): AttackableUnit | null {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      let nearest: AttackableUnit | null = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = this.owner.position.dist(enemy.position);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = enemy;
        }
      }
      return nearest;
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Singed_E;
}
const __cacheSinged_E = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_E>>();
export default function makeSinged_E(api: ContentApi) {
  const cached = __cacheSinged_E.get(api);
  if (cached) return cached;
  const built = __buildSinged_E(api);
  __cacheSinged_E.set(api, built);
  return built;
}


interface Gout {
  angle: number;
  reach: number;
  size: number;
  hop: number;
}


/**
 * The landing: a body driven into the dirt inside a burst of Singed's own
 * chemistry. Toxic green throughout, and built round the *impact* — a crater
 * ring and grit first, the spill second — so it never reads as another pool of
 * Cassiopeia's venom.
 */
function __buildSinged_E_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const ParticleSystem = api.helpers.ParticleSystem;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Singed_E_Impact extends SpellObject {
    position = this.owner.position.copy();
    radius = 80;
    lifeTime = IMPACT_LIFETIME;
    age = 0;

    _gouts: Gout[] = [];
    particleSystem: ParticleSystem = PredefinedParticleSystems.smoke([132, 214, 88], 0.55, 3);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // Seeded on the way in: an empty particle system handed to the manager
      // removes itself on its first update, before anything could be added.
      for (let i = 0; i < FUME_COUNT; i++) {
        const a = random(TWO_PI);
        const r = random(0, this.radius * 0.6);
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * r,
          y: this.position.y + sin(a) * r * 0.6,
          size: random(14, 30),
          opacity: random(60, 120),
        });
      }

      for (let i = 0; i < SPLAT_COUNT; i++) {
        this._gouts.push({
          angle: (TWO_PI * i) / SPLAT_COUNT + random(-0.25, 0.25),
          reach: random(0.6, 1.1),
          size: random(7, 16),
          hop: random(8, 22),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // The body hits in the first fifth. Everything after that is the spill
      // spreading and the fumes coming off it.
      const slam = constrain(t / 0.2, 0, 1);
      const flash = 1 - slam;

      push();
      translate(this.position.x, this.position.y);

      // the spill: an uneven, low puddle, wider across than deep because it is
      // lying on the ground
      noStroke();
      fill(96, 168, 62, 120 * fade);
      beginShape();
      const lobes = 16;
      for (let i = 0; i < lobes; i++) {
        const a = (TWO_PI * i) / lobes;
        const wobble = 1 + 0.2 * Math.sin(i * 1.7) + 0.1 * Math.sin(i * 3.9);
        const rr = this.radius * (0.35 + 0.55 * slam) * wobble;
        vertex(cos(a) * rr, sin(a) * rr * 0.7);
      }
      endShape(CLOSE);

      // dirt ring punched out by the body — flattened, because a person landing
      // drives force sideways along the floor
      noFill();
      stroke(72, 132, 46, 210 * fade);
      strokeWeight(7 * fade + 2);
      ellipse(0, 0, this.radius * 2 * (0.25 + slam), this.radius * 1.35 * (0.25 + slam));
      stroke(186, 250, 132, 235 * fade * (1 - slam * 0.5));
      strokeWeight(3 * fade + 1);
      ellipse(0, 0, this.radius * 2 * (0.15 + 0.9 * slam), this.radius * 1.35 * (0.15 + 0.9 * slam));

      // gouts of chemical thrown clear on a parabola, falling back into the spill
      noStroke();
      for (const gout of this._gouts) {
        const d = this.radius * gout.reach * (0.2 + slam);
        const lift = sin(constrain(slam, 0, 1) * PI) * gout.hop;
        fill(158, 240, 104, 240 * fade);
        circle(cos(gout.angle) * d, sin(gout.angle) * d * 0.75 - lift, gout.size * (1 - t * 0.5));
      }

      // bubbles surfacing and popping: this is a reagent, not water
      for (let i = 0; i < 7; i++) {
        const a = i * 2.4;
        const d = this.radius * 0.55 * Math.abs(Math.sin(a)) * (0.4 + slam);
        const phase = (t * 2.4 + i / 7) % 1;
        fill(214, 255, 168, 220 * fade * (1 - phase));
        circle(cos(a) * d, sin(a) * d * 0.7, this.radius * 0.12 * (1 - phase) + 3);
      }

      // the moment of contact: a hard pale-green flash, gone in three frames
      if (flash > 0) {
        blendMode(ADD);
        fill(206, 255, 170, 200 * flash);
        circle(0, 0, this.radius * 1.1 * flash + 18);
        blendMode(BLEND);
        noFill();
        stroke(226, 255, 200, 230 * flash);
        strokeWeight(4);
        ellipse(0, 0, this.radius * 2.1 * (1 - flash) + 20, this.radius * 1.4 * (1 - flash) + 14);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const span = this.radius * 1.8;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Singed_E_Impact;
}
const __cacheSinged_E_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_E_Impact>>();
export function makeSinged_E_Impact(api: ContentApi) {
  const cached = __cacheSinged_E_Impact.get(api);
  if (cached) return cached;
  const built = __buildSinged_E_Impact(api);
  __cacheSinged_E_Impact.set(api, built);
  return built;
}