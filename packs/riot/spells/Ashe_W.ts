import type { ContentApi } from '@moba2d/core/content/ContentApi';

type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Ashe_W = InstanceType<ReturnType<typeof makeAshe_W>>;
type Ashe_W_Frost = InstanceType<ReturnType<typeof makeAshe_W_Frost>>;
type Ashe_W_Object = InstanceType<ReturnType<typeof makeAshe_W_Object>>;



/** Windup: each needle draws itself out of the bow rather than blinking in. */
export const NEEDLE_SPAWN_MS = 90;

/** How long the frost left on a struck body stays up. */
export const FROST_MS = 300;

/** Spikes in the little rosette a needle leaves. Kept low: fifteen can land. */
export const FROST_SPIKES = 5;


function __buildAshe_W(api: ContentApi) {
  const Spell = api.Spell;
  const VectorUtils = api.utils.VectorUtils;
  const Ashe_W_Object = makeAshe_W_Object(api);
  class Ashe_W extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_ashe_w');
    name = 'Tán Xạ Tiễn (Ashe_W)';
    description =
      'Bắn ra <span>10 mũi tên</span> theo hình nón. Mỗi mũi tên gây <span class="damage">5 sát thương</span> và <span class="buff">Làm Chậm 75%</span> kẻ địch trúng chiêu trong <span class="time">1.5 giây</span>';
    coolDown = 5000;
    manaCost = 30;

    onSpellCast() {
      let mouse = this.aimPoint;
      let direction = mouse.sub(this.owner.position).normalize();

      let arrowCount = 15;
      let arrowLength = 500;
      let angle = direction.heading();
      let angleStep = Math.PI / (arrowCount * 2);

      for (let i = 0; i < arrowCount; i++) {
        let _angle = angle - (angleStep * arrowCount) / 2 + angleStep * i;
        let { from, to } = VectorUtils.getVectorWithAngleAndRange(
          this.owner.position,
          _angle,
          arrowLength
        );

        let obj = new Ashe_W_Object(this.owner);
        obj.position = from;
        obj.destination = to;
        obj.direction = p5.Vector.fromAngle(_angle);
        // cosmetic only: the outer needles take longer to draw themselves out, so
        // the fan opens from the middle instead of appearing on one frame. It
        // stretches the windup rather than delaying it — a needle that is dark
        // for its first frames would deal its damage invisibly.
        obj.spawnStretch = Math.abs(i - (arrowCount - 1) / 2) * 14;

        this.game.objectManager.addObject(obj);
      }
    }
  }
  return Ashe_W;
}
const __cacheAshe_W = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_W>>();
export default function makeAshe_W(api: ContentApi) {
  const cached = __cacheAshe_W.get(api);
  if (cached) return cached;
  const built = __buildAshe_W(api);
  __cacheAshe_W.set(api, built);
  return built;
}


