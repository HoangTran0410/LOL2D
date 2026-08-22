import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Shield = InstanceType<ContentApi['buffs']['Shield']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StatAmp = InstanceType<ContentApi['buffs']['StatAmp']>;
type Garen_W = InstanceType<ReturnType<typeof makeGaren_W>>;
type Garen_W_Aegis = InstanceType<ReturnType<typeof makeGaren_W_Aegis>>;



export const DURATION = 3000;

export const SHIELD_AMOUNT = 70;

export const OMNIVAMP = 0.2;


/** How long the plates take to fly in and lock. Short — this is a panic button. */
export const FORM_MS = 240;

export const PLATE_COUNT = 4;

/** Where a plate starts, as a multiple of Garen's body radius. */
export const PLATE_START = 3.4;

/** One pass of the polish highlight down the face of the shield. */
export const SHIMMER_PERIOD_MS = 780;

export const SPARK_COUNT = 5;

export const SPARK_LIFETIME_MS = 420;

/** Covers the plates at their farthest, the shield outline and the cast flare. */
export const BOUNDING_MARGIN = 170;

/** Cosmetic-only ceiling; the buff ending or Garen dying is the real exit. */
export const HARD_STOP_MS = DURATION + 1200;


/**
 * The Demacian kite shield, in units of Garen's body radius. Right half only —
 * the left is this mirrored — read top-left to bottom point.
 */
export const SHIELD_PROFILE: [number, number][] = [
  [-1.3, 1.05],
  [-0.1, 1.05],
  [0.72, 0.74],
  [1.46, 0.0],
];


/** Half-width of the shield at a given height, for the polish highlight. */
function shieldHalfWidth(y: number): number {
  for (let i = 0; i < SHIELD_PROFILE.length - 1; i++) {
    const [y0, w0] = SHIELD_PROFILE[i];
    const [y1, w1] = SHIELD_PROFILE[i + 1];
    if (y >= y0 && y <= y1) return lerp(w0, w1, (y - y0) / (y1 - y0));
  }
  return 0;
}


/**
 * Courage.
 *
 * League's version is a shield plus tenacity and lasting damage reduction.
 * There is no tenacity stat here, so the durability lands as a shield and the
 * staying power as omnivamp: Garen's whole identity is being the one who is
 * still standing at the end of the fight.
 */
function __buildGaren_W(api: ContentApi) {
  const Spell = api.Spell;
  const Shield = api.buffs.Shield;
  const StatAmp = api.buffs.StatAmp;
  const Garen_W_Aegis = makeGaren_W_Aegis(api);
  class Garen_W extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_garen_w');
    name = 'Lòng Can Đảm (Garen_W)';
    description =
      `Nhận <span class="buff">Khiên ${SHIELD_AMOUNT}</span> và <span class="buff">hút ${OMNIVAMP * 100}% máu</span>` +
      ` từ mọi sát thương gây ra, trong <span class="time">${DURATION / 1000} giây</span>`;
    coolDown = 9000;
    manaCost = 25;

    onSpellCast() {
      const shield = new Shield(DURATION, this.owner, this.owner);
      shield.stackId = 'garen_w';
      shield.amount = SHIELD_AMOUNT;
      shield.color = [230, 220, 170];
      this.owner.addBuff(shield);

      const amp = new StatAmp(DURATION, this.owner, this.owner);
      amp.stackId = 'garen_w_vamp';
      amp.name = 'Dũng Khí';
      amp.bonuses = { omnivamp: { baseBonus: OMNIVAMP } };
      this.owner.addBuff(amp);

      // Three seconds is short enough that the enemy has to *see* it to respect
      // it, and a grey bar on the health bar is not seeing it. The aegis shadows
      // the omnivamp buff, which runs the full duration whether or not the shield
      // gets chewed through early.
      const aegis = new Garen_W_Aegis(this.owner);
      aegis.attachTo(this.owner, amp);
      this.game.objectManager.addObject(aegis);
    }
  }
  return Garen_W;
}
const __cacheGaren_W = new WeakMap<ContentApi, ReturnType<typeof __buildGaren_W>>();
export default function makeGaren_W(api: ContentApi) {
  const cached = __cacheGaren_W.get(api);
  if (cached) return cached;
  const built = __buildGaren_W(api);
  __cacheGaren_W.set(api, built);
  return built;
}


interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
}


/**
 * Steel plates slam together into a Demacian kite shield and hold. Gold and
 * brushed steel, hard straight edges, heraldic silhouette — nothing else in the
 * game is a *shape* rather than a ring, which is the point: at a glance you know
 * it is Garen and you know he is not dying to this trade.
 */
