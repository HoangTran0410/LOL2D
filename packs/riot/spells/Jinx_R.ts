import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Jinx_R = InstanceType<ReturnType<typeof makeJinx_R>>;
type Jinx_R_Object = InstanceType<ReturnType<typeof makeJinx_R_Object>>;
type Jinx_R_Smoke = InstanceType<ReturnType<typeof makeJinx_R_Smoke>>;



export const BLAST_RADIUS = 200;

export const BASE_DAMAGE = 34;

export const MAX_MISSING_HEALTH_BONUS = 40;

/** Wiki: 10% of the damage at the muzzle, 100% once it has gone the distance. */
export const MIN_TRAVEL_SCALE = 0.1;

export const FULL_POWER_DISTANCE = 2_000;

export const SPEED = 16;

export const MAX_SPEED = 30;

/** Not a range — a leash, so a rocket into empty map is collected. */
export const MAX_TRAVEL = 12_000;


/**
 * Collision width, and the width the rocket is *drawn*. The two are one number
 * on purpose: a warhead painted twice the size of the thing that hits is a lie
 * the player pays for.
 */
export const SIZE = 56;

/** Nose to tail, drawn. Longer than it is wide — it is a missile, not a ball. */
export const ROCKET_LENGTH = 158;


/**
 * How far the rocket travels between puffs of exhaust.
 *
 * Under the puff's own starting diameter, deliberately: at a step wider than
 * the puff the plume came out as a row of evenly spaced beads instead of a
 * trail. Overlap is what makes it read as one continuous thing.
 */
export const SMOKE_STEP = 44;

/** How long one puff hangs in the air before it has dissipated. */
export const SMOKE_MS = 1_500;

export const SMOKE_RADIUS = 40;


/**
 * Super Mega Death Rocket!
 *
 * From `docs/abilities/jinx/r.json`: direction-targeted, **Global**, speed
 * 1700 rising to 2200, and it explodes on colliding with an enemy *champion*.
 * Damage runs 10%–100% based on distance travelled, with a separate bonus off
 * the target's missing health.
 *
 * The first pass had it as a 1400px shot that "armed" after 300px. That was a
 * guess standing in for the real rule, and it got both halves wrong: the
 * ability is global, and the distance does not gate the rocket, it *scales*
 * it. Firing across the map is the point, and firing it next to you is weak
 * rather than forbidden.
 */
function __buildJinx_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Jinx_R_Object = makeJinx_R_Object(api);
  const Jinx_R_Smoke = makeJinx_R_Smoke(api);
  class Jinx_R extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_jinx_r');
    name = 'Tên Lửa Đạn Đạo Siêu Khủng Khiếp! (Jinx_R)';
    description =
      `Phóng một quả tên lửa <span class="buff">bay khắp bản đồ</span>, chỉ nổ khi trúng` +
      ` <span class="damage">tướng địch</span> (đi xuyên qua lính). Bay càng xa càng nhanh và càng mạnh:` +
      ` sát thương từ <span class="damage">${MIN_TRAVEL_SCALE * 100}%</span> tới` +
      ` <span class="damage">100%</span> của <span class="damage">${BASE_DAMAGE}</span> theo quãng đường,` +
      ` cộng thêm tới <span class="damage">${MAX_MISSING_HEALTH_BONUS} sát thương</span> theo lượng máu mục tiêu đã mất.` +
      ` Nổ trong bán kính <span>${BLAST_RADIUS}px</span>`;
    coolDown = 10000;
    manaCost = 90;

    /** The touch layer draws a telegraph at this; the rocket itself is not bounded by it. */
    range = 1_200;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);
      const rocket = new Jinx_R_Object(this.owner);
      rocket.launchedFrom = this.owner.position.copy();
      rocket.heading = to.copy().sub(this.owner.position);
      if (rocket.heading.magSq() === 0) rocket.heading = this.game.facing(this.owner);
      rocket.heading.setMag(1);
      rocket.destination = to;
      this.game.objectManager.addObject(rocket);

      // The exhaust is its own object, not part of the rocket's `draw()`.
      // `ObjectManager.draw` culls by the drawer's own bounds, so a plume painted
      // by a rocket that is three screens away would vanish along with it — the
      // Lux R failure, exactly. A trail that outlives and out-reaches its painter
      // has to be the thing that owns those bounds.
      const smoke = new Jinx_R_Smoke(this.owner);
      smoke.source = rocket;
      rocket.smoke = smoke;
      this.game.objectManager.addObject(smoke);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Jinx_R;
}
const __cacheJinx_R = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_R>>();
export default function makeJinx_R(api: ContentApi) {
  const cached = __cacheJinx_R.get(api);
  if (cached) return cached;
  const built = __buildJinx_R(api);
  __cacheJinx_R.set(api, built);
  return built;
}


