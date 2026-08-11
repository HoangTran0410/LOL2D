import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import DamageOverTime from '../buffs/DamageOverTime';
import Ground from '../buffs/Ground';
import Slow from '../buffs/Slow';

/**
 * Miasma. The real ability never silences — it lays down a lingering venom
 * field that POISONS, slows, and GROUNDS everything inside, so the victim can
 * walk out but cannot dash or blink out.
 */
export default class Cassiopeia_W extends Spell {
  image = AssetManager.getAsset('spell_cassiopeia_w');
  name = 'Bãi Độc (Cassiopeia_W)';
  description =
    'Phun ra một đám mây độc tồn tại <span class="time">5 giây</span>. Kẻ địch bên trong nhiễm độc, mất <span class="damage">2 sát thương</span> mỗi <span class="time">0.4 giây</span>, bị <span class="buff">Làm Chậm</span> (giảm dần từ 50% theo thời gian tồn tại của bãi độc) và bị <span class="buff">Ghìm</span> — vẫn đi được nhưng không thể dùng kỹ năng lướt hay dịch chuyển để thoát ra';
  coolDown = 10000;
  manaCost = 40;

  castRange = 320;
  radius = 100;
  duration = 5000;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.castRange
    );

    const obj = new Cassiopeia_W_Object(this.owner);
    obj.position = to;
    obj.radius = this.radius;
    obj.lifeTime = this.duration;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.castRange);
  }
}

interface VenomCloud {
  angle: number;
  distance: number;
  spin: number;
  size: number;
  phase: number;
}

const CLOUD_COUNT = 14;

export class Cassiopeia_W_Object extends SpellObject {
  image = AssetManager.getAsset('spell_cassiopeia_w');
  position: p5.Vector = this.owner.position.copy();

  radius = 100;
  lifeTime = 5000;
  age = 0;
  fadeTime = 500;

  damagePerTick = 2;
  tickInterval = 400;
  poisonDuration = 800;

  /** The slow decays over the field's lifetime, as it does in game. */
  slowPercentStart = 0.5;
  slowPercentEnd = 0.15;

  /** Buffs are refreshed on a tick instead of every frame to avoid per-frame garbage. */
  reapplyInterval = 200;
  /** Slow and ground linger a beat after stepping out of the cloud. */
  debuffLinger = 250;

  _timeSinceReapply = this.reapplyInterval; // so the field bites the very first frame
  _clouds: VenomCloud[] = [];

  onAdded() {
    for (let i = 0; i < CLOUD_COUNT; i++) {
      this._clouds.push({
        angle: (TWO_PI * i) / CLOUD_COUNT + random(-0.3, 0.3),
        distance: random(this.radius * 0.15, this.radius * 0.8),
        spin: random(0.0002, 0.0007) * (random() < 0.5 ? -1 : 1),
        size: random(this.radius * 0.4, this.radius * 0.75),
        phase: random(TWO_PI),
      });
    }
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    this._timeSinceReapply += deltaTime;
    if (this._timeSinceReapply >= this.reapplyInterval) {
      this._timeSinceReapply = 0;
      this._poisonEnemiesInside();
    }

    for (const cloud of this._clouds) {
      cloud.angle += cloud.spin * deltaTime;
    }
  }

  _currentSlowPercent() {
    const t = Math.min(1, this.age / this.lifeTime);
    return this.slowPercentStart + (this.slowPercentEnd - this.slowPercentStart) * t;
  }

  _poisonEnemiesInside() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.radius,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    const controlDuration = this.reapplyInterval + this.debuffLinger;
    const slowPercent = this._currentSlowPercent();

    enemies.forEach((enemy: any) => {
      // DamageOverTime renews by default, so standing in the cloud only pushes the
      // remaining duration back instead of restarting the damage ticks
      const poisonBuff = new DamageOverTime(this.poisonDuration, this.owner, enemy);
      poisonBuff.stackId = 'cassiopeia_w_poison';
      poisonBuff.image = this.image;
      poisonBuff.name = 'Nhiễm Độc';
      poisonBuff.damagePerTick = this.damagePerTick;
      poisonBuff.tickInterval = this.tickInterval;
      poisonBuff.flameColor = [150, 255, 120];
      poisonBuff.emberColor = [30, 110, 40];
      enemy.addBuff(poisonBuff);

      const slowBuff = new Slow(controlDuration, this.owner, enemy);
      slowBuff.image = this.image;
      slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      slowBuff.percent = slowPercent;
      enemy.addBuff(slowBuff);

      // Miasma grounds, it does not silence: casting still works, escaping does not
      const groundBuff = new Ground(controlDuration, this.owner, enemy);
      groundBuff.image = this.image;
      enemy.addBuff(groundBuff);
    });
  }

  _getOpacity() {
    if (this.age < 250) return this.age / 250;
    if (this.age > this.lifeTime - this.fadeTime) {
      return map(this.age, this.lifeTime - this.fadeTime, this.lifeTime, 1, 0);
    }
    return 1;
  }

  draw() {
    const opacity = this._getOpacity();

    push();
    noStroke();

    // dark base so the cloud reads as a hole of venom on the ground
    fill(60, 30, 80, 70 * opacity);
    circle(this.position.x, this.position.y, this.radius * 2);

    // slowly churning puffs
    for (const cloud of this._clouds) {
      const breathe = 1 + 0.15 * sin(this.age / 350 + cloud.phase);
      const x = this.position.x + cos(cloud.angle) * cloud.distance;
      const y = this.position.y + sin(cloud.angle) * cloud.distance;

      fill(120, 60, 160, 45 * opacity);
      circle(x, y, cloud.size * breathe);
      fill(160, 230, 130, 30 * opacity);
      circle(x, y, cloud.size * breathe * 0.55);
    }

    noFill();
    stroke(180, 120, 220, 120 * opacity);
    strokeWeight(2);
    circle(this.position.x, this.position.y, this.radius * 2);

    // tendrils clawing at the ground, marking the field as a grounding zone
    stroke(200, 160, 235, 90 * opacity);
    strokeWeight(2);
    for (let i = 0; i < 8; i++) {
      const a = (TWO_PI * i) / 8 + this.age / 2200;
      arc(this.position.x, this.position.y, this.radius * 1.7, this.radius * 1.7, a, a + 0.35);
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
