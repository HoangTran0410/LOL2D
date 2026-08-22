import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Malphite_R = InstanceType<ReturnType<typeof makeMalphite_R>>;
type Malphite_R_Charge = InstanceType<ReturnType<typeof makeMalphite_R_Charge>>;
type Malphite_R_Object = InstanceType<ReturnType<typeof makeMalphite_R_Object>>;



export const MAX_RANGE = 350;

export const HIT_RADIUS = 100;

export const DAMAGE = 30;

export const AIRBORNE_MS = 1000;

export const CHARGE_SPEED = 15;

/** Ceiling on the charge, so a flight that never arrives still cleans up. */
export const CHARGE_TIMEOUT_MS = 3000;

/** How long the crater is on screen after he lands. */
export const IMPACT_MS = 900;

/** Slabs of ground heaved up around the rim. */
export const PLATE_COUNT = 9;

/** Rock splinters thrown out of the crater. */
export const SHARD_COUNT = 16;


/** Stone, in three values: shadowed rock, lit rock, and the dust off both. */
const ROCK_DARK: [number, number, number] = [92, 84, 74];

const ROCK_LIT: [number, number, number] = [176, 166, 146];

const DUST: [number, number, number] = [156, 141, 116];


function __buildMalphite_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const VectorUtils = api.utils.VectorUtils;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Spell = api.Spell;
  const Malphite_R_Charge = makeMalphite_R_Charge(api);
  const Malphite_R_Object = makeMalphite_R_Object(api);
  class Malphite_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_malphite_r');
    name = 'Không Thể Cản Phá (Malphite_R)';
    description =
      '<span class="buff">Lướt</span> tới khu vực chỉ định với tốc độ cao, gây <span class="damage">30 sát thương</span> và <span class="buff">Hất Tung</span> các kẻ địch trong <span class="time">1 giây</span> xung quanh điểm đến. <i>(Không thể cản phá bởi các hiệu ứng khống chế)</i>';
    coolDown = 10000;
    manaCost = 100;

    maxRange = MAX_RANGE;
    hitRadius = HIT_RADIUS;
    damage = DAMAGE;

    castCancelCheck() {
      return !this.owner.canMove;
    }

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.maxRange
      );

      const dashBuff = new Dash(3000, this.owner, this.owner);
      dashBuff.cancelable = false;
      dashBuff.dashDestination = to;
      dashBuff.dashSpeed = CHARGE_SPEED;
      dashBuff.onReachedDestination = () => {
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.owner.position.x,
            y: this.owner.position.y,
            r: this.hitRadius,
          }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

        enemies.forEach((enemy: any) => {
          const airborneBuff = new Airborne(AIRBORNE_MS, this.owner, enemy);
          airborneBuff.image = this.image;
          enemy.addBuff(airborneBuff);

          enemy.takeDamage(this.damage, this.owner);
        });

        const obj = new Malphite_R_Object(this.owner);
        obj.hitRadius = this.hitRadius;
        this.game.objectManager.addObject(obj);
      };

      // The circle he is going to land in, drawn on the ground for the whole
      // charge. Without it the ability's only warning is the boulder itself, and
      // 350px at 15 px/frame is long enough for the warning to be worth having.
      const charge = new Malphite_R_Charge(this.owner);
      charge.landing = to.copy();
      charge.hitRadius = this.hitRadius;
      charge.dashBuff = dashBuff;
      this.game.objectManager.addObject(charge);

      this.owner.addBuff(dashBuff);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Malphite_R;
}
const __cacheMalphite_R = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_R>>();
export default function makeMalphite_R(api: ContentApi) {
  const cached = __cacheMalphite_R.get(api);
  if (cached) return cached;
  const built = __buildMalphite_R(api);
  __cacheMalphite_R.set(api, built);
  return built;
}


/**
 * The charge itself: a landing telegraph plus the ground Malphite tears up on
 * the way there.
 *
 * It owns nothing about the damage — the dash's `onReachedDestination` still
 * does that — so there is exactly one thing that can fire the impact. This is
 * only what the charge looks like while it is happening.
 */
