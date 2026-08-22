import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Blitzcrank_W = InstanceType<ReturnType<typeof makeBlitzcrank_W>>;
type Blitzcrank_W_Object = InstanceType<ReturnType<typeof makeBlitzcrank_W_Object>>;



export const HASTE_DURATION = 4000;

export const HASTE_PERCENT = 0.5;

export const BACKLASH_DURATION = 1000;

export const BACKLASH_PERCENT = 0.75;


/** Pistons punch out and slam back — the machine kicking over before it revs. */
export const PRIME_MS = 260;

/** The gear takes a moment to reach speed rather than snapping to full rpm. */
export const SPINUP_MS = 420;

export const TOOTH_COUNT = 12;

/** Arcs are re-struck on a clock, not per frame, so they read as discrete bolts. */
export const ARC_INTERVAL_MS = 90;

export const ARC_COUNT = 3;

export const ARC_SEGMENTS = 5;

export const VENT_INTERVAL_MS = 150;

/**
 * The last stretch before Overdrive expires: the gear glows amber, the arcs
 * double up and the whole rig starts shaking. This is a warning, not decoration
 * — the 75% slow that lands the instant this ends is the worst moment in the
 * ability, and the player deserves to see it coming.
 */
export const REDLINE_MS = 900;

export const BOUNDING_MARGIN = 120;

/** Cosmetic-only ceiling; the buff ending or Blitzcrank dying is the real exit. */
export const HARD_STOP_MS = HASTE_DURATION + 1200;


function __buildBlitzcrank_W(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const Spell = api.Spell;
  const Slow = api.buffs.Slow;
  const Speedup = api.buffs.Speedup;
  const Blitzcrank_W_Object = makeBlitzcrank_W_Object(api);
  class Blitzcrank_W extends Spell {
    targetingMode = 'SELF' as const;
    name = 'Tăng Tốc (Blitzcrank_W)';
    image = api.asset('spell_blitzcrank_w');
    description =
      '<span class="buff">Tăng Tốc 50%</span> trong <span class="time">4 giây</span>, sau đó bị <span class="buff">Làm Chậm 75%</span> trong <span class="time">1 giây</span>';
    coolDown = 7500;
    manaCost = 20;

    onSpellCast() {
      const speedBuff = new Speedup(HASTE_DURATION, this.owner, this.owner);
      speedBuff.image = this.image;
      speedBuff.percent = HASTE_PERCENT;
      speedBuff.addDeactivateListener(() => {
        const slowBuff = new Slow(BACKLASH_DURATION, this.owner, this.owner);
        slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
        slowBuff.image = this.image;
        slowBuff.percent = BACKLASH_PERCENT;
        this.owner.addBuff(slowBuff);
      });

      this.owner.addBuff(speedBuff);

      // Overdrive is the only self-buff in the kit with a *penalty* attached, so
      // it needs to be visible from across the lane: brass, steam and arcing
      // current, winding down to a redline that says the slow is about to land.
      const rig = new Blitzcrank_W_Object(this.owner);
      rig.attachTo(this.owner, speedBuff);
      this.game.objectManager.addObject(rig);
    }
  }
  return Blitzcrank_W;
}
const __cacheBlitzcrank_W = new WeakMap<ContentApi, ReturnType<typeof __buildBlitzcrank_W>>();
export default function makeBlitzcrank_W(api: ContentApi) {
  const cached = __cacheBlitzcrank_W.get(api);
  if (cached) return cached;
  const built = __buildBlitzcrank_W(api);
  __cacheBlitzcrank_W.set(api, built);
  return built;
}


interface Arc {
  /** Endpoints on the gear ring, in radians. */
  a0: number;
  a1: number;
  /** Perpendicular kinks along the bolt, one per interior segment. */
  jitter: number[];
}


/**
 * A steam-and-brass rig bolted onto Blitzcrank for the duration of Overdrive.
 * Everything here is machinery — cut gear teeth, hard electric zigzags, vented
 * steam — so it never gets mistaken for anyone's magic buff.
 */
