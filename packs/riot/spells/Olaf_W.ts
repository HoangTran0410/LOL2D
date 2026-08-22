import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Olaf_W = InstanceType<ReturnType<typeof makeOlaf_W>>;
type Olaf_W_Object = InstanceType<ReturnType<typeof makeOlaf_W_Object>>;



export const DURATION = 6000;

export const ATTACK_SPEED_PERCENT = 0.5;

export const OMNIVAMP = 0.4;

export const ON_HIT_DAMAGE = 4;


/** The axes fall in and cross. Accelerating, so they land rather than arrive. */
export const SLAM_MS = 320;

/** The frost star thrown off the crossing, after the axes touch down. */
export const SHATTER_MS = 460;

export const AXE_COUNT = 2;

/** Where the axes ride once they have settled, past his own body. */
export const ORBIT_MARGIN = 26;

export const SPIN_MS_PER_TURN = 1400;

export const RUNE_COUNT = 4;

/** One pass of the flicker around the rune ring. */
export const RUNE_CYCLE_MS = 1600;

/** How often a drop of life is drawn back into him — the omnivamp, made visible. */
export const VAMP_INTERVAL_MS = 190;

export const DROP_INTERVAL_MS = VAMP_INTERVAL_MS;

/**
 * The swing rhythm the buff actually buys, in ms. A base 620ms swing divided by
 * the attack-speed multiplier: derived from the stat so the beat on screen and
 * the number in the tooltip cannot drift apart.
 */
export const BEAT_MS = 620 / (1 + ATTACK_SPEED_PERCENT);

export const DROP_LIFETIME_MS = 620;

export const FROST_INTERVAL_MS = 110;

export const BOUNDING_MARGIN = 160;

/** Cosmetic-only ceiling; the buff ending or Olaf dying is the real exit. */
export const HARD_STOP_MS = DURATION + 1200;


/**
 * Four staves, in unit coordinates, drawn as bare line segments. Angular and
 * asymmetric on purpose: runes have to look *carved*, and a curve anywhere in
 * here would turn them into decorative squiggles.
 */
export const RUNES: number[][][] = [
  [
    [0, -1, 0, 1],
    [0, -1, 0.72, -0.3],
    [0, 0.15, 0.72, 0.95],
  ],
  [
    [0, -1, 0, 1],
    [0, -0.85, 0.8, -0.05],
    [0.8, -0.05, 0, 0.7],
  ],
  [
    [-0.7, 1, 0, -1],
    [0, -1, 0.7, 1],
    [-0.38, 0.1, 0.38, 0.1],
  ],
  [
    [0, -1, 0, 1],
    [-0.72, -0.55, 0.72, 0.55],
    [-0.72, 0.55, 0.72, -0.55],
  ],
];


/**
 * Vicious Strikes.
 *
 * This used to carry its own `ON_ATTACK_HIT` subscription to do the healing —
 * about thirty lines of subscribe/unsubscribe bookkeeping duplicated across
 * four spells. `omnivamp` is a stat now (see `Stats.ts`), so the whole ability
 * is the buff, and the vamp works on Olaf's abilities too, which is what
 * "toàn phần" means.
 */
function __buildOlaf_W(api: ContentApi) {
  const Spell = api.Spell;
  const StatAmp = api.buffs.StatAmp;
  const Olaf_W_Object = makeOlaf_W_Object(api);
  class Olaf_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_olaf_w');
    name = 'Nổi Khùng (Olaf_W)';
    description =
      `Trong <span class="time">${DURATION / 1000} giây</span>: <span class="buff">+${ATTACK_SPEED_PERCENT * 100}% tốc độ đánh</span>,` +
      ` <span class="buff">+${ON_HIT_DAMAGE} sát thương mỗi đòn đánh</span> và` +
      ` <span class="buff">hút ${OMNIVAMP * 100}% máu từ mọi sát thương gây ra</span>`;
    coolDown = 10000;
    manaCost = 30;

    onSpellCast() {
      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = 'olaf_w';
      amp.image = this.image;
      amp.name = 'Đòn Hiểm';
      amp.bonuses = {
        attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT },
        onHitDamage: { baseBonus: ON_HIT_DAMAGE },
        omnivamp: { baseBonus: OMNIVAMP },
      };
      this.owner.addBuff(amp);

      // +50% attack speed and 40% omnivamp means the enemy has six seconds to
      // decide to disengage, and they can only make that call if they can see it.
      // Norse, and only Norse: frost off the steel, blood on the edge, carved
      // staves — no glow, no orb, nothing anyone else in the game uses.
      const strikes = new Olaf_W_Object(this.owner);
      strikes.attachTo(this.owner, amp);
      this.game.objectManager.addObject(strikes);
    }
  }
  return Olaf_W;
}
const __cacheOlaf_W = new WeakMap<ContentApi, ReturnType<typeof __buildOlaf_W>>();
export default function makeOlaf_W(api: ContentApi) {
  const cached = __cacheOlaf_W.get(api);
  if (cached) return cached;
  const built = __buildOlaf_W(api);
  __cacheOlaf_W.set(api, built);
  return built;
}


