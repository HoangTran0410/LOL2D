import type { ContentApi } from '@moba2d/core/content/ContentApi';

type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Ground = InstanceType<ContentApi['buffs']['Ground']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Singed_W = InstanceType<ReturnType<typeof makeSinged_W>>;
type Singed_W_Object = InstanceType<ReturnType<typeof makeSinged_W_Object>>;



/**
 * Mega Adhesive. Pure crowd control: it deals NO damage whatsoever — the
 * poison trail people associate with Singed is his Q, a different ability.
 * The puddle heavily slows and GROUNDS everyone standing in it, so nobody
 * dashes or blinks their way out of the glue.
 */
function __buildSinged_W(api: ContentApi) {
  const VectorUtils = api.utils.VectorUtils;
  const Spell = api.Spell;
  const Singed_W_Object = makeSinged_W_Object(api);
  class Singed_W extends Spell {
    targetingMode = 'POINT' as const;
    image = api.asset('spell_singed_w');
    name = 'Keo Siêu Dính (Singed_W)';
    description =
      'Đổ một vũng keo dính xuống khu vực chỉ định, tồn tại trong <span class="time">5 giây</span>. Chiêu này <b>không gây bất kỳ sát thương nào</b>. Kẻ địch đứng trong vũng keo bị <span class="buff">Làm Chậm 60%</span> và bị <span class="buff">Ghìm</span> — vẫn đi được nhưng không thể dùng kỹ năng lướt hay dịch chuyển để thoát ra';
    coolDown = 8000;
    manaCost = 30;

    castRange = 350;
    radius = 130;
    duration = 5000;

    onSpellCast() {
      const { to } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.aimPoint,
        this.castRange
      );

      const obj = new Singed_W_Object(this.owner);
      obj.position = to;
      obj.radius = this.radius;
      obj.lifeTime = this.duration;
      this.game.objectManager.addObject(obj);
    }

    drawPreview() {
      super.drawPreview(this.castRange);
    }
  }
  return Singed_W;
}
const __cacheSinged_W = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_W>>();
export default function makeSinged_W(api: ContentApi) {
  const cached = __cacheSinged_W.get(api);
  if (cached) return cached;
  const built = __buildSinged_W(api);
  __cacheSinged_W.set(api, built);
  return built;
}


interface GlueBlob {
  offsetX: number;
  offsetY: number;
  size: number;
  age: number;
  lifeTime: number;
  /** Blobs sag rather than rise: this is glue, not gas. */
  sagSpeed: number;
}


const BLOB_SPAWN_INTERVAL = 120;

const MAX_BLOBS = 18;

const EDGE_SEGMENTS = 24;


