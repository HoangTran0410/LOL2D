import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ahri_R = InstanceType<ReturnType<typeof makeAhri_R>>;
type Ahri_R_Burst = InstanceType<ReturnType<typeof makeAhri_R_Burst>>;
type Ahri_R_Object = InstanceType<ReturnType<typeof makeAhri_R_Object>>;



/** Nine tails again — the ultimate's orbs and its burst both carry the count. */
export const ESSENCE_POINTS = 9;

/** Windup: the orbs unfurl out of the dash instead of being there already. */
export const ORB_SPAWN_MS = 160;

/** How long the arcane star left where an orb landed stays up. */
export const R_BURST_MS = 420;

/** How far past its hitbox an orb paints, as a multiple of `size`. */
export const ORB_PAINT_REACH = 2;


function __buildAhri_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Ahri_R_Object = makeAhri_R_Object(api);
  class Ahri_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_ahri_r');
    name = 'Phi Hồ (Ahri_R)';
    description =
      '<span class="buff">Lướt</span> tới trước theo hướng chỉ định, bắn tối đa 3 quả cầu vào 3 kẻ địch gần nhất trong phạm vi, gây <span class="damage">20 sát thương</span> mỗi quả cầu. Có thể sử dụng tối đa <span>3 lần</span> lướt trong vòng <span class="time">10 giây</span>';
    coolDown = 10000;
    manaCost = 50;

    maxDashCount = 3;
    maxDashDistance = 150;
    timeWaitForNextDash = 1000;
    timeoutForAllDashes = 10000;
    rangeToFindEnemies = 150;
    damage = 20;

    dashCount = 0;
    timeSinceFirstDash = 0;
    timeSinceLastDash = 0;

    checkCastCondition() {
      return (
        this.owner.canMove &&
        this.dashCount < this.maxDashCount &&
        (!this.timeSinceLastDash || this.timeSinceLastDash >= this.timeWaitForNextDash)
      );
    }

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.maxDashDistance
      );

      const dashBuff = new Dash(3000, this.owner, this.owner);
      dashBuff.dashDestination = to;
      dashBuff.image = this.image;
      dashBuff.dashSpeed = 10;
      dashBuff.onReachedDestination = () => {
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.owner.position.x,
            y: this.owner.position.y,
            r: this.rangeToFindEnemies,
          }),
          filters: [
            PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
            PredefinedFilters.visibleTo(this.owner),
          ],
        });

        for (let i = 0; i < Math.min(3, enemies.length); i++) {
          const enemy = enemies[i];

          const obj = new Ahri_R_Object(this.owner);
          obj.targetEnemy = enemy;
          obj.damage = this.damage;
          // purely cosmetic: the three orbs unfurl and spin out of step, so a
          // triple hit reads as three shots instead of one sprite drawn thrice.
          // Their flight is untouched — staggering that would move the damage.
          obj.unfurlScale = 1 + i * 0.4;
          obj.spinOffset = i * 0.8;
          this.game.objectManager.addObject(obj);
        }
      };
      this.owner.addBuff(dashBuff);

      this.dashCount++;
      this.timeSinceLastDash = 0;
      // recast window, not a cooldown — deliberately not reduced
      this.currentCooldown = this.timeWaitForNextDash;
    }

    onUpdate() {
      if (this.dashCount > 0) {
        this.timeSinceFirstDash += deltaTime;
        this.timeSinceLastDash += deltaTime;
      }

      if (this.dashCount >= this.maxDashCount || this.timeSinceFirstDash > this.timeoutForAllDashes) {
        this.dashCount = 0;
        this.timeSinceFirstDash = 0;
        this.timeSinceLastDash = 0;
        this.currentCooldown = this.reducedCooldown(this.coolDown);
      }
    }
  }
  return Ahri_R;
}
const __cacheAhri_R = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_R>>();
export default function makeAhri_R(api: ContentApi) {
  const cached = __cacheAhri_R.get(api);
  if (cached) return cached;
  const built = __buildAhri_R(api);
  __cacheAhri_R.set(api, built);
  return built;
}


