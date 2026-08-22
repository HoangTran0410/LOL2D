import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type RootBuff = InstanceType<ContentApi['buffs']['Root']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Yasuo_Q = InstanceType<ReturnType<typeof makeYasuo_Q>>;
type Yasuo_Q3_Object = InstanceType<ReturnType<typeof makeYasuo_Q3_Object>>;
type Yasuo_Q_Object = InstanceType<ReturnType<typeof makeYasuo_Q_Object>>;



// Tuning lives here so the tests and the HUD read the same numbers the spell
// does — retuning a value must never mean editing something else to match.
export const Q_RANGE = 200;

export const Q_RAY_WIDTH = 30;

export const Q_DAMAGE = 10;

/** How long Yasuo is planted in the thrust, and how long the slash is drawn. */
export const Q_CAST_MS = 300;

export const Q3_RANGE = 400;

export const Q3_SPEED = 5;

export const Q3_DAMAGE = 20;

export const Q3_AIRBORNE_MS = 1000;


/** Ribbons of air dragged along the blade — two per side of the lane. */
export const Q_WIND_STREAKS = 6;

/** Half-width of the crescent edge, in radians about the aim. */
export const Q_ARC_SPREAD = 0.32;

/** Crescents the tornado winds around itself. */
export const Q3_FUNNEL_ARCS = 3;


function __buildYasuo_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const RootBuff = api.buffs.Root;
  const Yasuo_Q_Object = makeYasuo_Q_Object(api);
  const Yasuo_Q3_Object = makeYasuo_Q3_Object(api);
  class Yasuo_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    PHASES = {
      Q1: {
        image: api.asset('spell_yasuo_q1'),
      },
      Q2: {
        image: api.asset('spell_yasuo_q2'),
      },
      Q3: {
        image: api.asset('spell_yasuo_q3'),
      },
    };
    phase = this.PHASES.Q1;

    image = this.phase.image;
    name = 'Bão Kiếm (Yasuo_Q)';
    description =
      'Đâm lưỡi kiếm về hướng chỉ định, gây <span class="damage">10 sát thương</span>. <span>Cộng dồn 2 lần</span> sẽ tạo ra một cơn lốc lớn, <span class="buff">Hất Tung</span> kẻ địch trúng chiêu trong <span class="time">1 giây</span> và gây <span class="damage">20 sát thương</span>';
    coolDown = 3500;
    manaCost = 20;

    coolDownIfHit = 500;
    hitStackCount = 0;
    lastHitTime = 0;
    timeToResetHitStack = 3500;

    changeState(newState: (typeof this.PHASES)[keyof typeof this.PHASES]) {
      this.phase = newState;
      this.image = newState.image;
    }

    onSpellCast() {
      const mouse = this.aimPoint;
      const angle = mouse.sub(this.owner.position).heading();

      // Q1, Q2
      if (this.phase == this.PHASES.Q1 || this.phase == this.PHASES.Q2) {
        const obj = new Yasuo_Q_Object(this.owner);
        obj.angle = angle;
        obj.lifeTime = Q_CAST_MS;
        obj.range = Q_RANGE;
        obj.rayWidth = Q_RAY_WIDTH;
        // The loaded cast is drawn hotter, so the stack state is legible from the
        // world and not only from the icon in the HUD.
        obj.stacks = this.hitStackCount;
        obj.onHit = (_champ: any) => {
          this.hitStackCount++;
          this.lastHitTime = Date.now();
          this.currentCooldown = this.reducedCooldown(this.coolDownIfHit);
        };

        this.game.objectManager.addObject(obj);

        // stay while casting
        this.owner.addBuff(new RootBuff(Q_CAST_MS, this.owner, this.owner));
      }

      // Q3
      else if (this.phase == this.PHASES.Q3) {
        const { from: _from, to: destination } = VectorUtils.getVectorWithAngleAndRange(
          this.owner.position,
          angle,
          Q3_RANGE
        );

        const tornado = new Yasuo_Q3_Object(this.owner);
        tornado.destination = destination;
        tornado.airBorneTime = Q3_AIRBORNE_MS;
        tornado.speed = Q3_SPEED;
        this.game.objectManager.addObject(tornado);

        this.changeState(this.PHASES.Q1);
      }
    }

    onUpdate() {
      // reset hit stack if not hit for a while
      if (this.lastHitTime + this.timeToResetHitStack < Date.now()) {
        this.hitStackCount = 0;
        if (this.phase != this.PHASES.Q1) this.changeState(this.PHASES.Q1);
      }
      this.hitStackCount = constrain(this.hitStackCount, 0, 2);

      // if hit once, change state to Q2
      if (this.phase == this.PHASES.Q1) {
        if (this.hitStackCount == 1) {
          this.changeState(this.PHASES.Q2);
        }
      }

      // if hit twice, change state to Q3
      else if (this.phase == this.PHASES.Q2) {
        if (this.hitStackCount == 2) {
          this.changeState(this.PHASES.Q3);
        }
      }
    }
  }
  return Yasuo_Q;
}
const __cacheYasuo_Q = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_Q>>();
export default function makeYasuo_Q(api: ContentApi) {
  const cached = __cacheYasuo_Q.get(api);
  if (cached) return cached;
  const built = __buildYasuo_Q(api);
  __cacheYasuo_Q.set(api, built);
  return built;
}


