import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ezreal_W = InstanceType<ReturnType<typeof makeEzreal_W>>;
type Ezreal_W_Burst = InstanceType<ReturnType<typeof makeEzreal_W_Burst>>;
type Ezreal_W_Mark = InstanceType<ReturnType<typeof makeEzreal_W_Mark>>;
type Ezreal_W_Orb = InstanceType<ReturnType<typeof makeEzreal_W_Orb>>;



export const EZREAL_W_RANGE = 640;

export const EZREAL_W_SPEED = 13;

export const EZREAL_W_ORB_SIZE = 34;

/** How long the sigil stays on the victim before it burns out unused. */
export const EZREAL_W_MARK_DURATION_MS = 4000;

/** The whole of W's damage: the orb itself does nothing until it is set off. */
export const EZREAL_W_DETONATE_DAMAGE = 26;

/** Only an *ability* detonation pays this back — a basic attack does not. */
export const EZREAL_W_MANA_REFUND = 30;
// Ezreal_W / essenceFluxSpell / detonateEssenceFlux / Ezreal_W_Orb / Ezreal_W_Mark reference each other as real values both ways —
// see this file's own header comment on the codemod's cycle handling.
function __group0_Ezreal_WBuild(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const EventType = api.enums.EventType;
  const MissileSpellObject = api.MissileSpellObject;
  const Spell = api.Spell;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const Champion = api.units.Champion;
  const TrailSystem = api.helpers.TrailSystem;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const Ezreal_W_Burst = makeEzreal_W_Burst(api);


/**
 * Essence Flux — a mark, not a hit.
 *
 * The orb passes straight through anything that is not a champion and sticks to
 * the first one it finds. Nothing happens on contact; the damage is banked until
 * Ezreal touches that champion again with anything, which is the reason his kit
 * reads as a combo rather than four separate buttons.
 */
  class Ezreal_W extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ezreal_w');
    name = 'Tinh Hoa Tuôn Chảy (Ezreal_W)';
    description =
      'Bắn một quả cầu tinh túy xuyên qua lính, đánh dấu tướng địch đầu tiên trúng phải trong' +
      ` <span class="time">${EZREAL_W_MARK_DURATION_MS / 1000} giây</span>.` +
      ' Đòn đánh hoặc chiêu thức kế tiếp của Ezreal lên mục tiêu đó sẽ kích nổ dấu ấn, gây' +
      ` <span class="damage">${EZREAL_W_DETONATE_DAMAGE} sát thương</span>.` +
      ` Nếu kích nổ bằng chiêu thức, Ezreal hoàn lại <span class="buff">${EZREAL_W_MANA_REFUND} năng lượng</span>.`;

    coolDown = 8000;
    manaCost = 40;

    range = EZREAL_W_RANGE;

    /**
     * The one live sigil. Held here rather than looked up in the quadtree because
     * every other Ezreal spell has to ask "is this the marked target?" at the
     * moment it lands, and a spatial query for an effect glued to a moving body is
     * both slower and wrong the frame the body is culled.
     */
    mark: Ezreal_W_Mark | null = null;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        EZREAL_W_RANGE
      );

      const orb = new Ezreal_W_Orb(this.owner);
      orb.position = from;
      orb.destination = to;
      this.game.objectManager.addObject(orb);
    }

    /** Called by the orb when it finds a champion; replaces any older sigil. */
    applyMark(target: AttackableUnit): Ezreal_W_Mark {
      this.mark?.expire();
      const mark = new Ezreal_W_Mark(this.owner, target);
      this.mark = mark;
      this.game.objectManager.addObject(mark);
      return mark;
    }

    /**
     * Set the sigil off. `byAbility` is the only thing that separates the two
     * triggers: the mana back is what makes weaving W into a Q/E rotation worth
     * the extra button, and a basic attack must not pay it.
     */
    detonate(target: AttackableUnit, byAbility: boolean): boolean {
      const mark = this.mark;
      if (!mark || mark.toRemove || mark.target !== target) return false;

      this.mark = null;
      mark.detonate();
      if (byAbility) this.owner.restoreMana(EZREAL_W_MANA_REFUND);
      return true;
    }
  }


/** The W spell instance on a unit, if it has one. */
  function essenceFluxSpell(unit: AttackableUnit): Ezreal_W | null {
    const spells = (unit as { spells?: Spell[] }).spells;
    if (!spells) return null;
    for (const spell of spells) if (spell instanceof Ezreal_W) return spell;
    return null;
  }


/**
 * "This ability just damaged that unit — set off the mark if it is on them."
 *
 * Ezreal's other three spells call this after they apply their own damage. It
 * is deliberately a plain function rather than an event: `ON_ATTACK_HIT` only
 * ever fires for basic attacks, so a spell hanging its detonation there would
 * be invisible to every ability in the kit.
 */
  function detonateEssenceFlux(
    caster: AttackableUnit,
    target: AttackableUnit,
    byAbility = true
  ): boolean {
    return essenceFluxSpell(caster)?.detonate(target, byAbility) ?? false;
  }


