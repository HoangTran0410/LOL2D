import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Alistar_R = InstanceType<ReturnType<typeof makeAlistar_R>>;
type Alistar_R_Object = InstanceType<ReturnType<typeof makeAlistar_R_Object>>;



export const DURATION = 7000;

export const SHIELD_AMOUNT = 70;


/** How long the opening hoof-stomp reads for: rings out, cracks open, dust up. */
export const STOMP_MS = 420;

/** The horns are not there at frame 1 — they grow out of his skull. */
export const HORN_GROW_MS = 520;

/** Cracks in the dirt outlive the stomp, so the ground stays scuffed a beat. */
export const CRACK_MS = 1100;

export const CRACK_COUNT = 7;

export const CHIP_COUNT = 9;

export const DUST_INTERVAL_MS = 140;

/** Everything painted past his own body: horns, ring, stomp wave, kicked dirt. */
export const BOUNDING_MARGIN = 140;

/**
 * Belt-and-braces ceiling on a purely cosmetic object, the same guard Malphite's
 * armour carries. The real exit is the buff ending or Alistar dying.
 */
export const HARD_STOP_MS = DURATION + 1500;


/**
 * The horn, as a cubic Bezier in units of Alistar's body radius: out from the
 * temple, a shallow dip, then a hard hook upward to the point. Sampled and
 * stamped as shrinking discs, which is how it tapers without needing a mesh.
 */
export const HORN_PATH: [number, number][] = [
  [0.5, -0.42],
  [1.24, -0.24],
  [1.62, -0.84],
  [1.4, -1.48],
];


/** One axis of a cubic Bezier. Two calls give a point on the curve. */
function cubic(p0: number, p1: number, p2: number, p3: number, u: number): number {
  const v = 1 - u;
  return v * v * v * p0 + 3 * v * v * u * p1 + 3 * v * u * u * p2 + u * u * u * p3;
}


function __buildAlistar_R(api: ContentApi) {
  const Spell = api.Spell;
  const Shield = api.buffs.Shield;
  const StatAmp = api.buffs.StatAmp;
  const Alistar_R_Object = makeAlistar_R_Object(api);
  class Alistar_R extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_alistar_r');
    name = 'Bất Khuất (Alistar_R)';
    description =
      `Trong <span class="time">${DURATION / 1000} giây</span>: nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>` +
      ` và <span class="buff">+8 sát thương đánh thường</span>`;
    coolDown = 10000;
    manaCost = 50;

    onSpellCast() {
      const shield = new Shield(DURATION, this.owner, this.owner);
      shield.stackId = 'alistar_r_shield';
      shield.image = this.image;
      shield.amount = SHIELD_AMOUNT;
      shield.color = [255, 235, 170];
      this.owner.addBuff(shield);

      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = 'alistar_r';
      amp.image = this.image;
      amp.name = 'Ý Chí Bất Diệt';
      amp.bonuses = { attackDamage: { baseBonus: 8 } };
      this.owner.addBuff(amp);

      // A shield bar and +8 AD is nothing to look at for seven seconds. The horns
      // are the tell: while they are out, hitting Alistar is a waste of a cooldown.
      // The object shadows the stat buff rather than timing itself, so the two can
      // never disagree about when the will breaks.
      const stomp = new Alistar_R_Object(this.owner);
      stomp.attachTo(this.owner, amp);
      this.game.objectManager.addObject(stomp);
    }
  }
  return Alistar_R;
}
const __cacheAlistar_R = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_R>>();
export default function makeAlistar_R(api: ContentApi) {
  const cached = __cacheAlistar_R.get(api);
  if (cached) return cached;
  const built = __buildAlistar_R(api);
  __cacheAlistar_R.set(api, built);
  return built;
}


interface Crack {
  angle: number;
  /** Where the fissure kinks, as a fraction of its length. */
  kink: number;
  /** How far the kink throws it off the straight line. */
  bend: number;
  length: number;
}


interface Chip {
  angle: number;
  radius: number;
  size: number;
}


/**
 * Unbreakable Will made visible: horns out, hooves planted, dirt still settling.
 * Everything here is earth and bone — brown, tan, bull — so it never reads as
 * anyone else's buff at a glance across the map.
 */
