import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Dash = InstanceType<ContentApi['buffs']['Dash']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Stun = InstanceType<ContentApi['buffs']['Stun']>;
type Warwick_R = InstanceType<ReturnType<typeof makeWarwick_R>>;
type Warwick_R_Object = InstanceType<ReturnType<typeof makeWarwick_R_Object>>;



export const RANGE = 550;

export const LEAP_SPEED = 24;

export const SUPPRESS_MS = 1500;

export const DAMAGE_PER_TICK = 10;

export const TICK_INTERVAL = 300;


/** How long one claw streak dropped by the leap stays in the air. */
export const STREAK_MS = 260;

/** Fangs per jaw. Six is a mouth; the old eight-spoke ring was a gear. */
export const FANG_COUNT = 6;

/** How far the jaws gape between bites, in pixels off the victim's body. */
export const JAW_GAP = 16;

/** The white-out on the moment of the bite. */
export const BITE_FLASH_MS = 260;

/** Close enough to count as landed, for the paths a Dash ends without arriving. */
export const CLAMP_DISTANCE = 60;


const BLOOD_DARK: [number, number, number] = [92, 8, 14];

const BLOOD: [number, number, number] = [188, 26, 34];

const BLOOD_BRIGHT: [number, number, number] = [255, 132, 116];


/**
 * Infinite Duress: he crosses the gap and pins them there. The damage is paid
 * out over the pin rather than up front, so killing Warwick mid-ultimate is a
 * real save for the victim's team.
 */
function __buildWarwick_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Dash = api.buffs.Dash;
  const Stun = api.buffs.Stun;
  const Warwick_R_Object = makeWarwick_R_Object(api);
  class Warwick_R extends Spell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_warwick_r');
    name = 'Khóa Chết (Warwick_R)';
    description =
      `Nhảy tới kẻ địch gần con trỏ nhất trong <span>${RANGE}px</span>, ghim chúng` +
      ` <span class="buff">Choáng</span> trong <span class="time">${SUPPRESS_MS / 1000} giây</span>` +
      ` và cắn <span class="damage">${DAMAGE_PER_TICK} sát thương</span> mỗi nhịp`;
    coolDown = 10000;
    manaCost = 70;

    range = RANGE;

    checkCastCondition() {
      return !!this._findTarget() && Dash.CanDash(this.owner);
    }

    onSpellCast() {
      const target = this._findTarget();
      if (!target) return;

      const leap = new Dash(1500, this.owner, this.owner);
      leap.image = this.image;
      leap.dashDestination = target.position.copy();
      leap.dashSpeed = LEAP_SPEED;
      leap.showTrail = true;
      leap.cancelable = false;
      // the generic white streak reads as a blink; this one reads as a wolf
      leap.trailSystem.trailColor = 'rgba(150, 18, 24, 0.42)';
      this.owner.addBuff(leap);

      target.addBuff(new Stun(SUPPRESS_MS, this.owner, target));

      const pin = new Warwick_R_Object(this.owner);
      pin.victim = target;
      pin.attachTo(target);
      this.game.objectManager.addObject(pin);

      // `onDashUpdate`, never `dashBuff.onUpdate =`: Dash puts the movement step
      // itself in `Dash.prototype.onUpdate`, so an instance assignment does not
      // hook the frame, it deletes it — and the leap plays standing still.
      leap.onDashUpdate = () => pin.trackLeap();
      leap.onReachedDestination = () => pin.land();
      leap.onCancelled = () => pin.land();
    }

    _findTarget() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      });
      // Range is measured from Warwick — that is what the ultimate can reach —
      // but *which* of those he takes is measured from the cursor. Nearest-to-
      // caster picked for you, and it picked wrong in the only fight that
      // matters: the minion at your feet instead of the champion you are looking
      // at. Same rule as Zed R, Yasuo E/R, Ekko E and Lee Sin R.
      const aim = this.aimPoint;
      let nearest = null;
      let nearestDistance = Infinity;
      for (const enemy of enemies) {
        const distance = enemy.position.dist(aim);
        if (distance < nearestDistance) {
          nearestDistance = distance;
          nearest = enemy;
        }
      }
      return nearest;
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Warwick_R;
}
const __cacheWarwick_R = new WeakMap<ContentApi, ReturnType<typeof __buildWarwick_R>>();
export default function makeWarwick_R(api: ContentApi) {
  const cached = __cacheWarwick_R.get(api);
  if (cached) return cached;
  const built = __buildWarwick_R(api);
  __cacheWarwick_R.set(api, built);
  return built;
}


/** One pair of claw marks dropped behind Warwick as he crosses the gap. */
interface Streak {
  x: number;
  y: number;
  angle: number;
  age: number;
  /** Rolled when the streak is dropped, so it does not shimmer as it fades. */
  spread: number;
}