function __buildMalphite_R_Charge(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const Dash = api.buffs.Dash;
  const SpellObject = api.SpellObject;
  class Malphite_R_Charge extends SpellObject {
    landing: p5.Vector = this.owner.position.copy();
    hitRadius = HIT_RADIUS;
    dashBuff: Dash | null = null;
    age = 0;

    particleSystem = PredefinedParticleSystems.smoke([...DUST], 0.45, 6);

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
      this._kickDust(5);
    }

    /** Grit thrown off his feet — a rock does not slide, it ploughs. */
    _kickDust(count: number) {
      for (let i = 0; i < count; i++) {
        this.particleSystem.addParticle({
          x: this.owner.position.x + random(-16, 16),
          y: this.owner.position.y + random(-12, 12),
          size: random(10, 22),
          opacity: random(90, 150),
        });
      }
    }

    update() {
      this.age += deltaTime;
      this.position = this.owner.position.copy();

      if (frameCount % 3 === 0) this._kickDust(2);

      const dashOver = !this.dashBuff || this.dashBuff.toRemove;
      if (dashOver || this.age >= CHARGE_TIMEOUT_MS) this.toRemove = true;
    }

    draw() {
      const pulse = 0.55 + 0.45 * sin(this.age / 90);

      push();
      translate(this.landing.x, this.landing.y);

      // The exact area about to be hit. A dashed rim rather than a solid one, so
      // it is never mistaken for a wall or a zone that is already live.
      noFill();
      stroke(ROCK_LIT[0], ROCK_LIT[1], ROCK_LIT[2], 130 + 70 * pulse);
      strokeWeight(4);
      const segments = 22;
      for (let i = 0; i < segments; i++) {
        if (i % 2) continue;
        const a1 = (TWO_PI * i) / segments - this.age / 800;
        const a2 = (TWO_PI * (i + 1)) / segments - this.age / 800;
        arc(0, 0, this.hitRadius * 2, this.hitRadius * 2, a1, a2);
      }

      // dust already settling in the middle of it, tightening as he closes
      const closing = 1 - constrain(this.owner.position.dist(this.landing) / MAX_RANGE, 0, 1);
      noStroke();
      fill(DUST[0], DUST[1], DUST[2], 30 + 45 * closing);
      circle(0, 0, this.hitRadius * 2 * (0.25 + 0.55 * closing));
      pop();
    }

    getDisplayBoundingBox() {
      // Covers both ends of the charge: the boulder and the circle it is aimed at.
      const minX = Math.min(this.landing.x, this.owner.position.x) - this.hitRadius;
      const minY = Math.min(this.landing.y, this.owner.position.y) - this.hitRadius;
      return new Rectangle({
        x: minX,
        y: minY,
        w: Math.abs(this.landing.x - this.owner.position.x) + this.hitRadius * 2,
        h: Math.abs(this.landing.y - this.owner.position.y) + this.hitRadius * 2,
        data: this,
      });
    }
  }
  return Malphite_R_Charge;
}
const __cacheMalphite_R_Charge = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_R_Charge>>();
export function makeMalphite_R_Charge(api: ContentApi) {
  const cached = __cacheMalphite_R_Charge.get(api);
  if (cached) return cached;
  const built = __buildMalphite_R_Charge(api);
  __cacheMalphite_R_Charge.set(api, built);
  return built;
}


/** One slab of ground heaved up by the impact. */
interface Plate {
  angle: number;
  /** How far from the centre the slab stands. */
  distance: number;
  width: number;
  height: number;
  /** How far it tips outward once it is up. */
  tilt: number;
}


/** One splinter of rock thrown clear of it. */
interface Shard {
  angle: number;
  speed: number;
  size: number;
  spin: number;
  /** Shards arc up and fall back; each carries its own hop height. */
  hop: number;
}


/**
 * Unstoppable Force, the landing.
 *
 * It used to be a single orange circle fading its alpha out — the same picture
 * a fire spell would leave, and nothing about it said a mountain had just hit
 * the floor. What lands now is stone: slabs of ground shoved up around the rim,
 * splinters thrown clear on parabolas, cracks running out past the hit radius
 * and a dust cloud settling over all of it.
 *
 * Deliberately *not* an `AoePulse`. Rammus already owns `crater` and Alistar
 * owns `stomp`; a third champion borrowing either would put six area effects
 * back to looking like each other, which is the exact problem those styles were
 * invented to solve. Malphite's impact is plates and grit, and it is his.
 */
