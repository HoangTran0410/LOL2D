import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Yasuo_W = InstanceType<ReturnType<typeof makeYasuo_W>>;
type Yasuo_W_Object = InstanceType<ReturnType<typeof makeYasuo_W_Object>>;



export const WALL_LENGTH = 300;

export const WALL_WIDTH = 25;

export const WALL_DURATION_MS = 3750;

/** Drift outward, in px per frame — the wall walks away from Yasuo as it lives. */
export const WALL_DRIFT_SPEED = 0.5;

/** How long the wall takes to unfurl to full length. Also its hitbox growth. */
export const WALL_RISE_MS = 240;

/** The stretch at the end where the wall visibly thins, telegraphing its expiry. */
export const WALL_FADE_MS = 700;

/** How long a single block flash burns for. */
export const BLOCK_FLASH_MS = 420;

/** Serpentine wind lines running the length of the wall. */
export const WIND_RIBBONS = 7;

/** Bright gusts racing end to end. */
export const WIND_GUSTS = 5;

/** Ceiling on simultaneously drawn block flashes. */
export const MAX_BLOCK_FLASHES = 8;


function __buildYasuo_W(api: ContentApi) {
  const Spell = api.Spell;
  const Yasuo_W_Object = makeYasuo_W_Object(api);
  class Yasuo_W extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_yasuo_w');
    name = 'Tường Gió (Yasuo_W)';
    description =
      'Tạo ra một bức tường gió theo hướng chỉ định, <span class="buff">Chặn</span> toàn bộ đạn đạo từ kẻ địch trong <span class="time">3.75 giây</span>';
    coolDown = 6000;
    manaCost = 20;

    onSpellCast() {
      const startRange = this.owner.stats.size.value + 20;
      const mouse = this.aimPoint;
      const direction = mouse.copy().sub(this.owner.position).normalize();
      const position = this.owner.position.copy().add(direction.setMag(startRange));

      const obj = new Yasuo_W_Object(this.owner);
      obj.position = position;
      obj.direction = direction;
      obj.size = WALL_LENGTH;
      obj.duration = WALL_DURATION_MS;

      this.game.objectManager.addObject(obj);
    }
  }
  return Yasuo_W;
}
const __cacheYasuo_W = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_W>>();
export default function makeYasuo_W(api: ContentApi) {
  const cached = __cacheYasuo_W.get(api);
  if (cached) return cached;
  const built = __buildYasuo_W(api);
  __cacheYasuo_W.set(api, built);
  return built;
}


/** One projectile stopped by the wall, in the wall's own coordinates. */
interface BlockFlash {
  /** Distance along the wall from its centre — travels with the wall as it drifts. */
  along: number;
  age: number;
  /** Fixed at creation so the burst does not re-scatter every frame. */
  seed: number;
}


/**
 * Wind Wall.
 *
 * The flat lerped quad it used to be said nothing about what the ability does:
 * it looked like a pane of coloured glass, it appeared at full height on the
 * first frame, and a projectile dying against it produced no picture at all —
 * the missile simply stopped existing, which reads as a bug rather than as a
 * block.
 *
 * Three things fix that, all driven off `timeSinceCreated`:
 *
 *  - it **unfurls**. `rise` eases the length open over `WALL_RISE_MS`, and the
 *    *hitbox* uses the same number, so the wall never blocks anything it has
 *    not visibly grown far enough to reach.
 *  - it **moves**. Serpentine ribbons run its length inside the thickness and
 *    bright gusts race end to end, so it reads as air held in place under
 *    tension rather than as a solid object.
 *  - it **reacts**. Every block leaves a burst, recorded in wall-local
 *    coordinates so it rides along as the wall drifts outward.
 */
