import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Yasuo_E = InstanceType<ReturnType<typeof makeYasuo_E>>;
type Yasuo_E_Object = InstanceType<ReturnType<typeof makeYasuo_E_Object>>;



export const E_RANGE = 130;

export const E_DAMAGE = 10;

/**
 * 8 px/frame put this at roughly 350ms for a 170px hop, which felt like being
 * dragged rather than like cutting through someone. The rest of the game dashes
 * at 15–24; 16 lands the sweep in about ten frames, long enough for the trail
 * to read and short enough to feel like a blade.
 */
export const E_DASH_SPEED = 16;

/** How long a point of the sword's path stays on screen behind him. */
export const E_TRAIL_MS = 260;

/** How long the strike burst burns for, once the blade actually connects. */
export const E_STRIKE_MS = 300;

/** Half-width of the swept plane at Yasuo's own body. */
export const E_TRAIL_HALF_WIDTH = 15;


function __buildYasuo_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Yasuo_E_Object = makeYasuo_E_Object(api);
  class Yasuo_E extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_yasuo_e');
    name = 'Quét Kiếm (Yasuo_E)';
    description =
      '<span class="buff">Lướt</span> xuyên qua kẻ địch gần nhất trong tầm, gây <span class="damage">10 sát thương</span> <i>khi lưỡi kiếm chạm tới mục tiêu</i>';
    coolDown = 2000;
    manaCost = 20;

    rangeToFindEnemies = E_RANGE;

    checkCastCondition() {
      return Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const mouse = this.aimPoint;
      this.owner.destination.set(mouse.x, mouse.y);

      // find all enemies in range
      const enemiesInRange = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.rangeToFindEnemies, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });
      if (enemiesInRange.length == 0) {
        this.resetCoolDown();
        return;
      }

      // find nearest enemy to mouse
      let nearestEnemy: any = null;
      let nearestDistance = Infinity;
      for (const p of enemiesInRange) {
        const d = p.position.dist(mouse);
        if (d < nearestDistance) {
          nearestEnemy = p;
          nearestDistance = d;
        }
      }
      if (!nearestEnemy) {
        this.resetCoolDown();
        return;
      }

      // dash through — the destination sits past the target, not on it
      const { from: _from, to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        nearestEnemy.position,
        this.owner.position.dist(nearestEnemy.position) +
          nearestEnemy.stats.size.value / 2 +
          this.owner.stats.size.value / 2
      );

      const dashBuff = new Dash(2000, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = destination;
      dashBuff.dashSpeed = E_DASH_SPEED;
      // The sweep object paints a swept blade plane; Dash's generic white polyline
      // on top of it would only muddy the shape.
      dashBuff.showTrail = false;

      const sweep = new Yasuo_E_Object(this.owner);
      sweep.dashBuff = dashBuff;
      sweep.target = nearestEnemy;
      sweep.damage = E_DAMAGE;
      sweep.heading = destination.copy().sub(this.owner.position);
      this.game.objectManager.addObject(sweep);

      // The blade lands where the blade *is*. `onDashUpdate` runs immediately
      // after each movement step, so the hit is tested against ground Yasuo has
      // actually covered — the old code dealt the damage at cast, before he had
      // moved a pixel, which is why the ability had no impact to speak of.
      //
      // Never `dashBuff.onUpdate = …`: Dash implements its own movement there and
      // an instance assignment would delete the dash outright. See Dash.ts.
      dashBuff.onDashUpdate = () => sweep.tryStrike();
      dashBuff.onReachedDestination = () => sweep.finishPass();
      dashBuff.onCancelled = () => sweep.endPass();

      this.owner.addBuff(dashBuff);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.rangeToFindEnemies, this.owner));
    }
  }
  return Yasuo_E;
}
const __cacheYasuo_E = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_E>>();
export default function makeYasuo_E(api: ContentApi) {
  const cached = __cacheYasuo_E.get(api);
  if (cached) return cached;
  const built = __buildYasuo_E(api);
  __cacheYasuo_E.set(api, built);
  return built;
}


/** One sample of where the blade has been, ageing out of the ribbon. */
interface SweepSample {
  x: number;
  y: number;
  age: number;
}


/**
 * Sweeping Blade — the pass, and everything it leaves behind.
 *
 * The ability shipped with no visual of any kind: the champion teleported a
 * body-length forward and a damage number appeared. Both halves are fixed here,
 * and they are the same fix — the pass now *takes time*, so there is something
 * to draw and something to react to.
 *
 * What is drawn is the plane the sword swept, not a line: two offset edges
 * around the sampled path, tapering to nothing at the tail, with a white-hot
 * core down the middle and a crescent riding Yasuo's body — the same curved
 * steel-and-wind vocabulary as Steel Tempest, at the shape of a lunge rather
 * than a thrust.
 *
 * `hitTargets` is the multi-hit guard the pass needs: `tryStrike` runs on every
 * frame of the dash and would otherwise charge the same body ten times over.
 */