function __buildMalphite_R_Object(api: ContentApi) {
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const SpellObject = api.SpellObject;
  class Malphite_R_Object extends SpellObject {
    position = this.owner.position.copy();
    lifeTime = IMPACT_MS;
    age = 0;
    hitRadius = HIT_RADIUS;

    _plates: Plate[] = [];
    _shards: Shard[] = [];

    particleSystem = PredefinedParticleSystems.smoke([...DUST], 0.7, 4);

    onAdded() {
      super.onAdded();

      for (let i = 0; i < PLATE_COUNT; i++) {
        this._plates.push({
          angle: (TWO_PI * i) / PLATE_COUNT + random(-0.12, 0.12),
          distance: this.hitRadius * random(0.72, 0.96),
          width: this.hitRadius * random(0.22, 0.4),
          height: this.hitRadius * random(0.3, 0.55),
          tilt: random(0.12, 0.4),
        });
      }

      for (let i = 0; i < SHARD_COUNT; i++) {
        this._shards.push({
          angle: (TWO_PI * i) / SHARD_COUNT + random(-0.2, 0.2),
          speed: random(0.8, 1.4),
          size: this.hitRadius * random(0.07, 0.15),
          spin: random(-0.25, 0.25),
          hop: this.hitRadius * random(0.12, 0.3),
        });
      }

      this.game.objectManager.addObject(this.particleSystem);
      for (let i = 0; i < 18; i++) {
        const a = random(TWO_PI);
        const d = random(this.hitRadius * 0.7);
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * d,
          y: this.position.y + sin(a) * d,
          size: random(this.hitRadius * 0.25, this.hitRadius * 0.55),
          opacity: random(110, 180),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
      }
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // The ground is shoved up fast and settles back slowly, which is what makes
      // this feel heavy: the rise is over in a fifth of the effect's life.
      const heave = constrain(t / 0.2, 0, 1);
      const settle = 1 - constrain((t - 0.45) / 0.55, 0, 1);
      const flash = 1 - constrain(t / 0.16, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // The floor of the crater — pulverised rock, not a coloured disc.
      noStroke();
      fill(ROCK_DARK[0], ROCK_DARK[1], ROCK_DARK[2], 120 * fade);
      circle(0, 0, this.hitRadius * 2 * (0.5 + 0.5 * heave));

      // Cracks running out past the rim, so the hit radius has an edge that is
      // read rather than measured.
      stroke(ROCK_DARK[0], ROCK_DARK[1], ROCK_DARK[2], 210 * fade);
      strokeWeight(3 * fade + 1);
      noFill();
      for (const plate of this._plates) {
        const inner = this.hitRadius * 0.25;
        const outer = this.hitRadius * (1.05 + 0.3 * Math.abs(sin(plate.angle * 3.1))) * heave;
        const kink = plate.angle + 0.16 * sin(plate.angle * 5);
        line(
          cos(plate.angle) * inner,
          sin(plate.angle) * inner,
          cos(kink) * outer,
          sin(kink) * outer
        );
      }

      // The rim itself.
      stroke(ROCK_LIT[0], ROCK_LIT[1], ROCK_LIT[2], 200 * fade);
      strokeWeight(6 * fade + 2);
      circle(0, 0, this.hitRadius * 2 * (0.55 + 0.45 * heave));

      // Slabs of ground standing on end around it, tipping outward as they rise
      // and sinking back as the effect ends.
      noStroke();
      for (const plate of this._plates) {
        const stand = heave * settle;
        if (stand <= 0.01) continue;
        const height = plate.height * stand;
        push();
        translate(cos(plate.angle) * plate.distance, sin(plate.angle) * plate.distance);
        rotate(plate.angle + HALF_PI + plate.tilt * stand);
        // shadowed body of the slab, wider at the ground than at the top
        fill(ROCK_DARK[0], ROCK_DARK[1], ROCK_DARK[2], 235 * fade);
        quad(
          -plate.width / 2,
          0,
          plate.width / 2,
          0,
          plate.width * 0.3,
          -height,
          -plate.width * 0.34,
          -height
        );
        // the lit face along its leading edge
        fill(ROCK_LIT[0], ROCK_LIT[1], ROCK_LIT[2], 220 * fade);
        quad(
          plate.width * 0.16,
          0,
          plate.width / 2,
          0,
          plate.width * 0.3,
          -height,
          plate.width * 0.14,
          -height
        );
        pop();
      }

      // Splinters thrown clear, arcing up and coming back down.
      for (const shard of this._shards) {
        const distance = this.hitRadius * (0.2 + 1.15 * t) * shard.speed;
        const lift = sin(constrain(t, 0, 1) * PI) * shard.hop;
        push();
        translate(cos(shard.angle) * distance, sin(shard.angle) * distance - lift);
        rotate(shard.angle + this.age * shard.spin * 0.02);
        fill(ROCK_LIT[0], ROCK_LIT[1], ROCK_LIT[2], 235 * fade);
        const size = shard.size * (1 - t * 0.4);
        // an irregular chip of rock, never a neat triangle
        quad(-size, -size * 0.55, size * 0.85, -size, size, size * 0.65, -size * 0.5, size);
        pop();
      }

      // The instant of contact.
      if (flash > 0) {
        noStroke();
        fill(255, 245, 225, 190 * flash);
        circle(0, 0, this.hitRadius * 0.9 * flash + 22);
        noFill();
        stroke(240, 232, 210, 235 * flash);
        strokeWeight(7 * flash + 2);
        circle(0, 0, this.hitRadius * 2 * (1 - flash) + 20);
      }

      pop();
    }

    getDisplayBoundingBox() {
      // The shards fly well past the hit radius, and the cracks past them.
      const span = this.hitRadius * 2.2;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Malphite_R_Object;
}
const __cacheMalphite_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMalphite_R_Object>>();
export function makeMalphite_R_Object(api: ContentApi) {
  const cached = __cacheMalphite_R_Object.get(api);
  if (cached) return cached;
  const built = __buildMalphite_R_Object(api);
  __cacheMalphite_R_Object.set(api, built);
  return built;
}