function __buildWarwick_R_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  const AttackableUnit = api.units.AttackableUnit;
  class Warwick_R_Object extends SpellObject {
    victim: AttackableUnit | null = null;
    age = 0;
    sinceTick = 0;

    /** The leap's afterimages, oldest first. */
    _streaks: Streak[] = [];
    /** ms since he landed on them, or -1 while he is still in the air. */
    _biteAge = -1;
    /** Counts down from `BITE_FLASH_MS` after every damage tick. */
    _tickFlash = 0;
    /** Seeded once: which way each fang leans, so the mouth is not symmetrical. */
    _fangLean: number[] = [];

    particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize(
      'rgba(188, 26, 34, 0.78)',
      0.45
    );

    onAdded() {
      for (let i = 0; i < FANG_COUNT * 2; i++) this._fangLean.push(random(-0.16, 0.16));

      this.game.objectManager.addObject(this.particleSystem);
      // Blood comes in bursts, one per bite; an empty system deletes itself on
      // its first update, so the pin owns the draining.
      this.particleSystem.autoRemoveIfEmpty = false;
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    /** Called from the leap's per-frame hook: one claw streak per two frames. */
    trackLeap() {
      const victim = this.victim as any;
      if (!victim) return;
      const angle = Math.atan2(
        victim.position.y - this.owner.position.y,
        victim.position.x - this.owner.position.x
      );
      if (this._streaks.length && this._streaks[this._streaks.length - 1].age < 30) return;
      this._streaks.push({
        x: this.owner.position.x,
        y: this.owner.position.y,
        angle,
        age: 0,
        spread: random(10, 20),
      });
    }

    /** He arrives. Everything about the pin starts here rather than at the cast. */
    land() {
      if (this._biteAge >= 0) return;
      this._biteAge = 0;
      this._tickFlash = BITE_FLASH_MS;
      this._spray(16, 7);
    }

    update() {
      // The pin rides the victim: it must not keep chewing a corpse, and it must
      // not reappear on the body that respawns somewhere else.
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.sinceTick += deltaTime;
      if (this._biteAge >= 0) this._biteAge += deltaTime;
      if (this._tickFlash > 0) this._tickFlash -= deltaTime;

      let i = 0;
      while (i < this._streaks.length) {
        this._streaks[i].age += deltaTime;
        if (this._streaks[i].age >= STREAK_MS) this._streaks.splice(i, 1);
        else i++;
      }

      const victim = this.victim as any;
      // Nothing in this game outlives its caster: killing Warwick ends the pin.
      if (!victim || victim.isDead || this.owner.isDead || this.age >= SUPPRESS_MS) {
        this.toRemove = true;
        return;
      }
      this.position.set(victim.position.x, victim.position.y);

      // Not every way a Dash ends fires `onReachedDestination` — a grounded or
      // interrupted leap simply stops — so proximity is the backstop. If he is
      // standing on them, he is biting them, whatever the buff did.
      if (this._biteAge < 0 && this.owner.position.dist(victim.position) <= CLAMP_DISTANCE) {
        this.land();
      }

      if (this.sinceTick < TICK_INTERVAL) return;
      this.sinceTick -= TICK_INTERVAL;
      victim.takeDamage(DAMAGE_PER_TICK, this.owner);
      // every bite draws blood, so the drain is visible and not just a number
      this._tickFlash = BITE_FLASH_MS;
      this._spray(6, 5);
    }

    /** A burst of blood off the victim. */
    _spray(count: number, maxSize: number) {
      const victim = this.victim as any;
      if (!victim) return;
      for (let i = 0; i < count; i++) {
        const a = random(TWO_PI);
        const d = random(0, 26);
        this.particleSystem.addParticle({
          x: victim.position.x + cos(a) * d,
          y: victim.position.y + sin(a) * d,
          r: random(maxSize * 0.4, maxSize),
        });
      }
    }

    draw() {
      const victim = this.victim as any;
      if (!victim) return;

      this._drawStreaks();
      if (this._biteAge < 0) return; // still in the air: nothing to clamp yet

      const size = victim.animatedValues?.displaySize ?? 40;
      const grip = size / 2;
      // Facing matters: the jaws close along the line he came in on, so the bite
      // is legibly *his* and not a ring that happens to sit on the victim.
      const facing = Math.atan2(
        victim.position.y - this.owner.position.y,
        victim.position.x - this.owner.position.x
      );
      // Jaws gape between bites and slam shut on the tick — the tick interval is
      // the animation, so the damage and the chewing can never drift apart.
      const chew = constrain(this.sinceTick / TICK_INTERVAL, 0, 1);
      const gap = JAW_GAP * (1 - chew) * (1 - chew);
      const flash = constrain(this._tickFlash / BITE_FLASH_MS, 0, 1);
      const left = constrain(1 - this.age / SUPPRESS_MS, 0, 1);
      const [dr, dg, db] = BLOOD_DARK;
      const [br, bg, bb] = BLOOD;
      const [lr, lg, lb] = BLOOD_BRIGHT;

      push();
      translate(victim.position.x, victim.position.y);

      // pooled blood under the pin, growing while it lasts
      noStroke();
      fill(dr, dg, db, 120);
      ellipse(0, grip * 0.55, size * (0.7 + 0.5 * (1 - left)), size * 0.32);

      // how long they are held — the victim's team is reading this to decide
      // whether they can get there in time
      noFill();
      stroke(br, bg, bb, 150);
      strokeWeight(3);
      circle(0, 0, size + 26);
      stroke(lr, lg, lb, 235);
      strokeWeight(3);
      arc(0, 0, size + 26, size + 26, -HALF_PI, -HALF_PI + TWO_PI * left);

      rotate(facing);

      // the two jaws, closing across the victim
      this._drawJaw(-1, grip, gap, flash);
      this._drawJaw(1, grip, gap, flash);

      // the claws holding them in place while he chews
      stroke(dr, dg, db, 235);
      strokeWeight(4);
      noFill();
      for (const side of [-1, 1]) {
        const y = side * (grip * 0.55);
        arc(-grip * 0.2, y, grip * 1.6, grip * 1.1, side < 0 ? 0.5 : -1.1, side < 0 ? 1.9 : 0.5);
      }

      // the bite itself
      if (flash > 0) {
        noStroke();
        fill(255, 235, 230, 210 * flash);
        circle(0, 0, size * 0.7 * flash + 10);
        noFill();
        stroke(lr, lg, lb, 240 * flash);
        strokeWeight(5 * flash + 1);
        circle(0, 0, size + 40 * (1 - flash));
      }

      pop();
    }

    /**
     * One jaw. `side` is -1 for the upper set and 1 for the lower; both are drawn
     * in the rotated frame so "upper" means "above the line he charged in on".
     */
    _drawJaw(side: number, grip: number, gap: number, flash: number) {
      const [dr, dg, db] = BLOOD_DARK;
      const y = side * (grip * 0.35 + gap);
      const span = grip * 1.5;

      push();
      // the gum line the fangs are set into
      noFill();
      stroke(dr, dg, db, 245);
      strokeWeight(6);
      arc(0, y, span * 2, grip * 1.5, side < 0 ? PI : 0, side < 0 ? TWO_PI : PI);

      noStroke();
      for (let i = 0; i < FANG_COUNT; i++) {
        const f = (i + 0.5) / FANG_COUNT;
        const x = lerp(-span * 0.85, span * 0.85, f);
        // the middle fangs are the long ones, as in an actual mouth
        const length = (10 + 7 * sin(f * PI)) * (1 - Math.abs(x) / (span * 2.4));
        const lean = this._fangLean[(side < 0 ? 0 : FANG_COUNT) + i] ?? 0;
        const base = y + side * grip * 0.28;
        fill(255, 245, 235, 235);
        triangle(x - 4, base, x + 4, base, x + lean * 12, base - side * length);
        // the tip reddens as he works
        const mid = base - side * length * 0.45;
        fill(200, 60, 60, 200 * flash);
        triangle(x - 2, mid, x + 2, mid, x + lean * 12, base - side * length);
      }
      pop();
    }

    /** The claw marks he leaves in the air crossing the gap. */
    _drawStreaks() {
      if (!this._streaks.length) return;
      const [br, bg, bb] = BLOOD;
      const [lr, lg, lb] = BLOOD_BRIGHT;

      push();
      for (const streak of this._streaks) {
        const fade = 1 - streak.age / STREAK_MS;
        push();
        translate(streak.x, streak.y);
        rotate(streak.angle);
        // three parallel gashes raked backwards: a wolf, not a smoke puff
        for (let i = -1; i <= 1; i++) {
          const offset = i * streak.spread;
          stroke(br, bg, bb, 200 * fade);
          strokeWeight(5 * fade + 1);
          line(-34, offset * 0.6, 6, offset);
          stroke(lr, lg, lb, 230 * fade);
          strokeWeight(2 * fade + 0.5);
          line(-30, offset * 0.6, 4, offset);
        }
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      const victim = this.victim as any;
      const at = victim?.position ?? this.owner.position;
      // The streaks trail all the way back to where he jumped from, so the box
      // has to span the leap and not just the mouth at the end of it.
      let minX = at.x - 70;
      let minY = at.y - 70;
      let maxX = at.x + 70;
      let maxY = at.y + 70;
      for (const streak of this._streaks) {
        if (streak.x - 45 < minX) minX = streak.x - 45;
        if (streak.y - 45 < minY) minY = streak.y - 45;
        if (streak.x + 45 > maxX) maxX = streak.x + 45;
        if (streak.y + 45 > maxY) maxY = streak.y + 45;
      }
      return new Rectangle({
        x: minX,
        y: minY,
        w: maxX - minX,
        h: maxY - minY,
        data: this,
      });
    }
  }
  return Warwick_R_Object;
}
const __cacheWarwick_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildWarwick_R_Object>>();
export function makeWarwick_R_Object(api: ContentApi) {
  const cached = __cacheWarwick_R_Object.get(api);
  if (cached) return cached;
  const built = __buildWarwick_R_Object(api);
  __cacheWarwick_R_Object.set(api, built);
  return built;
}