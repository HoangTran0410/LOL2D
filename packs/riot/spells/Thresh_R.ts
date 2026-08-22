import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Thresh_R = InstanceType<ReturnType<typeof makeThresh_R>>;
type Thresh_R_Object = InstanceType<ReturnType<typeof makeThresh_R_Object>>;



export const RADIUS = 220;

export const DURATION = 8000;

export const DAMAGE = 30;

export const SLOW_PERCENT = 0.7;


/** Panels around the rim. Ten reads as a wall rather than a pentagon. */
export const WALL_COUNT = 10;

/** How long one panel takes to swing up out of the ground. */
export const WALL_RISE_MS = 240;

/**
 * Delay between neighbouring panels. The cage assembles as a wave running round
 * the ring instead of popping into existence, which is the whole point: an
 * ultimate should cost the eye a moment.
 */
export const WALL_STAGGER_MS = 34;

/** Painted height of a standing panel, in screen pixels above its footprint. */
export const WALL_HEIGHT = 48;

/** How long a shattered panel spends falling over. */
export const BREAK_MS = 520;

/** Iron bars per panel. */
export const BARS_PER_WALL = 4;

/** Lanterns hung on the cage — Thresh's signature, and a light source. */
export const LANTERN_COUNT = 4;

/** How often a spectral wisp peels off the rim. */
export const WISP_INTERVAL_MS = 55;


const IRON: [number, number, number] = [16, 46, 34];

const SPECTRE: [number, number, number] = [130, 255, 180];


/**
 * The Box. A cage of walls: standing inside costs nothing, *leaving* is what
 * breaks a wall and hurts. One break per victim, exactly as in League — which
 * is why `broken` is a list rather than a flag.
 */
function __buildThresh_R(api: ContentApi) {
  const Spell = api.Spell;
  const Thresh_R_Object = makeThresh_R_Object(api);
  class Thresh_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_thresh_r');
    name = 'Đóng Hộp (Thresh_R)';
    description =
      `Dựng một chiếc lồng bán kính <span>${RADIUS}px</span> quanh mình trong` +
      ` <span class="time">${DURATION / 1000} giây</span>. Kẻ địch <span class="damage">bước ra khỏi lồng</span>` +
      ` nhận <span class="damage">${DAMAGE} sát thương</span> và <span class="buff">Làm Chậm ${SLOW_PERCENT * 100}%</span>` +
      ` — mỗi kẻ chỉ phá được một lần`;
    coolDown = 10000;
    manaCost = 70;

    onSpellCast() {
      this.game.objectManager.addObject(new Thresh_R_Object(this.owner));
    }

    drawPreview() {
      super.drawPreview(RADIUS);
    }
  }
  return Thresh_R;
}
const __cacheThresh_R = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_R>>();
export default function makeThresh_R(api: ContentApi) {
  const cached = __cacheThresh_R.get(api);
  if (cached) return cached;
  const built = __buildThresh_R(api);
  __cacheThresh_R.set(api, built);
  return built;
}