interface Drop {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}


/**
 * Two axes riding Olaf for the duration of Vicious Strikes. They orbit *and*
 * spin on their own heads, which is what stops a pair of orbiting sprites from
 * reading as a decorative ring: real thrown steel tumbles.
 */
function __buildOlaf_W_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Olaf_W_Object extends SpellObject {
    age = 0;

    _drops: Drop[] = [];
    _dropTimer = 0;
    _frostTimer = 0;

    particleSystem = PredefinedParticleSystems.smoke([196, 228, 248], 0.55, 6);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // Frost is emitted on a clock; onRemoved() drains it, so a gap between
      // puffs cannot delete the system mid-buff.
      this.particleSystem.autoRemoveIfEmpty = false;
      this._frost(8);
    }

    onRemoved() {
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    /** Where an axe head is right now, in world space, so frost trails the blade. */
    _axeHead(index: number): { x: number; y: number } {
      const r = this.owner.animatedValues.displaySize / 2;
      const orbit = r + ORBIT_MARGIN;
      const a = (TWO_PI * index) / AXE_COUNT + (this.age / SPIN_MS_PER_TURN) * TWO_PI;
      return {
        x: this.owner.position.x + cos(a) * orbit,
        y: this.owner.position.y + sin(a) * orbit,
      };
    }

    _frost(count: number) {
      for (let i = 0; i < count; i++) {
        const head = this._axeHead(i % AXE_COUNT);
        this.particleSystem.addParticle({
          x: head.x + random(-6, 6),
          y: head.y + random(-6, 6),
          size: random(7, 15),
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

      this._frostTimer += deltaTime;
      if (this._frostTimer >= FROST_INTERVAL_MS) {
        this._frostTimer = 0;
        this._frost(AXE_COUNT);
      }

      // Omnivamp, drawn as what it is: life coming *back*. These rise off the
      // ground around him and are drawn inward until his body absorbs them.
      // They used to be blood flung off the axe head and falling away, which is
      // the picture for a wound, and reads as the opposite of what W does.
      if (this.age >= SLAM_MS) {
        this._dropTimer += deltaTime;
        if (this._dropTimer >= VAMP_INTERVAL_MS) {
          this._dropTimer = 0;
          const a = random(TWO_PI);
          const d = this.owner.animatedValues.displaySize * random(0.9, 1.5);
          this._drops.push({
            x: cos(a) * d,
            y: sin(a) * d,
            vx: 0,
            vy: 0,
            age: 0,
          });
        }
      }

      let i = 0;
      while (i < this._drops.length) {
        const drop = this._drops[i];
        drop.age += deltaTime;
        // accelerating inward: absorbed, not merely drifting past
        const pull = 0.16 + (drop.age / DROP_LIFETIME_MS) * 0.34;
        drop.vx -= drop.x * pull * 0.06;
        drop.vy -= drop.y * pull * 0.06 + 0.05; // slight lift, so it climbs him
        drop.x += drop.vx;
        drop.y += drop.vy;
        const reached = Math.hypot(drop.x, drop.y) < 6;
        if (reached || drop.age >= DROP_LIFETIME_MS) this._drops.splice(i, 1);
        else i++;
      }
    }

    /** One axe, haft along +x, head at the far end. Drawn in its own space. */
    _drawAxe(scaleFactor: number) {
      push();
      scale(scaleFactor);
      // haft
      stroke(58, 40, 24, 245);
      strokeWeight(6);
      line(-16, 0, 17, 0);
      stroke(124, 90, 54, 245);
      strokeWeight(3);
      line(-16, 0, 17, 0);
      // a leather grip at the butt, so the haft has a near end and a far end
      stroke(38, 28, 18, 245);
      strokeWeight(7);
      line(-16, 0, -8, 0);

      // the head: a broad bearded wedge, dark bevel first then cold steel
      noStroke();
      fill(46, 58, 70, 245);
      beginShape();
      vertex(11, -6);
      vertex(23, -16);
      vertex(32, 0);
      vertex(23, 16);
      vertex(11, 6);
      endShape(CLOSE);
      fill(188, 214, 232, 250);
      beginShape();
      vertex(13, -4);
      vertex(23, -13);
      vertex(29, 0);
      vertex(23, 13);
      vertex(13, 4);
      endShape(CLOSE);
      // the honed edge, and the rime clinging to it
      stroke(246, 252, 255, 250);
      strokeWeight(2);
      noFill();
      beginShape();
      vertex(23, -13);
      vertex(29, 0);
      vertex(23, 13);
      endShape();
      stroke(150, 214, 250, 200);
      strokeWeight(1.5);
      line(16, -7, 26, -9);
      line(16, 7, 26, 9);
      pop();
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      const rawSlam = constrain(this.age / SLAM_MS, 0, 1);
      // accelerating: they drop under weight rather than gliding into place
      const slam = rawSlam * rawSlam;
      const orbit = lerp(r * 2.6, r + ORBIT_MARGIN, slam);
      const spin = (this.age / SPIN_MS_PER_TURN) * TWO_PI;

      push();
      translate(this.position.x, this.position.y);

      // Carved staves standing in a ring, lighting one after another. They are the
      // slow element: the axes are frantic, the runes are patient, and having both
      // is what keeps a six-second buff from reading as one busy loop.
      const runeR = r + 44;
      const turn = ((this.age % RUNE_CYCLE_MS) / RUNE_CYCLE_MS) * RUNE_COUNT;
      for (let i = 0; slam > 0.02 && i < RUNE_COUNT; i++) {
        const a = (TWO_PI * i) / RUNE_COUNT - HALF_PI;
        // a lit band sweeping round the ring, brightest on the rune it is passing.
        // The distance has to wrap both ways or the last rune never lights.
        const gap = Math.abs(((turn - i + RUNE_COUNT * 1.5) % RUNE_COUNT) - RUNE_COUNT / 2);
        const lit = constrain(1 - gap, 0, 1);
        push();
        translate(cos(a) * runeR, sin(a) * runeR);
        scale(9 * slam);
        for (const [x0, y0, x1, y1] of RUNES[i]) {
          stroke(20, 34, 46, 230);
          strokeWeight(0.55);
          line(x0, y0, x1, y1);
          stroke(lerp(120, 236, lit), lerp(180, 250, lit), lerp(220, 255, lit), 140 + 110 * lit);
          strokeWeight(0.3);
          line(x0, y0, x1, y1);
        }
        pop();
      }

      // The healing itself. Each mote brightens as it closes on him, so the eye
      // follows it *in* — the direction is the whole message.
      noStroke();
      for (const drop of this._drops) {
        const home = constrain(1 - Math.hypot(drop.x, drop.y) / (r * 3), 0, 1);
        fill(lerp(150, 255, home), lerp(20, 90, home), lerp(24, 70, home), 235);
        circle(drop.x, drop.y, 4 + 3 * home);
      }

      // The axes. On the way in they fall from above the ring and cross; after
      // that they orbit and tumble.
      for (let i = 0; i < AXE_COUNT; i++) {
        const a = (TWO_PI * i) / AXE_COUNT + spin;
        push();
        translate(cos(a) * orbit, sin(a) * orbit - (1 - slam) * 150);
        rotate(a + HALF_PI + spin * 1.6);
        this._drawAxe(lerp(1.35, 1, slam));
        pop();
      }

      // How much of the frenzy is left. Red, not frost: nothing about Vicious
      // Strikes is cold, and the blue was borrowed from an ability he does not have.
      noFill();
      stroke(58, 20, 18, 130);
      strokeWeight(4);
      circle(0, 0, runeR * 2 + 22);
      stroke(255, 108, 74, 235);
      strokeWeight(4);
      arc(0, 0, runeR * 2 + 22, runeR * 2 + 22, -HALF_PI, -HALF_PI + TWO_PI * left);

      // THE TEMPO. The attack-speed half of the buff, and the only part of it a
      // player can act on, so it gets the loudest element: a beat snapping outward
      // on the actual swing interval the bonus buys. Derived from
      // ATTACK_SPEED_PERCENT rather than a hand-picked number, so retuning the
      // stat retunes the picture with it.
      if (this.age >= SLAM_MS) {
        const beat = ((this.age - SLAM_MS) % BEAT_MS) / BEAT_MS;
        const kick = 1 - beat;
        noFill();
        stroke(255, 160, 90, 210 * kick * kick);
        strokeWeight(5 * kick + 1);
        circle(0, 0, r * 1.6 + beat * r * 1.7);
        // and a hot flare on his body at the top of each beat
        noStroke();
        fill(255, 190, 130, 150 * kick * kick * kick);
        circle(0, 0, r * 1.5);
      }

      // The crossing: a frost star, not a ring — ice breaks along spikes.
      if (this.age >= SLAM_MS && this.age < SLAM_MS + SHATTER_MS) {
        const t = (this.age - SLAM_MS) / SHATTER_MS;
        const fade = 1 - t;
        const spikes = 10;
        noFill();
        stroke(214, 242, 255, 235 * fade);
        strokeWeight(4 * fade + 1);
        beginShape();
        for (let i = 0; i < spikes * 2; i++) {
          const ang = (TWO_PI * i) / (spikes * 2);
          const radius = i % 2 === 0 ? size * 0.8 + 150 * t : size * 0.45 + 70 * t;
          vertex(cos(ang) * radius, sin(ang) * radius);
        }
        endShape(CLOSE);
        const flash = 1 - constrain(t / 0.25, 0, 1);
        if (flash > 0) {
          noStroke();
          fill(236, 250, 255, 210 * flash);
          circle(0, 0, size * 0.9 * flash + 14);
          // a red splash under the white, so the shatter is not purely cold
          fill(180, 30, 32, 150 * flash);
          circle(0, 0, size * 0.55 * flash + 8);
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Olaf_W_Object;
}
const __cacheOlaf_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildOlaf_W_Object>>();
export function makeOlaf_W_Object(api: ContentApi) {
  const cached = __cacheOlaf_W_Object.get(api);
  if (cached) return cached;
  const built = __buildOlaf_W_Object(api);
  __cacheOlaf_W_Object.set(api, built);
  return built;
}