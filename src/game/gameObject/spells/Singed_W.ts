import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Ground from '../buffs/Ground';
import Slow from '../buffs/Slow';

/**
 * Mega Adhesive. Pure crowd control: it deals NO damage whatsoever — the
 * poison trail people associate with Singed is his Q, a different ability.
 * The puddle heavily slows and GROUNDS everyone standing in it, so nobody
 * dashes or blinks their way out of the glue.
 */
export default class Singed_W extends Spell {
  image = AssetManager.getAsset('spell_singed_w');
  name = 'Keo Dính (Singed_W)';
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
      this.game.worldMouse,
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

export class Singed_W_Object extends SpellObject {
  image = AssetManager.getAsset('spell_singed_w');
  position: p5.Vector = this.owner.position.copy();

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

    push();

    // thick amber glue, deliberately NOT the green of a poison pool
    noStroke();
    fill(190, 150, 40, 90 * opacity);
    beginShape();
    for (let i = 0; i < EDGE_SEGMENTS; i++) {
      const angle = (TWO_PI * i) / EDGE_SEGMENTS;
      const wobble = 1 + 0.05 * sin(this.age / 320 + i * 1.7);
      vertex(
        this.position.x + cos(angle) * this.radius * wobble,
        this.position.y + sin(angle) * this.radius * wobble
      );
    }
    endShape(CLOSE);

    noFill();
    stroke(230, 195, 80, 150 * opacity);
    strokeWeight(3);
    circle(this.position.x, this.position.y, this.radius * 2);

    // slow, viscous blobs sagging inside the puddle
    noStroke();
    for (const blob of this._blobs) {
      const t = blob.age / blob.lifeTime;
      fill(240, 210, 110, 120 * (1 - t) * opacity);
      circle(
        this.position.x + blob.offsetX,
        this.position.y + blob.offsetY,
        blob.size * (1 - t * 0.4)
      );
    }

    // sticky strands across the puddle, to read as "you are stuck here"
    stroke(250, 225, 150, 70 * opacity);
    strokeWeight(1);
    for (let i = 0; i < 5; i++) {
      const a = (TWO_PI * i) / 5 + this.age / 1400;
      line(
        this.position.x + cos(a) * this.radius * 0.25,
        this.position.y + sin(a) * this.radius * 0.25,
        this.position.x + cos(a) * this.radius * 0.9,
        this.position.y + sin(a) * this.radius * 0.9
      );
    }

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.radius,
      y: this.position.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }
}
