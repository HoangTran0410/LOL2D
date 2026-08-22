import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Warwick_W = InstanceType<ReturnType<typeof makeWarwick_W>>;
type Warwick_W_Object = InstanceType<ReturnType<typeof makeWarwick_W_Object>>;



export const DURATION = 6000;

export const SPEED_PERCENT = 0.4;

export const HUNT_RADIUS = 900;

export const WOUNDED_THRESHOLD = 0.5;

export const OMNIVAMP = 0.35;


/** The snarl: one crimson wave off the body as he picks up the scent. */
export const SNARL_MS = 380;

/** One full heart cycle. Slower than a resting pulse — this is a stalk, not a sprint. */
export const BEAT_PERIOD_MS = 950;

/** The second, weaker thump of the double beat, as a fraction of the cycle. */
export const BEAT_OFFSET = 0.26;

export const SWIPE_INTERVAL_MS = 620;

export const SWIPE_MS = 480;

export const MOTE_INTERVAL_MS = 90;

export const MOTE_MAX = 26;

/** Where a blood mote condenses before it is drawn in, in body radii. */
export const MOTE_SPAWN_RADIUS = 2.5;

export const BOUNDING_MARGIN = 150;

/** Cosmetic-only ceiling; the buff ending or Warwick dying is the real exit. */
export const HARD_STOP_MS = DURATION + 1200;


/**
 * Blood Hunt. The wiki version keys off enemies below half health; this keeps
 * that — the speed is unconditional, but the *reveal* only lands on the wounded,
 * so the ability tells Warwick who to go after rather than just moving him.
 */
function __buildWarwick_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Speedup = api.buffs.Speedup;
  const StatAmp = api.buffs.StatAmp;
  const createReveal = api.buffs.createReveal;
  const Warwick_W_Object = makeWarwick_W_Object(api);
  class Warwick_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_warwick_w');
    name = 'Mùi Máu (Warwick_W)';
    description =
      `Đánh hơi trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+${SPEED_PERCENT * 100}% tốc chạy</span>` +
      `, <span class="buff">hút ${OMNIVAMP * 100}% máu từ mọi sát thương</span>,` +
      ` và <span class="buff">lộ diện</span> mọi kẻ địch dưới <span>${WOUNDED_THRESHOLD * 100}% máu</span>` +
      ` trong <span>${HUNT_RADIUS}px</span>`;
    coolDown = 10000;
    manaCost = 25;

    onSpellCast() {
      const haste = new Speedup(DURATION, this.owner, this.owner);
      haste.stackId = 'warwick_w';
      haste.image = this.image;
      haste.percent = SPEED_PERCENT;
      this.owner.addBuff(haste);

      const drink = new StatAmp(DURATION, this.owner, this.owner);
      drink.stackId = 'warwick_w_vamp';
      drink.image = this.image;
      drink.name = 'Săn Máu';
      drink.bonuses = { omnivamp: { baseBonus: OMNIVAMP } };
      this.owner.addBuff(drink);

      // The whole point of Blood Hunt is that the wounded should know they are
      // being hunted. It only works if the hunt is visible: a heartbeat, blood
      // pulled out of the air towards him, and claws opening the space around him.
      const hunt = new Warwick_W_Object(this.owner);
      hunt.attachTo(this.owner, drink);
      this.game.objectManager.addObject(hunt);

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: HUNT_RADIUS,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      enemies.forEach((enemy: any) => {
        const max = enemy.stats?.maxHealth?.value ?? 0;
        if (!max || enemy.stats.health.value / max > WOUNDED_THRESHOLD) return;
        enemy.addBuff(
          createReveal({
            durationMs: DURATION,
            source: this.owner,
            target: enemy,
            stackId: 'warwick_w_scent',
          })
        );
      });
    }
  }
  return Warwick_W;
}
const __cacheWarwick_W = new WeakMap<ContentApi, ReturnType<typeof __buildWarwick_W>>();
export default function makeWarwick_W(api: ContentApi) {
  const cached = __cacheWarwick_W.get(api);
  if (cached) return cached;
  const built = __buildWarwick_W(api);
  __cacheWarwick_W.set(api, built);
  return built;
}


/** One thump of the double heartbeat: a half-sine bump starting at `at`. */
function thumpAt(phase: number, at: number, width: number): number {
  const d = phase - at;
  if (d < 0 || d >= width) return 0;
  return sin((d / width) * PI);
}


interface Mote {
  angle: number;
  /** Distance from Warwick, shrinking: motes travel inward, not outward. */
  radius: number;
  size: number;
  speed: number;
}


interface Swipe {
  angle: number;
  age: number;
  /** Claws rake either clockwise or anticlockwise; a fixed hand looks scripted. */
  dir: number;
}


/**
 * The hunt made visible. Everything moves *inward* or *around* — blood drawn to
 * him, claws opening the ring, a heart driving both — which is the opposite of
 * every other buff in the game, where the effect radiates out. Warwick is taking
 * something, not giving it off, and the motion should say so before the colour does.
 */