function __buildThresh_R_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Slow = api.buffs.Slow;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Thresh_R_Object extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    radius = RADIUS;
    visionRadius = RADIUS;
    lifeTime = DURATION;
    age = 0;
    /** Everyone currently inside, so leaving can be noticed. */
    inside = new Set<unknown>();
    /** Everyone who has already paid for one wall. */
    broken = new Set<unknown>();

    /** ms since each panel shattered, or -1 while it still stands. */
    _breakAge: number[] = [];
    /**
     * Seeded once, never re-rolled: the bars lean by a hair so the iron reads as
     * forged rather than printed. Rolling this in `draw()` would make the whole
     * cage vibrate.
     */
    _barLean: number[] = [];
    /** Back-to-front paint order, so the near wall occludes the far one. */
    _order: number[] = [];
    _wispTimer = 0;
    _wispIndex = 0;

    /** Wisps peeling off the bars, and the shower a broken panel throws. */
    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(150, 255, 195, 0.7)',
      0.3
    );

    onAdded() {
      for (let i = 0; i < WALL_COUNT; i++) {
        this._breakAge.push(-1);
        for (let j = 0; j < BARS_PER_WALL; j++) this._barLean.push(random(-2.2, 2.2));
      }
      // The panels never spin, so their depth order is fixed for the whole cast:
      // sort once here rather than every frame. Larger sin = lower on screen =
      // nearer the camera = painted last.
      for (let i = 0; i < WALL_COUNT; i++) this._order.push(i);
      this._order.sort((a, b) => sin(this._wallMid(a)) - sin(this._wallMid(b)));

      this.game.objectManager.addObject(this.particleSystem);
      // The first wisp is 55ms away, and an empty system deletes itself on its
      // very first update — so the cage owns the draining, not the system.
      this.particleSystem.autoRemoveIfEmpty = false;
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    /** Centre angle of panel `i`. */
    _wallMid(i: number) {
      return ((i + 0.5) / WALL_COUNT) * TWO_PI;
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }

      for (let i = 0; i < this._breakAge.length; i++) {
        if (this._breakAge[i] >= 0) this._breakAge[i] += deltaTime;
      }

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as any[];

      const nowInside = new Set<unknown>(enemies);
      for (const unit of this.inside) {
        if (nowInside.has(unit) || this.broken.has(unit)) continue;
        const escapee = unit as any;
        if (!escapee?.takeDamage || escapee.isDead) continue;
        this.broken.add(unit);
        escapee.takeDamage(DAMAGE, this.owner);
        const slow = new Slow(2000, this.owner, escapee);
        slow.percent = SLOW_PERCENT;
        escapee.addBuff(slow);
        // Cosmetic only: the panel they walked through is the one that falls, so
        // the damage number has a cause the player can point at.
        this._shatterNearest(escapee.position);
      }
      this.inside = nowInside;

      // A cage that just sits there stops being read after the first second.
      // Wisps bleeding off the bars keep it alive without moving the boundary.
      this._wispTimer += deltaTime;
      if (this._wispTimer >= WISP_INTERVAL_MS && this._breakAge.length) {
        this._wispTimer = 0;
        // Golden-angle stepping: scattered to the eye, deterministic in code.
        const a = this._wispIndex++ * 2.39996;
        this.particleSystem.addParticle({
          x: this.position.x + cos(a) * this.radius,
          y: this.position.y + sin(a) * this.radius - random(0, WALL_HEIGHT),
          r: random(3, 7),
        });
      }
    }

    /** Marks the panel closest to `at` as broken and throws its debris. */
    _shatterNearest(at: p5.Vector) {
      if (!this._breakAge.length) return;
      const angle = Math.atan2(at.y - this.position.y, at.x - this.position.x);
      const turn = (angle + TWO_PI) % TWO_PI;
      const index = Math.min(WALL_COUNT - 1, Math.floor((turn / TWO_PI) * WALL_COUNT));
      if (this._breakAge[index] < 0) this._breakAge[index] = 0;

      const mid = this._wallMid(index);
      for (let i = 0; i < 10; i++) {
        this.particleSystem.addParticle({
          x: this.position.x + cos(mid) * this.radius + random(-24, 24),
          y: this.position.y + sin(mid) * this.radius + random(-WALL_HEIGHT, 10),
          r: random(4, 10),
        });
      }
    }

    /** 0 → still underground, 1 → fully up. Staggered so the cage assembles. */
    _riseOf(index: number) {
      return constrain((this.age - index * WALL_STAGGER_MS) / WALL_RISE_MS, 0, 1);
    }

    draw() {
      const left = constrain(1 - this.age / this.lifeTime, 0, 1);
      const [ir, ig, ib] = IRON;
      const [sr, sg, sb] = SPECTRE;

      push();
      translate(this.position.x, this.position.y);

      // The floor of the box, at full radius from the very first frame. The
      // *walls* rise; the boundary does not, because the boundary is already
      // live and lying about it would cost someone 30 health.
      noStroke();
      fill(sr, sg, sb, 16 * left);
      circle(0, 0, this.radius * 2);
      noFill();
      stroke(ir, ig, ib, 190 * left);
      strokeWeight(6);
      circle(0, 0, this.radius * 2);
      stroke(sr, sg, sb, 150 * left);
      strokeWeight(2);
      circle(0, 0, this.radius * 2);

      // How much of the four seconds is left, read off the floor rather than off
      // a HUD element — the player is standing in the middle of this thing.
      stroke(sr, sg, sb, 210 * left);
      strokeWeight(4);
      arc(0, 0, this.radius * 2 - 14, this.radius * 2 - 14, -HALF_PI, -HALF_PI + TWO_PI * left);

      for (const index of this._order) this._drawWall(index, left);
      for (let k = 0; k < LANTERN_COUNT; k++) this._drawLantern(k, left);

      pop();
    }

    /** One wrought-iron panel, standing in local space around the cage centre. */
    _drawWall(index: number, left: number) {
      const rise = this._riseOf(index);
      if (rise <= 0) return;

      const broken = this._breakAge[index] >= 0;
      const fall = broken ? constrain(this._breakAge[index] / BREAK_MS, 0, 1) : 0;
      // A broken panel keeps a stump: the hole is what matters, and a stump says
      // "this one is spent" more clearly than an empty gap would.
      const standing = rise * (1 - fall * 0.82);
      const height = WALL_HEIGHT * standing;
      const glow = broken ? 1 - fall : 1;
      const alpha = left * glow;

      const gap = (TWO_PI / WALL_COUNT) * 0.11;
      const a0 = (index / WALL_COUNT) * TWO_PI + gap;
      const a1 = ((index + 1) / WALL_COUNT) * TWO_PI - gap;
      const segments = 4;
      const [ir, ig, ib] = IRON;
      const [sr, sg, sb] = SPECTRE;

      push();

      // The panel face, following the curve of the ring so the cage reads round
      // rather than as a ten-sided nut.
      noStroke();
      fill(ir, ig, ib, 205 * alpha);
      beginShape();
      for (let s = 0; s <= segments; s++) {
        const a = lerp(a0, a1, s / segments);
        vertex(cos(a) * this.radius, sin(a) * this.radius);
      }
      for (let s = segments; s >= 0; s--) {
        const a = lerp(a0, a1, s / segments);
        vertex(cos(a) * this.radius, sin(a) * this.radius - height);
      }
      endShape(CLOSE);

      // Spectral wash inside the panel, brightest where it meets the ground so
      // the wall looks lit from the floor of the box.
      fill(sr, sg, sb, 40 * alpha);
      beginShape();
      for (let s = 0; s <= segments; s++) {
        const a = lerp(a0, a1, s / segments);
        vertex(cos(a) * this.radius, sin(a) * this.radius);
      }
      for (let s = segments; s >= 0; s--) {
        const a = lerp(a0, a1, s / segments);
        vertex(cos(a) * this.radius, sin(a) * this.radius - height * 0.55);
      }
      endShape(CLOSE);

      // Bars, each with its own permanent lean.
      for (let j = 0; j < BARS_PER_WALL; j++) {
        const a = lerp(a0, a1, (j + 0.5) / BARS_PER_WALL);
        const lean = this._barLean[index * BARS_PER_WALL + j] ?? 0;
        const bx = cos(a) * this.radius;
        const by = sin(a) * this.radius;
        stroke(ir, ig, ib, 240 * alpha);
        strokeWeight(4);
        line(bx, by, bx + lean, by - height);
        stroke(sr, sg, sb, 200 * alpha);
        strokeWeight(1.5);
        line(bx, by, bx + lean, by - height);
        // finial: the spike that makes it a cage and not a fence
        if (height > 10) {
          noStroke();
          fill(sr, sg, sb, 225 * alpha);
          triangle(
            bx + lean - 4,
            by - height,
            bx + lean + 4,
            by - height,
            bx + lean,
            by - height - 9
          );
        }
      }

      // Top rail, tying the bars together.
      if (height > 6) {
        noFill();
        stroke(ir, ig, ib, 240 * alpha);
        strokeWeight(4);
        beginShape();
        for (let s = 0; s <= segments; s++) {
          const a = lerp(a0, a1, s / segments);
          vertex(cos(a) * this.radius, sin(a) * this.radius - height);
        }
        endShape();
        stroke(sr, sg, sb, 230 * alpha);
        strokeWeight(1.5);
        beginShape();
        for (let s = 0; s <= segments; s++) {
          const a = lerp(a0, a1, s / segments);
          vertex(cos(a) * this.radius, sin(a) * this.radius - height);
        }
        endShape();
      }

      // The moment of the break: a flash on the panel that just gave way, so the
      // victim and everyone watching agree on where the hole is.
      if (broken && fall < 0.5) {
        const flash = 1 - fall / 0.5;
        const mid = this._wallMid(index);
        noStroke();
        fill(230, 255, 240, 200 * flash);
        circle(cos(mid) * this.radius, sin(mid) * this.radius - WALL_HEIGHT * 0.4, 30 + 70 * flash);
      }

      pop();
    }

    /** A hanging lantern: green flame in an iron ring, bobbing on its chain. */
    _drawLantern(k: number, left: number) {
      const a = (k / LANTERN_COUNT) * TWO_PI + PI / WALL_COUNT;
      const wall = Math.min(WALL_COUNT - 1, Math.floor((a / TWO_PI) * WALL_COUNT));
      const rise = this._riseOf(wall);
      if (rise <= 0.4) return;

      const settle = constrain((rise - 0.4) / 0.6, 0, 1);
      const bob = sin(this.age / 320 + k * 1.7) * 5;
      const x = cos(a) * this.radius;
      const y = sin(a) * this.radius - WALL_HEIGHT - 20 * settle + bob;
      const alpha = left * settle;
      const [ir, ig, ib] = IRON;
      const [sr, sg, sb] = SPECTRE;

      push();
      // chain back down to the rail
      stroke(ir, ig, ib, 190 * alpha);
      strokeWeight(2);
      line(x, y, cos(a) * this.radius, sin(a) * this.radius - WALL_HEIGHT * rise);

      // the flame, which is what actually lights the panel below it
      noStroke();
      fill(sr, sg, sb, 55 * alpha);
      circle(x, y, 46 + sin(this.age / 140 + k) * 5);
      fill(190, 255, 215, 220 * alpha);
      circle(x, y, 13 + sin(this.age / 90 + k * 2) * 2);

      // iron cage around the flame
      noFill();
      stroke(ir, ig, ib, 235 * alpha);
      strokeWeight(2.5);
      circle(x, y, 20);
      line(x - 10, y, x + 10, y);
      pop();
    }

    getDisplayBoundingBox() {
      // Deliberately not square: the walls, their finials and the lanterns all
      // paint *above* the ring, so the top edge has to reach further than the
      // bottom one or the cage gets culled while its floor is still on screen.
      const halfWidth = this.radius + 40;
      const top = this.radius + WALL_HEIGHT + 80;
      const bottom = this.radius + 40;
      return new Rectangle({
        x: this.position.x - halfWidth,
        y: this.position.y - top,
        w: halfWidth * 2,
        h: top + bottom,
        data: this,
      });
    }
  }
  return Thresh_R_Object;
}
const __cacheThresh_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildThresh_R_Object>>();
export function makeThresh_R_Object(api: ContentApi) {
  const cached = __cacheThresh_R_Object.get(api);
  if (cached) return cached;
  const built = __buildThresh_R_Object(api);
  __cacheThresh_R_Object.set(api, built);
  return built;
}