function __buildYasuo_W_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const CollideUtils = api.utils.CollideUtils;
  const rectToVertices = api.utils.rectToVertices;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const SpellObject = api.SpellObject;
  class Yasuo_W_Object extends SpellObject {
    position = this.owner.position.copy();
    direction = p5.Vector.random2D();
    speed = WALL_DRIFT_SPEED;
    size = WALL_LENGTH;
    width = WALL_WIDTH;
    duration = WALL_DURATION_MS;
    timeSinceCreated = 0;

    // for smooth display
    animatedWidth = 0;
    animatedSize = 0;
    animatedPosition = this.owner.position.copy();

    _blocks: BlockFlash[] = [];
    /** Fixed per wall so two walls on screen do not ripple in lockstep. */
    _seed = random(TWO_PI);

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#cef9', 0.35);

    onAdded() {
      super.onAdded();
      // The wall emits only when it blocks something, which is normally seconds
      // after it goes up. An empty system removes itself on its very first frame,
      // so left on the default it would be gone before any projectile arrived.
      this.particleSystem.autoRemoveIfEmpty = false;
      this.game.objectManager.addObject(this.particleSystem);
    }

    onRemoved() {
      // Handing the automatic teardown back rather than killing the system
      // outright: gust particles thrown in the last instant still get to finish.
      this.particleSystem.autoRemoveIfEmpty = true;
      super.onRemoved();
    }

    /** 0 while the wall is still unfurling, 1 once it is fully open. */
    get rise(): number {
      const t = constrain(this.timeSinceCreated / WALL_RISE_MS, 0, 1);
      return 1 - Math.pow(1 - t, 3);
    }

    update() {
      this.timeSinceCreated += deltaTime;

      // move wall
      this.position.add(this.direction.setMag(this.speed));

      // The drawn length and the blocking length are the same value, deliberately:
      // a wall that stops a missile it has not yet grown far enough to touch is
      // exactly the kind of invisible hitbox this rewrite exists to remove.
      const rise = this.rise;
      this.animatedSize = this.size * rise;
      this.animatedWidth = this.width * rise;
      this.animatedPosition.lerp(this.position, 0.2);

      for (const block of this._blocks) block.age += deltaTime;
      if (this._blocks.length > 0 && this._blocks[0].age > BLOCK_FLASH_MS) this._blocks.shift();

      // check collision with spell objects
      const rx = this.animatedPosition.x;
      const ry = this.animatedPosition.y - this.animatedSize / 2;
      const rw = this.animatedWidth;
      const rh = this.animatedSize;
      const angle = this.direction.heading();
      const vertices = rectToVertices(rx, ry, rw, rh, angle, {
        x: this.animatedPosition.x,
        y: this.animatedPosition.y,
      });

      const spellObjects = this.game.objectManager.queryObjects({
        queryByDisplayBoundingBox: true,
        filters: [
          PredefinedFilters.missileSpellObject,
          PredefinedFilters.excludeTeamId(this.owner.teamId),
          (o: any) => CollideUtils.pointPolygon(o.position.x, o.position.y, vertices),
        ],
      });

      spellObjects.forEach((o: SpellObject) => {
        o.toRemove = true;
        this._recordBlock(o.position);
      });

      // check to remove
      if (this.timeSinceCreated >= this.duration) {
        this.toRemove = true;
      }
    }

    /**
     * Where along the wall a projectile died, stored as a scalar offset from the
     * wall's centre. World coordinates would strand the burst behind the wall,
     * which drifts a couple of hundred pixels over its life.
     */
    _recordBlock(at: p5.Vector) {
      const heading = this.direction.heading();
      const dx = at.x - this.animatedPosition.x;
      const dy = at.y - this.animatedPosition.y;
      // project onto the wall's own axis, which is the direction's perpendicular
      const along = -sin(heading) * dx + cos(heading) * dy;
      const half = this.animatedSize / 2;

      this._blocks.push({
        along: constrain(along, -half, half),
        age: 0,
        seed: random(TWO_PI),
      });
      if (this._blocks.length > MAX_BLOCK_FLASHES) this._blocks.shift();

      // The gust squeezed out of the wall by the impact. Emitted in world space
      // because it is air that has escaped the wall — it should not ride along.
      const normal = createVector(cos(heading), sin(heading));
      const axis = createVector(-sin(heading), cos(heading));
      for (let i = 0; i < 10; i++) {
        const spread = random(-1, 1) * 26;
        const push = random(-14, 14);
        this.particleSystem.addParticle({
          x: this.animatedPosition.x + axis.x * (along + spread) + normal.x * push,
          y: this.animatedPosition.y + axis.y * (along + spread) + normal.y * push,
          r: random(3, 8),
        });
      }
    }

    draw() {
      const life = constrain(this.timeSinceCreated / this.duration, 0, 1);
      const halfLen = this.animatedSize / 2;
      const w = this.animatedWidth;
      if (halfLen <= 0.5) return;

      // The last stretch thins out, so the wall's expiry is read before a
      // projectile goes through it rather than afterwards.
      const expiring = constrain(
        (this.timeSinceCreated - (this.duration - WALL_FADE_MS)) / WALL_FADE_MS,
        0,
        1
      );
      const alpha = (1 - 0.55 * life) * (1 - 0.6 * expiring);
      const flick = 0.85 + 0.15 * sin(this.timeSinceCreated / 90 + this._seed);

      push();
      translate(this.animatedPosition.x, this.animatedPosition.y);
      rotate(this.direction.heading());

      // The body of held air. Faint on its own — the wall's presence comes from
      // what moves inside it, not from the slab.
      noStroke();
      fill(150, 185, 255, 60 * alpha);
      quad(0, -halfLen, w, -halfLen, w, halfLen, 0, halfLen);

      blendMode(ADD);
      noFill();
      strokeCap(ROUND);

      // Serpentine ribbons running the length, weaving through the thickness.
      // The phase offset per ribbon is what turns a set of parallel lines into
      // something that reads as turbulent.
      for (let i = 0; i < WIND_RIBBONS; i++) {
        const k = i / (WIND_RIBBONS - 1);
        const seed = this._seed + i * 1.7;
        stroke(200, 245, 255, (45 + 85 * (1 - Math.abs(k - 0.5) * 2)) * alpha * flick);
        strokeWeight(1.2 + 1.4 * (i % 2));
        beginShape();
        for (let s = 0; s <= 12; s++) {
          const p = s / 12;
          const y = lerp(-halfLen, halfLen, p);
          const x = w * (0.5 + 0.44 * sin(p * PI * 2.2 + seed + this.timeSinceCreated / 150));
          vertex(x, y);
        }
        endShape();
      }

      // Gusts: short bright dashes racing end to end, brightest mid-run. They are
      // the reason the wall reads as air under pressure and not as a curtain.
      for (let i = 0; i < WIND_GUSTS; i++) {
        const phase = (this.timeSinceCreated / 620 + i / WIND_GUSTS) % 1;
        const travel = i % 2 === 0 ? phase : 1 - phase;
        const y = lerp(-halfLen, halfLen, travel);
        const len = halfLen * 0.2;
        stroke(245, 255, 255, 190 * alpha * sin(phase * PI));
        strokeWeight(2.4);
        line(w * 0.35, y - len * 0.5, w * 0.65, y + len * 0.5);
      }

      // The face the projectiles hit, and the two ends, so the wall has a hard
      // edge to aim around instead of dissolving into its own haze.
      stroke(225, 250, 255, 200 * alpha);
      strokeWeight(2.5);
      line(0, -halfLen, 0, halfLen);
      stroke(180, 235, 255, 150 * alpha);
      strokeWeight(1.5);
      line(w, -halfLen, w, halfLen);
      for (const end of [-halfLen, halfLen]) {
        // the ends curl: air spilling around the edge of the wall
        const curl = end > 0 ? 1 : -1;
        stroke(215, 248, 255, 190 * alpha);
        strokeWeight(2.5);
        arc(
          w * 0.5,
          end - curl * w * 0.6,
          w * 1.6,
          w * 1.6,
          curl > 0 ? 0 : PI,
          curl > 0 ? PI : TWO_PI
        );
      }

      this._drawBlocks(w);

      blendMode(BLEND);
      strokeCap(ROUND);
      pop();
    }

    /** Every projectile the wall ate, still burning where it died. */
    _drawBlocks(w: number) {
      for (const block of this._blocks) {
        const t = constrain(block.age / BLOCK_FLASH_MS, 0, 1);
        if (t >= 1) continue;
        const fade = 1 - t;

        push();
        translate(w * 0.5, block.along);

        // the ring the wall throws back at whatever hit it
        noFill();
        stroke(255, 255, 255, 235 * fade);
        strokeWeight(4 * fade + 1);
        circle(0, 0, 12 + 72 * t);
        stroke(170, 240, 255, 195 * fade);
        strokeWeight(7 * fade + 1);
        circle(0, 0, 6 + 46 * t);

        // spokes of air blown out of the point of impact
        strokeWeight(2);
        for (let i = 0; i < 5; i++) {
          const a = block.seed + i * 1.26;
          const reach = 18 + 48 * t;
          stroke(220, 250, 255, 165 * fade);
          line(cos(a) * reach * 0.35, sin(a) * reach * 0.35, cos(a) * reach, sin(a) * reach);
        }

        // the hit itself — squared off by fade² so it is a hit, not a glow
        noStroke();
        fill(255, 255, 255, 225 * fade * fade);
        circle(0, 0, 18 * fade + 4);
        pop();
      }
    }

    getDisplayBoundingBox() {
      // The wall is rotated arbitrarily, so the box has to be a square that
      // contains it at any angle: half its length, plus its thickness, plus the
      // reach of a block flash sitting on the far end of it.
      const span = this.animatedSize / 2 + this.animatedWidth + 60;
      return new Rectangle({
        x: this.animatedPosition.x - span,
        y: this.animatedPosition.y - span,
        w: span * 2,
        h: span * 2,
        data: this,
      });
    }
  }
  return Yasuo_W_Object;
}
const __cacheYasuo_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_W_Object>>();
export function makeYasuo_W_Object(api: ContentApi) {
  const cached = __cacheYasuo_W_Object.get(api);
  if (cached) return cached;
  const built = __buildYasuo_W_Object(api);
  __cacheYasuo_W_Object.set(api, built);
  return built;
}