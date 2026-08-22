import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type ParticleSystem = InstanceType<ContentApi['helpers']['ParticleSystem']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Veigar_E = InstanceType<ReturnType<typeof makeVeigar_E>>;
type Veigar_E_Object = InstanceType<ReturnType<typeof makeVeigar_E_Object>>;



export const CAST_RANGE = 300;

export const PREPARE_MS = 1000;

export const CAGE_LIFETIME_MS = 5000;

/** Outer diameter of the cage; the wall is `WALL_THICKNESS` either side of it. */
export const CAGE_SIZE = 300;

export const WALL_THICKNESS = 30;

/** Standing pillars around the rim — the bars of the cage. */
export const PILLAR_COUNT = 9;

/** Painted height of a pillar above its footprint. */
export const PILLAR_HEIGHT = 42;

/** Arcane runes orbiting inside the wall. */
export const RUNE_COUNT = 12;

/** How long the cage spends sinking back into the ground at the end. */
export const COLLAPSE_MS = 300;

/** How often a mote of dark matter peels off the wall. */
export const MOTE_INTERVAL_MS = 60;

export const STUN_TIME = 2000;


const VOID: [number, number, number] = [28, 12, 52];

const ARCANE: [number, number, number] = [70, 40, 162];

const ARCANE_BRIGHT: [number, number, number] = [178, 130, 255];


function __buildVeigar_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Veigar_E_Object = makeVeigar_E_Object(api);
  class Veigar_E extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_veigar_e');
    name = 'Bẻ Cong Không Gian (Veigar_E)';
    description = `Vặn xoắn không gian, tạo ra một lồng giam tồn tại trong <span class="time">${CAGE_LIFETIME_MS / 1000} giây</span>. <span class="buff">Làm Choáng</span> <span class="time">${STUN_TIME / 1000} giây</span> những kẻ địch dám bước qua.`;
    coolDown = 5000;
    manaCost = 50;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        CAST_RANGE
      );

      const obj = new Veigar_E_Object(this.owner);
      obj.position = to;
      this.game.objectManager.addObject(obj);
    }
  }
  return Veigar_E;
}
const __cacheVeigar_E = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_E>>();
export default function makeVeigar_E(api: ContentApi) {
  const cached = __cacheVeigar_E.get(api);
  if (cached) return cached;
  const built = __buildVeigar_E(api);
  __cacheVeigar_E.set(api, built);
  return built;
}


/** One jagged link of the lightning that crawls between two pillar tops. */
interface Crackle {
  /** Sideways offset of each kink, rolled once — a re-roll per frame is static. */
  kinks: number[];
  /** Phase of this arc's own flicker, so the nine of them never blink together. */
  phase: number;
}


