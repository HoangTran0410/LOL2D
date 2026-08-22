import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { DynamicWall } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type JarvanIV_R = InstanceType<ReturnType<typeof makeJarvanIV_R>>;
type JarvanIV_R_ImpactObject = InstanceType<ReturnType<typeof makeJarvanIV_R_ImpactObject>>;
type JarvanIV_R_WallObject = InstanceType<ReturnType<typeof makeJarvanIV_R_WallObject>>;



export const JARVAN_R_DAMAGE = 45;

export const JARVAN_R_BLAST_RADIUS = 200;

export const JARVAN_R_RING_RADIUS = 180;

export const JARVAN_R_ARENA_MS = 3500;

/** How long a recast-collapsed slab takes to crumble. It stops blocking at once. */
export const JARVAN_R_COLLAPSE_MS = 280;

/** Short lockout after the leap so one keypress is not read as two. */
export const JARVAN_R_RECAST_DELAY_MS = 400;


function __buildJarvanIV_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const JarvanIV_R_ImpactObject = makeJarvanIV_R_ImpactObject(api);
  const JarvanIV_R_WallObject = makeJarvanIV_R_WallObject(api);
  class JarvanIV_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_jarvaniv_r');
    name = 'Đại Địa Chấn (JarvanIV_R)';
    description =
      'Nhảy vào điểm chỉ định gây <span class="damage">45 sát thương</span> diện rộng và <span class="buff">Dựng Đấu Trường Tường Đá</span> tạo chướng ngại vật xung quanh trong <span class="time">3.5 giây</span>.';
    coolDown = 10000;
    manaCost = 100;
    range = 650;

    /** The slabs currently standing, so a recast can bring them down early. */
    liveWalls: JarvanIV_R_WallObject[] = [];

    /**
     * The arena is a trap for *both* champions, so being able to open it is part
     * of the ability rather than a convenience: the same walls that hold a target
     * in also hold Jarvan in, and a fight that turns has to be leaveable.
     */
    onSpellCast() {
      if (this.liveWalls.length > 0) {
        this.collapseArena();
        this.currentCooldown = this.reducedCooldown(this.coolDown);
        return;
      }

      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const dashBuff = new Dash(600, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = to;
      dashBuff.dashSpeed = 20;
      dashBuff.onReachedDestination = () => {
        // The impact only exists once he has actually landed — the shockwave is
        // the ground breaking under him, so it cannot start while he is airborne.
        const impact = new JarvanIV_R_ImpactObject(this.owner);
        impact.position = to.copy();
        impact.blastRadius = JARVAN_R_BLAST_RADIUS;
        impact.ringRadius = JARVAN_R_RING_RADIUS;
        this.game.objectManager.addObject(impact);

        // AoE damage
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({ x: to.x, y: to.y, r: JARVAN_R_BLAST_RADIUS }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });
        for (const enemy of enemies) {
          enemy.takeDamage(JARVAN_R_DAMAGE, this.owner);
        }

        // Create ring arena of custom earthen rock slabs around perimeter
        const numSlabs = 8;
        for (let i = 0; i < numSlabs; i++) {
          const angle = (TWO_PI / numSlabs) * i;
          const slabX = to.x + cos(angle) * JARVAN_R_RING_RADIUS;
          const slabY = to.y + sin(angle) * JARVAN_R_RING_RADIUS;

          const wall = new JarvanIV_R_WallObject(this.owner);
          wall.position = createVector(slabX, slabY);
          wall.angle = angle + HALF_PI;
          wall.length = 150;
          wall.thickness = 36;
          wall.lifeTime = JARVAN_R_ARENA_MS;
          // slabs erupt out of the ground in sequence around the ring rather than
          // all at once, so the arena reads as being thrown up around him
          wall.eruptDelay = i * 26;
          this.game.objectManager.addObject(wall);
          this.liveWalls.push(wall);
        }

        // A recast window, not a cooldown: the real one starts when the arena
        // comes down, whether the player brought it down or it timed out.
        this.currentCooldown = JARVAN_R_RECAST_DELAY_MS;
      };
      this.owner.addBuff(dashBuff);
    }

    /** Brings every standing slab down together, each playing its own crumble. */
    collapseArena() {
      for (const wall of this.liveWalls) wall.collapse();
      this.liveWalls = [];
    }

    onUpdate() {
      if (this.liveWalls.length === 0) return;
      // The arena outliving its own timer is the ordinary case; charge the real
      // cooldown at that point too, so the recast window cannot be sat on.
      let standing = 0;
      for (const wall of this.liveWalls) if (!wall.toRemove && !wall.collapsing) standing++;
      if (standing === 0) {
        this.liveWalls = [];
        this.currentCooldown = this.reducedCooldown(this.coolDown);
      }
    }
  }
  return JarvanIV_R;
}
const __cacheJarvanIV_R = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_R>>();
export default function makeJarvanIV_R(api: ContentApi) {
  const cached = __cacheJarvanIV_R.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_R(api);
  __cacheJarvanIV_R.set(api, built);
  return built;
}


