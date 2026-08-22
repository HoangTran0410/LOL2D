import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ahri_W = InstanceType<ReturnType<typeof makeAhri_W>>;
type Ahri_W_Impact = InstanceType<ReturnType<typeof makeAhri_W_Impact>>;
type Ahri_W_Object = InstanceType<ReturnType<typeof makeAhri_W_Object>>;



/** Embers riding each wisp. Three fires × three embers is the nine-tail count. */
export const EMBERS_PER_FIRE = 3;

/** How long the scorch left on a struck body stays up. */
export const W_IMPACT_MS = 300;

/** How far past its hitbox a wisp paints, as a multiple of `size`. */
export const FIRE_PAINT_REACH = 2;


function __buildAhri_W(api: ContentApi) {
  const Spell = api.Spell;
  const Ahri_W_Object = makeAhri_W_Object(api);
  class Ahri_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_ahri_w');
    name = 'Lửa Hồ Ly (Ahri_W)';
    description =
      'Tạo ra <span>3 ngọn lửa</span> quay xung quanh bản thân trong <span class="time">5 giây</span>. Mỗi ngọn lửa sẽ tự động tấn công mục tiêu gần nhất trong tầm, gây <span class="damage">10 sát thương</span> và <span class="buff">Làm Châm 20%</span> tốc chạy kẻ địch trong <span class="time">0.5 giây</span>';
    coolDown = 5000;
    manaCost = 25;

    onSpellCast() {
      const count = 3;
      for (let i = 0; i < count; i++) {
        const obj = new Ahri_W_Object(this.owner);
        obj.angle = (i * 2 * PI) / count;
        // the fires orbit Ahri's body; they die with it instead of circling a
        // corpse (and still hunting) for the rest of their five seconds
        obj.attachTo(this.owner);
        this.game.objectManager.addObject(obj);
      }
    }
  }
  return Ahri_W;
}
const __cacheAhri_W = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_W>>();
export default function makeAhri_W(api: ContentApi) {
  const cached = __cacheAhri_W.get(api);
  if (cached) return cached;
  const built = __buildAhri_W(api);
  __cacheAhri_W.set(api, built);
  return built;
}


