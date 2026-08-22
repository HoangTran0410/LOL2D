import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Airborne = InstanceType<ContentApi['buffs']['Airborne']>;
type AoePulse = InstanceType<ContentApi['AoePulse']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Untargetable = InstanceType<ContentApi['buffs']['Untargetable']>;
type Rammus_R = InstanceType<ReturnType<typeof makeRammus_R>>;
type Rammus_R_Leap = InstanceType<ReturnType<typeof makeRammus_R_Leap>>;



export const MAX_RANGE = 500;

export const RADIUS = 210;

export const DAMAGE = 32;

export const LEAP_SPEED = 13;

/** Ceiling on the flight, so a leap that never arrives still lands. */
export const LEAP_TIMEOUT_MS = 2000;


/**
 * Soaring Slam.
 *
 * The first version wrote `owner.position.set(landing)` and applied the blast
 * in the same frame — a teleport with a ring drawn on it. Nothing about it read
 * as a leap: no travel, no airtime, and no reason for the enemy standing on the
 * landing spot to move, because by the time anything was visible the damage had
 * already happened.
 *
 * Now the ability is the flight. Rammus dashes to the point, spends the whole
 * trip `Untargetable` (he is in the air — see Fizz E, which uses the same pair),
 * and the slam fires **on arrival**, from `Rammus_R_Leap`. That gives the
 * victims the one thing the teleport denied them: the length of the jump to
 * walk out of the circle, which is drawn on the ground the entire time.
 */
function __buildRammus_R(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Untargetable = api.buffs.Untargetable;
  const Rammus_R_Leap = makeRammus_R_Leap(api);
  class Rammus_R extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_rammus_r');
    name = 'Cú Nhảy Chấn Động (Rammus_R)';
    description =
      `Bay tới vị trí chỉ định, <span class="buff">Không Thể Bị Chọn</span> suốt đường bay, rồi giáng xuống` +
      ` bán kính <span>${RADIUS}px</span>: <span class="damage">${DAMAGE} sát thương</span>,` +
      ` <span class="buff">Hất Tung</span> và <span class="buff">Làm Chậm 50%</span> kẻ địch trúng phải`;
    coolDown = 10000;
    manaCost = 60;

    maxRange = MAX_RANGE;

    checkCastCondition() {
      // Grounded means grounded: the leap fails before it charges mana.
      return Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.maxRange
      );

      const airborne = new Untargetable(LEAP_TIMEOUT_MS, this.owner, this.owner);
      airborne.image = this.image;
      this.owner.addBuff(airborne);

      const leapDash = new Dash(LEAP_TIMEOUT_MS, this.owner, this.owner);
      leapDash.image = this.image;
      leapDash.dashDestination = to;
      leapDash.dashSpeed = LEAP_SPEED;
      leapDash.showTrail = true;
      // He is already in the air and untargetable; nothing lands on him to stop
      // him, and his own knock-up must not abort his own jump.
      leapDash.cancelable = false;
      this.owner.addBuff(leapDash);

      const leap = new Rammus_R_Leap(this.owner);
      leap.landing = to;
      leap.dashBuff = leapDash;
      leap.airborneBuff = airborne;
      this.game.objectManager.addObject(leap);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return Rammus_R;
}
const __cacheRammus_R = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_R>>();
export default function makeRammus_R(api: ContentApi) {
  const cached = __cacheRammus_R.get(api);
  if (cached) return cached;
  const built = __buildRammus_R(api);
  __cacheRammus_R.set(api, built);
  return built;
}


/**
 * The flight, and the slam that ends it. Owns the landing so there is exactly
 * one place that can fire it: `landed` latches, because the dash ending, the
 * timeout and the object being removed all converge here.
 */