/**
 * Steel Tempest, the thrust.
 *
 * Yasuo's kit is one material seen four ways: pale cyan wind wrapped around
 * white-hot steel. What separates each spell is the *shape* the two make —
 * here it is a crescent, the edge of a sword swept around a body, drawn as an
 * arc centred on Yasuo himself. A straight lance of light is Pantheon's spear
 * and must not be reused; the curve is the whole identity of this one.
 *
 * The hitbox is a rectangle from Yasuo out to `currentRayLength`, and every
 * value below is derived from that same number, so what is painted is what is
 * hit. `playersEffected` is the multi-hit guard: the ray grows over several
 * frames and would otherwise re-hit the same body on each of them.
 */
function __buildYasuo_Q_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const CollideUtils = api.utils.CollideUtils;
  const rectToVertices = api.utils.rectToVertices;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const RootBuff = api.buffs.Root;
  class Yasuo_Q_Object extends SpellObject {
    position = this.owner.position.copy();
    angle = 0;
    range = Q_RANGE;
    rayWidth = Q_RAY_WIDTH;
    raySpeed = 30;
    currentRayLength = 0;
    /** 0, 1 or 2 — how loaded the cast was, purely for how hot it is drawn. */
    stacks = 0;

    lifeTime = Q_CAST_MS;
    age = 0;

    playersEffected: any[] = [];
    onHit: (champ: any) => void = () => {};

    update() {
      this.age += deltaTime;
      if (this.age > this.lifeTime) this.toRemove = true;
      this.currentRayLength = Math.min(this.currentRayLength + this.raySpeed, this.range);

      // check collide with enemy
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: this.currentRayLength,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.playersEffected),
          (o: any) => {
            const vertices = rectToVertices(
              this.owner.position.x,
              this.owner.position.y - this.rayWidth / 2 - o.stats.size.value / 2,
              this.currentRayLength,
              this.rayWidth + o.stats.size.value,
              this.angle,
              {
                x: this.owner.position.x,
                y: this.owner.position.y,
              }
            );
            return CollideUtils.pointPolygon(o.position.x, o.position.y, vertices);
          },
        ],
      });

      enemies.forEach((p: SpellObject['owner']) => {
        const buff = new RootBuff(this.lifeTime / 2, this.owner, p);
        buff.image = api.asset('spell_yasuo_q1');
        p.addBuff(buff);
        p.takeDamage(Q_DAMAGE, this.owner);

        this.playersEffected.push(p);
        this.onHit(p);
      });
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const reach = this.currentRayLength;
      if (reach <= 1) return;

      const half = this.rayWidth / 2;
      // The edge lags the hitbox by an eased beat. A crescent that arrives at
      // full length on frame one reads as a beam; letting it catch up is the
      // whole difference between "a shape appeared" and "he swung".
      const swing = 1 - (1 - t) * (1 - t);
      const charge = constrain(this.stacks, 0, 2) / 2;
      // The point landing, gone almost before it is seen.
      const flash = 1 - constrain(t / 0.3, 0, 1);

      push();
      translate(this.owner.position.x, this.owner.position.y);
      rotate(this.angle);

      // The lane that is genuinely being hit. Faint, but the boundary is never a
      // guess for whoever is standing at its edge.
      noStroke();
      fill(170, 232, 255, (24 + 16 * charge) * fade);
      quad(0, -half * 0.4, reach, -half * 1.1, reach, half * 1.1, 0, half * 0.4);

      blendMode(ADD);
      strokeCap(ROUND);

      // Air dragged along the steel: bowed ribbons, never straight lines. The bow
      // grows with `swing`, so the wind is still catching up as the blade stops.
      noFill();
      const pairs = Math.max(1, Q_WIND_STREAKS / 2 - 1);
      for (let i = 0; i < Q_WIND_STREAKS; i++) {
        const side = i % 2 === 0 ? 1 : -1;
        const k = Math.floor(i / 2) / pairs;
        const bow = half * (0.45 + 0.95 * k) * side;
        const start = reach * 0.1 * (1 - k);
        stroke(185, 245, 255, (55 + 105 * (1 - k)) * fade);
        strokeWeight(2.4 * fade + 0.7);
        beginShape();
        for (let s = 0; s <= 6; s++) {
          const p = s / 6;
          vertex(lerp(start, reach, p), bow * sin(p * PI) * (0.3 + 0.7 * swing));
        }
        endShape();
      }

      // The blade: a hot core along the thrust that stops short of the point, so
      // what the tip reads as is the crescent rather than a round stroke cap.
      strokeCap(SQUARE);
      stroke(120, 200, 240, 105 * fade);
      strokeWeight(half * 0.85 * fade + 2);
      line(0, 0, reach * 0.9, 0);
      stroke(235, 253, 255, (195 + 45 * charge) * fade);
      strokeWeight(half * 0.3 * fade + 1.5);
      line(0, 0, reach * 0.94, 0);

      // The crescent the ability is named for, plus the afterimage of where the
      // edge was a beat ago — two arcs is what makes a sweep look swept.
      strokeCap(ROUND);
      noFill();
      const spread = Q_ARC_SPREAD * (0.55 + 0.45 * swing);
      stroke(150, 225, 255, 145 * fade);
      strokeWeight(9 * fade + 2);
      arc(0, 0, reach * 2, reach * 2, -spread, spread);
      stroke(250, 255, 255, 230 * fade);
      strokeWeight(3.5 * fade + 1.2);
      arc(0, 0, reach * 2, reach * 2, -spread * 0.85, spread * 0.85);

      const trailRadius = reach * (0.7 + 0.2 * swing);
      stroke(160, 235, 255, 85 * fade * swing);
      strokeWeight(4 * fade + 1);
      arc(0, 0, trailRadius * 2, trailRadius * 2, -spread * 1.3, spread * 1.3);

      // A second, tighter crescent on the loaded cast: Q2 is a different picture
      // from Q1 at a glance, not the same picture in a slightly brighter blue.
      if (charge > 0) {
        const inner = reach * 0.86;
        stroke(215, 250, 255, 125 * fade * charge);
        strokeWeight(3 * fade + 1);
        arc(0, 0, inner * 2, inner * 2, -spread * 1.1, spread * 1.1);
      }

      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 205 * flash);
        circle(reach, 0, half * 1.5 * flash + 6);
      }

      blendMode(BLEND);
      strokeCap(ROUND);
      pop();
    }

    getDisplayBoundingBox() {
      // The crescent and its stroke weight overshoot `range` by a few pixels.
      const span = this.range + 24;
      return new Rectangle({
        x: this.owner.position.x - span,
        y: this.owner.position.y - span,
        w: span * 2,
        h: span * 2,
        data: this,
      });
    }
  }
  return Yasuo_Q_Object;
}
const __cacheYasuo_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_Q_Object>>();
export function makeYasuo_Q_Object(api: ContentApi) {
  const cached = __cacheYasuo_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildYasuo_Q_Object(api);
  __cacheYasuo_Q_Object.set(api, built);
  return built;
}