function __buildAhri_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const TrailSystem = api.helpers.TrailSystem;
  const Ahri_W_Impact = makeAhri_W_Impact(api);
  class Ahri_W_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    lifeTime = 5000;
    prepairTime = 1000;
    age = 0;
    angle = 0;
    rotateSpeed = 0.07;
    moveSpeed = 8;
    size = 25;
    rangeToFindEnemy = 160;
    damage = 10;
    targetEnemy: SpellObject['owner'] | null = null;

    trailSystem = new TrailSystem({
      trailColor: '#6AA5D644',
      trailSize: this.size,
    });

    /** Cosmetic: flame flicker, offset per fire so the three never pulse together. */
    _flicker = 0;
    /** Cosmetic: heading the wisp is drawn along, eased so it never snaps around. */
    _heading = 0;
    _headingSet = false;

    static PHASES = {
      PREPARING: 'PREPARING',
      ROTATING: 'ROTATING',
      ATTACKING: 'ATTACKING',
    } as const;

    phase: (typeof Ahri_W_Object.PHASES)[keyof typeof Ahri_W_Object.PHASES] =
      Ahri_W_Object.PHASES.PREPARING;

    onAdded() {
      this.game.objectManager.addObject(this.trailSystem);
      // each fire starts its flicker a third of a cycle apart, so the trio reads
      // as three separate flames rather than one light source drawn three times
      this._flicker = this.angle;
    }

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.angle += this.rotateSpeed;
      this._flicker += deltaTime / 90;
      if (this.age >= this.lifeTime) this.toRemove = true;

      // preparing
      if (this.phase === Ahri_W_Object.PHASES.PREPARING) {
        this.position = (this.position as any).lerp(this._getPosition(), 0.2);
        this._faceAlong(this.angle + HALF_PI);

        if (this.age >= this.prepairTime) {
          this.phase = Ahri_W_Object.PHASES.ROTATING;
        }
      }

      // rotating
      else if (this.phase === Ahri_W_Object.PHASES.ROTATING) {
        this.position = (this.position as any).lerp(this._getPosition(), 0.2);
        this.trailSystem.addTrail(this.position);
        // the wisp leans into its orbit, which is what sells the circling
        this._faceAlong(this.angle + HALF_PI);

        // query players in range
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.position.x,
            y: this.position.y,
            r: this.rangeToFindEnemy,
          }),
          filters: [
            PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
            PredefinedFilters.visibleTo(this.owner),
          ],
        });

        // find the closest enemy
        let closestEnemy: (typeof enemies)[0] | null = null;
        let closestDistance = Infinity;
        enemies.forEach((enemy: SpellObject['owner']) => {
          const distance = this.position.dist(enemy.position);
          if (distance < closestDistance) {
            closestDistance = distance;
            closestEnemy = enemy;
          }
        });

        if (closestEnemy) {
          this.targetEnemy = closestEnemy;
          this.isMissile = true;
          this.phase = Ahri_W_Object.PHASES.ATTACKING;
        }
      }

      // attacking
      else if (this.phase === Ahri_W_Object.PHASES.ATTACKING && this.targetEnemy) {
        const previous = this.position.copy();
        VectorUtils.moveVectorToVector(this.position, this.targetEnemy.position, this.moveSpeed);
        this.trailSystem.addTrail(this.position);
        // pointed at where it is actually going, so the dive is legible from the
        // shape alone — a wisp aimed sideways would look like it is drifting
        this._faceAlong(Math.atan2(this.position.y - previous.y, this.position.x - previous.x));

        const distance = this.position.dist(this.targetEnemy.position);
        if (distance <= this.targetEnemy.stats.size.value / 2) {
          const slowBuff = new Slow(500, this.owner, this.targetEnemy);
          slowBuff.percent = 0.2;
          this.targetEnemy.addBuff(slowBuff);
          this.targetEnemy.takeDamage(this.damage, this.owner);

          // the wisp is gone this frame, so the strike needs its own object or the
          // fire simply blinks out of existence on top of its victim
          const scorch = new Ahri_W_Impact(this.owner);
          scorch.position = this.targetEnemy.position.copy();
          scorch.angle = this._heading;
          scorch.targetSize = this.targetEnemy.animatedValues?.displaySize ?? 40;
          this.game.objectManager.addObject(scorch);

          this.toRemove = true;
        }
      }
    }

    /** Eases the drawn heading towards a new one; a snap would read as a glitch. */
    _faceAlong(target: number) {
      if (!this._headingSet) {
        this._heading = target;
        this._headingSet = true;
        return;
      }
      // shortest way round, so crossing the ±PI seam does not spin the wisp
      let delta = target - this._heading;
      while (delta > PI) delta -= TWO_PI;
      while (delta < -PI) delta += TWO_PI;
      this._heading += delta * 0.25;
    }

    _getPosition() {
      return this.owner.position.copy().add(
        p5.Vector.fromAngle(this.angle).mult(
          this.owner.stats.size.value / 2 + this.size / 2 + 20 // 20 is padding between owner and this object
        )
      );
    }

    draw() {
      const preparing = this.phase === Ahri_W_Object.PHASES.PREPARING;
      const attacking = this.phase === Ahri_W_Object.PHASES.ATTACKING;
      // the fire gathers out of nothing over its first second instead of
      // appearing at full brightness the frame the key is pressed
      const born = preparing ? constrain(this.age / this.prepairTime, 0, 1) : 1;
      const flick = 1 + sin(this._flicker) * 0.12;
      const r = (this.size / 2) * born * flick;
      // diving, the wisp stretches out into a dart; orbiting it stays rounded
      const stretch = attacking ? 2.4 : 1.7;

      push();
      translate(this.position.x, this.position.y);

      // sparks still being pulled in while the fire forms — the windup made
      // visible, so the one second before it can hunt is not dead air
      if (preparing && born < 1) {
        noStroke();
        fill(170, 206, 235, 200 * born);
        for (let i = 0; i < 5; i++) {
          const a = this._flicker * 0.7 + (TWO_PI * i) / 5;
          const d = (1 - born) * 46;
          circle(cos(a) * d, sin(a) * d, 4 * born + 1.5);
        }
      }

      rotate(this._heading);

      // arcane halo, additive so a wisp crossing Ahri's body still reads as light
      blendMode(ADD);
      noStroke();
      fill(70, 136, 190, 70 * born);
      circle(0, 0, r * 4);
      blendMode(BLEND);

      // the wisp body: a leaf pointing the way it travels, with a tail dragging
      // behind it. Curved rather than a circle — a foxfire, not a bead.
      noStroke();
      fill(78, 145, 200, 215 * born);
      beginShape();
      vertex(r * stretch, 0);
      vertex(0, -r);
      vertex(-r * stretch * 1.3, 0);
      vertex(0, r);
      endShape(CLOSE);

      // hotter inner leaf, slightly ahead of the outer one
      fill(150, 197, 235, 235 * born);
      beginShape();
      vertex(r * stretch * 0.75, 0);
      vertex(r * 0.1, -r * 0.55);
      vertex(-r * stretch * 0.7, 0);
      vertex(r * 0.1, r * 0.55);
      endShape(CLOSE);

      // white core, the part that stays readable at a distance
      fill(240, 247, 252, 245 * born);
      circle(r * 0.15, 0, r * 0.9);

      // embers circling the wisp — three each, nine across the trio
      fill(205, 227, 245, 200 * born);
      for (let i = 0; i < EMBERS_PER_FIRE; i++) {
        const a = -this._flicker * 1.4 + (TWO_PI * i) / EMBERS_PER_FIRE;
        const d = r * 1.5;
        circle(cos(a) * d, sin(a) * d * 0.6, 3.5 + sin(this._flicker * 2 + i) * 1.2);
      }

      pop();
    }

    // the halo and the tail both reach well past the 25px body
    getDisplayBoundingBox() {
      const r = this.size * FIRE_PAINT_REACH;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ahri_W_Object;
}
const __cacheAhri_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_W_Object>>();
export function makeAhri_W_Object(api: ContentApi) {
  const cached = __cacheAhri_W_Object.get(api);
  if (cached) return cached;
  const built = __buildAhri_W_Object(api);
  __cacheAhri_W_Object.set(api, built);
  return built;
}