function __buildAhri_R_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const MissileSpellObject = api.MissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  const Ahri_R_Burst = makeAhri_R_Burst(api);
  class Ahri_R_Object extends MissileSpellObject {
    targetEnemy: SpellObject['owner'] | null = null;
    damage = 20;
    speed = 7;
    size = 20;
    // locked onto one enemy, so it passes harmlessly through everyone else
    maxHitCount = 0;
    /** Cosmetic: stretches this orb's unfurl so the volley does not bloom as one. */
    unfurlScale = 1;
    /** Cosmetic: phase offset for the tail spin, same reason. */
    spinOffset = 0;

    trailSystem = new TrailSystem({
      trailColor: '#6AA5D666',
      trailSize: this.size,
    });

    /** Cosmetic: drives the unfurl and the spin. */
    _age = 0;

    onBeforeMove() {
      if (this.targetEnemy) this.destination = this.targetEnemy.position; // live ref: the orb tracks its target
    }

    onArrive() {
      if (!this.targetEnemy) return;
      this.targetEnemy.takeDamage(this.damage, this.owner);

      // the orb vanishes on arrival, so the landing is its own object — without
      // it an ultimate's three hits are three sprites silently switching off
      const burst = new Ahri_R_Burst(this.owner);
      burst.position = this.targetEnemy.position.copy();
      burst.targetSize = this.targetEnemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(burst);
    }

    update() {
      if (!this.targetEnemy) {
        this.toRemove = true;
        return;
      }

      this._age += deltaTime;

      super.update();
    }

    draw() {
      // ease-out unfurl: the orb blooms open fast then holds, which is what makes
      // the stagger between the three shots readable
      const grow = constrain(this._age / (ORB_SPAWN_MS * this.unfurlScale), 0, 1);
      const scaleUp = 1 - (1 - grow) * (1 - grow);

      const spin = this._age / 200 + this.spinOffset;
      const r = (this.size / 2) * scaleUp;
      const heading = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );

      push();
      translate(this.position.x, this.position.y);

      // arcane halo, additive: three orbs converging on one target should pool
      // into a brighter core rather than stack as three flat discs
      blendMode(ADD);
      noStroke();
      fill(70, 139, 195, 85);
      circle(0, 0, r * 4.2);
      blendMode(BLEND);

      // nine spirit tails wheeling around the orb, alternating long and short so
      // the star reads as fox-fire rather than as a gear
      push();
      rotate(spin);
      noStroke();
      for (let i = 0; i < ESSENCE_POINTS; i++) {
        const a = (TWO_PI * i) / ESSENCE_POINTS;
        const len = r * (i % 2 ? 1.6 : 2.3) * (1 + sin(spin * 3 + i) * 0.12);
        push();
        rotate(a);
        fill(125, 180, 225, 190);
        triangle(r * 0.45, -r * 0.3, r * 0.45, r * 0.3, len, 0);
        pop();
      }
      pop();

      // the body: an outer shell of pink essence around a white-hot heart
      noStroke();
      fill(82, 150, 205, 200);
      circle(0, 0, r * 1.9);
      fill(200, 225, 245, 240);
      circle(0, 0, r * 1.15);
      fill(255, 255, 255, 250);
      circle(0, 0, r * 0.6);

      // a lance of light out the leading edge, so the orb points at the enemy it
      // has locked onto — this ultimate homes, and the art should say so
      push();
      rotate(heading);
      fill(210, 232, 250, 150);
      triangle(r * 2.6, 0, r * 0.6, -r * 0.4, r * 0.6, r * 0.4);
      pop();

      pop();
    }

    // tails and halo paint well past the 20px hitbox
    getDisplayBoundingBox() {
      const r = this.size * ORB_PAINT_REACH;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ahri_R_Object;
}
const __cacheAhri_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_R_Object>>();
export function makeAhri_R_Object(api: ContentApi) {
  const cached = __cacheAhri_R_Object.get(api);
  if (cached) return cached;
  const built = __buildAhri_R_Object(api);
  __cacheAhri_R_Object.set(api, built);
  return built;
}


/**
 * Where an orb landed. A nine-pointed arcane star, then wisps of stolen essence
 * drifting back towards Ahri — the ultimate's whole fantasy in one beat, and the
 * reason the burst is drawn relative to her rather than only to the victim.
 */
function __buildAhri_R_Burst(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Ahri_R_Burst extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = R_BURST_MS;
    maxRadius = 62;

    _wisps: { offset: number; drift: number; size: number }[] = [];

    onAdded() {
      for (let i = 0; i < 4; i++) {
        this._wisps.push({
          offset: random(-26, 26),
          drift: random(0.55, 1),
          size: random(4, 8),
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
      const flash = 1 - constrain(t / 0.25, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(175, 214, 245, 200 * flash);
        circle(0, 0, this.targetSize + t * 70);
        blendMode(BLEND);
      }

      // hard ring on the victim, so the ultimate's hit is unmistakable even in a
      // fight where several things are landing at once
      noFill();
      stroke(130, 185, 230, 230 * fade);
      strokeWeight(4 * fade + 1.5);
      circle(0, 0, this.targetSize * 0.7 + this.maxRadius * t);

      // nine-pointed star snapping open — the same count as the orb's tails
      stroke(225, 240, 252, 235 * fade);
      strokeWeight(3 * fade + 0.8);
      for (let i = 0; i < ESSENCE_POINTS; i++) {
        const a = (TWO_PI * i) / ESSENCE_POINTS + t * 0.5;
        const inner = 6 + this.maxRadius * 0.25 * t;
        const outer = inner + this.maxRadius * 0.7 * t * fade + 6;
        line(cos(a) * inner, sin(a) * inner, cos(a) * outer, sin(a) * outer);
      }

      pop();

      // stolen essence pulled home. Drawn in world space because it spans the gap
      // between the corpse and Ahri, which is the whole point of the beat.
      const owner = this.owner.position;
      push();
      noStroke();
      for (const w of this._wisps) {
        const p = constrain(t * w.drift, 0, 1);
        const x = lerp(this.position.x, owner.x, p) + w.offset * (1 - p);
        const y = lerp(this.position.y, owner.y, p) + w.offset * (1 - p) * 0.5;
        fill(190, 220, 245, 210 * fade);
        circle(x, y, w.size * fade + 2);
      }
      pop();
    }

    getDisplayBoundingBox() {
      // deliberately spans caster and victim: the essence wisps travel between the
      // two, and a box around the victim alone would cull them mid-flight
      const owner = this.owner.position;
      const pad = this.targetSize + this.maxRadius + 30;
      const minX = Math.min(this.position.x, owner.x) - pad;
      const minY = Math.min(this.position.y, owner.y) - pad;
      const maxX = Math.max(this.position.x, owner.x) + pad;
      const maxY = Math.max(this.position.y, owner.y) + pad;
      return new Rectangle({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        data: this,
      });
    }
  }
  return Ahri_R_Burst;
}
const __cacheAhri_R_Burst = new WeakMap<ContentApi, ReturnType<typeof __buildAhri_R_Burst>>();
export function makeAhri_R_Burst(api: ContentApi) {
  const cached = __cacheAhri_R_Burst.get(api);
  if (cached) return cached;
  const built = __buildAhri_R_Burst(api);
  __cacheAhri_R_Burst.set(api, built);
  return built;
}