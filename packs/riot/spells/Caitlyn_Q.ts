import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { CAITLYN_W_REVEAL_STACK_ID } from './Caitlyn_W';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Caitlyn_Q = InstanceType<ReturnType<typeof makeCaitlyn_Q>>;
type Caitlyn_Q_Brace = InstanceType<ReturnType<typeof makeCaitlyn_Q_Brace>>;
type Caitlyn_Q_Impact = InstanceType<ReturnType<typeof makeCaitlyn_Q_Impact>>;
type Caitlyn_Q_Object = InstanceType<ReturnType<typeof makeCaitlyn_Q_Object>>;



export const CAITLYN_Q_RANGE = 720;

export const CAITLYN_Q_SPEED = 24;

export const CAITLYN_Q_WIDTH = 34;

export const CAITLYN_Q_DAMAGE = 32;

/** Everyone behind the first body — unless a trap already caught them. */
export const CAITLYN_Q_REDUCED_DAMAGE = 19;

export const CAITLYN_Q_CAST_TIME_MS = 350;


/**
 * Piltover Peacemaker — the long piercing shot, and the reason her trap matters.
 *
 * The damage falls off after the first body it passes through, so hitting a
 * champion standing behind a wave is worth much less than catching them in the
 * open. A target already held by W is the exception: it takes the full number
 * wherever it is standing, which is the one combo in the kit.
 */
function __buildCaitlyn_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Caitlyn_Q_Object = makeCaitlyn_Q_Object(api);
  const Caitlyn_Q_Brace = makeCaitlyn_Q_Brace(api);
  class Caitlyn_Q extends Spell {
    image = api.asset('spell_caitlyn_q');
    name = 'Bắn Xuyên Táo (Caitlyn_Q)';
    description =
      `Lên đạn trong <span class="time">${CAITLYN_Q_CAST_TIME_MS / 1000} giây</span> rồi bắn một phát` +
      ` xuyên thấu, gây <span class="damage">${CAITLYN_Q_DAMAGE} sát thương</span> lên mục tiêu đầu tiên` +
      ` và <span class="damage">${CAITLYN_Q_REDUCED_DAMAGE} sát thương</span> lên những mục tiêu sau.` +
      ' Kẻ địch đang dính Bẫy Yordle luôn nhận sát thương đầy đủ.';

    coolDown = 8000;
    manaCost = 45;

    range = CAITLYN_Q_RANGE;

    private brace: Caitlyn_Q_Brace | null = null;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        castTimeMs: CAITLYN_Q_CAST_TIME_MS,
        resource: {
          commitAt: 'start',
          refundOn: ['STUN', 'SILENCE', 'DISPLACEMENT', 'MOVE'],
        },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onCastStart() {
      this.clearBrace();
      const brace = new Caitlyn_Q_Brace(this.owner);
      brace.lifeTime = CAITLYN_Q_CAST_TIME_MS;
      brace.attachTo(this.owner);
      this.brace = brace;
      this.game.objectManager.addObject(brace);
    }

    onSpellCast(context: CastContext) {
      this.clearBrace();

      const direction = this.firingDirection(context);
      const aim = createVector(
        this.owner.position.x + direction.x * CAITLYN_Q_RANGE,
        this.owner.position.y + direction.y * CAITLYN_Q_RANGE
      );
      const { from, to } = VectorUtils.getVectorWithRange(this.owner.position, aim, CAITLYN_Q_RANGE);

      const shot = new Caitlyn_Q_Object(this.owner);
      shot.position = from;
      shot.destination = to;
      this.game.objectManager.addObject(shot);
    }

    onCancel() {
      this.clearBrace();
    }

    onComplete() {
      this.clearBrace();
    }

    /** Idempotent — cancel, completion and death all land here. */
    private clearBrace() {
      if (this.brace) this.brace.toRemove = true;
      this.brace = null;
    }
  }
  return Caitlyn_Q;
}
const __cacheCaitlyn_Q = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_Q>>();
export default function makeCaitlyn_Q(api: ContentApi) {
  const cached = __cacheCaitlyn_Q.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_Q(api);
  __cacheCaitlyn_Q.set(api, built);
  return built;
}


/** True while this unit is wearing the reveal Caitlyn's own trap applied. */
export function isTrapRevealed(unit: AttackableUnit): boolean {
  for (const buff of unit.buffs) {
    if (buff.stackId === CAITLYN_W_REVEAL_STACK_ID && !buff.toRemove) return true;
  }
  return false;
}


/**
 * The shot.
 *
 * Caitlyn's visual language is a rifle round, not a bolt of magic: a hard white
 * slug with a muzzle-blue shockwave cone peeled back behind it and a straight
 * flat trail. It is deliberately the fastest thing in her kit and reads as one
 * continuous line rather than a travelling ball.
 */
