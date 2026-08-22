import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ekko_Q = InstanceType<ReturnType<typeof makeEkko_Q>>;
type Ekko_Q_HitFlash = InstanceType<ReturnType<typeof makeEkko_Q_HitFlash>>;
type Ekko_Q_Object = InstanceType<ReturnType<typeof makeEkko_Q_Object>>;



export const EKKO_Q_OUT_DAMAGE = 20;

export const EKKO_Q_RETURN_DAMAGE = 30;

export const EKKO_Q_SLOW_PERCENT = 0.4;

export const EKKO_Q_FIELD_RADIUS = 100;


function __buildEkko_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Ekko_Q_Object = makeEkko_Q_Object(api);
  class Ekko_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ekko_q');
    name = 'Dây Cót Thời Gian (Ekko_Q)';
    description =
      'Bắn ra một bẫy thời gian theo hướng chỉ định gây <span class="damage">20 sát thương</span>. Khi trúng tướng hoặc bay hết tầm, bẫy mở rộng làm chậm kẻ địch <span class="buff">40%</span>. Sau đó quay về Ekko gây <span class="damage">30 sát thương</span>.';
    coolDown = 7000;
    manaCost = 50;

    range = 450;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const obj = new Ekko_Q_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      this.game.objectManager.addObject(obj);
    }
  }
  return Ekko_Q;
}
const __cacheEkko_Q = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_Q>>();
export default function makeEkko_Q(api: ContentApi) {
  const cached = __cacheEkko_Q.get(api);
  if (cached) return cached;
  const built = __buildEkko_Q(api);
  __cacheEkko_Q.set(api, built);
  return built;
}


/**
 * Timewinder — out, bloom, back.
 *
 * The three phases have to look like three different things, because the player
 * is timing a second hit off the return: the outbound disc spins one way in
 * teal, the bloom is a clock face opening, and the return spins the *other* way
 * in magenta and travels faster. The old version drew one circle and a stick for
 * all three, so the return — the half that hits harder — was unreadable.
 */