/** The orb: slow, fat, and unmistakably not the Q bolt. */
  class Ezreal_W_Orb extends MissileSpellObject {
    speed = EZREAL_W_SPEED;
    size = EZREAL_W_ORB_SIZE;
    /** Pierces everything; `onHit` decides what actually stops it. */
    maxHitCount = Infinity;

    trailSystem = new TrailSystem({
      trailColor: 'rgba(255, 186, 92, 0.42)',
      trailSize: EZREAL_W_ORB_SIZE * 0.75,
      trailLifeTime: 420,
      maxLength: 22,
    });

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(255, 205, 120, 0.55)',
      0.28
    );

    /** Seeded once: three ribbons that wind around the orb as it travels. */
    _ribbonPhase: number[] = [];
    _spin = 0;

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
      for (let i = 0; i < 3; i++) this._ribbonPhase.push(random(TWO_PI));
    }

    onAfterMove() {
      this._spin += 0.09;
      if (frameCount % 3 === 0) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-10, 10),
          y: this.position.y + random(-10, 10),
          r: random(3, 8),
        });
      }
    }

    onHit(enemy: AttackableUnit) {
      // Minions are scenery to this orb: it is looking for a champion and keeps
      // going until it finds one or runs out of range.
      if (!(enemy instanceof Champion)) return;

      essenceFluxSpell(this.owner)?.applyMark(enemy);
      this.toRemove = true;

      for (let i = 0; i < 12; i++) {
        this.particleSystem.addParticle({
          x: enemy.position.x + random(-18, 18),
          y: enemy.position.y + random(-18, 18),
          r: random(4, 10),
        });
      }
    }

    draw() {
      const s = this.size;

      push();
      translate(this.position.x, this.position.y);

      // a warm halo, so the orb reads as *slower and heavier* than the Q bolt
      noStroke();
      fill(255, 175, 70, 55);
      circle(0, 0, s * 2.1);
      fill(255, 210, 130, 80);
      circle(0, 0, s * 1.35);

      // three ribbons winding around the core; each keeps its own seeded phase so
      // they braid instead of pulsing together
      noFill();
      stroke(255, 232, 175, 210);
      strokeWeight(2);
      for (const phase of this._ribbonPhase) {
        beginShape();
        for (let i = 0; i <= 12; i++) {
          const a = (i / 12) * TWO_PI;
          const wobble = 1 + 0.28 * sin(a * 2 + this._spin * 2 + phase);
          vertex(cos(a) * s * 0.62 * wobble, sin(a) * s * 0.4 * wobble);
        }
        endShape(CLOSE);
      }

      // core
      noStroke();
      fill(255, 190, 90);
      circle(0, 0, s * 0.52);
      fill(255, 250, 225);
      circle(0, 0, s * 0.24);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 1.4;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }


/**
 * The sigil riding the victim.
 *
 * It has to be legible from across the screen and from *both* sides: Ezreal is
 * looking for his combo target, and the victim needs to know a chunk of damage
 * is parked on them. So it is a bright ring of runes rather than a subtle tint,
 * and the ring visibly winds down as the four seconds run out.
 */
  class Ezreal_W_Mark extends SpellObject {
    target: AttackableUnit;
    age = 0;
    lifeTime = EZREAL_W_MARK_DURATION_MS;
    radius = 40;

    private stopWatchingAttacks?: () => void;
    private detonated = false;

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(140, 205, 255, 0.6)',
      0.3
    );

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.target = target;
      this.position = target.position.copy();
      this.attachTo(target);
    }

    onAdded() {
      this.useParticles(this.particleSystem);
      // A basic attack is the other half of the trigger, and `ON_ATTACK_HIT` is
      // the only event that fires for one. The ability half cannot use it —
      // nothing emits this for a spell — so the abilities call
      // `detonateEssenceFlux` directly instead.
      this.stopWatchingAttacks = this.game.eventManager.on(
        EventType.ON_ATTACK_HIT,
        ({ attacker, victim }: BasicAttackHit) => {
          if (attacker !== this.owner || victim !== this.target) return;
          detonateEssenceFlux(this.owner, this.target, false);
        }
      );
    }

    onRemoved() {
      this.stopWatchingAttacks?.();
      this.stopWatchingAttacks = undefined;
      super.onRemoved();
    }

    update() {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.target.position.x, this.target.position.y);
      this.radius = (this.target.animatedValues?.displaySize ?? 40) * 0.85 + 12;

      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.expire();
    }

    /** Burned out unused — no damage, no refund. Idempotent. */
    expire() {
      this.toRemove = true;
    }

    /** Cash the mark in. Idempotent: two triggers can land on the same frame. */
    detonate() {
      if (this.detonated) return;
      this.detonated = true;
      this.toRemove = true;

      this.target.takeDamage(EZREAL_W_DETONATE_DAMAGE, this.owner);

      for (let i = 0; i < 16; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-22, 22),
          y: this.position.y + random(-22, 22),
          r: random(5, 12),
        });
      }
      const burst = new Ezreal_W_Burst(this.owner);
      burst.position = this.position.copy();
      burst.radius = this.radius;
      this.game.objectManager.addObject(burst);
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // the arrival snap: the ring slams shut onto the body in the first 200ms
      const arrive = constrain(this.age / 200, 0, 1);
      const settle = 1 - (1 - arrive) * (1 - arrive);
      const d = this.radius * (2.6 - 1.6 * settle);

      push();
      translate(this.position.x, this.position.y);

      // the outer rune ring, counter-rotating against the inner one so the sigil
      // never looks like a plain spinning circle
      push();
      rotate(-frameCount * 0.018);
      noFill();
      stroke(120, 195, 255, 200 * settle);
      strokeWeight(2.5);
      for (let i = 0; i < 6; i++) {
        const a = (TWO_PI / 6) * i;
        arc(0, 0, d, d, a + 0.1, a + 0.62);
      }
      pop();

      // the countdown: a single arc that unwinds over the mark's whole life, so
      // "how long do I have left" is readable without a timer
      noFill();
      stroke(190, 235, 255, 230 * settle);
      strokeWeight(3);
      arc(0, 0, d * 0.78, d * 0.78, -HALF_PI, -HALF_PI + TWO_PI * (1 - t));

      // the banked damage itself: a small bright glyph pinned to the chest
      push();
      rotate(frameCount * 0.05);
      noStroke();
      fill(215, 245, 255, 230 * settle);
      for (let i = 0; i < 3; i++) {
        const a = (TWO_PI / 3) * i;
        circle(cos(a) * this.radius * 0.28, sin(a) * this.radius * 0.28, 6);
      }
      pop();
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius * 1.6;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return { Ezreal_W, essenceFluxSpell, detonateEssenceFlux, Ezreal_W_Orb, Ezreal_W_Mark };
}
const __group0_Ezreal_WCache = new WeakMap<ContentApi, ReturnType<typeof __group0_Ezreal_WBuild>>();
function __group0_Ezreal_WBuilder(api: ContentApi) {
  const cached = __group0_Ezreal_WCache.get(api);
  if (cached) return cached;
  const built = __group0_Ezreal_WBuild(api);
  __group0_Ezreal_WCache.set(api, built);
  return built;
}
export default function makeEzreal_W(api: ContentApi) {
  return __group0_Ezreal_WBuilder(api).Ezreal_W;
}
export function makeEssenceFluxSpell(api: ContentApi) {
  return __group0_Ezreal_WBuilder(api).essenceFluxSpell;
}
export function makeDetonateEssenceFlux(api: ContentApi) {
  return __group0_Ezreal_WBuilder(api).detonateEssenceFlux;
}
export function makeEzreal_W_Orb(api: ContentApi) {
  return __group0_Ezreal_WBuilder(api).Ezreal_W_Orb;
}
export function makeEzreal_W_Mark(api: ContentApi) {
  return __group0_Ezreal_WBuilder(api).Ezreal_W_Mark;
}


/** The detonation — the sigil collapsing inward and then blowing out. */
function __buildEzreal_W_Burst(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ezreal_W_Burst extends SpellObject {
    age = 0;
    lifeTime = 340;
    radius = 40;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const ease = 1 - (1 - t) * (1 - t);

      push();
      translate(this.position.x, this.position.y);

      // the collapse: rune shards driven inward before the blast leaves
      stroke(160, 220, 255, 230 * fade);
      strokeWeight(3 * fade + 1);
      for (let i = 0; i < 6; i++) {
        const a = (TWO_PI / 6) * i + t * 1.2;
        const outer = this.radius * (1.6 - 1.1 * ease);
        const inner = outer - 14 * fade;
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }

      // the blast rim, on the radius the damage actually covered
      noFill();
      stroke(255, 215, 140, 235 * fade);
      strokeWeight(5 * fade + 1.5);
      circle(0, 0, this.radius * 2 * (0.4 + 1.1 * ease));

      // white core, gone in the first fifth
      const flash = 1 - constrain(t / 0.2, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 250, 235, 240 * flash);
        circle(0, 0, this.radius * 0.9 * flash + 12);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius * 2 + 30;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ezreal_W_Burst;
}
const __cacheEzreal_W_Burst = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_W_Burst>>();
export function makeEzreal_W_Burst(api: ContentApi) {
  const cached = __cacheEzreal_W_Burst.get(api);
  if (cached) return cached;
  const built = __buildEzreal_W_Burst(api);
  __cacheEzreal_W_Burst.set(api, built);
  return built;
}