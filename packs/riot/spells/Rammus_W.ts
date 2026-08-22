import type { ContentApi } from '@moba2d/core/content/ContentApi';

type DamageReflect = InstanceType<ContentApi['buffs']['DamageReflect']>;
type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Rammus_W = InstanceType<ReturnType<typeof makeRammus_W>>;
type Rammus_W_Shell = InstanceType<ReturnType<typeof makeRammus_W_Shell>>;



export const DURATION = 5000;

export const SHIELD_AMOUNT = 80;

export const SELF_SLOW = 0.25;

/** Share of every hit the spikes send back at whoever landed it. */
export const REFLECT_PERCENT = 0.8;


/** How long the shell takes to slam shut around him. */
export const CURL_MS = 260;

/** Spikes around the rim. Ten is a hedgehog; six reads as armour plating. */
export const SPIKE_COUNT = 10;

/** How far a spike stands out past the shell, at full extension. */
export const SPIKE_LENGTH = 15;

/** Cracks that can open across the dome as the shield is chipped away. */
export const CRACK_COUNT = 4;

/** How far past his own body the shell paints, for the display box. */
export const BOUNDING_MARGIN = 60;

/**
 * Belt-and-braces upper bound on a purely cosmetic wrapper, the same guard
 * `Malphite_W_Armor` carries: the real exit is the shield expiring or Rammus
 * dying, and if some path nobody has found skips both, this turns a permanent
 * artefact into a five-second one.
 */
export const HARD_STOP_MS = DURATION + 1_000;


const SHELL_DARK: [number, number, number] = [88, 54, 28];

const SHELL: [number, number, number] = [168, 122, 68];

const SHELL_LIGHT: [number, number, number] = [226, 194, 136];


function __buildRammus_W(api: ContentApi) {
  const Spell = api.Spell;
  const DamageReflect = api.buffs.DamageReflect;
  const Shield = api.buffs.Shield;
  const Slow = api.buffs.Slow;
  const Rammus_W_Shell = makeRammus_W_Shell(api);
  class Rammus_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_rammus_w');
    name = 'Thế Thủ (Rammus_W)';
    description =
      `Cuộn tròn trong <span class="time">${DURATION / 1000} giây</span>: nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span>` +
      ` và <span class="buff">phản ${REFLECT_PERCENT * 100}% sát thương</span> về kẻ đã gây ra nó (tính trên đòn đánh gốc,` +
      ` trước khi khiên đỡ), đổi lại <span class="debuff">chậm ${SELF_SLOW * 100}%</span> vì mai rùa quá nặng`;
    coolDown = 10000;
    manaCost = 25;

    onSpellCast() {
      // Added BEFORE the shield, and the order is the tuning. `takeDamage` walks
      // the buff list in insertion order handing each one what the last returned,
      // so this sees the swing as it arrived; behind the shield it would only
      // ever reflect the overflow, which on a 25-damage poke is nothing at all.
      const reflect = new DamageReflect(DURATION, this.owner, this.owner);
      reflect.stackId = 'rammus_w_reflect';
      reflect.percent = REFLECT_PERCENT;
      this.owner.addBuff(reflect);

      const shield = new Shield(DURATION, this.owner, this.owner);
      shield.stackId = 'rammus_w_shield';
      shield.image = this.image;
      shield.amount = SHIELD_AMOUNT;
      shield.color = [180, 200, 120];
      this.owner.addBuff(shield);

      const slow = new Slow(DURATION, this.owner, this.owner);
      slow.percent = SELF_SLOW;
      this.owner.addBuff(slow);

      // A recoloured version of the shared Shield ring is what every shield in
      // the game already looks like, so Defensive Ball Curl was unreadable: the
      // one thing an enemy needs to know is "do not hit him right now", and a
      // thin ring in a different hue does not say that. Actual armour does. The
      // ring stays — it is the generic shield readout — and this rides on top.
      const shell = new Rammus_W_Shell(this.owner);
      shell.attachTo(this.owner, shield);
      this.game.objectManager.addObject(shell);
    }
  }
  return Rammus_W;
}
const __cacheRammus_W = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_W>>();
export default function makeRammus_W(api: ContentApi) {
  const cached = __cacheRammus_W.get(api);
  if (cached) return cached;
  const built = __buildRammus_W(api);
  __cacheRammus_W.set(api, built);
  return built;
}