function __buildVeigar_E_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Stun = api.buffs.Stun;
  const ParticleSystem = api.helpers.ParticleSystem;
  class Veigar_E_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    prepairTime = PREPARE_MS;
    lifeTime = CAGE_LIFETIME_MS;
    age = 0;
    strokeWidth = WALL_THICKNESS;
    size = CAGE_SIZE;

    static PHASES = {
      PREPAIRING: 0,
      ACTIVE: 1,
    } as const;
    phase: (typeof Veigar_E_Object.PHASES)[keyof typeof Veigar_E_Object.PHASES] =
      Veigar_E_Object.PHASES.PREPAIRING;

    /** Seeded once in `onAdded` — see `Crackle`. */
    _crackles: Crackle[] = [];
    /** Fixed rim directions the motes bleed off, so `update` never touches p5. */
    _rimDirs: { x: number; y: number }[] = [];
    _moteTimer = 0;
    _moteIndex = 0;
    /** Where the last victim walked through, and how recently. */
    _catchAngle = 0;
    _catchFlash = 0;

    particleSystem = new ParticleSystem({
      getParticlePosFn: (p: any) => ({ x: p.x, y: p.y }),
      getParticleSizeFn: (p: any) => p.r * 2,
      isDeadFn: (p: any) => p.r <= 0,
      updateFn: (p: any) => {
        p.r -= 0.3;
        // motes are dragged inward — the cage is eating the space around it
        p.x += p.vx + random(-0.6, 0.6);
        p.y += p.vy + random(-0.6, 0.6);
      },
      preDrawFn: () => {
        noStroke();
      },
      drawFn: (p: any) => {
        const alpha = map(this.age, this.prepairTime, this.lifeTime, 210, 40);
        fill(ARCANE_BRIGHT[0], ARCANE_BRIGHT[1], ARCANE_BRIGHT[2], alpha);
        ellipse(p.x, p.y, p.r * 2, p.r * 2);
        fill(VOID[0], VOID[1], VOID[2], alpha);
        ellipse(p.x, p.y, p.r, p.r);
      },
    });

    enemiesEffected: any[] = [];

    onAdded() {
      for (let i = 0; i < PILLAR_COUNT; i++) {
        const kinks: number[] = [];
        for (let k = 0; k < 4; k++) kinks.push(random(-9, 9));
        this._crackles.push({ kinks, phase: random(TWO_PI) });
      }
      // Rolled here rather than in `update`, which has to stay free of p5 vector
      // maths: the emitter is a plain add of two numbers.
      for (let i = 0; i < 24; i++) {
        const a = (i / 24) * TWO_PI;
        this._rimDirs.push({ x: cos(a), y: sin(a) });
      }

      this.game.objectManager.addObject(this.particleSystem);
      // The first mote is a whole second away — the cage does not start eating
      // space until it is drawn — and an empty system deletes itself on its first
      // update, which is why none of these motes had ever reached the screen.
      this.particleSystem.autoRemoveIfEmpty = false;
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    update() {
      this.age += deltaTime;
      if (this._catchFlash > 0) this._catchFlash -= deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
      }

      // prepairing phase
      if (this.phase === Veigar_E_Object.PHASES.PREPAIRING) {
        if (this.age >= this.prepairTime) {
          this.phase = Veigar_E_Object.PHASES.ACTIVE;
        }
      }

      // active phase
      else if (this.phase === Veigar_E_Object.PHASES.ACTIVE) {
        // check collision
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.position.x,
            y: this.position.y,
            r: this.size / 2,
          }),
          filters: [
            PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
            PredefinedFilters.excludeObjects(this.enemiesEffected),
            (o: any) => {
              const distance = o.position.dist(this.position);
              // collide with edge of the circle
              return (
                distance <= this.size / 2 + this.strokeWidth / 2 &&
                distance >= this.size / 2 - this.strokeWidth / 2
              );
            },
          ],
        });

        enemies.forEach((enemy: any) => {
          const stunBuff = new Stun(STUN_TIME, this.owner, enemy);
          enemy.addBuff(stunBuff);

          this.enemiesEffected.push(enemy);
          // Cosmetic: the wall lights up where it caught someone, so a stun that
          // came from a cage edge is never mistaken for a stun from anywhere else.
          this._catchAngle = Math.atan2(
            enemy.position.y - this.position.y,
            enemy.position.x - this.position.x
          );
          this._catchFlash = 420;
        });

        // update particle system
        this._moteTimer += deltaTime;
        if (this._moteTimer >= MOTE_INTERVAL_MS && this._rimDirs.length) {
          this._moteTimer = 0;
          const dir = this._rimDirs[this._moteIndex++ % this._rimDirs.length];
          const reach = this.size / 2 + random(-this.strokeWidth / 2, this.strokeWidth / 2);
          this.particleSystem.addParticle({
            x: this.position.x + dir.x * reach,
            y: this.position.y + dir.y * reach - random(0, PILLAR_HEIGHT),
            // inward drift, at a tenth of the rim radius per second
            vx: -dir.x * 0.35,
            vy: -dir.y * 0.35,
            r: random(6, 11),
          });
        }
      }
    }

    draw() {
      push();
      if (this.phase === Veigar_E_Object.PHASES.PREPAIRING) {
        this._drawInscription();
      } else {
        this._drawCage();
      }
      pop();
    }

    /**
     * The first second: Veigar draws the circle before it means anything. Enemies
     * get that whole second to be somewhere else, so the telegraph has to be
     * unmistakable — a bright head running round a widening groove.
     */
    _drawInscription() {
      const t = constrain(this.age / this.prepairTime, 0, 1);
      const alpha = 220 * t;
      const radius = this.size / 2;
      const head = TWO_PI * t - HALF_PI;

      push();
      translate(this.position.x, this.position.y);

      // the groove being cut, thickening as it is carved
      noFill();
      stroke(VOID[0], VOID[1], VOID[2], alpha * 0.9);
      strokeWeight(this.strokeWidth * (0.4 + 0.6 * t));
      arc(0, 0, this.size, this.size, -HALF_PI, head);
      stroke(ARCANE[0], ARCANE[1], ARCANE[2], alpha);
      strokeWeight(this.strokeWidth * 0.55 * (0.4 + 0.6 * t));
      arc(0, 0, this.size, this.size, -HALF_PI, head);

      // the stylus: a bright spark at the leading edge, which is the thing the
      // eye actually tracks round the circle
      noStroke();
      fill(ARCANE_BRIGHT[0], ARCANE_BRIGHT[1], ARCANE_BRIGHT[2], 90);
      circle(cos(head) * radius, sin(head) * radius, 46);
      fill(245, 230, 255, 240);
      circle(cos(head) * radius, sin(head) * radius, 14);

      // runes lighting up behind the stylus, one by one
      for (let i = 0; i < RUNE_COUNT; i++) {
        const a = (i / RUNE_COUNT) * TWO_PI - HALF_PI;
        if (a > head) continue;
        this._drawRune(cos(a) * radius, sin(a) * radius, a, alpha);
      }

      // inner sigil, so the interior is claimed ground from the start
      noFill();
      stroke(ARCANE[0], ARCANE[1], ARCANE[2], alpha * 0.45);
      strokeWeight(2);
      circle(0, 0, this.size * 0.62 * t);
      circle(0, 0, this.size * 0.3 * t);
      pop();
    }

    /** The standing cage: nine arcane pillars with lightning strung between them. */
    _drawCage() {
      const t = constrain((this.age - this.prepairTime) / (this.lifeTime - this.prepairTime), 0, 1);
      // it sinks back where it came from rather than blinking out
      const collapse = constrain((this.age - (this.lifeTime - COLLAPSE_MS)) / COLLAPSE_MS, 0, 1);
      const standing = 1 - collapse;
      const alpha = (215 - 120 * t) * standing;
      const radius = this.size / 2;
      const spin = this.age / 1400;

      push();
      translate(this.position.x, this.position.y);

      // the void the cage sits on: darker than the terrain, so the wall never
      // gets lost against a bright patch of map
      noStroke();
      fill(VOID[0], VOID[1], VOID[2], 70 * standing);
      circle(0, 0, this.size - this.strokeWidth);

      // the wall itself, the band that actually stuns
      noFill();
      stroke(VOID[0], VOID[1], VOID[2], alpha);
      strokeWeight(this.strokeWidth);
      circle(0, 0, this.size);
      stroke(ARCANE[0], ARCANE[1], ARCANE[2], alpha);
      strokeWeight(this.strokeWidth * 0.55 + sin(this.age / 200) * 2);
      circle(0, 0, this.size);
      stroke(ARCANE_BRIGHT[0], ARCANE_BRIGHT[1], ARCANE_BRIGHT[2], alpha * 0.8);
      strokeWeight(2);
      circle(0, 0, this.size + this.strokeWidth / 2);
      circle(0, 0, this.size - this.strokeWidth / 2);

      // pillars, standing out of the band
      const height = PILLAR_HEIGHT * standing;
      for (let i = 0; i < PILLAR_COUNT; i++) {
        const a = (i / PILLAR_COUNT) * TWO_PI + spin;
        const bx = cos(a) * radius;
        const by = sin(a) * radius;
        noStroke();
        fill(VOID[0], VOID[1], VOID[2], 235 * standing);
        quad(bx - 8, by, bx + 8, by, bx + 5, by - height, bx - 5, by - height);
        fill(ARCANE[0], ARCANE[1], ARCANE[2], alpha);
        quad(bx - 5, by, bx + 5, by, bx + 3, by - height, bx - 3, by - height);
        // the cap glows: the eye lands on a row of lights, not a row of sticks
        fill(ARCANE_BRIGHT[0], ARCANE_BRIGHT[1], ARCANE_BRIGHT[2], 235 * standing);
        circle(bx, by - height, 8 + sin(this.age / 130 + i) * 2);
      }

      // lightning strung pillar to pillar, each arc flickering on its own phase
      if (height > 4) {
        for (let i = 0; i < PILLAR_COUNT; i++) {
          const crackle = this._crackles[i];
          if (!crackle) continue;
          const lit = sin(this.age / 110 + crackle.phase);
          if (lit < 0.15) continue;
          const a0 = (i / PILLAR_COUNT) * TWO_PI + spin;
          const a1 = ((i + 1) / PILLAR_COUNT) * TWO_PI + spin;
          noFill();
          stroke(ARCANE_BRIGHT[0], ARCANE_BRIGHT[1], ARCANE_BRIGHT[2], 200 * lit * standing);
          strokeWeight(2);
          beginShape();
          vertex(cos(a0) * radius, sin(a0) * radius - height);
          for (let k = 0; k < crackle.kinks.length; k++) {
            const f = (k + 1) / (crackle.kinks.length + 1);
            const a = lerp(a0, a1, f);
            // the kink swings across the span instead of being re-rolled, which
            // is what makes it read as one arc moving rather than static noise
            const swing = crackle.kinks[k] * sin(this.age / 70 + crackle.phase + k);
            vertex(cos(a) * (radius + swing), sin(a) * (radius + swing) - height);
          }
          vertex(cos(a1) * radius, sin(a1) * radius - height);
          endShape();
        }
      }

      // runes orbiting the inside of the wall, counter to the pillars
      for (let i = 0; i < RUNE_COUNT; i++) {
        const a = (i / RUNE_COUNT) * TWO_PI - spin * 1.6;
        const r = radius - this.strokeWidth * 0.75;
        this._drawRune(cos(a) * r, sin(a) * r, a, alpha * 0.85);
      }

      // where the last victim was caught
      if (this._catchFlash > 0) {
        const flash = constrain(this._catchFlash / 420, 0, 1);
        const cx = cos(this._catchAngle) * radius;
        const cy = sin(this._catchAngle) * radius;
        noStroke();
        fill(240, 225, 255, 210 * flash);
        circle(cx, cy - height * 0.5, 26 + 70 * (1 - flash));
        noFill();
        stroke(ARCANE_BRIGHT[0], ARCANE_BRIGHT[1], ARCANE_BRIGHT[2], 230 * flash);
        strokeWeight(4 * flash + 1);
        circle(cx, cy, 40 + 90 * (1 - flash));
      }

      pop();
    }

    /** A single sliver of Veigar's script, standing on end at `(x, y)`. */
    _drawRune(x: number, y: number, angle: number, alpha: number) {
      push();
      translate(x, y);
      rotate(angle + HALF_PI);
      noStroke();
      fill(ARCANE_BRIGHT[0], ARCANE_BRIGHT[1], ARCANE_BRIGHT[2], alpha);
      // a diamond with a bar through it: legible at this size, and nothing else
      // in the game draws it
      quad(0, -9, 6, 0, 0, 9, -6, 0);
      fill(245, 235, 255, alpha);
      rect(-3, -1.5, 6, 3);
      pop();
    }

    getDisplayBoundingBox() {
      // taller than it is wide: the pillars and their lightning paint above the
      // ring, and the mote drift reaches a little past the wall
      const halfWidth = this.size / 2 + this.strokeWidth;
      const top = this.size / 2 + this.strokeWidth + PILLAR_HEIGHT + 20;
      const bottom = this.size / 2 + this.strokeWidth;
      return new Rectangle({
        x: this.position.x - halfWidth,
        y: this.position.y - top,
        w: halfWidth * 2,
        h: top + bottom,
        data: this,
      });
    }
  }
  return Veigar_E_Object;
}
const __cacheVeigar_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildVeigar_E_Object>>();
export function makeVeigar_E_Object(api: ContentApi) {
  const cached = __cacheVeigar_E_Object.get(api);
  if (cached) return cached;
  const built = __buildVeigar_E_Object(api);
  __cacheVeigar_E_Object.set(api, built);
  return built;
}