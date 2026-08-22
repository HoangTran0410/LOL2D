import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type StealthWard = InstanceType<ReturnType<typeof makeStealthWard>>;
type StealthWard_Object = InstanceType<ReturnType<typeof makeStealthWard_Object>>;



/** The totem's drawn proportions. `size` stays the ward's own tiny footprint. */
export const WARD_HEIGHT = 26;

export const WARD_WIDTH = 15;

/** Planting animation: the stake is driven into the ground over this long. */
export const WARD_PLANT_MS = 320;

/** How often the eye blinks while it is healthy. */
export const BLINK_INTERVAL_MS = 2600;

/** How long one blink takes. */
export const BLINK_MS = 180;

/** A slow ring goes out on this beat, the ward telling you it is still watching. */
export const PULSE_INTERVAL_MS = 2000;

/** The last stretch of its life, where it visibly starts to fail. */
export const WARD_EXPIRY_WARNING_MS = 3000;


function __buildStealthWard(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const StealthWard_Object = makeStealthWard_Object(api);
  class StealthWard extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_stealthward');
    name = 'Mắt Xanh (Stealth Ward)';
    description =
      'Cắm một mắt xanh, cung cấp <span class="buff">Tầm Nhìn</span> 700px, tồn tại trong <span class="time">20 giây</span>';
    coolDown = 10000;

    maxRange = 300;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.maxRange
      );

      const obj = new StealthWard_Object(this.owner);
      obj.position = to;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.maxRange);
    }
  }
  return StealthWard;
}
const __cacheStealthWard = new WeakMap<ContentApi, ReturnType<typeof __buildStealthWard>>();
export default function makeStealthWard(api: ContentApi) {
  const cached = __cacheStealthWard.get(api);
  if (cached) return cached;
  const built = __buildStealthWard(api);
  __cacheStealthWard.set(api, built);
  return built;
}


/**
 * A small totem with one open eye.
 *
 * A ward is furniture — it sits still for twenty seconds — so the whole design
 * is about staying legible without ever demanding attention: the eye blinks on
 * a slow beat, a faint ring says it is awake, and in the last three seconds the
 * blinking turns frantic and the light drains, which is the only warning the
 * player gets that the vision is about to go out.
 */
function __buildStealthWard_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class StealthWard_Object extends SpellObject {
    visionRadius = 350;
    size = 0;
    maxSize = 10;
    lifeTime = 20000;
    age = 0;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
      this.size = lerp(this.size, this.maxSize, 0.1);
    }

    /** 1 = wide open, 0 = shut. Blinks faster once the ward is running out. */
    _eyeOpen() {
      const left = this.lifeTime - this.age;
      const dying = left < WARD_EXPIRY_WARNING_MS;
      const interval = dying ? 380 : BLINK_INTERVAL_MS;
      const phase = this.age % interval;
      if (phase > BLINK_MS) return 1;
      // a full close-and-open inside the blink window, not a hard cut
      return 1 - sin((phase / BLINK_MS) * PI);
    }

    draw() {
      // ease-out plant: the stake goes in hard and settles, so a ward dropped
      // behind you is something you *see* being placed
      const grow = constrain(this.age / WARD_PLANT_MS, 0, 1);
      const planted = 1 - (1 - grow) * (1 - grow);
      const left = this.lifeTime - this.age;
      // the light drains over the last three seconds, before the ward pops
      const life = constrain(left / WARD_EXPIRY_WARNING_MS, 0, 1);
      const open = this._eyeOpen();
      const h = WARD_HEIGHT * planted;
      const w = WARD_WIDTH * planted;

      push();
      translate(this.position.x, this.position.y);

      // dust kicked up by the stake going in
      if (grow < 1) {
        noStroke();
        const puff = 1 - grow;
        fill(190, 200, 160, 130 * puff);
        for (let i = 0; i < 5; i++) {
          const a = (TWO_PI * i) / 5;
          const d = grow * 22;
          circle(cos(a) * d, sin(a) * d * 0.45 + 6, 7 * puff + 2);
        }
        // the ground ring of the impact
        noFill();
        stroke(200, 235, 120, 180 * puff);
        strokeWeight(2);
        ellipse(0, 6, 60 * grow, 24 * grow);
      }

      // shadow under it, so the totem is standing on the floor and not hovering
      noStroke();
      fill(20, 30, 15, 90 * planted);
      ellipse(0, h * 0.42, w * 1.5, w * 0.55);

      // the slow "I am awake" ring. Faint on purpose: it must be findable when
      // you go looking for it and invisible when you are not.
      const pulse = (this.age % PULSE_INTERVAL_MS) / PULSE_INTERVAL_MS;
      if (planted > 0.9) {
        noFill();
        stroke(190, 245, 90, 70 * (1 - pulse) * life);
        strokeWeight(2);
        ellipse(0, h * 0.42, 130 * pulse, 52 * pulse);
      }

      // the stake: two tapered legs of dark wood driven into the ground
      stroke(46, 40, 26, 235 * planted);
      strokeWeight(3);
      line(-w * 0.28, h * 0.42, -w * 0.12, -h * 0.12);
      line(w * 0.28, h * 0.42, w * 0.12, -h * 0.12);
      // a binding across them, the detail that makes it a totem and not a post
      strokeWeight(2.5);
      line(-w * 0.34, h * 0.06, w * 0.34, h * 0.06);

      // the husk holding the eye
      noStroke();
      fill(58, 74, 34, 240 * planted);
      ellipse(0, -h * 0.3, w * 1.25, h * 0.85);
      fill(86, 112, 46, 240 * planted);
      ellipse(0, -h * 0.32, w * 0.95, h * 0.68);

      // glow around the eye — additive so it lifts off the ground it sits on
      blendMode(ADD);
      fill(180, 240, 60, 70 * open * life * planted);
      circle(0, -h * 0.32, w * 2.6);
      blendMode(BLEND);

      // the eye. The lid closes vertically, which is the one bit of motion that
      // makes this read as watching rather than as a glowing pebble.
      const eyeH = h * 0.42 * open;
      fill(238, 255, 170, 250 * planted);
      ellipse(0, -h * 0.32, w * 0.8, eyeH);
      fill(120, 190, 40, 250 * planted * life);
      ellipse(0, -h * 0.32, w * 0.5, eyeH * 0.72);
      fill(18, 34, 10, 250 * planted);
      ellipse(0, -h * 0.32, w * 0.2, eyeH * 0.6);
      // a highlight, so the eye is wet
      fill(255, 255, 255, 220 * open * planted);
      circle(-w * 0.14, -h * 0.4, w * 0.16);

      pop();
    }

    getDisplayBoundingBox() {
      // the awake-ring is the widest thing painted, and the totem stands *up*
      // from its position, so the box is not centred on the origin
      const r = 80;
      return new Rectangle({
        x: this.position.x - r,
        y: this.position.y - r - WARD_HEIGHT,
        w: r * 2,
        h: r * 2 + WARD_HEIGHT,
        data: this,
      });
    }
  }
  return StealthWard_Object;
}
const __cacheStealthWard_Object = new WeakMap<ContentApi, ReturnType<typeof __buildStealthWard_Object>>();
export function makeStealthWard_Object(api: ContentApi) {
  const cached = __cacheStealthWard_Object.get(api);
  if (cached) return cached;
  const built = __buildStealthWard_Object(api);
  __cacheStealthWard_Object.set(api, built);
  return built;
}