/**
 * Flies on its own heading rather than to a destination: a global shot has no
 * endpoint, so `MissileSpellObject`'s arrive-and-die is switched off and the
 * rocket steps along `heading` until a champion stops it.
 */
function __buildJinx_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const acceleratedSpeed = api.combat.GlobalShot.acceleratedSpeed;
  const enemyChampionsOnly = api.combat.GlobalShot.enemyChampionsOnly;
  const travelRamp = api.combat.GlobalShot.travelRamp;
  const MissileSpellObject = api.MissileSpellObject;
  const AoePulse = api.AoePulse;
  class Jinx_R_Object extends MissileSpellObject {
    size = SIZE;
    maxHitCount = 0; // its own collision, so it can ignore everything but champions
    removeOnArrive = false;
    launchedFrom: p5.Vector = this.owner.position.copy();
    heading: p5.Vector = createVector(1, 0);
    distanceTravelled = 0;
    smoke: Jinx_R_Smoke | null = null;

    update() {
      this.speed = acceleratedSpeed(this.distanceTravelled, SPEED, MAX_SPEED, FULL_POWER_DISTANCE);
      this.position.add(this.heading.copy().mult(this.speed));
      this.distanceTravelled += this.speed;
      // Keeps the drawn nose pointing down the flight path forever.
      this.destination = this.position.copy().add(this.heading.copy().mult(100));

      if (this.distanceTravelled >= MAX_TRAVEL) {
        this.toRemove = true;
        return;
      }

      const hit = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.size / 2 }),
        filters: enemyChampionsOnly(this.owner.teamId),
      });
      if (hit.length > 0) this.detonate();
    }

    /** 10% at the muzzle, 100% once it has gone the distance. */
    get travelScale(): number {
      return (
        MIN_TRAVEL_SCALE +
        (1 - MIN_TRAVEL_SCALE) * travelRamp(this.distanceTravelled, FULL_POWER_DISTANCE)
      );
    }

    detonate() {
      this.toRemove = true;
      const scaled = BASE_DAMAGE * this.travelScale;

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: BLAST_RADIUS }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        const max = enemy.stats?.maxHealth?.value ?? 0;
        const missing = max > 0 ? 1 - enemy.stats.health.value / max : 0;
        // The missing-health half is deliberately not scaled by distance — the
        // wiki calls that out explicitly.
        enemy.takeDamage(scaled + MAX_MISSING_HEALTH_BONUS * missing, this.owner);
      });

      // Two pulses, not one. A single ring is how every other area ability in the
      // game announces itself, and the ultimate that ends a teamfight cannot look
      // like a Nasus E: the fireball goes off first and fast, the crater it left
      // is still there a third of a second later.
      const fireball = new AoePulse(this.owner);
      fireball.position = this.position.copy();
      fireball.radius = BLAST_RADIUS * 1.15;
      fireball.lifeTime = 340;
      fireball.color = [255, 205, 120];
      // Fragmentation, the shape the whole Jinx kit detonates in: casing chunks
      // tumbling out through smoke. `shards` read as rock splinters and was
      // shared with four other champions, so the ultimate that ends a teamfight
      // looked like somebody's ground slam.
      fireball.style = 'frag';
      fireball.spokes = 18;
      // Hot, but not opaque: a 400px disc at full alpha hides the fight it just
      // decided, and the player has to be able to see who survived it.
      fireball.fillAlpha = 105;
      this.game.objectManager.addObject(fireball);

      const crater = new AoePulse(this.owner);
      crater.position = this.position.copy();
      crater.radius = BLAST_RADIUS;
      crater.lifeTime = 720;
      crater.color = [255, 130, 190];
      crater.style = 'crater';
      crater.spokes = 16;
      this.game.objectManager.addObject(crater);

      // The plume it was dragging balls up where it died instead of stopping mid
      // air with the rocket.
      this.smoke?.burst(this.position, BLAST_RADIUS * 0.8);
    }

    draw() {
      const angle = Math.atan2(this.heading.y, this.heading.x);
      const charge = this.travelScale;
      // Deterministic per-frame wobble: distance is the only thing that changes
      // every frame here, so the flame flickers without reading `frameCount`.
      const flicker = 0.72 + 0.28 * Math.sin(this.distanceTravelled * 0.4);
      const half = ROCKET_LENGTH / 2;
      const wide = SIZE / 2;
      // Keeps the painted face the right way up when the rocket flies west.
      const flip = Math.cos(angle) < 0 ? -1 : 1;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);
      scale(1, flip);
      noStroke();

      // Heat haze, sized by the ramp: a rocket that has crossed the map arrives
      // visibly hotter than one fired at your feet, which is the whole ability.
      blendMode(ADD);
      fill(255, 90, 150, 30 + 55 * charge);
      ellipse(-half * 0.35, 0, ROCKET_LENGTH * (0.95 + 0.55 * charge), SIZE * (1.7 + 0.7 * charge));
      blendMode(BLEND);

      // Exhaust: three nested cones down to a white-hot core.
      const plume = (70 + 210 * charge) * flicker;
      fill(255, 70, 40, 160);
      triangle(-half + 8, -wide * 0.8, -half + 8, wide * 0.8, -half - plume, 0);
      fill(255, 165, 60, 210);
      triangle(-half + 8, -wide * 0.55, -half + 8, wide * 0.55, -half - plume * 0.62, 0);
      fill(255, 248, 215, 240);
      triangle(-half + 8, -wide * 0.28, -half + 8, wide * 0.28, -half - plume * 0.3, 0);

      // Fins, swept back off the tail. Light enough to be seen against a nearly
      // black map — the first pass painted them in a plum that vanished into it.
      fill(150, 62, 118);
      quad(
        -half + 6,
        -wide * 0.72,
        -half + 30,
        -wide * 1.5,
        -half + 56,
        -wide * 1.2,
        -half + 44,
        -wide * 0.66
      );
      quad(
        -half + 6,
        wide * 0.72,
        -half + 30,
        wide * 1.5,
        -half + 56,
        wide * 1.2,
        -half + 44,
        wide * 0.66
      );

      // Hull.
      const nose = half * 0.44;
      fill(228, 66, 148);
      rect(-half + 6, -wide * 0.78, nose + half - 6, wide * 1.56, wide * 0.5);
      // Warhead cone, and a collar where it meets the tube.
      fill(250, 236, 244);
      triangle(nose, -wide * 0.78, nose, wide * 0.78, half, 0);
      fill(120, 46, 96);
      rect(nose - 8, -wide * 0.8, 8, wide * 1.6);

      // Hazard banding, so the hull is not one flat slab of pink.
      fill(255, 255, 255, 60);
      for (let i = 0; i < 3; i++) {
        rect(-half + 24 + i * 26, -wide * 0.78, 7, wide * 1.56);
      }

      // The face. This is the tell: a grinning shark mouth is Jinx's rocket and
      // nobody else's, and it survives being shrunk to a dot at map zoom.
      fill(20, 12, 24);
      rect(-half + 22, wide * 0.18, 62, wide * 0.5, 4);
      fill(255, 250, 245);
      for (let i = 0; i < 5; i++) {
        const x = -half + 26 + i * 12;
        triangle(x, wide * 0.68, x + 10, wide * 0.68, x + 5, wide * 0.2);
      }
      fill(255, 252, 248);
      circle(nose - 26, -wide * 0.24, wide * 0.72);
      fill(28, 16, 32);
      circle(nose - 23, -wide * 0.24, wide * 0.32);

      // Shock cone off the nose, pulsing with the flame.
      noFill();
      stroke(255, 220, 240, 150 * flicker);
      strokeWeight(3);
      arc(half - 6, 0, 46, SIZE * 1.5, -1.0, 1.0);
      pop();
    }

    getDisplayBoundingBox() {
      // Generous: the plume alone reaches ~280 behind a fully charged rocket, and
      // the box is what decides whether any of this is drawn at all.
      const span = ROCKET_LENGTH * 1.6;
      return this.squareDisplayBoundingBox(span * 2);
    }
  }
  return Jinx_R_Object;
}
const __cacheJinx_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_R_Object>>();
export function makeJinx_R_Object(api: ContentApi) {
  const cached = __cacheJinx_R_Object.get(api);
  if (cached) return cached;
  const built = __buildJinx_R_Object(api);
  __cacheJinx_R_Object.set(api, built);
  return built;
}