function __buildAlistar_R_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const PredefinedParticleSystems = api.helpers.PredefinedParticleSystems;
  class Alistar_R_Object extends SpellObject {
    age = 0;

    _cracks: Crack[] = [];
    _chips: Chip[] = [];
    _dustTimer = 0;

    particleSystem = PredefinedParticleSystems.smoke([164, 126, 84], 0.7, 3.5);

    onAdded() {
      this.game.objectManager.addObject(this.particleSystem);
      // The dust must survive quiet frames between puffs; it is drained in
      // onRemoved() instead, so it fades out with the buff rather than blinking.
      this.particleSystem.autoRemoveIfEmpty = false;

      const size = this.owner.animatedValues.displaySize;
      for (let i = 0; i < CRACK_COUNT; i++) {
        this._cracks.push({
          angle: (TWO_PI * i) / CRACK_COUNT + random(-0.25, 0.25),
          kink: random(0.35, 0.6),
          bend: random(-16, 16),
          length: size * random(1.4, 2.2),
        });
      }
      for (let i = 0; i < CHIP_COUNT; i++) {
        this._chips.push({
          angle: (TWO_PI * i) / CHIP_COUNT + random(-0.2, 0.2),
          radius: size * 0.62 + random(0, 14),
          size: random(4, 9),
        });
      }

      this._puff(6);
    }

    onRemoved() {
      // Let the dirt already in the air fall; only stop feeding it.
      this.particleSystem.autoRemoveIfEmpty = true;
    }

    _puff(count: number) {
      const pos = this.owner.position;
      const size = this.owner.animatedValues.displaySize;
      for (let i = 0; i < count; i++) {
        const a = random(TWO_PI);
        const r = size * 0.5 + random(0, 18);
        this.particleSystem.addParticle({
          x: pos.x + cos(a) * r,
          y: pos.y + sin(a) * r * 0.55 + size * 0.35,
          size: random(10, 22),
          opacity: random(70, 140),
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

      // He keeps churning the ground the whole time he is planted on it.
      this._dustTimer += deltaTime;
      if (this._dustTimer >= DUST_INTERVAL_MS) {
        this._dustTimer = 0;
        this._puff(1);
      }
    }

    /**
     * One horn, stamped as a chain of shrinking discs along HORN_PATH. `grow`
     * clips the curve short, so the horn extends out of his head rather than
     * appearing whole.
     */
    _drawHorn(r: number, grow: number, widthScale: number, red: number, green: number, blue: number) {
      noStroke();
      fill(red, green, blue);
      const samples = 18;
      for (let i = 0; i <= samples; i++) {
        const u = (i / samples) * grow;
        const x = cubic(HORN_PATH[0][0], HORN_PATH[1][0], HORN_PATH[2][0], HORN_PATH[3][0], u) * r;
        const y = cubic(HORN_PATH[0][1], HORN_PATH[1][1], HORN_PATH[2][1], HORN_PATH[3][1], u) * r;
        const w = lerp(0.4, 0.05, u) * r * widthScale;
        circle(x, y, w * 2);
      }
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      // eased out, so the horns shoot up fast and settle rather than sliding in
      const rawGrow = constrain(this.age / HORN_GROW_MS, 0, 1);
      const grow = 1 - (1 - rawGrow) * (1 - rawGrow);
      // a slow bellows breath, so a seven-second buff is never a static decal
      const breath = 1 + sin(this.age / 340) * 0.045;

      push();
      translate(this.position.x, this.position.y);

      // Cracked earth under the hooves. Drawn first and lowest so the horns and
      // the ring sit on top of it, and kept alive past the stomp: the scuffed
      // ground is what says a heavy thing landed here.
      const crackT = constrain(this.age / CRACK_MS, 0, 1);
      if (crackT < 1) {
        const open = constrain(this.age / STOMP_MS, 0, 1);
        const fade = 1 - crackT;
        for (const crack of this._cracks) {
          const len = crack.length * open;
          const ca = cos(crack.angle);
          const sa = sin(crack.angle);
          // squashed on y so the fissures lie on the ground instead of standing up
          const kx = ca * len * crack.kink - sa * crack.bend;
          const ky = (sa * len * crack.kink + ca * crack.bend) * 0.55;
          stroke(58, 38, 22, 210 * fade);
          strokeWeight(5);
          line(ca * r * 0.5, sa * r * 0.5 * 0.55, kx, ky);
          line(kx, ky, ca * len, sa * len * 0.55);
          stroke(140, 96, 52, 170 * fade);
          strokeWeight(2);
          line(ca * r * 0.5, sa * r * 0.5 * 0.55, kx, ky);
          line(kx, ky, ca * len, sa * len * 0.55);
        }
      }

      // Clods of turf orbiting his hooves — cheap, but it keeps the ground busy
      // and it is unmistakably dirt rather than magic.
      noStroke();
      const spin = this.age / 900;
      for (const chip of this._chips) {
        const a = chip.angle + spin;
        fill(122, 88, 52, 220);
        circle(cos(a) * chip.radius, sin(a) * chip.radius * 0.5 + r * 0.45, chip.size);
      }

      // The horns. Three passes per side: a dark keratin core, the tan body, then
      // a lit ridge along the outside, so they read against any avatar art.
      for (const sign of [-1, 1]) {
        push();
        scale(sign, 1);
        scale(breath);
        this._drawHorn(r, grow, 1.15, 60, 40, 24);
        this._drawHorn(r, grow, 0.92, 214, 186, 138);
        this._drawHorn(r, grow, 0.42, 255, 244, 214);
        pop();
      }

      // How much of the will is left. Earthy gold, and low-contrast until it runs
      // short — the player should read it without it competing with the horns.
      noFill();
      stroke(96, 72, 44, 110);
      strokeWeight(4);
      circle(0, 0, r * 2 + 30);
      stroke(236, 198, 120, 230);
      strokeWeight(4);
      arc(0, 0, r * 2 + 30, r * 2 + 30, -HALF_PI, -HALF_PI + TWO_PI * left);

      // The stomp itself: two waves off the hooves, the second chasing the first.
      if (this.age < STOMP_MS) {
        const t = this.age / STOMP_MS;
        const fade = 1 - t;
        noFill();
        stroke(150, 108, 62, 230 * fade);
        strokeWeight(10 * fade + 2);
        circle(0, 0, size + 190 * t);
        stroke(248, 226, 176, 220 * fade);
        strokeWeight(5 * fade + 1.5);
        circle(0, 0, size + 130 * t);

        // the flash of contact, gone in the first heartbeat
        const flash = 1 - constrain(t / 0.3, 0, 1);
        if (flash > 0) {
          noStroke();
          fill(255, 240, 205, 190 * flash);
          circle(0, 0, size * 0.9 * flash + 18);
        }
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Alistar_R_Object;
}
const __cacheAlistar_R_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAlistar_R_Object>>();
export function makeAlistar_R_Object(api: ContentApi) {
  const cached = __cacheAlistar_R_Object.get(api);
  if (cached) return cached;
  const built = __buildAlistar_R_Object(api);
  __cacheAlistar_R_Object.set(api, built);
  return built;
}