/**
 * The tornado the third cast throws.
 *
 * The sprite alone spun in place and read as a decal sliding across the floor.
 * The crescents around it turn at different rates and widen with the funnel, so
 * the column reads as air being wound tighter the further it travels — the same
 * curved-wind vocabulary as the thrust, at a different scale.
 */
function __buildYasuo_Q3_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Airborne = api.buffs.Airborne;
  class Yasuo_Q3_Object extends MissileSpellObject {
    speed = Q3_SPEED;
    minSize = 30;
    maxSize = 200;
    size = this.minSize;
    airBorneTime = Q3_AIRBORNE_MS;
    angle = 0;
    originalLength = 0;

    image = api.asset('obj_yasuo_q3');

    onAfterMove() {
      const distance = this.position.dist(this.destination);
      if (!this.originalLength) this.originalLength = distance;

      // the tornado widens as it travels, which also widens its hitbox
      this.size = map(distance, this.originalLength, 0, this.minSize, this.maxSize);
      this.angle += 0.2;
    }

    onHit(enemy: any) {
      const buff = new Airborne(this.airBorneTime, this.owner, enemy);
      buff.image = api.asset('spell_yasuo_q3');
      enemy.addBuff(buff);
      enemy.takeDamage(Q3_DAMAGE, this.owner);
    }

    draw() {
      const spin = this.angle;
      const size = this.size;

      push();
      translate(this.position.x, this.position.y);

      blendMode(ADD);
      noFill();
      strokeCap(ROUND);

      // Nested crescents, each turning faster than the one inside it: the funnel
      // is the difference in speed, not the arcs themselves.
      for (let i = 0; i < Q3_FUNNEL_ARCS; i++) {
        const k = i / Math.max(1, Q3_FUNNEL_ARCS - 1);
        const radius = size * (0.4 + 0.34 * k);
        const phase = spin * (1 + k * 0.9) + i * 2.1;
        stroke(180, 240, 255, 150 - 38 * i);
        strokeWeight(size * 0.045 + 1.5);
        arc(0, 0, radius * 2, radius * 2, phase, phase + PI * (0.8 - 0.18 * i));
      }

      // Debris caught in the column, orbiting on a flattened ellipse so the
      // funnel has a floor to it rather than hanging in the air.
      noStroke();
      for (let i = 0; i < 5; i++) {
        const a = spin * 1.6 + (TWO_PI / 5) * i;
        const radius = size * (0.3 + 0.2 * sin(spin * 2 + i));
        fill(225, 250, 255, 165);
        circle(cos(a) * radius, sin(a) * radius * 0.75, size * 0.05 + 2);
      }
      blendMode(BLEND);

      rotate(spin);
      image(api.renderableAsset(this.image), 0, 0, size, size);
      pop();
    }

    getDisplayBoundingBox() {
      // The outermost crescent sits at 0.74 * size from the centre, so the base
      // class's `size`-wide box would clip the funnel off its own tornado.
      const span = this.size * 0.9 + 20;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Yasuo_Q3_Object;
}
const __cacheYasuo_Q3_Object = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_Q3_Object>>();
export function makeYasuo_Q3_Object(api: ContentApi) {
  const cached = __cacheYasuo_Q3_Object.get(api);
  if (cached) return cached;
  const built = __buildYasuo_Q3_Object(api);
  __cacheYasuo_Q3_Object.set(api, built);
  return built;
}