/** One jagged split running across the dome once the shield starts giving. */
interface Crack {
  angle: number;
  /** Sideways kinks along the split, rolled once so it never wriggles. */
  kinks: number[];
  /** Fraction of the shield that has to be gone before this one opens. */
  at: number;
}


/** The curled carapace: spiked plates clamped over Rammus for the duration. */
function __buildRammus_W_Shell(api: ContentApi) {
  const SpellObject = api.SpellObject;
  const Shield = api.buffs.Shield;
  class Rammus_W_Shell extends SpellObject {
    age = 0;

    /** Seeded in `onAdded`, animated from the shield's remaining amount. */
    _cracks: Crack[] = [];
    /** Per-spike length jitter, so the rim is not a machined gear. */
    _spikeJitter: number[] = [];

    onAdded() {
      for (let i = 0; i < CRACK_COUNT; i++) {
        const kinks: number[] = [];
        for (let k = 0; k < 3; k++) kinks.push(random(-7, 7));
        this._cracks.push({
          angle: random(TWO_PI),
          kinks,
          // staggered thresholds: the dome splinters progressively rather than
          // going from pristine to shattered in one hit
          at: (i + 1) / (CRACK_COUNT + 1),
        });
      }
      for (let i = 0; i < SPIKE_COUNT; i++) this._spikeJitter.push(random(0.75, 1.25));
    }

    update() {
      // Rides Rammus: no drawing on the corpse, no reappearing at the fountain.
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);
      if (this.age >= HARD_STOP_MS) this.toRemove = true;
    }

    /** 1 while the shield is untouched, 0 once it has absorbed everything. */
    get _intact(): number {
      const shield = this._anchorBuff as Shield | null;
      if (!shield || !shield._initialAmount) return 1;
      return constrain(shield.amount / shield._initialAmount, 0, 1);
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const radius = size / 2;
      const shield = this._anchorBuff as Shield | null;
      const left =
        shield && shield.duration ? constrain(1 - shield.timeElapsed / shield.duration, 0, 1) : 0;
      // slams shut over the first quarter-second, so the cast has a moment
      const curl = constrain(this.age / CURL_MS, 0, 1);
      const intact = this._intact;
      // he rocks very slightly: a ball of armour, settling
      const rock = sin(this.age / 260) * 0.035 * curl;
      const [dr, dg, db] = SHELL_DARK;
      const [mr, mg, mb] = SHELL;
      const [lr, lg, lb] = SHELL_LIGHT;

      push();
      translate(this.position.x, this.position.y);
      rotate(rock);

      // ground shadow: the shell is heavy, which is what the self-slow is
      noStroke();
      fill(30, 20, 10, 90 * curl);
      ellipse(0, radius * 0.55, size * 1.1 * curl, size * 0.34 * curl);

      // spikes, driven out as he curls
      const spikeOut = SPIKE_LENGTH * curl;
      for (let i = 0; i < SPIKE_COUNT; i++) {
        const a = (i / SPIKE_COUNT) * TWO_PI;
        const jitter = this._spikeJitter[i] ?? 1;
        const inner = radius * 0.92;
        const outer = inner + spikeOut * jitter;
        const width = 0.11;
        fill(dr, dg, db, 250);
        triangle(
          cos(a - width) * inner,
          sin(a - width) * inner,
          cos(a + width) * inner,
          sin(a + width) * inner,
          cos(a) * outer,
          sin(a) * outer
        );
        fill(lr, lg, lb, 210);
        triangle(
          cos(a - width * 0.4) * inner,
          sin(a - width * 0.4) * inner,
          cos(a + width * 0.15) * inner,
          sin(a + width * 0.15) * inner,
          cos(a) * (outer - 2),
          sin(a) * (outer - 2)
        );
      }

      // the dome: six scutes around a central plate, seams picked out dark, which
      // is what makes it a tortoise shell and not a brown circle
      const dome = radius * (0.7 + 0.28 * curl);
      stroke(dr, dg, db, 250);
      strokeWeight(3);
      fill(mr, mg, mb, 245);
      circle(0, 0, dome * 2);

      for (let i = 0; i < 6; i++) {
        const a0 = (i / 6) * TWO_PI;
        const a1 = ((i + 1) / 6) * TWO_PI;
        noStroke();
        // alternating tone gives the plates relief without a gradient
        fill(mr + (i % 2 ? 22 : -18), mg + (i % 2 ? 18 : -14), mb + (i % 2 ? 14 : -10), 240);
        beginShape();
        vertex(cos(a0) * dome * 0.42, sin(a0) * dome * 0.42);
        vertex(cos(a0) * dome, sin(a0) * dome);
        vertex(cos((a0 + a1) / 2) * dome * 1.02, sin((a0 + a1) / 2) * dome * 1.02);
        vertex(cos(a1) * dome, sin(a1) * dome);
        vertex(cos(a1) * dome * 0.42, sin(a1) * dome * 0.42);
        endShape(CLOSE);
        stroke(dr, dg, db, 230);
        strokeWeight(2.5);
        line(cos(a0) * dome * 0.42, sin(a0) * dome * 0.42, cos(a0) * dome, sin(a0) * dome);
      }

      // the keystone plate at the top of the dome
      noStroke();
      fill(lr, lg, lb, 235);
      circle(0, 0, dome * 0.84);
      fill(mr, mg, mb, 245);
      circle(0, 0, dome * 0.62);
      noFill();
      stroke(dr, dg, db, 220);
      strokeWeight(2);
      circle(0, 0, dome * 0.84);

      // Cracks: the shell splits as the shield is spent, so an attacker can see
      // their damage landing on something that is running out.
      const spent = 1 - intact;
      for (const crack of this._cracks) {
        if (spent < crack.at) continue;
        const opened = constrain((spent - crack.at) / 0.25, 0, 1);
        stroke(24, 14, 6, 235 * opened);
        strokeWeight(2.5);
        noFill();
        beginShape();
        vertex(0, 0);
        for (let k = 0; k < crack.kinks.length; k++) {
          const f = (k + 1) / crack.kinks.length;
          const r = dome * f * opened;
          const a = crack.angle + crack.kinks[k] * 0.06;
          vertex(cos(a) * r, sin(a) * r);
        }
        endShape();
      }

      // how much of the five seconds is left
      noFill();
      stroke(dr, dg, db, 130);
      strokeWeight(4);
      circle(0, 0, radius * 2 + SPIKE_LENGTH * 2 + 12);
      stroke(lr, lg, lb, 235);
      strokeWeight(4);
      arc(
        0,
        0,
        radius * 2 + SPIKE_LENGTH * 2 + 12,
        radius * 2 + SPIKE_LENGTH * 2 + 12,
        -HALF_PI,
        -HALF_PI + TWO_PI * left
      );

      // the slam of curling up
      if (this.age < CURL_MS) {
        const t = this.age / CURL_MS;
        noFill();
        stroke(210, 176, 120, 210 * (1 - t));
        strokeWeight(6 * (1 - t) + 1);
        circle(0, 0, size + 90 * t);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Rammus_W_Shell;
}
const __cacheRammus_W_Shell = new WeakMap<ContentApi, ReturnType<typeof __buildRammus_W_Shell>>();
export function makeRammus_W_Shell(api: ContentApi) {
  const cached = __cacheRammus_W_Shell.get(api);
  if (cached) return cached;
  const built = __buildRammus_W_Shell(api);
  __cacheRammus_W_Shell.set(api, built);
  return built;
}