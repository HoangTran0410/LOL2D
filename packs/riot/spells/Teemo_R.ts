import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Teemo_R = InstanceType<ReturnType<typeof makeTeemo_R>>;
type Teemo_R_Buff = InstanceType<ReturnType<typeof makeTeemo_R_Buff>>;
type Teemo_R_Object = InstanceType<ReturnType<typeof makeTeemo_R_Object>>;



export const THROW_RANGE = 100;

export const INVISIBLE_AFTER_MS = 1000;

export const SHROOM_LIFETIME_MS = 20000;

export const EXPLODE_RANGE = 200;

export const EXPLODE_LIFETIME_MS = 1500;

export const DAMAGE = 30;

export const SLOW_PERCENT = 0.7;

export const SLOW_MS = 2000;


/** Spore puffs thrown by the burst. Seeded once — see `_spores`. */
export const SPORE_COUNT = 16;

/** Fraction of the burst spent on the white flash. */
export const FLASH_FRACTION = 0.18;


const TOXIC_DARK: [number, number, number] = [78, 118, 34];

const TOXIC: [number, number, number] = [150, 205, 60];

const TOXIC_BRIGHT: [number, number, number] = [225, 255, 140];


function __buildTeemo_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Teemo_R_Object = makeTeemo_R_Object(api);
  class Teemo_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_teemo_r');
    name = 'Bẫy Độc (Teemo_R)';
    description =
      'Đặt 1 bẫy độc tàng hình sau <span class="time">1 giây</span>, tồn tại trong <span class="time">20 giây</span>, phát nổ khi kẻ địch dẫm phải, <span class="buff">Làm Chậm 70%</span> các kẻ địch trong <span class="time">2 giây</span> và gây <span class="damage">30 sát thương</span> <i>(sẽ nảy nếu đặt trên bẫy độc khác)</i>';

    coolDown = 3000;

    manaCost = 30;

    onSpellCast() {
      let { from, to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        THROW_RANGE
      );

      let obj = new Teemo_R_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      obj.invisibleAfter = INVISIBLE_AFTER_MS;
      obj.lifeTime = SHROOM_LIFETIME_MS;
      obj.explodeRange = EXPLODE_RANGE;
      obj.throwRange = THROW_RANGE;

      this.game.objectManager.addObject(obj);
    }
  }
  return Teemo_R;
}
const __cacheTeemo_R = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_R>>();
export default function makeTeemo_R(api: ContentApi) {
  const cached = __cacheTeemo_R.get(api);
  if (cached) return cached;
  const built = __buildTeemo_R(api);
  __cacheTeemo_R.set(api, built);
  return built;
}


function __buildTeemo_R_Buff(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const Slow = api.buffs.Slow;
  class Teemo_R_Buff extends Slow {
    image = api.asset('spell_teemo_r');
    buffAddType = BuffAddType.RENEW_EXISTING;
    percent = SLOW_PERCENT;
  }
  return Teemo_R_Buff;
}
const __cacheTeemo_R_Buff = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_R_Buff>>();
export function makeTeemo_R_Buff(api: ContentApi) {
  const cached = __cacheTeemo_R_Buff.get(api);
  if (cached) return cached;
  const built = __buildTeemo_R_Buff(api);
  __cacheTeemo_R_Buff.set(api, built);
  return built;
}


/** One puff of spores thrown out by the burst, with its own fixed trajectory. */
interface Spore {
  angle: number;
  /** Share of the blast radius this one covers. */
  speed: number;
  size: number;
  /** Puffs arc up and settle, so each carries its own hop height. */
  hop: number;
  /** Radians of tumble over the whole burst. */
  spin: number;
}