function __buildBlitzcrank_W_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Blitzcrank_W_Object extends SpellObject {
    age = 0;
    spin = 0;

    _arcs: Arc[] = [];
    _arcTimer = 0;
    _ventTimer = 0;

    particleSystem = PredefinedParticleSystems.smoke([222, 232, 240], 1.5, 5);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // Steam comes in bursts; between them the system would sit empty and remove
      // itself, so it is drained deliberately in onRemoved() instead.
      this.particleSystem.autoRemoveIfEmpty = false;

      this._strikeArcs(ARC_COUNT);
      this._vent(5);
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    _strikeArcs(count: number) {
      this._arcs.length = 0;
      for (let i = 0; i < count; i++) {
        const a0 = random(TWO_PI);
        const jitter: number[] = [];
        for (let k = 1; k < ARC_SEGMENTS; k++) jitter.push(random(-9, 9));
        this._arcs.push({ a0, a1: a0 + random(1.1, 2.6), jitter });
      }
    }

    _vent(count: number) {
      const pos = this.owner.position;
      const r = this.owner.animatedValues.displaySize / 2;
      for (let i = 0; i < count; i++) {
        // two exhaust ports on his shoulders, so the steam has a source
        const side = random(1) < 0.5 ? -1 : 1;
        this.particleSystem.addParticle({
          x: pos.x + side * r * 0.8 + random(-4, 4),
          y: pos.y - r * 0.5 + random(-4, 4),
          size: random(8, 16),
          opacity: random(90, 170),
        });
      }
    }

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      if (this.age >= HARD_STOP_MS) {
        this.toRemove = true;
        return;
      }

      // The gear winds up rather than starting at full rpm, and winds up further
      // once it redlines — angle is integrated so the change of rate is visible.
      const spinup = constrain(this.age / SPINUP_MS, 0, 1);
      this.spin += deltaTime * 0.006 * spinup * (1 + this._redline * 1.4);

      this._arcTimer += deltaTime;
      if (this._arcTimer >= ARC_INTERVAL_MS) {
        this._arcTimer = 0;
        this._strikeArcs(this._redline > 0 ? ARC_COUNT * 2 : ARC_COUNT);
      }

      this._ventTimer += deltaTime;
      if (this._ventTimer >= VENT_INTERVAL_MS) {
        this._ventTimer = 0;
        this._vent(this._redline > 0 ? 3 : 1);
      }
    }

    /** 0 while Overdrive is comfortable, ramping to 1 as it is about to blow. */
    get _redline(): number {
      const buff = this._anchorBuff;
      if (!buff || !buff.duration) return 0;
      const remaining = buff.duration - buff.timeElapsed;
      return constrain(1 - remaining / REDLINE_MS, 0, 1);
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      const redline = this._redline;
      const gearR = r + 20;
      const prime = constrain(this.age / PRIME_MS, 0, 1);

      push();
      translate(this.position.x, this.position.y);
      // the whole rig judders once it is over-revved, which sells the penalty
      if (redline > 0) {
        translate(random(-2, 2) * redline, random(-2, 2) * redline);
      }

      // The gear. Brass body, cut teeth, dark shadow behind — it is a machine
      // part, drawn with straight edges so it never reads as an aura ring.
      push();
      rotate(this.spin);
      const brassR = lerp(214, 255, redline);
      const brassG = lerp(164, 120, redline);
      const brassB = lerp(78, 40, redline);
      for (let i = 0; i < TOOTH_COUNT; i++) {
        const a = (TWO_PI * i) / TOOTH_COUNT;
        push();
        rotate(a);
        translate(gearR, 0);
        noStroke();
        fill(58, 40, 18, 235);
        beginShape();
        vertex(-2, -8);
        vertex(9, -5.5);
        vertex(9, 5.5);
        vertex(-2, 8);
        endShape(CLOSE);
        fill(brassR, brassG, brassB, 245);
        beginShape();
        vertex(-2, -6);
        vertex(7, -4);
        vertex(7, 4);
        vertex(-2, 6);
        endShape(CLOSE);
        pop();
      }
      noFill();
      stroke(52, 36, 16, 235);
      strokeWeight(7);
      circle(0, 0, gearR * 2);
      stroke(brassR, brassG, brassB, 245);
      strokeWeight(4);
      circle(0, 0, gearR * 2);
      // a lit rivet per quadrant, so the rotation is readable at a glance
      noStroke();
      fill(255, 236, 190, 220);
      for (let i = 0; i < 4; i++) {
        const a = (TWO_PI * i) / 4;
        circle(cos(a) * (gearR - 9), sin(a) * (gearR - 9), 4.5);
      }
      pop();

      // Current jumping the gap between teeth. Two passes: a fat cyan glow and a
      // thin white core, which is what makes a zigzag read as electricity rather
      // than as a scribble.
      for (const bolt of this._arcs) {
        for (const [weight, red, green, blue, alpha] of [
          [7, 90, 200, 255, 120],
          [2.5, 240, 252, 255, 240],
        ] as number[][]) {
          stroke(red, green, blue, alpha);
          strokeWeight(weight);
          noFill();
          beginShape();
          for (let k = 0; k <= ARC_SEGMENTS; k++) {
            const u = k / ARC_SEGMENTS;
            const a = lerp(bolt.a0, bolt.a1, u) + this.spin;
            const kick = k === 0 || k === ARC_SEGMENTS ? 0 : bolt.jitter[k - 1];
            vertex(cos(a) * (gearR + kick), sin(a) * (gearR + kick));
          }
          endShape();
        }
      }

      // How much rev is left. It goes amber as the redline approaches, so the
      // colour and the shaking say the same thing twice.
      noFill();
      stroke(46, 44, 40, 110);
      strokeWeight(4);
      circle(0, 0, gearR * 2 + 22);
      stroke(lerp(120, 255, redline), lerp(230, 150, redline), lerp(255, 40, redline), 235);
      strokeWeight(4);
      arc(0, 0, gearR * 2 + 22, gearR * 2 + 22, -HALF_PI, -HALF_PI + TWO_PI * left);

      // The kick-over: two pistons punch out sideways and slam home.
      if (prime < 1) {
        const stroke01 = sin(prime * PI); // out and back inside PRIME_MS
        for (const side of [-1, 1]) {
          push();
          translate(side * (r * 0.5 + 26 * stroke01), 0);
          stroke(60, 44, 22, 240);
          strokeWeight(11);
          line(0, -7, 0, 7);
          stroke(232, 190, 110, 250);
          strokeWeight(6);
          line(0, -7, 0, 7);
          pop();
        }
        // the crack of the start, one frame's worth of white
        const flash = 1 - prime;
        noStroke();
        fill(230, 250, 255, 190 * flash);
        circle(0, 0, size * 0.95 * flash + 14);
        noFill();
        stroke(150, 220, 255, 230 * flash);
        strokeWeight(6 * flash + 1);
        circle(0, 0, size + 120 * prime);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Blitzcrank_W_Object;
}
const __cacheBlitzcrank_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildBlitzcrank_W_Object>>();
export function makeBlitzcrank_W_Object(api: ContentApi) {
  const cached = __cacheBlitzcrank_W_Object.get(api);
  if (cached) return cached;
  const built = __buildBlitzcrank_W_Object(api);
  __cacheBlitzcrank_W_Object.set(api, built);
  return built;
}