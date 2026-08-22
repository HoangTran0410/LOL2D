import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Singed_R = InstanceType<ReturnType<typeof makeSinged_R>>;
type Singed_R_Object = InstanceType<ReturnType<typeof makeSinged_R_Object>>;



export const DURATION = 9000;

export const BONUS_HEALTH = 50;

export const SPEED_PERCENT = 0.3;


/** He drinks it before anything happens — the flask empties, then the gas comes. */
export const CHUG_MS = 420;

/** How long the burst off the drained flask lasts. */
export const BURST_MS = 520;

/** Points around the boiling outline. Enough to wobble, few enough to stay a shape. */
export const BOIL_SEGMENTS = 26;

export const BUBBLE_INTERVAL_MS = 170;

export const BUBBLE_MAX = 16;

export const BUBBLE_MS = 1100;

export const GAS_INTERVAL_MS = 120;

export const BOUNDING_MARGIN = 130;

/** Cosmetic-only ceiling; the buff ending or Singed dying is the real exit. */
export const HARD_STOP_MS = DURATION + 1500;


function __buildSinged_R(api: ContentApi) {
  const Spell = api.Spell;
  const StatAmp = api.buffs.StatAmp;
  const Singed_R_Object = makeSinged_R_Object(api);
  class Singed_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_singed_r');
    name = 'Thuốc Hóa Điên (Singed_R)';
    description =
      `Uống thuốc trong <span class="time">${DURATION / 1000} giây</span>:` +
      ` <span class="buff">+${BONUS_HEALTH} máu tối đa</span>, <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>` +
      ` và <span class="buff">+6 sát thương đánh thường</span>`;
    coolDown = 10000;
    manaCost = 50;

    onSpellCast() {
      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = 'singed_r';
      amp.image = this.image;
      amp.name = 'Thuốc Điên';
      amp.bonuses = {
        maxHealth: { baseBonus: BONUS_HEALTH },
        speed: { percentBaseBonus: SPEED_PERCENT },
        attackDamage: { baseBonus: 6 },
      };
      this.owner.addBuff(amp);

      // Granting the health is a heal, not a stat. `health` is a resource that
      // `takeDamage`/`takeHeal` move directly, so a modifier on it was never an
      // offset the way `maxHealth` is — and until Stats.update() stopped folding
      // its own read back into the base, `health: { baseBonus }` re-granted
      // itself every frame and made this ultimate literal immortality.
      //
      // After `addBuff`, so the larger maxHealth is already in place and the heal
      // is not clipped to the old ceiling.
      this.owner.takeHeal(BONUS_HEALTH, this.owner);

      // Nine seconds of +50 health and +30% move speed is the longest self-buff in
      // the game, and chasing a Singed who drank it is a losing proposition. That
      // has to be obvious on sight, so he boils: acid green, and deliberately not
      // the violet his Q poison uses, because the two do very different things.
      const brew = new Singed_R_Object(this.owner);
      brew.attachTo(this.owner, amp);
      this.game.objectManager.addObject(brew);
    }
  }
  return Singed_R;
}
const __cacheSinged_R = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_R>>();
export default function makeSinged_R(api: ContentApi) {
  const cached = __cacheSinged_R.get(api);
  if (cached) return cached;
  const built = __buildSinged_R(api);
  __cacheSinged_R.set(api, built);
  return built;
}


interface Bubble {
  /** Offset from Singed, in body radii; bubbles rise in place, not outward. */
  x: number;
  y: number;
  size: number;
  rise: number;
  wobble: number;
  age: number;
}


/**
 * Insanity Potion, running hot. The silhouette is the whole read: a *boiling*
 * outline, one that visibly seethes rather than a clean ring, so a Singed under
 * it is recognisable from across the map even when the avatar is a grey dot in
 * the fog. Nothing else in the game has an unstable edge.
 */
