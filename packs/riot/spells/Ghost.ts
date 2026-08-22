import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Phasing = InstanceType<ContentApi['buffs']['Phasing']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Ghost = InstanceType<ReturnType<typeof makeGhost>>;
type Ghost_Object = InstanceType<ReturnType<typeof makeGhost_Object>>;



export const DURATION = 5000;

export const SPEED_PERCENT = 0.4;


/** The release: a pale ring letting go of him as the drag comes off. */
export const RELEASE_MS = 320;

/** A new streak is laid down on this clock, not per frame, so they space out. */
export const STREAK_INTERVAL_MS = 55;

export const STREAK_LIFETIME_MS = 420;

export const STREAK_MAX = 22;

/** How far behind him a streak can trail before it is spent. */
export const STREAK_REACH = 96;

/** Below this, he is standing still and the last known heading is kept. */
export const HEADING_EPSILON = 0.35;

export const BOUNDING_MARGIN = 150;

/** Cosmetic-only ceiling; the buff ending or the caster dying is the real exit. */
export const HARD_STOP_MS = DURATION + 1200;


function __buildGhost(api: ContentApi) {
  const Spell = api.Spell;
  const Speedup = api.buffs.Speedup;
  const Phasing = api.buffs.Phasing;
  const Ghost_Object = makeGhost_Object(api);
  class Ghost extends Spell {
    targetingMode = 'SELF' as const;
    name = 'Tốc Hành (Ghost)';
    image = api.asset('spell_ghost');
    description =
      '<span class="buff">Tăng tốc 40%</span> và <span class="buff">đi xuyên qua các đơn vị</span>' +
      ' trong <span class="time">5 giây</span>';
    coolDown = 10000;
    manaCost = 100;

    onSpellCast() {
      let speedupBuff = new Speedup(DURATION, this.owner, this.owner);
      speedupBuff.percent = SPEED_PERCENT;
      this.owner.addBuff(speedupBuff);

      // The half the name promises and the spell never delivered: Ghost is a
      // *disengage*, and raw movement speed does not disengage through the wave
      // that is body-blocking you. Bodies only — walls still stop him.
      const phase = new Phasing(DURATION, this.owner, this.owner);
      phase.image = this.image;
      this.owner.addBuff(phase);

      // Ghost is on every champion in the game, so its look has to be the one
      // thing that is nobody's: no colour, no creature, no element. Pale motion
      // streaks and thinning vapour — the read is "that one is faster than it
      // looks", and it never gets confused for a champion's own buff.
      const wake = new Ghost_Object(this.owner);
      wake.attachTo(this.owner, speedupBuff);
      this.game.objectManager.addObject(wake);
    }
  }
  return Ghost;
}
const __cacheGhost = new WeakMap<ContentApi, ReturnType<typeof __buildGhost>>();
export default function makeGhost(api: ContentApi) {
  const cached = __cacheGhost.get(api);
  if (cached) return cached;
  const built = __buildGhost(api);
  __cacheGhost.set(api, built);
  return built;
}


interface Streak {
  /** Where on the body it peeled off, relative to the direction of travel. */
  across: number;
  along: number;
  length: number;
  age: number;
  /** Streaks bow slightly, so a wake reads as flow rather than as hatching. */
  bow: number;
}


/**
 * The wake. Streaks are sized by how fast he is actually travelling, which is
 * what makes speed legible: they pull long while he runs and shrink back to a
 * standing shimmer the moment he stops. A trail that keeps streaming at full
 * length while the runner is parked reads as decoration, not as haste.
 */