function __buildSinged_W_Object(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const BuffAddType = api.enums.BuffAddType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellObject = api.SpellObject;
  const Ground = api.buffs.Ground;
  const Slow = api.buffs.Slow;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Singed_W_Object extends SpellObject {
    image = api.asset('spell_singed_w');
    position: p5.Vector = this.owner.position.copy();

    /**
     * Painted with the other ground effects, under the units standing in it —
     * a puddle you can see your own champion's feet in reads as a puddle.
     */
    zIndex = GROUND_Z_INDEX;

    radius = 130;
    lifeTime = 5000;
    age = 0;
    fadeTime = 400;

    slowPercent = 0.6;
    /** Both debuffs linger a beat after stepping out, like the real ability. */
    debuffLinger = 250;
    /** Buffs are refreshed on a tick instead of every frame to avoid per-frame garbage. */
    reapplyInterval = 200;

    _timeSinceReapply = this.reapplyInterval; // so the glue bites the very first frame
    _blobs: GlueBlob[] = [];
    _timeSinceBlobSpawn = 0;

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) {
        this.toRemove = true;
        return;
      }

      this._timeSinceReapply += deltaTime;
      if (this._timeSinceReapply >= this.reapplyInterval) {
        this._timeSinceReapply = 0;
        this._glueEnemiesInside();
      }

      this._updateBlobs();
    }

    _glueEnemiesInside() {
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.radius,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      // outlives one reapply tick, so neither debuff flickers off between ticks
      const buffDuration = this.reapplyInterval + this.debuffLinger;

      enemies.forEach((enemy: any) => {
        const slowBuff = new Slow(buffDuration, this.owner, enemy);
        slowBuff.image = this.image;
        slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
        slowBuff.percent = this.slowPercent;
        enemy.addBuff(slowBuff);

        // the point of the ability: no damage, just no way to dash out of it
        const groundBuff = new Ground(buffDuration, this.owner, enemy);
        groundBuff.image = this.image;
        enemy.addBuff(groundBuff);
      });
    }

    _updateBlobs() {
      this._timeSinceBlobSpawn += deltaTime;
      while (this._timeSinceBlobSpawn >= BLOB_SPAWN_INTERVAL && this._blobs.length < MAX_BLOBS) {
        this._timeSinceBlobSpawn -= BLOB_SPAWN_INTERVAL;

        const angle = random(TWO_PI);
        const distance = random(this.radius * 0.9);
        this._blobs.push({
          offsetX: cos(angle) * distance,
          offsetY: sin(angle) * distance,
          sagSpeed: random(0.02, 0.09),
          size: random(10, 24),
          age: 0,
          lifeTime: random(700, 1400),
        });
      }
      if (this._timeSinceBlobSpawn > BLOB_SPAWN_INTERVAL) this._timeSinceBlobSpawn = 0;

      let i = 0;
      while (i < this._blobs.length) {
        const blob = this._blobs[i];
        blob.age += deltaTime;

        if (blob.age >= blob.lifeTime) {
          this._blobs.splice(i, 1);
          continue;
        }

        blob.offsetY += blob.sagSpeed;
        i++;
      }
    }

    _getOpacity() {
      if (this.age < 200) return this.age / 200;
      if (this.age > this.lifeTime - this.fadeTime) {
        return map(this.age, this.lifeTime - this.fadeTime, this.lifeTime, 1, 0);
      }
      return 1;
    }

    draw() {
      const opacity = this._getOpacity();
      const left = constrain(1 - this.age / this.lifeTime, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // the body of the glue: an uneven, gloopy outline rather than a clean disc
      const edge: number[] = [];
      for (let i = 0; i < EDGE_SEGMENTS; i++) {
        edge.push(1 + 0.06 * sin(this.age / 320 + i * 1.7) + 0.03 * sin(i * 3.1));
      }

      // dark rim under the glue so the boundary survives on pale ground
      stroke(70, 45, 5, 200 * opacity);
      strokeWeight(7);
      fill(150, 110, 25, 150 * opacity);
      beginShape();
      for (let i = 0; i < EDGE_SEGMENTS; i++) {
        const angle = (TWO_PI * i) / EDGE_SEGMENTS;
        vertex(cos(angle) * this.radius * edge[i], sin(angle) * this.radius * edge[i]);
      }
      endShape(CLOSE);

      // bright meniscus on the inside of that rim: this is where "inside" starts
      noFill();
      stroke(255, 220, 110, 235 * opacity);
      strokeWeight(3.5);
      beginShape();
      for (let i = 0; i < EDGE_SEGMENTS; i++) {
        const angle = (TWO_PI * i) / EDGE_SEGMENTS;
        vertex(cos(angle) * this.radius * edge[i], sin(angle) * this.radius * edge[i]);
      }
      endShape(CLOSE);

      // how much longer the glue holds, read straight off its rim
      stroke(255, 245, 200, 200 * opacity);
      strokeWeight(5);
      arc(0, 0, this.radius * 2 + 12, this.radius * 2 + 12, -HALF_PI, -HALF_PI + TWO_PI * left);

      // slow, viscous blobs sagging inside the puddle
      noStroke();
      for (const blob of this._blobs) {
        const t = blob.age / blob.lifeTime;
        const size = blob.size * (1 - t * 0.4);
        fill(120, 85, 15, 130 * (1 - t) * opacity);
        circle(blob.offsetX, blob.offsetY + 2, size);
        fill(245, 205, 95, 170 * (1 - t) * opacity);
        circle(blob.offsetX, blob.offsetY, size);
        // highlight, so each blob reads as a wet bubble and not a flat dot
        fill(255, 245, 200, 150 * (1 - t) * opacity);
        circle(blob.offsetX - size * 0.2, blob.offsetY - size * 0.22, size * 0.32);
      }

      // sticky strands stretched between the middle and the rim
      noFill();
      stroke(255, 235, 165, 130 * opacity);
      strokeWeight(2.5);
      for (let i = 0; i < 7; i++) {
        const a = (TWO_PI * i) / 7 + this.age / 1400;
        const sag = sin(this.age / 500 + i) * 0.12;
        beginShape();
        vertex(cos(a) * this.radius * 0.15, sin(a) * this.radius * 0.15);
        vertex(cos(a + sag) * this.radius * 0.55, sin(a + sag) * this.radius * 0.55);
        vertex(cos(a) * this.radius * 0.95, sin(a) * this.radius * 0.95);
        endShape();
      }

      pop();
    }

    getDisplayBoundingBox() {
      const r = this.radius + 20; // the duration arc sits outside the rim
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Singed_W_Object;
}
const __cacheSinged_W_Object = new WeakMap<ContentApi, ReturnType<typeof __buildSinged_W_Object>>();
export function makeSinged_W_Object(api: ContentApi) {
  const cached = __cacheSinged_W_Object.get(api);
  if (cached) return cached;
  const built = __buildSinged_W_Object(api);
  __cacheSinged_W_Object.set(api, built);
  return built;
}