function __buildSinged_R_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Singed_R_Object extends SpellObject {
    age = 0;

    _bubbles: Bubble[] = [];
    _bubbleTimer = 0;
    _gasTimer = 0;
    _seed = 0;

    particleSystem = PredefinedParticleSystems.smoke([118, 214, 72], 0.9, 2.2);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // Gas is fed on a clock; an empty frame between puffs must not delete the
      // system, so it is drained in onRemoved() instead.
      this.particleSystem.autoRemoveIfEmpty = false;
      this._seed = random(1000);
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    _gas(count: number) {
      const pos = this.owner.position;
      const r = this.owner.animatedValues.displaySize / 2;
      for (let i = 0; i < count; i++) {
        const a = random(TWO_PI);
        this.particleSystem.addParticle({
          x: pos.x + cos(a) * random(r * 0.5, r * 1.4),
          y: pos.y + sin(a) * random(r * 0.5, r * 1.4),
          size: random(14, 30),
          opacity: random(50, 110),
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

      // Nothing boils until the flask is actually empty. The chug is the windup.
      if (this.age < CHUG_MS) return;

      const r = this.owner.animatedValues.displaySize / 2;

      this._gasTimer += deltaTime;
      if (this._gasTimer >= GAS_INTERVAL_MS) {
        this._gasTimer = 0;
        this._gas(1);
      }

      this._bubbleTimer += deltaTime;
      if (this._bubbleTimer >= BUBBLE_INTERVAL_MS && this._bubbles.length < BUBBLE_MAX) {
        this._bubbleTimer = 0;
        this._bubbles.push({
          x: random(-r * 1.1, r * 1.1),
          y: r * 0.7,
          size: random(5, 13),
          rise: random(0.35, 0.8),
          wobble: random(TWO_PI),
          age: 0,
        });
      }

      let i = 0;
      while (i < this._bubbles.length) {
        const bubble = this._bubbles[i];
        bubble.age += deltaTime;
        bubble.y -= bubble.rise;
        bubble.x += sin(bubble.age / 140 + bubble.wobble) * 0.5;
        if (bubble.age >= BUBBLE_MS) this._bubbles.splice(i, 1);
        else i++;
      }
    }

    /** The seething outline, traced once per stroke pass at a given phase offset. */
    _traceBoil(radius: number, phase: number, amplitude: number) {
      beginShape();
      for (let i = 0; i < BOIL_SEGMENTS; i++) {
        const a = (TWO_PI * i) / BOIL_SEGMENTS;
        // two incommensurate waves, so the edge never settles into a pattern
        const wobble =
          sin(a * 3 + phase) * amplitude + sin(a * 5 - phase * 0.7 + this._seed) * amplitude * 0.6;
        vertex(cos(a) * (radius + wobble), sin(a) * (radius + wobble));
      }
      endShape(CLOSE);
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      const chug = constrain(this.age / CHUG_MS, 0, 1);
      // the brew comes up to the boil rather than switching on
      const boil = constrain((this.age - CHUG_MS) / 600, 0, 1);
      const phase = this.age / 260;

      push();
      translate(this.position.x, this.position.y);

      if (boil > 0) {
        // The pool of gas he is standing in, and the seething edge on it.
        noStroke();
        fill(70, 170, 40, 46 * boil);
        this._traceBoil(size * 0.82, phase, 7 * boil);
        noFill();
        stroke(24, 74, 16, 210 * boil);
        strokeWeight(7);
        this._traceBoil(size * 0.82, phase, 7 * boil);
        stroke(158, 246, 76, 235 * boil);
        strokeWeight(3);
        this._traceBoil(size * 0.82, phase, 7 * boil);
        // a second, faster edge inside it: two boils at different rates is what
        // separates "chemical reaction" from "wobbly circle"
        stroke(206, 255, 130, 150 * boil);
        strokeWeight(2);
        this._traceBoil(size * 0.6, -phase * 1.6, 5 * boil);
      }

      // Bubbles rising off him and bursting at the top of their run.
      for (const bubble of this._bubbles) {
        const t = bubble.age / BUBBLE_MS;
        const pop01 = constrain((t - 0.78) / 0.22, 0, 1);
        if (pop01 <= 0) {
          noStroke();
          fill(120, 226, 66, 150);
          circle(bubble.x, bubble.y, bubble.size);
          fill(226, 255, 168, 200);
          circle(bubble.x - bubble.size * 0.2, bubble.y - bubble.size * 0.2, bubble.size * 0.35);
        } else {
          noFill();
          stroke(178, 248, 104, 200 * (1 - pop01));
          strokeWeight(2);
          circle(bubble.x, bubble.y, bubble.size * (1 + pop01 * 1.8));
        }
      }

      // How much of the brew is left, in the same acid green.
      noFill();
      stroke(30, 76, 20, 120);
      strokeWeight(4);
      circle(0, 0, size * 1.85);
      stroke(166, 250, 84, 235);
      strokeWeight(4);
      arc(0, 0, size * 1.85, size * 1.85, -HALF_PI, -HALF_PI + TWO_PI * left);

      // The chug. The flask tips up, the level drops, and only when it is dry does
      // the gas come — no drink, no buff, in that order and visibly.
      if (chug < 1) {
        push();
        translate(r * 0.85, -r * 0.75);
        rotate(lerp(0.35, -1.25, chug));
        const bodyW = 13;
        const bodyH = 20;
        // glass
        noStroke();
        fill(214, 240, 226, 190);
        beginShape();
        vertex(-bodyW / 2, -bodyH / 2);
        vertex(bodyW / 2, -bodyH / 2);
        vertex(bodyW / 2, bodyH / 2);
        vertex(-bodyW / 2, bodyH / 2);
        endShape(CLOSE);
        // what is left in it, draining from the top down
        const fill01 = 1 - chug;
        fill(126, 232, 70, 240);
        beginShape();
        vertex(-bodyW / 2 + 2, bodyH / 2 - bodyH * fill01 + 2);
        vertex(bodyW / 2 - 2, bodyH / 2 - bodyH * fill01 + 2);
        vertex(bodyW / 2 - 2, bodyH / 2 - 2);
        vertex(-bodyW / 2 + 2, bodyH / 2 - 2);
        endShape(CLOSE);
        // neck
        stroke(214, 240, 226, 220);
        strokeWeight(5);
        line(0, -bodyH / 2, 0, -bodyH / 2 - 8);
        pop();
      }

      // The flask hits the ground and lets go all at once.
      if (this.age >= CHUG_MS && this.age < CHUG_MS + BURST_MS) {
        const t = (this.age - CHUG_MS) / BURST_MS;
        const fade = 1 - t;
        noFill();
        stroke(96, 208, 52, 225 * fade);
        strokeWeight(10 * fade + 2);
        circle(0, 0, size + 200 * t);
        stroke(212, 255, 140, 200 * fade);
        strokeWeight(4 * fade + 1);
        circle(0, 0, size + 138 * t);
        const flash = 1 - constrain(t / 0.28, 0, 1);
        if (flash > 0) {
          noStroke();
          fill(226, 255, 170, 200 * flash);
          circle(0, 0, size * 0.95 * flash + 14);
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Singed_R_Object;
}
const __cacheSinged_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_R_Object>>();
export function makeSinged_R_Object(api: ContentApi) {
  const cached = __cacheSinged_R_Object.get(api);
  if (cached) return cached;
  const built = __buildSinged_R_Object(api);
  __cacheSinged_R_Object.set(api, built);
  return built;
}