function __buildGhost_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ghost_Object extends SpellObject {
    age = 0;

    _streaks: Streak[] = [];
    _streakTimer = 0;
    /** Latched heading. Never (0,0): it starts at +x and only ever turns. */
    _headingX = 1;
    _headingY = 0;
    /** Smoothed speed, 0..1, driving how long the streaks pull out. */
    _flow = 0;
    _lastX = 0;
    _lastY = 0;

    onAdded() {
      this._lastX = this.owner.position.x;
      this._lastY = this.owner.position.y;
    }

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      const pos = this.owner.position;
      this.position.set(pos.x, pos.y);

      if (this.age >= HARD_STOP_MS) {
        this.toRemove = true;
        return;
      }

      const dx = pos.x - this._lastX;
      const dy = pos.y - this._lastY;
      this._lastX = pos.x;
      this._lastY = pos.y;
      const step = Math.hypot(dx, dy);

      // A direction is never allowed to be (0,0): standing still keeps the last
      // heading rather than collapsing the whole wake onto a single point.
      if (step > HEADING_EPSILON) {
        this._headingX = dx / step;
        this._headingY = dy / step;
      }
      // eased so a hard stop bleeds off instead of cutting the wake dead
      this._flow = lerp(this._flow, constrain(step / 4, 0, 1), 0.15);

      this._streakTimer += deltaTime;
      if (this._streakTimer >= STREAK_INTERVAL_MS && this._streaks.length < STREAK_MAX) {
        this._streakTimer = 0;
        const r = this.owner.animatedValues.displaySize / 2;
        this._streaks.push({
          across: random(-r * 0.9, r * 0.9),
          along: random(-r * 0.3, r * 0.3),
          length: STREAK_REACH * random(0.45, 1) * (0.25 + this._flow * 0.75),
          age: 0,
          bow: random(-7, 7),
        });
      }

      let i = 0;
      while (i < this._streaks.length) {
        const streak = this._streaks[i];
        streak.age += deltaTime;
        if (streak.age >= STREAK_LIFETIME_MS) this._streaks.splice(i, 1);
        else i++;
      }
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      const heading = Math.atan2(this._headingY, this._headingX);

      push();
      translate(this.position.x, this.position.y);

      push();
      // everything below is drawn in travel space: +x is forward, so a streak is
      // simply a line pointing backwards and nothing has to be re-derived
      rotate(heading);

      // The streaks. They fade from their tail first, which is what gives each one
      // a direction rather than making it a symmetric dash.
      noFill();
      for (const streak of this._streaks) {
        const t = streak.age / STREAK_LIFETIME_MS;
        const fade = 1 - t;
        // it keeps sliding backwards after it is laid down, so the wake spreads
        const drift = streak.along - t * 26;
        const len = streak.length * (0.4 + fade * 0.6);
        for (const [weight, alpha] of [
          [5, 55 * fade],
          [2, 190 * fade],
        ] as number[][]) {
          stroke(232, 240, 248, alpha);
          strokeWeight(weight);
          beginShape();
          for (let k = 0; k <= 5; k++) {
            const u = k / 5;
            // a shallow bow, so the streak curves the way air moves round a body
            const sag = (0.25 - (u - 0.5) * (u - 0.5)) * 4 * streak.bow;
            vertex(drift - u * len, streak.across + sag);
          }
          endShape();
        }
      }

      // Vapour pooling under him, stretched along the direction of travel. This is
      // what still says "hasted" when he is standing still and there is no wake.
      noStroke();
      const stretch = 1 + this._flow * 0.9;
      fill(226, 236, 246, 46 + 26 * sin(this.age / 260));
      ellipse(-r * 0.25 * this._flow, r * 0.35, size * 1.15 * stretch, size * 0.55);

      // A thin leading edge, the only bright thing in front of him: it points the
      // way the streaks are coming from so the wake never looks like it drifted on.
      stroke(255, 255, 255, 150);
      strokeWeight(2);
      noFill();
      arc(0, 0, size * 1.2, size * 1.2, -0.7, 0.7);
      pop();

      // How much of the hurry is left, in the same colourless palette.
      noFill();
      stroke(70, 78, 88, 100);
      strokeWeight(4);
      circle(0, 0, size + 26);
      stroke(238, 244, 250, 215);
      strokeWeight(4);
      arc(0, 0, size + 26, size + 26, -HALF_PI, -HALF_PI + TWO_PI * left);

      // The release: one ring peeling off him as the drag lets go.
      if (this.age < RELEASE_MS) {
        const t = this.age / RELEASE_MS;
        const fade = 1 - t;
        noFill();
        stroke(255, 255, 255, 210 * fade);
        strokeWeight(7 * fade + 1.5);
        circle(0, 0, size + 150 * t);
        stroke(190, 205, 220, 160 * fade);
        strokeWeight(3);
        circle(0, 0, size + 96 * t);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ghost_Object;
}
const __cacheGhost_Object = new WeakMap<ContentApi, ReturnType<typeof __buildGhost_Object>>();
export function makeGhost_Object(api: ContentApi) {
  const cached = __cacheGhost_Object.get(api);
  if (cached) return cached;
  const built = __buildGhost_Object(api);
  __cacheGhost_Object.set(api, built);
  return built;
}