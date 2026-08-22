import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Nocturne_W = InstanceType<ReturnType<typeof makeNocturne_W>>;
type Nocturne_W_Shroud = InstanceType<ReturnType<typeof makeNocturne_W_Shroud>>;



export const DURATION = 3000;

export const SHIELD_AMOUNT = 65;

export const ATTACK_SPEED_PERCENT = 0.4;

export const OMNIVAMP = 0.25;


/** How long the darkness takes to rush in and close over him. */
export const GATHER_MS = 280;

/** Vertices of the writhing silhouette. Enough to ripple, few enough to read. */
export const SHROUD_VERTICES = 16;

/** Tendrils lashing out of the shroud. */
export const TENDRIL_COUNT = 7;

/** How far a tendril reaches past the body at full extension. */
export const TENDRIL_REACH = 34;

/** How far past his own body the shroud paints, for the display box. */
export const BOUNDING_MARGIN = 70;

/** Belt-and-braces stop for a cosmetic wrapper; the buff is the real exit. */
export const HARD_STOP_MS = DURATION + 1_000;


const UMBRA: [number, number, number] = [8, 4, 20];

const INDIGO: [number, number, number] = [58, 30, 118];

const INDIGO_BRIGHT: [number, number, number] = [150, 110, 240];


/**
 * Shroud of Darkness. The spell shield it is in League needs an "incoming
 * ability" hook this engine does not have, so it lands as the thing that shield
 * buys him: a window he can walk into a fight through, and the attack speed
 * that made blocking one spell worth it.
 */