function __buildYasuo_E_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const SpellObject = api.SpellObject;
  const Dash = api.buffs.Dash;
  class Yasuo_E_Object extends SpellObject {
    position = this.owner.position.copy();
    dashBuff: Dash | null = null;
    target: any = null;
    damage = E_DAMAGE;
    /** Never (0,0): seeded from the dash vector, and only ever replaced by one. */
    heading: p5.Vector = createVector(1, 0);

    age = 0;
    /** Runs once the dash is over, purely so the ribbon can fade out. */
    fadeAge = 0;
    passOver = false;
    /** Where the blade connected, and how long ago — null until it does. */
    strikeAt: p5.Vector | null = null;
    strikeAge = 0;

    hitTargets: any[] = [];
    _path: SweepSample[] = [];

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#cef9', 0.35);

    onAdded() {
      super.onAdded();
      this.game.objectManager.addObject(this.particleSystem);
      // Seeded on the first frame so the system is never empty on its own update,
      // which would remove it before the dash had gone anywhere.
      this._puff(6, 10);
    }

    /** Wind motes shed off the blade, in a disc around wherever Yasuo is now. */
    _puff(count: number, spread: number) {
      for (let i = 0; i < count; i++) {
        const a = random(TWO_PI);
        const d = random(spread);
        this.particleSystem.addParticle({
          x: this.owner.position.x + cos(a) * d,
          y: this.owner.position.y + sin(a) * d,
          r: random(2.5, 6),
        });
      }
    }

    update() {
      this.age += deltaTime;
      this.position = this.owner.position.copy();

      for (const sample of this._path) sample.age += deltaTime;
      while (this._path.length > 0 && this._path[0].age > E_TRAIL_MS) this._path.shift();

      if (this.strikeAt) this.strikeAge += deltaTime;

      const dashing = !this.passOver && !!this.dashBuff && !this.dashBuff.toRemove;
      if (dashing) {
        // Keep the heading honest while there is still real distance to run; the
        // last frame's vector shrinks to nothing and must never become the aim.
        const destination = this.dashBuff!.dashDestination;
        if (destination) {
          const toGo = destination.copy().sub(this.owner.position);
          if (toGo.magSq() > 4) this.heading = toGo;
        }
        this._path.push({ x: this.owner.position.x, y: this.owner.position.y, age: 0 });
        if (frameCount % 2 === 0) this._puff(2, 12);
        return;
      }

      // The dash is done: hold the ribbon on screen just long enough to be seen
      // dissolving, rather than snapping out on the frame he stops.
      this.passOver = true;
      this.fadeAge += deltaTime;
      if (this.fadeAge > Math.max(E_TRAIL_MS, E_STRIKE_MS) && this._path.length === 0) {
        this.toRemove = true;
      }
    }

    /**
     * The blade is level with the target: land the damage, once.
     *
     * Called from `Dash.onDashUpdate`, i.e. after each movement step, so the
     * contact test is against where Yasuo actually is rather than where he was
     * standing when the key was pressed.
     */
    tryStrike() {
      const target = this.target;
      if (!target || this.hitTargets.includes(target)) return;
      if (target.isDead || target.toRemove) return;

      const contact =
        (target.stats.size.value + this.owner.stats.size.value) / 2 +
        this.owner.stats.size.value * 0.2;
      if (this.owner.position.dist(target.position) > contact) return;

      this._strike(target);
    }

    /** The dash reached its end. Anything it swept through and somehow missed. */
    finishPass() {
      this.tryStrike();
      this.endPass();
    }

    /** Cancelled or arrived: stop sampling, start fading. */
    endPass() {
      this.passOver = true;
    }

    _strike(target: any) {
      this.hitTargets.push(target);
      target.takeDamage(this.damage, this.owner);
      const strikeAt = target.position.copy();
      this.strikeAt = strikeAt;
      this.strikeAge = 0;

      // The burst is thrown from the point of contact, not from Yasuo, so the
      // impact reads as happening to the target rather than around the caster.
      // Held in a local: the `random()` calls below are enough to lose narrowing
      // on a mutable property under `typecheck:core`'s strict null checks.
      for (let i = 0; i < 12; i++) {
        const a = random(TWO_PI);
        const d = random(6, 26);
        this.particleSystem.addParticle({
          x: strikeAt.x + cos(a) * d,
          y: strikeAt.y + sin(a) * d,
          r: random(3, 8),
        });
      }
    }

    draw() {
      this._drawRibbon();
      if (!this.passOver) this._drawBlade();
      this._drawStrike();
    }

    /** The plane the sword swept: two offset edges, tapering out at the tail. */
    _drawRibbon() {
      const count = this._path.length;
      if (count < 2) return;

      push();
      blendMode(ADD);
      noStroke();

      // Body of the sweep — a filled strip whose width is the age of each sample,
      // which is what makes it a wake instead of a stripe of constant thickness.
      fill(150, 225, 255, 70);
      beginShape();
      for (let i = 0; i < count; i++) this._ribbonVertex(i, 1);
      for (let i = count - 1; i >= 0; i--) this._ribbonVertex(i, -1);
      endShape(CLOSE);

      // The edge itself, riding the middle of that plane.
      noFill();
      strokeCap(ROUND);
      stroke(200, 245, 255, 150);
      strokeWeight(4);
      this._corePolyline();
      stroke(250, 255, 255, 225);
      strokeWeight(1.8);
      this._corePolyline();

      blendMode(BLEND);
      pop();
    }

    _corePolyline() {
      beginShape();
      for (const sample of this._path) vertex(sample.x, sample.y);
      endShape();
    }

    /** One edge of the swept plane, offset along the local normal of the path. */
    _ribbonVertex(index: number, side: number) {
      const count = this._path.length;
      const sample = this._path[index];
      const ahead = this._path[Math.min(count - 1, index + 1)];
      const behind = this._path[Math.max(0, index - 1)];

      let nx = -(ahead.y - behind.y);
      let ny = ahead.x - behind.x;
      const length = Math.hypot(nx, ny);
      if (length > 0.0001) {
        nx /= length;
        ny /= length;
      } else {
        nx = 0;
        ny = 0;
      }

      // Newest sample is widest; the tail closes to a point as it ages out.
      const freshness = 1 - constrain(sample.age / E_TRAIL_MS, 0, 1);
      const halfWidth =
        E_TRAIL_HALF_WIDTH * freshness * (0.35 + 0.65 * (index / Math.max(1, count - 1)));
      vertex(sample.x + nx * halfWidth * side, sample.y + ny * halfWidth * side);
    }

    /** The blade on Yasuo's body: a crescent leading the pass. */
    _drawBlade() {
      const angle = this.heading.heading();
      const reach = this.owner.stats.size.value * 0.95 + 18;
      // The crescent swings from behind him to in front over the pass, which is
      // the difference between carrying a sword and swinging one.
      const swing = constrain(this.age / 220, 0, 1);
      const lead = lerp(-0.55, 0.35, swing);

      push();
      translate(this.owner.position.x, this.owner.position.y);
      rotate(angle + lead);
      blendMode(ADD);
      noFill();
      strokeCap(ROUND);

      stroke(150, 225, 255, 170);
      strokeWeight(8);
      arc(0, 0, reach * 2, reach * 2, -0.5, 0.5);
      stroke(250, 255, 255, 235);
      strokeWeight(3);
      arc(0, 0, reach * 2, reach * 2, -0.42, 0.42);

      // the trailing half of the arc, dimmer: where the edge just came from
      stroke(160, 230, 255, 90);
      strokeWeight(3);
      arc(0, 0, reach * 1.55, reach * 1.55, -0.95, -0.35);

      blendMode(BLEND);
      pop();
    }

    /** The moment of contact: crossed crescents and a hard white flash. */
    _drawStrike() {
      if (!this.strikeAt) return;
      const t = constrain(this.strikeAge / E_STRIKE_MS, 0, 1);
      if (t >= 1) return;
      const fade = 1 - t;
      const angle = this.heading.heading();
      const spread = 40 + 46 * t;

      push();
      translate(this.strikeAt.x, this.strikeAt.y);
      rotate(angle);
      blendMode(ADD);
      noFill();
      strokeCap(ROUND);

      // A cross, not a ring: the target was cut, and a ring is what an explosion
      // leaves. Both strokes bow outward so they stay crescents.
      for (const tilt of [-0.75, 0.75]) {
        stroke(190, 240, 255, 180 * fade);
        strokeWeight(7 * fade + 1.5);
        arc(0, 0, spread * 2, spread * 2, tilt - 0.42, tilt + 0.42);
        stroke(255, 255, 255, 240 * fade);
        strokeWeight(2.5 * fade + 1);
        arc(0, 0, spread * 2, spread * 2, tilt - 0.34, tilt + 0.34);
      }

      noStroke();
      fill(255, 255, 255, 235 * fade * fade);
      circle(0, 0, 26 * fade + 5);

      blendMode(BLEND);
      pop();
    }

    getDisplayBoundingBox() {
      // Everything painted: the ribbon behind him, the crescent on his body and a
      // strike burst that may sit a body-length away from either.
      let minX = this.owner.position.x;
      let minY = this.owner.position.y;
      let maxX = minX;
      let maxY = minY;

      const stretch = (x: number, y: number) => {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      };

      for (const sample of this._path) stretch(sample.x, sample.y);
      if (this.strikeAt) stretch(this.strikeAt.x, this.strikeAt.y);

      const pad = this.owner.stats.size.value + 100;
      return new Rectangle({
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
        data: this,
      });
    }
  }
  return Yasuo_E_Object;
}
const __cacheYasuo_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildYasuo_E_Object>>();
export function makeYasuo_E_Object(api: ContentApi) {
  const cached = __cacheYasuo_E_Object.get(api);
  if (cached) return cached;
  const built = __buildYasuo_E_Object(api);
  __cacheYasuo_E_Object.set(api, built);
  return built;
}