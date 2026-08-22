import type { ContentApi } from '@moba2d/core/content/ContentApi';
import { makeDetonateEssenceFlux } from './Ezreal_W';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ezreal_Q = InstanceType<ReturnType<typeof makeEzreal_Q>>;
type Ezreal_Q_Impact = InstanceType<ReturnType<typeof makeEzreal_Q_Impact>>;
type Ezreal_Q_Object = InstanceType<ReturnType<typeof makeEzreal_Q_Object>>;



export const EZREAL_Q_DAMAGE = 24;

export const EZREAL_Q_RANGE = 620;

export const EZREAL_Q_SPEED = 17;

export const EZREAL_Q_BOLT_SIZE = 26;

/**
 * What a landed bolt takes off every one of Ezreal's other countdowns.
 *
 * The whole champion is built on this line: at a 4s base cooldown the refund is
 * nearly a third of Q's own timer, so hitting is what keeps the rotation going
 * and missing is what stops it.
 */
export const EZREAL_Q_COOLDOWN_REFUND_MS = 1200;


/** Mystic Shot — the cheap, fast bolt everything else in the kit is paid for by. */
function __buildEzreal_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Ezreal_Q_Object = makeEzreal_Q_Object(api);
  class Ezreal_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ezreal_q');
    name = 'Phát Bắn Thần Bí (Ezreal_Q)';
    description =
      `Bắn một mũi tên năng lượng gây <span class="damage">${EZREAL_Q_DAMAGE} sát thương</span>` +
      ' lên kẻ địch đầu tiên trúng phải. Nếu trúng, mọi chiêu thức của Ezreal được giảm' +
      ` <span class="time">${EZREAL_Q_COOLDOWN_REFUND_MS / 1000} giây</span> hồi chiêu.`;

    coolDown = 4000;
    manaCost = 25;

    range = EZREAL_Q_RANGE;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        EZREAL_Q_RANGE
      );

      const bolt = new Ezreal_Q_Object(this.owner);
      bolt.position = from;
      bolt.destination = to;
      this.game.objectManager.addObject(bolt);
    }
  }
  return Ezreal_Q;
}
const __cacheEzreal_Q = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_Q>>();
export default function makeEzreal_Q(api: ContentApi) {
  const cached = __cacheEzreal_Q.get(api);
  if (cached) return cached;
  const built = __buildEzreal_Q(api);
  __cacheEzreal_Q.set(api, built);
  return built;
}


/**
 * Shaves `EZREAL_Q_COOLDOWN_REFUND_MS` off every countdown the caster is
 * running, Q's own included.
 *
 * Exported so the suite can drive it without building a whole champion, and
 * written against `currentCooldown` — the runtime's own compatibility seam —
 * rather than poking the runtime, so a spell mid-cast is left alone.
 */
export function refundEzrealCooldowns(caster: AttackableUnit): void {
  const spells = (caster as { spells?: Spell[] }).spells;
  if (!spells) return;
  for (const spell of spells) {
    if (spell.currentCooldown > 0) {
      spell.currentCooldown = Math.max(0, spell.currentCooldown - EZREAL_Q_COOLDOWN_REFUND_MS);
    }
  }
}


/**
 * The bolt.
 *
 * Ezreal's motif is a *fired* arcane round: a hard arrowhead with chevrons
 * peeling off behind it, not a ball of energy. It is deliberately narrow and
 * pale gold so it reads at a glance against the fat amber W orb travelling the
 * same lane — those two are constantly in the air together.
 */