/** One puff of exhaust, with its own clock and its own drift. */
interface SmokePuff {
  x: number;
  y: number;
  age: number;
  /** Fixed at birth so a puff does not shimmer between frames. */
  seed: number;
  /** Multiplier on how fat this one gets. */
  scale: number;
  life: number;
}


/**
 * The smoke trail the rocket drags across the map.
 *
 * A queue, like `Nocturne_Q_Trail`: the oldest puff dissipates first, so the
 * plume retreats from the tail rather than blinking out all at once, and it
 * keeps living after the rocket is gone. That is not decoration — a global
 * shot is a thing you fire *and then look away from*, and the smoke hanging
 * over the lane is how everyone else finds out where it came from.
 */
function __buildJinx_R_Smoke(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Jinx_R_Smoke extends SpellObject {
    source: Jinx_R_Object | null = null;
    puffs: SmokePuff[] = [];

    update() {
      const step = deltaTime;
      for (const puff of this.puffs) puff.age += step;
      while (this.puffs.length && this.puffs[0].age >= this.puffs[0].life) this.puffs.shift();

      this.paint();

      if (!this.puffs.length && !this.source) this.toRemove = true;
    }

    /** Drops a puff every `SMOKE_STEP` the rocket covers, not every frame. */
    paint() {
      const source = this.source;
      if (!source || source.toRemove) {
        this.source = null;
        return;
      }

      const { x, y } = source.position;
      const last = this.puffs[this.puffs.length - 1];
      if (last && Math.hypot(x - last.x, y - last.y) < SMOKE_STEP) return;
      this.puffs.push({
        x,
        y,
        age: 0,
        seed: Math.random() * Math.PI * 2,
        // Uneven on purpose: identical puffs read as a machine-made dotted line.
        scale: 0.8 + Math.random() * 0.5,
        life: SMOKE_MS,
      });
      this.position.set(x, y);
    }

    /** A ball of smoke where the rocket died, thrown outward from the blast. */
    burst(at: p5.Vector, radius: number) {
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const d = radius * (0.25 + 0.55 * Math.random());
        this.puffs.push({
          x: at.x + Math.cos(a) * d,
          y: at.y + Math.sin(a) * d,
          age: 0,
          seed: a,
          scale: 1.8,
          life: SMOKE_MS * 1.4,
        });
      }
    }

    draw() {
      push();
      noStroke();
      for (const puff of this.puffs) {
        const t = puff.age / puff.life;
        const fade = 1 - t;
        // Puffs bloom and drift as they age, so the plume widens behind the
        // rocket instead of sitting on the flight line as a row of dots.
        const grow = SMOKE_RADIUS * puff.scale * (0.7 + 0.95 * t);
        const drift = 24 * t * puff.scale;
        const x = puff.x + Math.cos(puff.seed) * drift;
        const y = puff.y + Math.sin(puff.seed) * drift;

        // Two offset lobes rather than one disc. A single circle is a bubble; a
        // pair that never quite line up is a cloud. Light rather than dark —
        // this map is nearly black, and the first pass in smoke-grey was all but
        // invisible on it.
        for (let k = 0; k < 2; k++) {
          const a = puff.seed + k * 2.4;
          fill(150, 136, 158, 62 * fade);
          circle(x + Math.cos(a) * grow * 0.3, y + Math.sin(a) * grow * 0.3, grow * 1.7);
        }
        fill(198, 186, 208, 46 * fade);
        circle(x, y, grow * 1.1);
        // Embers, only while the puff is young: the hot core of the exhaust.
        if (t < 0.3) {
          const heat = 1 - t / 0.3;
          fill(255, 120, 175, 210 * heat);
          circle(x, y, grow * 0.62 * heat + 6);
        }
      }
      pop();
    }

    getDisplayBoundingBox() {
      if (!this.puffs.length) {
        return new Rectangle({ x: this.position.x, y: this.position.y, w: 1, h: 1, data: this });
      }
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const puff of this.puffs) {
        if (puff.x < minX) minX = puff.x;
        if (puff.y < minY) minY = puff.y;
        if (puff.x > maxX) maxX = puff.x;
        if (puff.y > maxY) maxY = puff.y;
      }
      // The margin covers full bloom plus drift on the outermost puff.
      const margin = SMOKE_RADIUS * 2 * 1.8 + 40;
      return new Rectangle({
        x: minX - margin,
        y: minY - margin,
        w: maxX - minX + margin * 2,
        h: maxY - minY + margin * 2,
        data: this,
      });
    }
  }
  return Jinx_R_Smoke;
}
const __cacheJinx_R_Smoke = new WeakMap<ContentApi, ReturnType<typeof __buildJinx_R_Smoke>>();
export function makeJinx_R_Smoke(api: ContentApi) {
  const cached = __cacheJinx_R_Smoke.get(api);
  if (cached) return cached;
  const built = __buildJinx_R_Smoke(api);
  __cacheJinx_R_Smoke.set(api, built);
  return built;
}