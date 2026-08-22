import type { ContentApi } from '@moba2d/core/content/ContentApi';

type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Nearsight = InstanceType<ContentApi['buffs']['Nearsight']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type Teemo_Q = InstanceType<ReturnType<typeof makeTeemo_Q>>;
type Teemo_Q_Object = InstanceType<ReturnType<typeof makeTeemo_Q_Object>>;
type Teemo_Q_Puff = InstanceType<ReturnType<typeof makeTeemo_Q_Puff>>;



function __buildTeemo_Q(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Teemo_Q_Object = makeTeemo_Q_Object(api);
  class Teemo_Q extends Spell {
    targetingMode = 'DIRECTION' as const;
    image = api.asset('spell_teemo_q');
    name = 'Phi Tiêu Mù (Teemo_Q)';
    description =
      'Phóng một phi tiêu tẩm độc về hướng chỉ định, gây <span class="damage">20 sát thương</span> và <span class="buff">Mờ Mắt</span> kẻ địch đầu tiên trúng phải trong <span class="time">2 giây</span>';
    coolDown = 5000;
    manaCost = 20;

    range = 400;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithRange(this.owner.position, this.aimPoint, this.range);

      const obj = new Teemo_Q_Object(this.owner);
      obj.destination = to;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.range);
    }
  }
  return Teemo_Q;
}
const __cacheTeemo_Q = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_Q>>();
export default function makeTeemo_Q(api: ContentApi) {
  const cached = __cacheTeemo_Q.get(api);
  if (cached) return cached;
  const built = __buildTeemo_Q(api);
  __cacheTeemo_Q.set(api, built);
  return built;
}


function __buildTeemo_Q_Object(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const Nearsight = api.buffs.Nearsight;
  const TrailSystem = api.helpers.TrailSystem;
  const Teemo_Q_Puff = makeTeemo_Q_Puff(api);
  class Teemo_Q_Object extends MissileSpellObject {
    speed = 10;
    size = 18;
    damage = 20;
    blindTime = 2000;
    newVisionRadius = 60;

    // a single-target dart: it sticks in the first thing it touches
    maxHitCount = 1;

    /** Cosmetic: the dart spirals as it flies. */
    _roll = 0;

    trailSystem = new TrailSystem({
      trailSize: this.size / 2,
      trailColor: '#9BF06066',
      maxLength: 14,
    });

    onAfterMove() {
      this._roll += 0.5;
    }

    onHit(enemy: any) {
      enemy.takeDamage(this.damage, this.owner);

      const blindBuff = new Nearsight(this.blindTime, this.owner, enemy);
      blindBuff.newVisionRadius = this.newVisionRadius;
      enemy.addBuff(blindBuff);

      // the dart vanishes on impact, so the poison burst is its own object
      const puff = new Teemo_Q_Puff(this.owner);
      puff.position = enemy.position.copy();
      puff.targetSize = enemy.animatedValues?.displaySize ?? 40;
      this.game.objectManager.addObject(puff);
    }

    draw() {
      // atan2 rather than a vector copy: this runs every frame
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const s = this.size;
      // the fletching spins around the shaft, so short flights still read
      const roll = Math.abs(cos(this._roll)) * 0.75 + 0.25;

      push();
      translate(this.position.x, this.position.y);

      // poison mist dripping off the tip
      noStroke();
      for (let i = 0; i < 3; i++) {
        fill(150, 230, 90, 70 - i * 20);
        circle(
          -cos(angle) * (s * 0.9 + i * 7) + random(-1.5, 1.5),
          -sin(angle) * (s * 0.9 + i * 7) + random(-1.5, 1.5),
          7 - i * 1.5
        );
      }

      rotate(angle);

      // shaft with a dark core so it does not disappear over grass
      stroke(35, 55, 25, 230);
      strokeWeight(5);
      line(-s, 0, s * 0.5, 0);
      stroke(120, 175, 85, 240);
      strokeWeight(2.5);
      line(-s, 0, s * 0.5, 0);

      // fletching, squashed by the roll
      noStroke();
      fill(90, 160, 70, 240);
      triangle(-s, 0, -s / 2.6, (-s / 2.4) * roll, -s / 3, 0);
      fill(70, 130, 55, 240);
      triangle(-s, 0, -s / 2.6, (s / 2.4) * roll, -s / 3, 0);

      // venom-soaked head, glowing
      blendMode(ADD);
      noStroke();
      fill(110, 255, 80, 110);
      circle(s * 0.85, 0, s * 1.9);
      fill(180, 255, 140, 90);
      circle(s * 0.85, 0, s);
      blendMode(BLEND);

      stroke(35, 65, 20, 235);
      strokeWeight(2);
      fill(190, 255, 120, 255);
      beginShape();
      vertex(s * 1.45, 0);
      vertex(s * 0.3, -s * 0.44);
      vertex(s * 0.6, 0);
      vertex(s * 0.3, s * 0.44);
      endShape(CLOSE);

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.size * 2.2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Teemo_Q_Object;
}
const __cacheTeemo_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_Q_Object>>();
export function makeTeemo_Q_Object(api: ContentApi) {
  const cached = __cacheTeemo_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildTeemo_Q_Object(api);
  __cacheTeemo_Q_Object.set(api, built);
  return built;
}


/** Poison bursting in the victim's face — the blind landing. */
function __buildTeemo_Q_Puff(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Teemo_Q_Puff extends SpellObject {
    targetSize = 40;
    age = 0;
    lifeTime = 620;
    maxRadius = 46;

    _blobs: { a: number; d: number; size: number; drift: number }[] = [];

    onAdded() {
      for (let i = 0; i < 7; i++) {
        this._blobs.push({
          a: random(TWO_PI),
          d: random(0.4, 1),
          size: random(12, 22),
          drift: random(-0.4, 0.4),
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

      // cloud of gas
      noStroke();
      for (const b of this._blobs) {
        const a = b.a + t * b.drift;
        const d = this.maxRadius * t * b.d;
        fill(110, 200, 70, 175 * fade);
        circle(cos(a) * d, sin(a) * d, b.size * (0.9 + t * 1.3));
      }
      fill(70, 150, 45, 150 * fade);
      circle(0, 0, this.targetSize * (0.7 + t * 0.5));

      // ring pinning down who is blinded
      noFill();
      stroke(180, 250, 120, 220 * fade);
      strokeWeight(3 * fade + 1);
      circle(0, 0, this.targetSize * 0.7 + this.maxRadius * 1.5 * t);

      // dark specks swimming over the victim's eyes
      noStroke();
      fill(30, 60, 20, 200 * fade);
      for (let i = 0; i < 5; i++) {
        const a = (i * TWO_PI) / 5 + t * 4;
        const r = this.targetSize * 0.35;
        circle(cos(a) * r, sin(a) * r * 0.6 - this.targetSize * 0.15, 4);
      }
      pop();
    }

    getDisplayBoundingBox() {
      const r = this.targetSize + this.maxRadius * 2;
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Teemo_Q_Puff;
}
const __cacheTeemo_Q_Puff = new WeakMap<ContentApi, ReturnType<typeof __buildTeemo_Q_Puff>>();
export function makeTeemo_Q_Puff(api: ContentApi) {
  const cached = __cacheTeemo_Q_Puff.get(api);
  if (cached) return cached;
  const built = __buildTeemo_Q_Puff(api);
  __cacheTeemo_Q_Puff.set(api, built);
  return built;
}