function __buildNocturne_W(api: ContentApi) {
  const Spell = api.Spell;
  const Shield = api.buffs.Shield;
  const StatAmp = api.buffs.StatAmp;
  const Nocturne_W_Shroud = makeNocturne_W_Shroud(api);
  class Nocturne_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_nocturne_w');
    name = 'Bóng Đen Bao Phủ (Nocturne_W)';
    description =
      `Nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>, <span class="buff">+${ATTACK_SPEED_PERCENT * 100}% tốc độ đánh</span>` +
      ` và <span class="buff">hút ${OMNIVAMP * 100}% máu</span> trong <span class="time">${DURATION / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 25;

    onSpellCast() {
      const shield = new Shield(DURATION, this.owner, this.owner);
      shield.stackId = 'nocturne_w';
      shield.image = this.image;
      shield.amount = SHIELD_AMOUNT;
      shield.color = [150, 110, 240];
      this.owner.addBuff(shield);

      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = 'nocturne_w_haste';
      amp.image = this.image;
      amp.name = 'Màn Đêm Bao Phủ';
      amp.bonuses = {
        attackSpeed: { percentBaseBonus: ATTACK_SPEED_PERCENT },
        omnivamp: { baseBonus: OMNIVAMP },
      };
      this.owner.addBuff(amp);

      // The shared Shield ring in violet is what half the roster's shields look
      // like, and this one is the three seconds Nocturne is most dangerous in.
      // The shroud is the warning: something is wrong with the shape of him.
      const shroud = new Nocturne_W_Shroud(this.owner);
      shroud.attachTo(this.owner, shield);
      this.game.objectManager.addObject(shroud);
    }
  }
  return Nocturne_W;
}
const __cacheNocturne_W = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_W>>();
export default function makeNocturne_W(api: ContentApi) {
  const cached = __cacheNocturne_W.get(api);
  if (cached) return cached;
  const built = __buildNocturne_W(api);
  __cacheNocturne_W.set(api, built);
  return built;
}


/** One vertex of the silhouette, breathing on its own clock. */
interface Wobble {
  /** Where in its cycle this vertex starts — the reason the edge ripples. */
  phase: number;
  /** How fast it breathes. */
  speed: number;
  /** How far in and out it travels, as a share of the body radius. */
  amp: number;
}


/** One arm of shadow whipping out of the cloak and back. */
interface Tendril {
  angle: number;
  phase: number;
  speed: number;
  reach: number;
  /** Which way it curls, so they do not all sweep the same direction. */
  curl: number;
}


function __buildNocturne_W_Shroud(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Shield = api.buffs.Shield;
  class Nocturne_W_Shroud extends SpellObject {
    age = 0;

    /** All of it rolled once in `onAdded` and animated from `age` after that. */
    _wobbles: Wobble[] = [];
    _tendrils: Tendril[] = [];

    onAdded() {
      for (let i = 0; i < SHROUD_VERTICES; i++) {
        this._wobbles.push({
          phase: random(TWO_PI),
          speed: random(0.0018, 0.0042),
          amp: random(0.1, 0.28),
        });
      }
      for (let i = 0; i < TENDRIL_COUNT; i++) {
        this._tendrils.push({
          angle: (TWO_PI * i) / TENDRIL_COUNT + random(-0.3, 0.3),
          phase: random(TWO_PI),
          speed: random(0.002, 0.005),
          reach: random(0.6, 1),
          curl: random() < 0.5 ? -1 : 1,
        });
      }
    }

    update() {
      // Rides Nocturne: the shroud has to die with him, not follow the corpse.
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
      if (this.age >= HARD_STOP_MS) this.toRemove = true;
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const radius = size / 2;
      const shield = this._anchorBuff as Shield | null;
      const left =
        shield && shield.duration ? constrain(1 - shield.timeElapsed / shield.duration, 0, 1) : 0;
      // The darkness is dragged in from outside rather than switched on: for the
      // first quarter-second the silhouette is too big for him and closing.
      const gather = constrain(this.age / GATHER_MS, 0, 1);
      const pull = 1 + (1 - gather) * 1.6;
      // it thins out as the window runs down, so the moment to disengage is
      // something the enemy can see coming rather than count
      const density = 0.35 + 0.65 * left;
      const [ur, ug, ub] = UMBRA;
      const [ir, ig, ib] = INDIGO;
      const [br, bg, bb] = INDIGO_BRIGHT;

      push();
      translate(this.position.x, this.position.y);

      // tendrils first, so the body of the shroud paints over their roots
      for (const tendril of this._tendrils) {
        const beat = (sin(this.age * tendril.speed + tendril.phase) + 1) / 2;
        const reach = radius + TENDRIL_REACH * tendril.reach * beat * gather;
        const a = tendril.angle + tendril.curl * beat * 0.5;
        noFill();
        stroke(ur, ug, ub, 215 * density);
        strokeWeight(7 * beat + 2);
        beginShape();
        for (let s = 0; s <= 4; s++) {
          const f = s / 4;
          // the arm curls as it extends, which is what separates a tendril of
          // shadow from a spike of it
          const curl = a + tendril.curl * f * f * 0.9;
          vertex(cos(curl) * lerp(radius * 0.4, reach, f), sin(curl) * lerp(radius * 0.4, reach, f));
        }
        endShape();
        stroke(ir, ig, ib, 190 * density);
        strokeWeight(3 * beat + 1);
        beginShape();
        for (let s = 0; s <= 4; s++) {
          const f = s / 4;
          const curl = a + tendril.curl * f * f * 0.9;
          vertex(cos(curl) * lerp(radius * 0.4, reach, f), sin(curl) * lerp(radius * 0.4, reach, f));
        }
        endShape();
      }

      // the shroud itself: a silhouette that will not hold still
      noStroke();
      for (let layer = 0; layer < 3; layer++) {
        // three nested copies at slightly different scales and phases read as
        // depth — one outline would just look like a wobbling coin
        const scale = 1.25 - layer * 0.22;
        const shade = layer === 0 ? ur : layer === 1 ? ir : br;
        const shadeG = layer === 0 ? ug : layer === 1 ? ig : bg;
        const shadeB = layer === 0 ? ub : layer === 1 ? ib : bb;
        const alpha = (layer === 0 ? 200 : layer === 1 ? 150 : 70) * density;
        fill(shade, shadeG, shadeB, alpha);
        beginShape();
        for (let i = 0; i < SHROUD_VERTICES; i++) {
          const wobble = this._wobbles[i];
          if (!wobble) continue;
          const a = (i / SHROUD_VERTICES) * TWO_PI;
          const breathe = sin(this.age * wobble.speed + wobble.phase + layer * 1.3);
          const r = radius * scale * pull * (1 + wobble.amp * breathe);
          vertex(cos(a) * r, sin(a) * r);
        }
        endShape(CLOSE);
      }

      // the pair of eyes in the dark: the one bit of Nocturne that is legible at
      // a glance, and the thing that tells an enemy which champion this is
      const glare = 0.55 + 0.45 * sin(this.age / 190);
      noStroke();
      fill(br, bg, bb, 90 * density * glare);
      circle(-radius * 0.28, -radius * 0.1, radius * 0.7);
      circle(radius * 0.28, -radius * 0.1, radius * 0.7);
      fill(235, 220, 255, 235 * density);
      circle(-radius * 0.28, -radius * 0.1, radius * 0.2 + 2);
      circle(radius * 0.28, -radius * 0.1, radius * 0.2 + 2);

      // how long the window lasts
      noFill();
      stroke(ir, ig, ib, 150);
      strokeWeight(3);
      circle(0, 0, size + 34);
      stroke(br, bg, bb, 235);
      strokeWeight(3);
      arc(0, 0, size + 34, size + 34, -HALF_PI, -HALF_PI + TWO_PI * left);

      // the moment it closes over him
      if (this.age < GATHER_MS) {
        const t = this.age / GATHER_MS;
        noFill();
        stroke(br, bg, bb, 220 * (1 - t));
        strokeWeight(7 * (1 - t) + 1);
        // inward, not outward: the darkness arrives from somewhere else
        circle(0, 0, size + 130 * (1 - t));
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Nocturne_W_Shroud;
}
const __cacheNocturne_W_Shroud = new WeakMap<ContentApi, ReturnType<typeof __buildNocturne_W_Shroud>>();
export function makeNocturne_W_Shroud(api: ContentApi) {
  const cached = __cacheNocturne_W_Shroud.get(api);
  if (cached) return cached;
  const built = __buildNocturne_W_Shroud(api);
  __cacheNocturne_W_Shroud.set(api, built);
  return built;
}