function __buildEzreal_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const TrailSystem = api.helpers.TrailSystem;
  const detonateEssenceFlux = makeDetonateEssenceFlux(api);
  const Ezreal_Q_Impact = makeEzreal_Q_Impact(api);
  class Ezreal_Q_Object extends MissileSpellObject {
    speed = EZREAL_Q_SPEED;
    size = EZREAL_Q_BOLT_SIZE;
    maxHitCount = 1;

    trailSystem = new TrailSystem({
      trailColor: 'rgba(200, 231, 200, 0.5)',
      trailSize: EZREAL_Q_BOLT_SIZE * 0.5,
      trailLifeTime: 240,
      maxLength: 16,
    });

    /** Distance covered, used to stretch the bolt out of its spawn rather than pop it in. */
    travelled = 0;

    onAfterMove() {
      this.travelled += this.speed;
    }

    onHit(enemy: AttackableUnit) {
      enemy.takeDamage(EZREAL_Q_DAMAGE, this.owner);
      refundEzrealCooldowns(this.owner);
      detonateEssenceFlux(this.owner, enemy);

      const impact = new Ezreal_Q_Impact(this.owner);
      impact.position = enemy.position.copy();
      impact.angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      this.game.objectManager.addObject(impact);
    }

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      // the bolt grows into its full length over the first 60px of flight, so it
      // leaves the gauntlet instead of appearing at full size
      const grow = constrain(this.travelled / 60, 0.35, 1);
      const len = this.size * 1.9 * grow;
      const half = this.size * 0.32;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // glow
      noStroke();
      fill(255, 210, 110, 60);
      ellipse(0, 0, len * 1.5, this.size * 1.1);

      // arrowhead
      fill(255, 236, 170, 240);
      triangle(len * 0.55, 0, -len * 0.35, -half, -len * 0.35, half);

      // chevrons peeling off the back — the part that makes it read as *fired*
      noFill();
      stroke(255, 205, 105, 210);
      strokeWeight(2.5);
      for (let i = 1; i <= 3; i++) {
        const x = -len * (0.25 + i * 0.22);
        const spread = half * (1 + i * 0.35);
        line(x + 7, 0, x - 3, -spread);
        line(x + 7, 0, x - 3, spread);
      }

      // hot core
      noStroke();
      fill(255, 255, 240, 245);
      ellipse(len * 0.12, 0, len * 0.4, half * 0.9);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 2.2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ezreal_Q_Object;
}
const __cacheEzreal_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_Q_Object>>();
export function makeEzreal_Q_Object(api: ContentApi) {
  const cached = __cacheEzreal_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildEzreal_Q_Object(api);
  __cacheEzreal_Q_Object.set(api, built);
  return built;
}


/** The connect: a directional splash of sparks, not a symmetric bloom. */
function __buildEzreal_Q_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ezreal_Q_Impact extends SpellObject {
    age = 0;
    lifeTime = 240;
    angle = 0;
    /** Seeded once in `onAdded`; re-rolling in `draw` flickers instead of animating. */
    _sparks: { spread: number; length: number }[] = [];

    onAdded() {
      for (let i = 0; i < 7; i++) {
        this._sparks.push({ spread: random(-0.8, 0.8), length: random(18, 42) });
      }
    }

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
      rotate(this.angle);

      // sparks carry on in the bolt's direction, so a hit has a heading
      stroke(255, 232, 165, 240 * fade);
      strokeWeight(2.5 * fade + 1);
      for (const spark of this._sparks) {
        const reach = spark.length * ease;
        line(0, 0, cos(spark.spread) * reach, sin(spark.spread) * reach);
      }

      // ring on the point of contact
      noFill();
      stroke(255, 200, 110, 220 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, 14 + 44 * ease);

      const flash = 1 - constrain(t / 0.25, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 252, 235, 235 * flash);
        circle(0, 0, 20 * flash + 6);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = 70;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ezreal_Q_Impact;
}
const __cacheEzreal_Q_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildEzreal_Q_Impact>>();
export function makeEzreal_Q_Impact(api: ContentApi) {
  const cached = __cacheEzreal_Q_Impact.get(api);
  if (cached) return cached;
  const built = __buildEzreal_Q_Impact(api);
  __cacheEzreal_Q_Impact.set(api, built);
  return built;
}