function __buildEkko_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const TrailSystem = api.helpers.TrailSystem;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const Ekko_Q_HitFlash = makeEkko_Q_HitFlash(api);
  class Ekko_Q_Object extends MissileSpellObject {
    speed = 9;
    /**
     * The hitbox, and it is also what the disc is drawn at. 30 was a dot at this
     * camera scale — for a boomerang whose whole skill expression is lining up the
     * return, the thing you are aiming has to be big enough to read in flight.
     */
    size = 46;
    removeOnArrive = false;

    expanded = false;
    expandedTimer = 0;
    expandedDuration = 1000;

    returning = false;
    returnSpeed = 12;

    forwardHitTargets: any[] = [];
    returnHitTargets: any[] = [];

    trailSystem = new TrailSystem({
      maxLength: 14,
      trailColor: '#4de8d2aa',
      trailSize: 9,
      trailLifeTime: 320,
    });

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#50dcbf', 0.35);

    onAdded() {
      super.onAdded();
      this.useParticles(this.particleSystem);
    }

    onBeforeMove() {
      if (this.returning) {
        this.destination = this.owner.position;
        this.speed = this.returnSpeed;
      }
    }

    update() {
      if (frameCount % 4 === 0) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-15, 15),
          y: this.position.y + random(-15, 15),
          r: random(4, 10),
        });
      }

      if (this.expanded) {
        this.expandedTimer += deltaTime;
        // Apply AoE slow to enemies inside the field
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.position.x,
            y: this.position.y,
            r: effectiveRange(EKKO_Q_FIELD_RADIUS, this.owner),
          }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });
        for (const enemy of enemies) {
          const slow = new Slow(400, this.owner, enemy);
          slow.percent = EKKO_Q_SLOW_PERCENT;
          enemy.addBuff(slow);
        }

        if (this.expandedTimer >= this.expandedDuration) {
          this.expanded = false;
          this.returning = true;
          // the snap back: the trail flips to the return colour so the second,
          // harder hit is a different object to the eye
          this.trailSystem.trailColor = '#ff6ad5aa';
          for (let i = 0; i < 10; i++) {
            this.particleSystem.addParticle({
              x: this.position.x + random(-30, 30),
              y: this.position.y + random(-30, 30),
              r: random(5, 11),
            });
          }
        }
        return;
      }

      super.update();
    }

    onHit(enemy: any) {
      if (!this.returning) {
        if (!this.forwardHitTargets.includes(enemy)) {
          this.forwardHitTargets.push(enemy);
          enemy.takeDamage(EKKO_Q_OUT_DAMAGE, this.owner);
          this.burstAt(enemy.position.x, enemy.position.y, 5);
        }
        // Expand on hitting champion
        if (enemy.constructor.name.includes('Champion') && !this.expanded) {
          this.expanded = true;
        }
      } else {
        if (!this.returnHitTargets.includes(enemy)) {
          this.returnHitTargets.push(enemy);
          enemy.takeDamage(EKKO_Q_RETURN_DAMAGE, this.owner);
          this.burstAt(enemy.position.x, enemy.position.y, 9);
        }
      }
    }

    /**
     * The on-hit. Particles alone were invisible against a moving disc — a hit
     * needs a hard, short-lived shape at the point of contact or the player cannot
     * tell a connect from a near miss, which on a boomerang is the whole read.
     */
    burstAt(x: number, y: number, count: number) {
      for (let i = 0; i < count; i++) {
        this.particleSystem.addParticle({
          x: x + random(-14, 14),
          y: y + random(-14, 14),
          r: random(6, 13),
        });
      }
      const flash = new Ekko_Q_HitFlash(this.owner, x, y, this.returning);
      this.game.objectManager.addObject(flash);
    }

    onArrive() {
      if (!this.expanded && !this.returning) {
        this.expanded = true;
      } else if (this.returning) {
        this.toRemove = true;
      }
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);

      if (this.expanded) {
        // BLOOM — a clock face opening, then shutting again as the timer runs out
        const t = constrain(this.expandedTimer / this.expandedDuration, 0, 1);
        const open = constrain(this.expandedTimer / 160, 0, 1);
        const shut = t > 0.82 ? 1 - (t - 0.82) / 0.18 : 1;
        const scale = (1 - (1 - open) * (1 - open)) * shut;
        const d = EKKO_Q_FIELD_RADIUS * 2 * scale;

        noStroke();
        fill(80, 220, 255, 70 * shut);
        circle(0, 0, d);
        noFill();
        stroke(100, 240, 255, 220 * shut);
        strokeWeight(3);
        circle(0, 0, d);

        // hour ticks: the field is a clock, which is the champion's whole identity
        push();
        rotate(frameCount * 0.02);
        stroke(180, 255, 245, 190 * shut);
        strokeWeight(2);
        for (let i = 0; i < 12; i++) {
          const a = (TWO_PI / 12) * i;
          const inner = (d / 2) * 0.82;
          line(cos(a) * inner, sin(a) * inner, (cos(a) * d) / 2, (sin(a) * d) / 2);
        }
        pop();

        // the hand sweeping the dial down to the return
        push();
        rotate(-HALF_PI + TWO_PI * t);
        stroke(0, 255, 230, 230 * shut);
        strokeWeight(3);
        line(0, 0, (d / 2) * 0.78, 0);
        pop();
        noStroke();
        fill(220, 255, 250, 230 * shut);
        circle(0, 0, 8);
        pop();
        return;
      }

      // FLIGHT — the disc, spinning the other way on the way home
      const returning = this.returning;
      rotate(frameCount * (returning ? -0.24 : 0.15));
      const d = returning ? this.size * 0.85 : this.size;

      // a soft halo so the disc separates from the ground at speed
      noStroke();
      fill(returning ? 255 : 80, returning ? 110 : 220, returning ? 210 : 255, 70);
      circle(0, 0, d * 1.5);

      // outer blades
      noFill();
      stroke(returning ? 255 : 90, returning ? 120 : 235, returning ? 220 : 255, 235);
      strokeWeight(3);
      for (let i = 0; i < 3; i++) {
        push();
        rotate((TWO_PI / 3) * i);
        arc(0, 0, d, d, -0.7, 0.7);
        pop();
      }
      // core
      noStroke();
      fill(returning ? 255 : 110, returning ? 150 : 240, returning ? 235 : 255, 235);
      circle(0, 0, d * 0.5);
      fill(255, 255, 255, 240);
      circle(0, 0, d * 0.22);
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.expanded ? EKKO_Q_FIELD_RADIUS + 20 : this.size + 10;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ekko_Q_Object;
}
const __cacheEkko_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_Q_Object>>();
export function makeEkko_Q_Object(api: ContentApi) {
  const cached = __cacheEkko_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildEkko_Q_Object(api);
  __cacheEkko_Q_Object.set(api, built);
  return built;
}


/** The connect: a hard ring and a cross-slash at the point of contact. */
function __buildEkko_Q_HitFlash(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ekko_Q_HitFlash extends SpellObject {
    lifeTime = 260;
    timer = 0;
    returning: boolean;

    constructor(owner: any, x: number, y: number, returning: boolean) {
      super(owner);
      this.position = createVector(x, y);
      this.returning = returning;
    }

    update() {
      this.timer += deltaTime;
      if (this.timer >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.timer / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // the return hit is the bigger one, and says so
      const scale = this.returning ? 1.35 : 1;

      push();
      translate(this.position.x, this.position.y);

      // white core, gone almost immediately
      const flash = 1 - constrain(t / 0.3, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 235 * flash);
        circle(0, 0, 26 * scale * (1 - flash) + 10);
      }

      // expanding shock ring on the point of contact
      noFill();
      stroke(
        this.returning ? 255 : 140,
        this.returning ? 150 : 245,
        this.returning ? 235 : 255,
        240 * fade
      );
      strokeWeight(5 * fade + 1.5);
      circle(0, 0, (20 + 62 * t) * scale);

      // four struck sparks, angled so the hit has a direction rather than a bloom
      stroke(235, 255, 255, 235 * fade);
      strokeWeight(3 * fade + 1);
      for (let i = 0; i < 4; i++) {
        const a = (TWO_PI / 4) * i + 0.6;
        const inner = 8 * scale;
        const outer = (16 + 34 * t) * scale;
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = 80;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ekko_Q_HitFlash;
}
const __cacheEkko_Q_HitFlash = new WeakMap<ContentApi, ReturnType<typeof __buildEkko_Q_HitFlash>>();
export function makeEkko_Q_HitFlash(api: ContentApi) {
  const cached = __cacheEkko_Q_HitFlash.get(api);
  if (cached) return cached;
  const built = __buildEkko_Q_HitFlash(api);
  __cacheEkko_Q_HitFlash.set(api, built);
  return built;
}