interface Debris {
  angle: number;
  speed: number;
  size: number;
  hop: number;
  spin: number;
}


/**
 * The landing.
 *
 * Cataclysm had no impact at all: he arrived and eight slabs simply existed. The
 * shockwave is the thing that says *he hit the ground here*, and per the
 * guidelines it fires strictly on touchdown — it is constructed from the dash's
 * `onReachedDestination`, so there is no path by which it can play mid-leap.
 *
 * Earth, not ice or light: ochre dust, tumbling rock chips, a cracked floor. The
 * palette is the whole reason this reads as Jarvan and not as Anivia.
 */
function __buildJarvanIV_R_ImpactObject(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class JarvanIV_R_ImpactObject extends SpellObject {
    blastRadius = JARVAN_R_BLAST_RADIUS;
    ringRadius = JARVAN_R_RING_RADIUS;
    lifeTime = 620;
    age = 0;

    debris: Debris[] = [];
    particleSystem = PredefinedParticleSystems.smoke([150, 115, 65], 0.35, 3.5);

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
      for (let i = 0; i < 22; i++) {
        this.debris.push({
          angle: (TWO_PI / 22) * i + random(-0.16, 0.16),
          speed: random(0.7, 1.15),
          size: random(6, 15),
          hop: random(12, 34),
          spin: random(-5, 5),
        });
      }
      for (let i = 0; i < 18; i++) {
        const a = random(TWO_PI);
        const d = random(0, this.blastRadius * 0.8);
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * d,
          y: this.position.y + sin(a) * d,
          size: random(22, 46),
          opacity: random(150, 220),
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

      push();
      translate(this.position.x, this.position.y);

      // the floor cracking open under the point of impact
      stroke(70, 45, 22, 210 * fade);
      strokeWeight(4 * fade + 1);
      noFill();
      for (let i = 0; i < 9; i++) {
        const a = (TWO_PI / 9) * i + 0.3;
        const reach = this.blastRadius * 0.75 * Math.min(1, t * 2.4);
        beginShape();
        vertex(0, 0);
        vertex(cos(a) * reach * 0.45 + cos(a + 1.2) * 12, sin(a) * reach * 0.45 + sin(a + 1.2) * 12);
        vertex(cos(a) * reach, sin(a) * reach);
        endShape();
      }

      // dust shockwave racing out to the damage radius, then a hard rim on it so
      // the blast boundary is not a guess
      noFill();
      stroke(205, 170, 105, 235 * fade);
      strokeWeight(11 * fade + 2);
      circle(0, 0, this.blastRadius * 2 * (0.25 + t * 0.85));
      stroke(150, 110, 55, 190 * fade);
      strokeWeight(3);
      circle(0, 0, this.blastRadius * 2);

      // rock chips thrown up and falling back
      noStroke();
      for (const chip of this.debris) {
        const d = this.blastRadius * t * chip.speed;
        const lift = sin(constrain(t, 0, 1) * PI) * chip.hop;
        push();
        translate(cos(chip.angle) * d, sin(chip.angle) * d - lift);
        rotate(chip.angle + chip.spin * t);
        fill(120, 85, 45, 240 * fade);
        const s = chip.size * (1 - t * 0.4);
        triangle(-s * 0.6, s * 0.5, s * 0.7, s * 0.2, 0, -s * 0.7);
        pop();
      }

      // the flash of the slam, gone almost immediately
      const flash = 1 - constrain(t / 0.18, 0, 1);
      if (flash > 0) {
        noStroke();
        fill(255, 235, 180, 200 * flash);
        circle(0, 0, this.blastRadius * 0.85 * (1 - flash) + 24);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.blastRadius + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return JarvanIV_R_ImpactObject;
}
const __cacheJarvanIV_R_ImpactObject = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_R_ImpactObject>>();
export function makeJarvanIV_R_ImpactObject(api: ContentApi) {
  const cached = __cacheJarvanIV_R_ImpactObject.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_R_ImpactObject(api);
  __cacheJarvanIV_R_ImpactObject.set(api, built);
  return built;
}


/** Distinctive earthen wall obstacle for Jarvan IV's Cataclysm arena. */
function __buildJarvanIV_R_WallObject(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Circle = api.utils.Quadtree.Circle;
  const AttackableUnit = api.units.AttackableUnit;
  const ActionState = api.enums.ActionState;
  const hasFlag = api.utils.hasFlag;
  const SAT = api.utils.SAT;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const slabVertices = api.terrain.slabVertices;
  class JarvanIV_R_WallObject extends SpellObject implements DynamicWall {
    angle = 0;
    length = 150;
    thickness = 36;
    lifeTime = JARVAN_R_ARENA_MS;
    age = 0;
    growth = 0;
    /** Staggers this slab's eruption so the ring rises in sequence. */
    eruptDelay = 0;
    /** Brought down early by a recast: stops blocking at once, crumbles on screen. */
    collapsing = false;
    collapseAge = 0;

    _satPolygon: any = null;
    _satCircle: any = null;
    _satResponse: any = null;

    particleSystem = PredefinedParticleSystems.smoke([140, 100, 50], 0.2, 3);

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
      // Earthen dust particles on spawn
      for (let i = 0; i < 6; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-20, 20),
          y: this.position.y + random(-20, 20),
          size: random(15, 30),
          opacity: 200,
        });
      }
    }

    /**
     * `DynamicWall`: the same two conditions `update` uses to decide whether to
     * push units — still underground, or already crumbling, and it is not terrain.
     * A grapple that caught on either would be catching on nothing visible.
     */
    get blocksMovement(): boolean {
      return !this.toRemove && !this.collapsing && this.age >= this.eruptDelay;
    }

    wallVertices() {
      return slabVertices(this.position, this.angle, this.length, this.thickness);
    }

    _getSATPolygon() {
      if (this._satPolygon) return this._satPolygon;

      const halfLength = this.length / 2;
      const halfThickness = this.thickness / 2;
      const polygon = new SAT.Polygon(new SAT.Vector(this.position.x, this.position.y), [
        new SAT.Vector(-halfLength, -halfThickness),
        new SAT.Vector(halfLength, -halfThickness),
        new SAT.Vector(halfLength, halfThickness),
        new SAT.Vector(-halfLength, halfThickness),
      ]);
      polygon.setAngle(this.angle);

      this._satPolygon = polygon;
      this._satCircle = new SAT.Circle(new SAT.Vector(0, 0), 1);
      this._satResponse = new SAT.Response();
      return this._satPolygon;
    }

    /** Recast: the slab stops being terrain on this frame and falls apart on screen. */
    collapse() {
      if (this.collapsing) return;
      this.collapsing = true;
      this.collapseAge = 0;
      for (let i = 0; i < 8; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + random(-this.length / 2, this.length / 2),
          y: this.position.y + random(-this.thickness, this.thickness),
          size: random(18, 34),
          opacity: random(160, 230),
        });
      }
    }

    update() {
      this.age += deltaTime;

      // Crumbling: no longer terrain. Blocking through the crumble would leave an
      // invisible wall standing for a quarter second after the player opened the
      // arena, which is exactly the frustration the recast exists to remove.
      if (this.collapsing) {
        this.collapseAge += deltaTime;
        if (this.collapseAge >= JARVAN_R_COLLAPSE_MS) this.toRemove = true;
        return;
      }

      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }
      // Still underground: it neither draws nor blocks. The slab that has not
      // risen must not stop anyone, or the arena would close before it is visible.
      if (this.age < this.eruptDelay) return;

      this.growth = lerp(this.growth, 1, 0.3);
      this._blockUnits();
    }

    _blockUnits() {
      const polygon = this._getSATPolygon();
      const circle = this._satCircle;
      const response = this._satResponse;

      const units = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: Math.hypot(this.length, this.thickness) / 2 + 50,
        }),
        filters: [PredefinedFilters.type(AttackableUnit), PredefinedFilters.excludeDead],
      });

      for (const unit of units) {
        if (hasFlag(unit.stats.actionState, ActionState.IS_GHOSTED)) continue;
        response.clear();
        circle.pos.x = unit.position.x;
        circle.pos.y = unit.position.y;
        circle.r = unit.stats.size.value / 2;

        if (SAT.testPolygonCircle(polygon, circle, response)) {
          unit.position.x += response.overlapV.x;
          unit.position.y += response.overlapV.y;
          unit.onCollideWall?.();
        }
      }
    }

    draw() {
      // has not broken the surface yet
      if (this.age < this.eruptDelay) return;

      const fade = this.collapsing
        ? constrain(1 - this.collapseAge / JARVAN_R_COLLAPSE_MS, 0, 1)
        : this.age > this.lifeTime - 500
          ? map(this.age, this.lifeTime - 500, this.lifeTime, 1, 0)
          : 1;
      // sinking back into the ground as it goes, rather than only fading
      const sink = this.collapsing ? fade : 1;
      const halfLength = (this.length / 2) * this.growth;
      const halfThickness = (this.thickness / 2) * this.growth * sink;
      // the first moments after it breaks ground, for the dust collar
      const erupting = constrain((this.age - this.eruptDelay) / 260, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // dust collar around the base where the slab tore through the floor
      if (erupting < 1) {
        const k = 1 - erupting;
        noFill();
        stroke(190, 155, 95, 210 * k);
        strokeWeight(5 * k + 1);
        ellipse(0, 0, this.length * (0.5 + erupting * 0.9), this.length * 0.28 * (0.5 + erupting));
      }

      rotate(this.angle);

      // Earthen rock crags visual
      noStroke();
      fill(90, 60, 30, 230 * fade);
      rectMode(CENTER);
      rect(0, 0, halfLength * 2, halfThickness * 2, 6);

      fill(180, 140, 60, 240 * fade);
      stroke(120, 80, 40, 240 * fade);
      strokeWeight(3);

      // Draw jagged earthen rock spikes
      for (let i = -3; i <= 3; i++) {
        const x = i * (halfLength / 3.5);
        const h = halfThickness * (0.8 + Math.abs(i) * 0.3);
        triangle(x - 12, halfThickness, x + 12, halfThickness, x, -h);
      }

      // damp grooves down the face, so a 3.5s wall is not a flat plate
      stroke(70, 45, 22, 170 * fade);
      strokeWeight(2);
      for (let i = -2; i <= 2; i++) {
        const x = i * (halfLength / 2.6);
        line(x, -halfThickness * 0.55, x + 4, halfThickness * 0.75);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = Math.hypot(this.length, this.thickness) / 2 + 50;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return JarvanIV_R_WallObject;
}
const __cacheJarvanIV_R_WallObject = new WeakMap<ContentApi, ReturnType<typeof __buildJarvanIV_R_WallObject>>();
export function makeJarvanIV_R_WallObject(api: ContentApi) {
  const cached = __cacheJarvanIV_R_WallObject.get(api);
  if (cached) return cached;
  const built = __buildJarvanIV_R_WallObject(api);
  __cacheJarvanIV_R_WallObject.set(api, built);
  return built;
}