function __buildCaitlyn_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  const TrailSystem = api.helpers.TrailSystem;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const Caitlyn_Q_Impact = makeCaitlyn_Q_Impact(api);
  class Caitlyn_Q_Object extends MissileSpellObject {
    speed = CAITLYN_Q_SPEED;
    size = CAITLYN_Q_WIDTH;
    /** Pierces the whole lane; the falloff is what limits it, not the body count. */
    maxHitCount = Infinity;

    trailSystem = new TrailSystem({
      trailColor: 'rgba(190, 235, 255, 0.42)',
      trailSize: CAITLYN_Q_WIDTH * 0.42,
      trailLifeTime: 220,
      maxLength: 20,
    });

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(215, 245, 255, 0.5)',
      0.4
    );

    travelled = 0;
    /**
     * Bodies passed through so far. Counted here rather than read off
     * `hitTargets`, which is the base class's bookkeeping and would make the
     * falloff depend on whether it pushes before or after it calls this.
     */
    pierced = 0;

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    onAfterMove() {
      this.travelled += this.speed;
    }

    onHit(enemy: AttackableUnit) {
      const first = this.pierced === 0;
      this.pierced++;
      const damage = first || isTrapRevealed(enemy) ? CAITLYN_Q_DAMAGE : CAITLYN_Q_REDUCED_DAMAGE;
      enemy.takeDamage(damage, this.owner);

      for (let i = 0; i < 8; i++) {
        this.particleSystem.addParticle({
          x: enemy.position.x + random(-14, 14),
          y: enemy.position.y + random(-14, 14),
          r: random(3, 9),
        });
      }
      const impact = new Caitlyn_Q_Impact(this.owner);
      impact.position = enemy.position.copy();
      impact.full = damage === CAITLYN_Q_DAMAGE;
      this.game.objectManager.addObject(impact);
    }

    draw() {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      // the slug stretches out of the barrel over the first 90px
      const grow = constrain(this.travelled / 90, 0.3, 1);
      const w = this.size;
      const len = w * 2.6 * grow;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // the shockwave cone dragged behind the round — the thing that makes it look
      // supersonic instead of thrown
      noStroke();
      fill(150, 215, 255, 60);
      triangle(len * 0.35, 0, -len * 0.8, -w * 0.6, -len * 0.8, w * 0.6);
      fill(210, 240, 255, 90);
      triangle(len * 0.35, 0, -len * 0.5, -w * 0.32, -len * 0.5, w * 0.32);

      // the round itself
      fill(245, 252, 255, 245);
      ellipse(len * 0.12, 0, len * 0.7, w * 0.34);
      fill(255, 255, 255);
      ellipse(len * 0.3, 0, len * 0.28, w * 0.2);

      // rim lines on the true hit width, so the pierce lane is not a guess
      stroke(160, 220, 255, 190);
      strokeWeight(2);
      line(-len * 0.7, -w / 2, len * 0.2, -w / 2);
      line(-len * 0.7, w / 2, len * 0.2, w / 2);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 3;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Caitlyn_Q_Object;
}
const __cacheCaitlyn_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_Q_Object>>();
export function makeCaitlyn_Q_Object(api: ContentApi) {
  const cached = __cacheCaitlyn_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_Q_Object(api);
  __cacheCaitlyn_Q_Object.set(api, built);
  return built;
}


/** The hit. A full-damage connect flares wider, so the falloff is visible. */
function __buildCaitlyn_Q_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Caitlyn_Q_Impact extends SpellObject {
    age = 0;
    lifeTime = 260;
    full = true;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const ease = 1 - (1 - t) * (1 - t);
      const scale = this.full ? 1 : 0.6;

      push();
      translate(this.position.x, this.position.y);

      noFill();
      stroke(180, 230, 255, 235 * fade);
      strokeWeight(4 * fade + 1.5);
      circle(0, 0, (16 + 56 * ease) * scale);

      // four hard splinters, so the hit has edges rather than a soft bloom
      stroke(240, 252, 255, 230 * fade);
      strokeWeight(2.5 * fade + 1);
      for (let i = 0; i < 4; i++) {
        const a = (TWO_PI / 4) * i + 0.4;
        const inner = 6 * scale;
        const outer = (14 + 34 * ease) * scale;
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }

      const flash = 1 - constrain(t / 0.22, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 235 * flash);
        circle(0, 0, 22 * scale * flash + 6);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = 80;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Caitlyn_Q_Impact;
}
const __cacheCaitlyn_Q_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_Q_Impact>>();
export function makeCaitlyn_Q_Impact(api: ContentApi) {
  const cached = __cacheCaitlyn_Q_Impact.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_Q_Impact(api);
  __cacheCaitlyn_Q_Impact.set(api, built);
  return built;
}


/**
 * The brace: Caitlyn planting her feet and sighting down the rifle.
 *
 * A `SpellObject` riding her body rather than `castSpec.vfx`, so the warning
 * survives her being culled or fogged — the 350ms window is the only chance
 * anyone gets to step out of the lane.
 */
function __buildCaitlyn_Q_Brace(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Caitlyn_Q_Brace extends SpellObject {
    age = 0;
    lifeTime = CAITLYN_Q_CAST_TIME_MS;
    radius = 44;

    update() {
      if (this.dropIfAttachmentLost()) return;
      this.position.set(this.owner.position.x, this.owner.position.y);
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      // the reticle closes onto the barrel: a wind-in, so the shot has a beat
      const wind = t * t;

      push();
      translate(this.position.x, this.position.y);

      // two brackets tightening around her, the hexagon motif of her hardware
      noFill();
      stroke(140, 225, 240, 190 + 60 * wind);
      strokeWeight(2 + 1.5 * wind);
      const d = this.radius * 2 * (1.35 - 0.5 * wind);
      for (let i = 0; i < 4; i++) {
        const a = (TWO_PI / 4) * i + PI / 4;
        arc(0, 0, d, d, a - 0.34, a + 0.34);
      }

      // the bead: a hard dot that snaps bright right before the round leaves
      noStroke();
      fill(220, 255, 255, 140 + 110 * wind);
      circle(0, 0, 6 + 8 * wind);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Caitlyn_Q_Brace;
}
const __cacheCaitlyn_Q_Brace = new WeakMap<ContentApi, ReturnType<typeof __buildCaitlyn_Q_Brace>>();
export function makeCaitlyn_Q_Brace(api: ContentApi) {
  const cached = __cacheCaitlyn_Q_Brace.get(api);
  if (cached) return cached;
  const built = __buildCaitlyn_Q_Brace(api);
  __cacheCaitlyn_Q_Brace.set(api, built);
  return built;
}