function __buildWarwick_W_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Warwick_W_Object extends SpellObject {
    age = 0;

    _motes: Mote[] = [];
    _moteTimer = 0;
    _swipes: Swipe[] = [];
    _swipeTimer = 0;

    particleSystem = PredefinedParticleSystems.smoke([118, 12, 20], 0.5, 4);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // Haze is emitted in bursts; draining it is onRemoved()'s job, not the
      // system's, or a quiet frame would delete it mid-hunt.
      this.particleSystem.autoRemoveIfEmpty = false;
      this._haze(7);
      this._swipes.push({ angle: random(TWO_PI), age: 0, dir: 1 });
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    _haze(count: number) {
      const pos = this.owner.position;
      const r = this.owner.animatedValues.displaySize / 2;
      for (let i = 0; i < count; i++) {
        const a = random(TWO_PI);
        this.particleSystem.addParticle({
          x: pos.x + cos(a) * random(r * 0.4, r * 1.3),
          y: pos.y + sin(a) * random(r * 0.4, r * 1.3) * 0.7 + r * 0.4,
          size: random(12, 26),
          opacity: random(60, 120),
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

      const r = this.owner.animatedValues.displaySize / 2;

      this._moteTimer += deltaTime;
      if (this._moteTimer >= MOTE_INTERVAL_MS && this._motes.length < MOTE_MAX) {
        this._moteTimer = 0;
        this._motes.push({
          angle: random(TWO_PI),
          radius: r * MOTE_SPAWN_RADIUS * random(0.75, 1),
          size: random(3, 7),
          speed: random(0.9, 1.9),
        });
        this._haze(1);
      }

      let i = 0;
      while (i < this._motes.length) {
        const mote = this._motes[i];
        mote.radius -= mote.speed;
        // it curls in rather than falling straight, so the pull reads as a draw
        mote.angle += 0.03;
        if (mote.radius <= r * 0.45) this._motes.splice(i, 1);
        else i++;
      }

      this._swipeTimer += deltaTime;
      if (this._swipeTimer >= SWIPE_INTERVAL_MS) {
        this._swipeTimer = 0;
        this._swipes.push({
          angle: random(TWO_PI),
          age: 0,
          dir: random(1) < 0.5 ? -1 : 1,
        });
      }

      let k = 0;
      while (k < this._swipes.length) {
        const swipe = this._swipes[k];
        swipe.age += deltaTime;
        if (swipe.age >= SWIPE_MS) this._swipes.splice(k, 1);
        else k++;
      }
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;

      // lub-DUB: a big thump then a smaller one, the shape a pulse actually has
      const phase = (this.age % BEAT_PERIOD_MS) / BEAT_PERIOD_MS;
      const beat = thumpAt(phase, 0, 0.16) + 0.55 * thumpAt(phase, BEAT_OFFSET, 0.13);

      push();
      translate(this.position.x, this.position.y);

      // The heartbeat ring. It swells on each thump instead of pulsing smoothly,
      // and that irregular rhythm is what makes it read as alive.
      noFill();
      stroke(150, 16, 24, 90 + 80 * beat);
      strokeWeight(6 + 5 * beat);
      circle(0, 0, size * 1.55 + 26 * beat);
      stroke(240, 60, 60, 60 + 140 * beat);
      strokeWeight(2.5);
      circle(0, 0, size * 1.55 + 26 * beat);

      // Blood pulled out of the air towards him.
      noStroke();
      for (const mote of this._motes) {
        // the closer it gets the brighter it burns, so the pull has a destination
        const near = constrain(1 - mote.radius / (r * MOTE_SPAWN_RADIUS), 0, 1);
        fill(lerp(120, 255, near), lerp(10, 70, near), lerp(16, 62, near), 210);
        circle(cos(mote.angle) * mote.radius, sin(mote.angle) * mote.radius, mote.size);
      }

      // Claws opening the ring. Three crescents at slightly different radii, each
      // tapering to nothing, raked around him rather than across a victim — Q's
      // gashes are the straight version of this and must not be confused with it.
      noFill();
      for (const swipe of this._swipes) {
        const t = swipe.age / SWIPE_MS;
        const fade = 1 - t;
        // opens fast, then drifts outward as it dies
        const open = constrain(t / 0.3, 0, 1);
        for (let i = -1; i <= 1; i++) {
          const radius = size * (0.95 + i * 0.14) + 30 * t;
          const span = 1.15 * open * (1 - Math.abs(i) * 0.15);
          const a0 = swipe.angle + i * 0.1 * swipe.dir;
          const a1 = a0 + span * swipe.dir;
          stroke(60, 4, 8, 220 * fade);
          strokeWeight(9 * fade + 1);
          arc(0, 0, radius * 2, radius * 2, Math.min(a0, a1), Math.max(a0, a1));
          stroke(232, 42, 44, 240 * fade);
          strokeWeight(4 * fade + 0.8);
          arc(0, 0, radius * 2, radius * 2, Math.min(a0, a1), Math.max(a0, a1));
        }
      }

      // How much of the hunt is left.
      noFill();
      stroke(58, 14, 16, 120);
      strokeWeight(4);
      circle(0, 0, size * 1.9);
      stroke(248, 72, 64, 235);
      strokeWeight(4);
      arc(0, 0, size * 1.9, size * 1.9, -HALF_PI, -HALF_PI + TWO_PI * left);

      // The snarl: one crimson wave off the body, and blood thrown with it.
      if (this.age < SNARL_MS) {
        const t = this.age / SNARL_MS;
        const fade = 1 - t;
        noFill();
        stroke(180, 18, 24, 235 * fade);
        strokeWeight(11 * fade + 2);
        circle(0, 0, size + 180 * t);
        stroke(255, 120, 110, 210 * fade);
        strokeWeight(4 * fade + 1);
        circle(0, 0, size + 122 * t);
        noStroke();
        fill(190, 20, 26, 200 * fade);
        circle(0, 0, size * 1.1 * fade + 12);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Warwick_W_Object;
}
const __cacheWarwick_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildWarwick_W_Object>>();
export function makeWarwick_W_Object(api: ContentApi) {
  const cached = __cacheWarwick_W_Object.get(api);
  if (cached) return cached;
  const built = __buildWarwick_W_Object(api);
  __cacheWarwick_W_Object.set(api, built);
  return built;
}