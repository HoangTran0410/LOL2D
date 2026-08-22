import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Invisible = InstanceType<ContentApi['buffs']['Invisible']>;
type Phasing = InstanceType<ContentApi['buffs']['Phasing']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Speedup = InstanceType<ContentApi['buffs']['Speedup']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Twitch_Q = InstanceType<ReturnType<typeof makeTwitch_Q>>;
type Twitch_Q_Object = InstanceType<ReturnType<typeof makeTwitch_Q_Object>>;



function __buildTwitch_Q(api: ContentApi) {
  const Spell = api.Spell;
  const Invisible = api.buffs.Invisible;
  const Speedup = api.buffs.Speedup;
  const Phasing = api.buffs.Phasing;
  const Twitch_Q_Object = makeTwitch_Q_Object(api);
  class Twitch_Q extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_twitch_q');
    name = 'Đột Kích (Twitch_Q)';
    description =
      '<span class="buff">Tàng Hình</span> và <span class="buff">Tăng Tốc 25%</span> trong <span class="time">4 giây</span>';
    coolDown = 6000;
    manaCost = 40;

    duration = 4000;
    speedupPercent = 0.25;

    onSpellCast() {
      const invisibleBuff = new Invisible(this.duration, this.owner, this.owner);
      invisibleBuff.image = this.image;
      this.owner.addBuff(invisibleBuff);

      // A rat slipping through the wave rather than bouncing off it. Stealth that
      // still gets body-blocked by the thing it is hiding from is not stealth.
      const phase = new Phasing(this.duration, this.owner, this.owner);
      phase.image = this.image;
      this.owner.addBuff(phase);

      const speedupBuff = new Speedup(this.duration, this.owner, this.owner);
      speedupBuff.image = this.image;
      speedupBuff.percent = this.speedupPercent;
      this.owner.addBuff(speedupBuff);

      const obj = new Twitch_Q_Object(this.owner);
      obj.attachTo(this.owner, invisibleBuff);
      this.game.objectManager.addObject(obj);
    }
  }
  return Twitch_Q;
}
const __cacheTwitch_Q = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_Q>>();
export default function makeTwitch_Q(api: ContentApi) {
  const cached = __cacheTwitch_Q.get(api);
  if (cached) return cached;
  const built = __buildTwitch_Q(api);
  __cacheTwitch_Q.set(api, built);
  return built;
}


/**
 * The puff of smoke Twitch vanishes into, and then the faint outline that keeps
 * a nearly transparent champion findable for his own team. It follows the
 * stealth buff rather than a clock of its own, so it can never linger after the
 * stealth is gone.
 */
function __buildTwitch_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Twitch_Q_Object extends SpellObject {
    position = this.owner.position.copy();
    age = 0;
    lifeTime = 500;
    maxRadius = 55;

    /** Cosmetic: motes of dust disturbed by the cloaked body. */
    _motes: { a: number; r: number; age: number; size: number }[] = [];
    _moteTimer = 0;

    /**
     * The cloak is drawn while the attachment holds — Twitch alive and the
     * stealth buff still ticking. It is not `dropIfAttachmentLost()` because the
     * smoke puff left at the vanish spot has to finish fading first; update()
     * below removes the object once nothing is left to draw.
     */
    get _cloaked(): boolean {
      return !!this._anchorBuff && !this.attachmentLost;
    }

    update() {
      this.age += deltaTime;

      if (this._cloaked) {
        this._moteTimer += deltaTime;
        if (this._moteTimer >= 110 && this._motes.length < 10) {
          this._moteTimer = 0;
          this._motes.push({
            a: random(TWO_PI),
            r: this.owner.animatedValues.displaySize / 2 + random(-4, 10),
            age: 0,
            size: random(3, 6),
          });
        }
      }

      let i = 0;
      while (i < this._motes.length) {
        const m = this._motes[i];
        m.age += deltaTime;
        if (m.age >= 600) this._motes.splice(i, 1);
        else i++;
      }

      // the smoke has cleared and the stealth is over: nothing left to draw
      if (this.age >= this.lifeTime && !this._cloaked && this._motes.length === 0) {
        this.toRemove = true;
      }
    }

    draw() {
      if (this.age < this.lifeTime) this._drawSmoke();
      if (this._cloaked || this._motes.length > 0) this._drawCloak();
    }

    /** The vanish itself, left behind at the spot he disappeared from. */
    _drawSmoke() {
      const progress = this.age / this.lifeTime;
      const alpha = map(this.age, 0, this.lifeTime, 190, 0);

      push();
      translate(this.position.x, this.position.y);
      noStroke();
      for (let i = 0; i < 7; i++) {
        const angle = (i * TWO_PI) / 7 + progress * 0.8;
        const distance = progress * this.maxRadius * (0.6 + (i % 3) * 0.2);
        fill(110, 150, 100, alpha * (0.5 + 0.5 * (i % 2 === 0 ? 1 : 0.6)));
        circle(cos(angle) * distance, sin(angle) * distance, 22 + progress * 26 + (i % 3) * 5);
      }
      // a darker heart to the cloud so it does not read as a flat green disc
      fill(60, 85, 55, alpha * 0.8);
      circle(0, 0, 26 + progress * 20);
      pop();
    }

    /** Where the invisible Twitch actually is — deliberately faint. */
    _drawCloak() {
      const pos = this.owner.position;
      const size = this.owner.animatedValues.displaySize;
      const stealthBuff = this._anchorBuff;
      const left =
        stealthBuff && stealthBuff.duration
          ? constrain(1 - stealthBuff.timeElapsed / stealthBuff.duration, 0, 1)
          : 0;

      push();
      translate(pos.x, pos.y);

      // disturbed dust drifting off the cloaked body
      noStroke();
      for (const m of this._motes) {
        const t = m.age / 600;
        fill(150, 190, 140, 110 * (1 - t));
        circle(cos(m.a) * (m.r + t * 10), sin(m.a) * (m.r + t * 10) - t * 8, m.size * (1 - t * 0.5));
      }

      if (!this._cloaked) {
        pop();
        return;
      }

      // a broken outline: enough to track him, not enough to give him away
      noFill();
      stroke(150, 200, 140, 90);
      strokeWeight(2);
      const segs = 7;
      for (let i = 0; i < segs; i++) {
        const a = (i * TWO_PI) / segs + frameCount / 90;
        arc(0, 0, size + 6, size + 6, a, a + 0.42);
      }

      // how much of the stealth is left
      stroke(180, 225, 160, 150);
      strokeWeight(2);
      arc(0, 0, size + 20, size + 20, -HALF_PI, -HALF_PI + TWO_PI * left);
      pop();
    }

    getDisplayBoundingBox() {
      // covers both the smoke left behind and Twitch himself, wherever he has got to
      const minX = Math.min(this.position.x, this.owner.position.x) - this.maxRadius - 30;
      const minY = Math.min(this.position.y, this.owner.position.y) - this.maxRadius - 30;
      return new Rectangle({
        x: minX,
        y: minY,
        w: Math.abs(this.position.x - this.owner.position.x) + (this.maxRadius + 30) * 2,
        h: Math.abs(this.position.y - this.owner.position.y) + (this.maxRadius + 30) * 2,
        data: this,
      });
    }
  }
  return Twitch_Q_Object;
}
const __cacheTwitch_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildTwitch_Q_Object>>();
export function makeTwitch_Q_Object(api: ContentApi) {
  const cached = __cacheTwitch_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildTwitch_Q_Object(api);
  __cacheTwitch_Q_Object.set(api, built);
  return built;
}