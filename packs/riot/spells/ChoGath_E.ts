import type { ContentApi } from '@moba2d/core/content/ContentApi';

type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type ChoGath_E = InstanceType<ReturnType<typeof makeChoGath_E>>;
type ChoGath_E_Gore = InstanceType<ReturnType<typeof makeChoGath_E_Gore>>;
type ChoGath_E_Object = InstanceType<ReturnType<typeof makeChoGath_E_Object>>;



function __buildChoGath_E(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const ChoGath_E_Object = makeChoGath_E_Object(api);
  class ChoGath_E extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_chogath_e');
    name = "Phóng Gai (Cho'Gath_E)";
    description =
      'Phóng một chùm gai xương <span>xuyên qua mọi kẻ địch</span> trên đường bay, gây <span class="damage">12 sát thương</span> và khiến chúng <span class="buff">Chảy Máu</span> <span class="damage">4 sát thương</span> mỗi <span class="time">0.5 giây</span> trong <span class="time">3 giây</span>';
    coolDown = 6000;
    manaCost = 20;

    range = 550;

    onSpellCast() {
      const { from, to } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        this.range
      );

      const obj = new ChoGath_E_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      obj.direction = p5.Vector.sub(to, from).normalize();
      this.game.objectManager.addObject(obj);
    }
  }
  return ChoGath_E;
}
const __cacheChoGath_E = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_E>>();
export default function makeChoGath_E(api: ContentApi) {
  const cached = __cacheChoGath_E.get(api);
  if (cached) return cached;
  const built = __buildChoGath_E(api);
  __cacheChoGath_E.set(api, built);
  return built;
}


function __buildChoGath_E_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const DamageOverTime = api.buffs.DamageOverTime;
  const TrailSystem = api.helpers.TrailSystem;
  const ChoGath_E_Gore = makeChoGath_E_Gore(api);
  class ChoGath_E_Object extends MissileSpellObject {
    speed = 12;
    size = 26;
    damage = 12;
    // a wall of spikes: it goes through everyone and only stops at max range
    maxHitCount = Infinity;

    bleedDuration = 3000;
    bleedDamagePerTick = 4;
    bleedTickInterval = 500;

    trailSystem = new TrailSystem({
      maxLength: 10,
      trailSize: this.size * 0.8,
      trailColor: '#D9C7A044',
    });

    /** Cosmetic: the spikes rattle as the cluster flies. */
    _shake = random(TWO_PI);

    onAfterMove() {
      this._shake += 0.4;
    }

    onHit(enemy: any) {
      enemy.takeDamage(this.damage, this.owner);

      const bleed = new DamageOverTime(this.bleedDuration, this.owner, enemy);
      bleed.stackId = 'chogath_e_bleed';
      bleed.damagePerTick = this.bleedDamagePerTick;
      bleed.tickInterval = this.bleedTickInterval;
      bleed.flameColor = [235, 120, 150]; // reads as a bleed rather than a burn
      bleed.image = api.asset('spell_chogath_e');
      enemy.addBuff(bleed);

      // the spikes pierce on through, so the hit needs its own splatter
      const gore = new ChoGath_E_Gore(this.owner);
      gore.position = enemy.position.copy();
      gore.angle = this.direction.heading();
      gore.targetSize = enemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(gore);
    }

    draw() {
      push();
      translate(this.position.x, this.position.y);
      rotate(this.direction.heading());

      // bone dust dragged along behind the cluster
      noStroke();
      for (let i = 0; i < 3; i++) {
        fill(200, 185, 150, 60 - i * 15);
        circle(-this.size * (0.7 + i * 0.45), sin(this._shake + i) * 4, this.size * (0.5 - i * 0.1));
      }

      // three staggered bone spikes so the volley reads as a cluster
      for (let i = -1; i <= 1; i++) {
        const offset = i * (this.size / 2.4) + sin(this._shake + i * 2) * 1.5;
        const len = this.size * (i === 0 ? 1.35 : 0.95);
        const w = this.size / (i === 0 ? 4 : 5);

        // dark outline keeps the bone readable on pale ground
        stroke(70, 55, 40, 220);
        strokeWeight(2);
        fill(240, 233, 210, 245);
        beginShape();
        vertex(len, offset);
        vertex(-len * 0.55, offset - w);
        vertex(-len * 0.3, offset);
        vertex(-len * 0.55, offset + w);
        endShape(CLOSE);

        // shaded underside
        noStroke();
        fill(165, 148, 120, 210);
        triangle(len * 0.55, offset, -len * 0.55, offset, -len * 0.55, offset + w);

        // wet tip
        fill(190, 70, 85, 200);
        triangle(len, offset, len * 0.55, offset - w * 0.4, len * 0.55, offset + w * 0.4);
      }
      pop();
    }

    // the cluster draws well past its 26px hitbox
    getDisplayBoundingBox() {
      const r = this.size * 1.8;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return ChoGath_E_Object;
}
const __cacheChoGath_E_Object = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_E_Object>>();
export function makeChoGath_E_Object(api: ContentApi) {
  const cached = __cacheChoGath_E_Object.get(api);
  if (cached) return cached;
  const built = __buildChoGath_E_Object(api);
  __cacheChoGath_E_Object.set(api, built);
  return built;
}


/** Bone chips and blood where the spikes went through someone. */
function __buildChoGath_E_Gore(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class ChoGath_E_Gore extends SpellObject {
    angle = 0;
    targetSize = 40;
    age = 0;
    lifeTime = 420;

    _bits: { a: number; speed: number; size: number; spin: number }[] = [];

    onAdded() {
      for (let i = 0; i < 7; i++) {
        this._bits.push({
          a: this.angle + random(-0.9, 0.9),
          speed: random(0.5, 1.4),
          size: random(4, 9),
          spin: random(-0.3, 0.3),
        });
      }
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;

      push();
      translate(this.position.x, this.position.y);

      // impact ring marking who the spikes went through
      noFill();
      stroke(200, 80, 95, 200 * fade);
      strokeWeight(4 * fade + 1);
      circle(0, 0, this.targetSize * 0.6 + 55 * t);

      // spray of blood, thrown along the spike line
      noStroke();
      for (const b of this._bits) {
        const d = 6 + 50 * t * b.speed;
        fill(175, 45, 60, 220 * fade);
        circle(cos(b.a) * d, sin(b.a) * d, b.size * fade + 1.5);
      }

      // a couple of bone chips tumbling out
      stroke(60, 48, 36, 200 * fade);
      strokeWeight(1.5);
      fill(235, 228, 205, 235 * fade);
      for (let i = 0; i < this._bits.length; i += 3) {
        const b = this._bits[i];
        const d = 10 + 44 * t * b.speed;
        push();
        translate(cos(b.a) * d, sin(b.a) * d);
        rotate(b.a + t * b.spin * 12);
        triangle(6, 0, -4, -3, -4, 3);
        pop();
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + 60;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return ChoGath_E_Gore;
}
const __cacheChoGath_E_Gore = new WeakMap<ContentApi, ReturnType<typeof __buildChoGath_E_Gore>>();
export function makeChoGath_E_Gore(api: ContentApi) {
  const cached = __cacheChoGath_E_Gore.get(api);
  if (cached) return cached;
  const built = __buildChoGath_E_Gore(api);
  __cacheChoGath_E_Gore.set(api, built);
  return built;
}