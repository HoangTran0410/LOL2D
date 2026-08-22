import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Invisible = InstanceType<ContentApi['buffs']['Invisible']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Shaco_Q = InstanceType<ReturnType<typeof makeShaco_Q>>;
type Shaco_Q_Object = InstanceType<ReturnType<typeof makeShaco_Q_Object>>;



export const BLINK_RANGE = 200;

export const STEALTH_MS = 2000;

export const SPEEDUP_PERCENT = 0.4;


/** How long a poof lasts. Short: this is a blink, not a channel. */
export const POOF_MS = 420;

/** Harlequin diamonds thrown by a poof. */
export const SHARD_COUNT = 9;

/** How far the diamonds reach at the point he left from. */
export const DEPART_REACH = 52;

/**
 * And at the point he arrives at. Deliberately smaller and quicker: he is
 * invisible on this end, and a flare as big as the departure one would hand
 * the enemy the answer for free.
 */
export const ARRIVE_REACH = 32;


const JESTER_DARK: [number, number, number] = [58, 16, 74];

const JESTER: [number, number, number] = [148, 52, 186];

const JESTER_RED: [number, number, number] = [214, 48, 78];


function __buildShaco_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Invisible = api.buffs.Invisible;
  const Speedup = api.buffs.Speedup;
  const Shaco_Q_Object = makeShaco_Q_Object(api);
  class Shaco_Q extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_shaco_q');
    name = 'Lừa Gạt (Shaco_Q)';
    description =
      '<span class="buff">Dịch chuyển</span> đến vị trí chỉ định, trở nên <span class="buff">Tàng Hình</span> trong <span class="time">2 giây</span> và <span class="buff">Tăng Tốc 40%</span> trong thời gian tàng hình.';
    coolDown = 5000;
    manaCost = 30;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        BLINK_RANGE
      );

      // flash to position
      this.owner.moveTo(to.x, to.y);
      this.owner.position.set(to.x, to.y);

      // stealth buff
      const insivibleBuff = new Invisible(STEALTH_MS, this.owner, this.owner);
      this.owner.addBuff(insivibleBuff);

      // speedup buff
      const speedupBuff = new Speedup(STEALTH_MS, this.owner, this.owner);
      speedupBuff.image = this.image;
      speedupBuff.percent = SPEEDUP_PERCENT;
      this.owner.addBuff(speedupBuff);

      // Both ends of the blink get a poof. Only the departure used to, which made
      // the trick unreadable: an enemy saw smoke where he *was* and nothing at
      // all where he went, so the ability looked like a delete rather than a
      // move. They are mirror images — one folds shut, one bursts open — so the
      // eye can pair them up and guess a direction.
      const departure = new Shaco_Q_Object(this.owner, from.copy());
      departure.implode = true;
      departure.reach = DEPART_REACH;
      this.game.objectManager.addObject(departure);

      const arrival = new Shaco_Q_Object(this.owner, to.copy());
      arrival.implode = false;
      arrival.reach = ARRIVE_REACH;
      this.game.objectManager.addObject(arrival);
    }
  }
  return Shaco_Q;
}
const __cacheShaco_Q = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_Q>>();
export default function makeShaco_Q(api: ContentApi) {
  const cached = __cacheShaco_Q.get(api);
  if (cached) return cached;
  const built = __buildShaco_Q(api);
  __cacheShaco_Q.set(api, built);
  return built;
}


/** One diamond off a harlequin's costume, thrown by the poof. */
interface Shard {
  angle: number;
  /** Share of `reach` this one covers. */
  speed: number;
  size: number;
  spin: number;
  /** Alternating purple/red, decided once so the pattern never re-shuffles. */
  red: boolean;
}


function __buildShaco_Q_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Shaco_Q_Object extends SpellObject {
    /** True at the point he vanished from: the shards fall inward. */
    implode = true;
    reach = DEPART_REACH;
    lifeTime = POOF_MS;
    age = 0;

    /** Rolled in `onAdded`, animated from progress — never re-rolled in `draw`. */
    _shards: Shard[] = [];

    particleSystem = PredefinedParticleSystems.smoke(JESTER, 1.6, 6);

    constructor(owner: any, position: p5.Vector) {
      super(owner);
      this.position = position;
    }

    onAdded() {
      for (let i = 0; i < SHARD_COUNT; i++) {
        this._shards.push({
          angle: (TWO_PI * i) / SHARD_COUNT + random(-0.2, 0.2),
          speed: random(0.6, 1.05),
          size: random(9, 17),
          spin: random(-3.4, 3.4),
          red: i % 2 === 0,
        });
      }

      const size = this.owner.stats.size.value / 2;
      for (let i = 0; i < 9; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-size, size),
          y: this.position.y + random(-size, size),
          size: random(12, 26),
          opacity: random(120, 220),
        });
      }

      this.game.objectManager.addObject(this.particleSystem);
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // Departure folds shut, arrival springs open. Same easing curve run in
      // opposite directions, which is what makes them read as one trick.
      const ease = 1 - (1 - t) * (1 - t);
      const travel = this.implode ? 1 - ease : ease;
      const flash = 1 - constrain(t / 0.25, 0, 1);
      const [dr, dg, db] = JESTER_DARK;
      const [pr, pg, pb] = JESTER;
      const [rr, rg, rb] = JESTER_RED;

      push();
      translate(this.position.x, this.position.y);

      // the hole in the world he stepped through
      noStroke();
      fill(dr, dg, db, 150 * fade);
      circle(0, 0, this.reach * (this.implode ? 1.4 * fade + 0.3 : 0.5 + ease));

      // the harlequin diamonds
      for (const shard of this._shards) {
        const distance = this.reach * travel * shard.speed;
        const scale = this.implode ? 0.4 + 0.6 * fade : 1 - t * 0.55;
        push();
        translate(cos(shard.angle) * distance, sin(shard.angle) * distance);
        rotate(shard.spin * (this.implode ? -t : t) + shard.angle);
        const [cr, cg, cb] = shard.red ? [rr, rg, rb] : [pr, pg, pb];
        // a lozenge, not a square: the diamond off a harlequin's motley, and the
        // one shape nothing else in this game draws
        const tall = shard.size * scale;
        const wide = tall * 0.55;
        fill(cr, cg, cb, 235 * fade);
        quad(0, -tall, wide, 0, 0, tall, -wide, 0);
        fill(255, 235, 250, 190 * fade);
        quad(0, -tall * 0.4, wide * 0.36, 0, 0, tall * 0.4, -wide * 0.36, 0);
        pop();
      }

      // the ring of the poof, so the two ends are the same shape at a glance
      noFill();
      stroke(pr, pg, pb, 210 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.reach * 2 * (this.implode ? 0.3 + fade * 0.9 : 0.2 + ease));

      // The grin. Only the departure gets it: it is the taunt he leaves behind,
      // and putting one on the arrival would be a beacon over a stealthed Shaco.
      if (this.implode && flash > 0) {
        const alpha = 235 * flash;
        noFill();
        stroke(255, 235, 250, alpha);
        strokeWeight(3);
        arc(0, -2, 34, 30, 0.35, PI - 0.35);
        strokeWeight(4);
        line(-11, -13, -5, -8);
        line(11, -13, 5, -8);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.reach + 40;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Shaco_Q_Object;
}
const __cacheShaco_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildShaco_Q_Object>>();
export function makeShaco_Q_Object(api: ContentApi) {
  const cached = __cacheShaco_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildShaco_Q_Object(api);
  __cacheShaco_Q_Object.set(api, built);
  return built;
}