function __buildTeemo_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Teemo_R_Object extends SpellObject {
    isMissile = true;
    position = createVector();
    destination = createVector();
    originalPosition!: p5.Vector;
    invisibleAfter = INVISIBLE_AFTER_MS;
    lifeTime = SHROOM_LIFETIME_MS;
    age = 0;
    moveSpeed = 6;
    explodeRange = EXPLODE_RANGE;
    explodeLifeTime = EXPLODE_LIFETIME_MS;
    throwRange = THROW_RANGE;
    bouncedOn: Teemo_R_Object[] = [];

    size = 50;
    curSize = this.size;
    angle = 0;
    mushroom_spots = [
      { x: 0, y: 0, r: 16 },
      { x: -5, y: -16, r: 18 },
      { x: 8, y: -16, r: 13 },
      { x: 20, y: 14, r: 14 },
      { x: -20, y: 14, r: 14 },
    ];

    /**
     * Rolled once, in `onAdded`, and never again.
     *
     * This used to be `random()` and `p5.Vector.random2D()` called from inside
     * `draw()`, which meant every spore was somewhere else on every frame: the
     * burst flickered like static instead of expanding. Anything an effect wants
     * to *animate* has to be fixed data driven by progress — here `t`, below —
     * not a fresh roll each time the frame comes round.
     */
    _spores: Spore[] = [];

    /** Toxic motes: the cloud that hangs after the puffs have landed. */
    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(178, 226, 84, 0.62)',
      0.16
    );

    static PHASES = {
      MOVING: 0,
      INVISIBLE: 1,
      exploding: 2,
    };
    phase = Teemo_R_Object.PHASES.MOVING;

    onAdded() {
      for (let i = 0; i < SPORE_COUNT; i++) {
        this._spores.push({
          // evenly spread, then nudged, so the burst is a ring with character
          // rather than either a clock face or a clump
          angle: (TWO_PI * i) / SPORE_COUNT + random(-0.18, 0.18),
          speed: random(0.62, 1.05),
          size: random(9, 19),
          hop: random(8, 26),
          spin: random(-2.4, 2.4),
        });
      }

      this.game.objectManager.addObject(this.particleSystem);
      // The shroom can sit armed for twenty seconds before it has a single mote
      // to show; an empty system removes itself on its first update, so draining
      // it is this object's job.
      this.particleSystem.autoRemoveIfEmpty = false;
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    update() {
      if (!this.originalPosition) {
        this.originalPosition = this.position.copy();
      }

      // update size
      this.curSize = lerp(this.curSize, this.size, 0.1);

      // moving phase
      if (this.phase === Teemo_R_Object.PHASES.MOVING) {
        // it tumbles through the air, which is what sells it as thrown rather
        // than slid along the ground
        this.angle += 0.08;
        VectorUtils.moveVectorToVector(this.position, this.destination, this.moveSpeed);

        if (this.position.dist(this.destination) < this.moveSpeed) {
          // check collide with other teemo R
          let others = this.game.objectManager.queryObjects({
            area: new Circle({
              x: this.destination.x,
              y: this.destination.y,
              r: this.size / 2,
            }),
            filters: [
              (o): o is Teemo_R_Object =>
                o instanceof Teemo_R_Object &&
                o.phase === Teemo_R_Object.PHASES.INVISIBLE &&
                o !== this &&
                this.bouncedOn.indexOf(o) === -1,
            ],
          });
          if (others?.length > 0) {
            const newDest = VectorUtils.moveVectorToVector(
              this.originalPosition,
              this.destination,
              this.throwRange * 2
            );
            this.originalPosition = this.position.copy();
            this.destination = newDest.copy();
            this.bouncedOn.push(others[0]);
            this.curSize = this.size + 10;
          } else {
            this.position = this.destination.copy();
            this.isMissile = false; // yasuo W cant block this
            this.phase = Teemo_R_Object.PHASES.INVISIBLE;
            this._puff(5, 6, 3); // it bites into the ground
          }
        }
      }

      // invisible phase
      else if (this.phase === Teemo_R_Object.PHASES.INVISIBLE) {
        // rotate and check age
        this.angle += 0.02;
        this.age += deltaTime;
        if (this.age > this.lifeTime) {
          this.toRemove = true;
        }

        if (this.age > this.invisibleAfter) {
          // check collide with enemy
          let enemies = this.game.objectManager.queryObjects({
            area: new Circle({
              x: this.position.x,
              y: this.position.y,
              r: this.size / 2,
            }),
            filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
          });

          let enemyStepIn = enemies?.[0];
          if (enemyStepIn) {
            let enemiesInRange = this.game.objectManager.queryObjects({
              area: new Circle({
                x: this.position.x,
                y: this.position.y,
                r: this.explodeRange / 2,
              }),
              filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId as any)],
            });

            enemiesInRange.forEach((enemy: any) => {
              let slowBuff = new Slow(SLOW_MS, this.owner, enemy);
              slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
              slowBuff.percent = SLOW_PERCENT;
              enemy.addBuff(slowBuff);
              enemy.takeDamage(DAMAGE, this.owner);
            });

            this.phase = Teemo_R_Object.PHASES.exploding;
            this.age = 0; // reset age
            this.size = this.explodeRange;
            this.visionRadius = this.explodeRange;
            this._puff(22, this.explodeRange / 2, 9);
          }
        }
      }

      // exploding phase
      else if (this.phase === Teemo_R_Object.PHASES.exploding) {
        this.age += deltaTime;
        // a second, slower wave of motes so the cloud keeps breathing while the
        // slow it applied is still running
        if (this.age < this.explodeLifeTime * 0.5 && random() < 0.35) {
          this._puff(1, this.explodeRange / 2, 7);
        }
        if (this.age > this.explodeLifeTime) {
          this.toRemove = true;
        }
      }
    }

    /** `count` motes scattered within `spread` of the shroom. */
    _puff(count: number, spread: number, maxSize: number) {
      for (let i = 0; i < count; i++) {
        const a = random(TWO_PI);
        const d = random(0, spread);
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * d,
          y: this.position.y + sin(a) * d,
          r: random(maxSize * 0.4, maxSize),
        });
      }
    }

    draw() {
      // moving phase + invisible phase
      if (
        this.phase === Teemo_R_Object.PHASES.MOVING ||
        this.phase === Teemo_R_Object.PHASES.INVISIBLE
      ) {
        let alpha =
          this.phase === Teemo_R_Object.PHASES.INVISIBLE && this.age > this.invisibleAfter ? 25 : 255;
        push();
        stroke(150, alpha);
        strokeWeight(this.curSize - this.size);
        fill(40, 97, 40, alpha);
        circle(this.position.x, this.position.y, this.curSize);

        noStroke();
        fill(114, 63, 127, alpha);
        for (let spot of this.mushroom_spots) {
          let x = spot.x * cos(this.angle) - spot.y * sin(this.angle);
          let y = spot.x * sin(this.angle) + spot.y * cos(this.angle);
          circle(this.position.x + x, this.position.y + y, spot.r);
        }

        pop();
      }

      // exploding phase
      else if (this.phase === Teemo_R_Object.PHASES.exploding) {
        this._drawBurst();
      }
    }

    /**
     * The burst, every value driven off one normalized progress.
     *
     * What the player has to read here is a radius: everything inside the rim
     * just took 30 damage and a 70% slow, and standing in the cloud for the next
     * two seconds is what that slow feels like. So the rim is hard-edged and the
     * gas inside it is soft.
     */
    _drawBurst() {
      const t = constrain(this.age / this.explodeLifeTime, 0, 1);
      const fade = 1 - t;
      // decelerating: the gas leaves fast and then settles, which is how a puff
      // of spores behaves and how a linear expansion never does
      const ease = 1 - (1 - t) * (1 - t) * (1 - t);
      const radius = this.explodeRange / 2;
      const flash = 1 - constrain(t / FLASH_FRACTION, 0, 1);
      const [dr, dg, db] = TOXIC_DARK;
      const [mr, mg, mb] = TOXIC;
      const [br, bg, bb] = TOXIC_BRIGHT;

      push();
      translate(this.position.x, this.position.y);

      // the gas filling the blast, growing into the rim it will settle at
      noStroke();
      fill(mr, mg, mb, 95 * fade);
      circle(0, 0, radius * 2 * (0.35 + 0.65 * ease));
      fill(dr, dg, db, 70 * fade);
      circle(0, 0, radius * 2 * (0.2 + 0.5 * ease));

      // the rim: exactly the radius that was damaged, so nobody has to guess
      noFill();
      stroke(dr, dg, db, 210 * fade);
      strokeWeight(8 * fade + 2);
      circle(0, 0, radius * 2);
      stroke(br, bg, bb, 235 * fade);
      strokeWeight(3 * fade + 1.5);
      circle(0, 0, radius * 2);

      // the wave racing out to that rim
      stroke(mr, mg, mb, 220 * fade);
      strokeWeight(9 * fade + 2);
      circle(0, 0, radius * 2 * (0.15 + 0.85 * ease));

      // the spore puffs themselves, on the trajectories rolled in onAdded
      for (const spore of this._spores) {
        const distance = radius * ease * spore.speed;
        // parabola: up out of the cap, then down into the cloud
        const lift = sin(t * PI) * spore.hop;
        const scale = (1 - t * 0.65) * (0.4 + 0.6 * constrain(t / 0.15, 0, 1));
        push();
        translate(cos(spore.angle) * distance, sin(spore.angle) * distance - lift);
        rotate(spore.spin * t);
        noStroke();
        fill(dr, dg, db, 230 * fade);
        circle(0, 0, spore.size * scale);
        fill(mr, mg, mb, 240 * fade);
        circle(0, -spore.size * 0.12 * scale, spore.size * 0.72 * scale);
        fill(br, bg, bb, 220 * fade);
        circle(-spore.size * 0.15 * scale, -spore.size * 0.2 * scale, spore.size * 0.3 * scale);
        pop();
      }

      // the pop itself, gone almost before it registers
      if (flash > 0) {
        noStroke();
        fill(245, 255, 205, 235 * flash);
        circle(0, 0, radius * 0.85 * flash + 22);
        noFill();
        stroke(255, 255, 230, 250 * flash);
        strokeWeight(5);
        circle(0, 0, radius * 1.5 * (1 - flash) + 20);
      }

      pop();
    }

    getDisplayBoundingBox() {
      // the burst throws puffs a little past its own rim and the flash ring
      // overshoots it too, so the box is the blast plus a margin
      const reach =
        this.phase === Teemo_R_Object.PHASES.exploding
          ? this.explodeRange / 2 + 45
          : this.size / 2 + 12;
      return this.squareDisplayBoundingBox(reach * 2);
    }
  }
  return Teemo_R_Object;
}
const __cacheTeemo_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_R_Object>>();
export function makeTeemo_R_Object(api: ContentApi) {
  const cached = __cacheTeemo_R_Object.get(api);
  if (cached) return cached;
  const built = __buildTeemo_R_Object(api);
  __cacheTeemo_R_Object.set(api, built);
  return built;
}