/** Where a wisp burned itself out on someone: a short magenta scorch bloom. */
function __buildAhri_W_Impact(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ahri_W_Impact extends SpellObject {
    angle = 0;
    targetSize = 40;
    age = 0;
    lifeTime = W_IMPACT_MS;
    maxRadius = 40;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const flash = 1 - constrain(t / 0.35, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(165, 206, 240, 150 * flash);
        circle(0, 0, this.targetSize * 0.8 + t * 34);
        blendMode(BLEND);
      }

      // ring on the body that took it — the slow's footprint, briefly
      noFill();
      stroke(120, 178, 225, 200 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, this.targetSize * 0.6 + this.maxRadius * t);

      // three petals of flame licking off in the direction the wisp came from,
      // which keeps the strike pointing rather than blooming symmetrically
      noStroke();
      fill(190, 220, 245, 220 * fade);
      for (let i = -1; i <= 1; i++) {
        const a = this.angle + i * 0.7;
        const d = 6 + this.maxRadius * t;
        push();
        translate(cos(a) * d, sin(a) * d);
        rotate(a);
        const len = 14 * fade + 4;
        triangle(len, 0, -len * 0.5, -4 * fade - 1.5, -len * 0.5, 4 * fade + 1.5);
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius + 20;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ahri_W_Impact;
}
const __cacheAhri_W_Impact = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_W_Impact>>();
export function makeAhri_W_Impact(api: ContentApi) {
  const cached = __cacheAhri_W_Impact.get(api);
  if (cached) return cached;
  const built = __buildAhri_W_Impact(api);
  __cacheAhri_W_Impact.set(api, built);
  return built;
}