function __buildRammus_R_Leap(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const Rectangle = api.utils.Quadtree.Rectangle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const AoePulse = api.AoePulse;
  const Airborne = api.buffs.Airborne;
  const Dash = api.buffs.Dash;
  const Slow = api.buffs.Slow;
  const Untargetable = api.buffs.Untargetable;
  class Rammus_R_Leap extends SpellObject {
    landing: p5.Vector = this.owner.position.copy();
    dashBuff: Dash | null = null;
    airborneBuff: Untargetable | null = null;
    radius = RADIUS;
    visionRadius = RADIUS;
    age = 0;
    landed = false;

    update() {
      this.position = this.owner.position.copy();
      this.age += deltaTime;

      const dashOver = !this.dashBuff || this.dashBuff.toRemove;
      const arrived = this.owner.position.dist(this.landing) <= LEAP_SPEED;
      if (!dashOver && !arrived && this.age < LEAP_TIMEOUT_MS) return;

      this.land();
    }

    land() {
      if (this.landed) return;
      this.landed = true;
      this.toRemove = true;

      // Back on the ground, back on the menu — even if the leap timed out.
      this.airborneBuff?.deactivateBuff?.();
      this.dashBuff?.deactivateBuff?.();

      const impact = this.owner.position.copy();
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({ x: impact.x, y: impact.y, r: this.radius }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        enemy.takeDamage(DAMAGE, this.owner);
        enemy.addBuff(new Airborne(600, this.owner, enemy));
        const slow = new Slow(2000, this.owner, enemy);
        slow.percent = 0.5;
        enemy.addBuff(slow);
      });

      const crater = new AoePulse(this.owner);
      crater.position = impact;
      crater.radius = this.radius;
      crater.lifeTime = 560;
      crater.color = [205, 200, 135];
      crater.style = 'crater';
      crater.spokes = 12;
      this.game.objectManager.addObject(crater);
    }

    draw() {
      // The circle he is about to come down in, on the ground the whole flight:
      // the warning is the ability's counterplay.
      const wind = 0.6 + 0.4 * Math.sin(this.age / 90);
      push();
      translate(this.landing.x, this.landing.y);
      noFill();
      stroke(255, 220, 120, 120 + 60 * wind);
      strokeWeight(4);
      circle(0, 0, this.radius * 2);
      stroke(255, 220, 120, 70);
      strokeWeight(2);
      circle(0, 0, this.radius * 2 * (0.3 + 0.5 * wind));
      pop();

      // ...and the ball itself, spinning and casting a shrinking shadow as it
      // rises over the midpoint of the jump.
      const total = Math.max(1, this.landing.dist(this.owner.position) + this.age * 0.001);
      const lift =
        Math.sin(constrain(1 - this.owner.position.dist(this.landing) / total, 0, 1) * PI) * 34;
      push();
      noStroke();
      fill(0, 0, 0, 80);
      ellipse(this.owner.position.x, this.owner.position.y, 42 - lift * 0.4, 20 - lift * 0.2);
      pop();
    }

    onRemoved() {
      // Death, scene exit and a normal landing all arrive here; `land` latches so
      // the slam still happens exactly once.
      this.land();
      super.onRemoved();
    }

    getDisplayBoundingBox() {
      const minX = Math.min(this.landing.x, this.owner.position.x) - this.radius;
      const minY = Math.min(this.landing.y, this.owner.position.y) - this.radius;
      return new Rectangle({
        x: minX,
        y: minY,
        w: Math.abs(this.landing.x - this.owner.position.x) + this.radius * 2,
        h: Math.abs(this.landing.y - this.owner.position.y) + this.radius * 2,
        data: this,
      });
    }
  }
  return Rammus_R_Leap;
}
const __cacheRammus_R_Leap = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_R_Leap>>();
export function makeRammus_R_Leap(api: ContentApi) {
  const cached = __cacheRammus_R_Leap.get(api);
  if (cached) return cached;
  const built = __buildRammus_R_Leap(api);
  __cacheRammus_R_Leap.set(api, built);
  return built;
}