function __buildGaren_W_Aegis(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Garen_W_Aegis extends SpellObject {
    age = 0;

    _sparks: Spark[] = [];
    _sparked = false;

    update() {
      if (this.dropIfAttachmentLost()) return;

      this.age += deltaTime;
      this.position.set(this.owner.position.x, this.owner.position.y);

      if (this.age >= HARD_STOP_MS) {
        this.toRemove = true;
        return;
      }

      // The moment the last plate seats, the seams throw sparks. Once only.
      if (!this._sparked && this.age >= FORM_MS) {
        this._sparked = true;
        const r = this.owner.animatedValues.displaySize / 2;
        // a quarter turn, so the plates come in on the diagonals, not the axes
        for (let i = 0; i < PLATE_COUNT; i++) {
          const a = (TWO_PI * i) / PLATE_COUNT + PI / 4;
          for (let k = 0; k < SPARK_COUNT; k++) {
            const spread = a + random(-0.5, 0.5);
            const speed = random(1.4, 3.2);
            this._sparks.push({
              x: cos(a) * r * 1.25,
              y: sin(a) * r * 1.25,
              vx: cos(spread) * speed,
              vy: sin(spread) * speed,
              age: 0,
            });
          }
        }
      }

      let i = 0;
      while (i < this._sparks.length) {
        const spark = this._sparks[i];
        spark.age += deltaTime;
        spark.x += spark.vx;
        spark.y += spark.vy;
        spark.vy += 0.06; // sparks fall, which is what makes them read as metal
        if (spark.age >= SPARK_LIFETIME_MS) this._sparks.splice(i, 1);
        else i++;
      }
    }

    /** The kite outline, traced from the mirrored profile. */
    _traceShield(r: number) {
      beginShape();
      for (let i = 0; i < SHIELD_PROFILE.length; i++) {
        const [y, w] = SHIELD_PROFILE[i];
        vertex(-w * r, y * r);
      }
      for (let i = SHIELD_PROFILE.length - 1; i >= 0; i--) {
        const [y, w] = SHIELD_PROFILE[i];
        vertex(w * r, y * r);
      }
      endShape(CLOSE);
    }

    draw() {
      const size = this.owner.animatedValues.displaySize;
      const r = size / 2;
      const buff = this._anchorBuff;
      const left = buff && buff.duration ? constrain(1 - buff.timeElapsed / buff.duration, 0, 1) : 0;
      const rawForm = constrain(this.age / FORM_MS, 0, 1);
      // eased out hard: the plates arrive fast and stop dead, like struck metal
      const form = 1 - (1 - rawForm) * (1 - rawForm) * (1 - rawForm);

      push();
      translate(this.position.x, this.position.y);

      // The plates on their way in. They are the windup; once seated they stop
      // being drawn separately and become the shield's rim.
      if (form < 1) {
        const travel = PLATE_START - (PLATE_START - 1.25) * form;
        for (let i = 0; i < PLATE_COUNT; i++) {
          const a = (TWO_PI * i) / PLATE_COUNT + PI / 4;
          push();
          translate(cos(a) * r * travel, sin(a) * r * travel);
          rotate(a);
          // a chevron pointing at the man it is about to armour
          noFill();
          stroke(70, 62, 48, 240 * form);
          strokeWeight(9);
          line(-10, -16, 6, 0);
          line(-10, 16, 6, 0);
          stroke(246, 214, 128, 250 * form);
          strokeWeight(4);
          line(-10, -16, 6, 0);
          line(-10, 16, 6, 0);
          pop();
        }
      }

      // The shield itself. Barely filled — Garen has to stay legible underneath —
      // but triple-stroked so the silhouette is hard even over a bright avatar.
      push();
      scale(lerp(1.35, 1, form), lerp(1.35, 1, form));
      noStroke();
      fill(228, 206, 150, 34 * form);
      this._traceShield(r);
      noFill();
      stroke(38, 34, 26, 235 * form);
      strokeWeight(9);
      this._traceShield(r);
      stroke(176, 178, 188, 240 * form); // brushed steel
      strokeWeight(6);
      this._traceShield(r);
      stroke(250, 220, 132, 250 * form); // Demacian gold trim
      strokeWeight(2.5);
      this._traceShield(r);

      // Polish sweeping down the face. A static outline reads as a UI decal; a
      // moving highlight reads as a physical object catching light.
      if (form >= 1) {
        const sweep = (this.age % SHIMMER_PERIOD_MS) / SHIMMER_PERIOD_MS;
        const y = lerp(SHIELD_PROFILE[0][0], SHIELD_PROFILE[SHIELD_PROFILE.length - 1][0], sweep);
        const halfWidth = shieldHalfWidth(y) * r * 0.86;
        const glare = sin(sweep * PI);
        stroke(255, 248, 214, 190 * glare);
        strokeWeight(3);
        line(-halfWidth, y * r, halfWidth, y * r);
      }
      pop();

      // Sparks off the seams where the plates met.
      noStroke();
      for (const spark of this._sparks) {
        const t = spark.age / SPARK_LIFETIME_MS;
        fill(255, lerp(230, 140, t), lerp(170, 40, t), 240 * (1 - t));
        circle(spark.x, spark.y, 4 * (1 - t) + 1.5);
      }

      // How long the courage holds, on the outside of the shield so it never
      // fights with the heraldry.
      noFill();
      stroke(74, 66, 48, 110);
      strokeWeight(4);
      circle(0, 0, r * 3.4);
      stroke(252, 226, 148, 235);
      strokeWeight(4);
      arc(0, 0, r * 3.4, r * 3.4, -HALF_PI, -HALF_PI + TWO_PI * left);

      // The cry itself — one gold flare at the moment of the shout.
      if (this.age < FORM_MS) {
        const flash = 1 - rawForm;
        noStroke();
        fill(255, 244, 206, 200 * flash);
        circle(0, 0, size * 1.1 * flash + 16);
        noFill();
        stroke(255, 226, 150, 235 * flash);
        strokeWeight(6 * flash + 1);
        circle(0, 0, size + 150 * rawForm);
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.owner.animatedValues.displaySize / 2 + BOUNDING_MARGIN;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Garen_W_Aegis;
}
const __cacheGaren_W_Aegis = new WeakMap<ContentApi, ReturnType<typeof __buildGaren_W_Aegis>>();
export function makeGaren_W_Aegis(api: ContentApi) {
  const cached = __cacheGaren_W_Aegis.get(api);
  if (cached) return cached;
  const built = __buildGaren_W_Aegis(api);
  __cacheGaren_W_Aegis.set(api, built);
  return built;
}