function __buildAshe_W_Object(api: ContentApi) {
  const BuffAddType = api.enums.BuffAddType;
  const MissileSpellObject = api.MissileSpellObject;
  const Slow = api.buffs.Slow;
  const TrailSystem = api.helpers.TrailSystem;
  const Ashe_W_Frost = makeAshe_W_Frost(api);
  class Ashe_W_Object extends MissileSpellObject {
    speed = 7;
    size = 10;
    maxHitCount = 1;

    trailSystem = new TrailSystem({
      maxLength: 10,
      trailSize: this.size * 0.5,
      trailColor: '#A8DFFF44',
    });

    /** Cosmetic: extra ms added to this needle's windup, so the fan opens outward. */
    spawnStretch = 0;
    /** Cosmetic: drives the draw-out and the sparkle. */
    _age = 0;

    onAfterMove() {
      this._age += deltaTime;
    }

    onArrive() {
      // cut the trail immediately rather than letting it fade out on its own
      if (this.trailSystem) this.trailSystem.toRemove = true;
    }

    onHit(enemy: any) {
      let slowBuff = new Slow(1500, this.owner, enemy);
      slowBuff.percent = 0.75;
      slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      enemy.addBuff(slowBuff);
      enemy.takeDamage(5, this.owner);

      // a 75% slow is the harshest thing in this spell and the needle vanishes on
      // contact, so the freeze needs its own object or the player never sees what
      // clipped them out of a fifteen-arrow fan
      const frost = new Ashe_W_Frost(this.owner);
      frost.position = enemy.position.copy();
      frost.angle = this.direction.heading();
      frost.targetSize = enemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(frost);
    }

    draw() {
      // ease-out draw-out: the needle grows along its own axis from a point, which
      // is what a shard of ice forming in flight should look like
      const grow = constrain(this._age / (NEEDLE_SPAWN_MS + this.spawnStretch), 0, 1);
      // floored at a third: a needle is dangerous from the frame it exists, so it
      // is never allowed to be too small to see while it is already collidable
      const born = 0.34 + 0.66 * (1 - (1 - grow) * (1 - grow));
      // fades out as it runs to the end of its 500px, so a wall of spent arrows
      // does not hang across the screen at full brightness
      const alpha = Math.min(this.position.dist(this.destination), 200) + 55;
      const len = 26 * born;
      const w = this.size * 0.45;

      push();
      translate(this.position.x, this.position.y);
      rotate(this.direction.heading());

      // cold light around the shaft, additive so the fan reads as one sheet of
      // frost where the needles overlap rather than fifteen separate sprites
      blendMode(ADD);
      noStroke();
      fill(70, 150, 220, alpha * 0.22);
      ellipse(0, 0, len * 2, w * 4);
      blendMode(BLEND);

      // the needle: a faceted shard, dark-edged so it survives pale terrain
      stroke(28, 62, 96, alpha * 0.85);
      strokeWeight(1);
      fill(186, 230, 255, alpha);
      beginShape();
      vertex(len, 0);
      vertex(0, -w);
      vertex(-len * 0.9, 0);
      vertex(0, w);
      endShape(CLOSE);

      // bright facet along the upper edge — the crystalline read in one shape
      noStroke();
      fill(245, 253, 255, alpha);
      triangle(len, 0, 0, -w, -len * 0.5, 0);

      // a hard white barb at the tip, and a spark that travels with it
      fill(255, 255, 255, alpha);
      triangle(len * 1.25, 0, len * 0.55, -w * 0.65, len * 0.55, w * 0.65);
      fill(220, 245, 255, alpha * (0.5 + sin(this._age / 60) * 0.4));
      circle(len * 1.05, 0, 3);

      pop();
    }

    // the shard is far longer than the 10px hitbox
    getDisplayBoundingBox() {
      const r = 34;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ashe_W_Object;
}
const __cacheAshe_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_W_Object>>();
export function makeAshe_W_Object(api: ContentApi) {
  const cached = __cacheAshe_W_Object.get(api);
  if (cached) return cached;
  const built = __buildAshe_W_Object(api);
  __cacheAshe_W_Object.set(api, built);
  return built;
}


/** Frost blooming where a needle went in: a small crystalline rosette. */
function __buildAshe_W_Frost(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Ashe_W_Frost extends SpellObject {
    angle = 0;
    targetSize = 40;
    age = 0;
    lifeTime = FROST_MS;
    maxRadius = 34;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const flash = 1 - constrain(t / 0.3, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      if (flash > 0) {
        blendMode(ADD);
        noStroke();
        fill(190, 235, 255, 140 * flash);
        circle(0, 0, this.targetSize * 0.7 + t * 30);
        blendMode(BLEND);
      }

      // ring on the body: the footprint of the slow that just landed
      noFill();
      stroke(150, 220, 255, 200 * fade);
      strokeWeight(2.5 * fade + 0.8);
      circle(0, 0, this.targetSize * 0.55 + this.maxRadius * t);

      // spikes of ice growing out of the entry point, fanned around the needle's
      // line so the rosette points the way the arrow was travelling
      noStroke();
      fill(226, 247, 255, 235 * fade);
      for (let i = 0; i < FROST_SPIKES; i++) {
        const a = this.angle + (i - (FROST_SPIKES - 1) / 2) * 0.55;
        const d = 4 + this.maxRadius * 0.5 * t;
        const len = (10 + this.maxRadius * 0.35 * t) * fade;
        push();
        translate(cos(a) * d, sin(a) * d);
        rotate(a);
        triangle(len, 0, -len * 0.3, -2.4, -len * 0.3, 2.4);
        pop();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius + 15;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Ashe_W_Frost;
}
const __cacheAshe_W_Frost = new WeakMap<ContentApi, ReturnType<typeof __buildAshe_W_Frost>>();
export function makeAshe_W_Frost(api: ContentApi) {
  const cached = __cacheAshe_W_Frost.get(api);
  if (cached) return cached;
  const built = __buildAshe_W_Frost(api);
  __cacheAshe_W_Frost.set(api, built);
  return built;
}