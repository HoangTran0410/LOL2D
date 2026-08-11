import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import Speedup from '../buffs/Speedup';
import TrailSystem from '../helpers/TrailSystem';

export default class Malphite_Q extends Spell {
  image = AssetManager.getAsset('spell_malphite_q');
  name = 'Mảnh Vỡ Kết Tinh (Malphite_Q)';
  description =
    'Ném một mảnh đá xuyên qua mọi kẻ địch trên đường đi, gây <span class="damage">20 sát thương</span> và <span class="buff">Làm Chậm 35%</span> trong <span class="time">2 giây</span>. Nếu trúng ít nhất một kẻ địch, Malphite được <span class="buff">Tăng Tốc 20%</span> trong <span class="time">2 giây</span>';
  coolDown = 6000;
  manaCost = 25;

  range = 500;
  damage = 20;
  slowPercent = 0.35;
  slowDuration = 2000;
  speedupPercent = 0.2;
  speedupDuration = 2000;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Malphite_Q_Object(this.owner);
    obj.destination = to;
    obj.damage = this.damage;
    obj.slowPercent = this.slowPercent;
    obj.slowDuration = this.slowDuration;
    obj.speedupPercent = this.speedupPercent;
    obj.speedupDuration = this.speedupDuration;

    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Malphite_Q_Object extends MissileSpellObject {
  image = AssetManager.getAsset('spell_malphite_q');
  speed = 9;
  size = 24;
  // a shard of the mountain: it does not stop for anybody
  maxHitCount = Infinity;

  damage = 20;
  slowPercent = 0.35;
  slowDuration = 2000;
  speedupPercent = 0.2;
  speedupDuration = 2000;

  trailSystem = new TrailSystem({
    trailColor: '#B6AECC55',
    trailSize: this.size,
  });

  _spin = random(TWO_PI);
  _grantedSpeedup = false;

  onAfterMove() {
    this._spin += 0.15;
  }

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const slowBuff = new Slow(this.slowDuration, this.owner, enemy);
    slowBuff.image = this.image;
    slowBuff.percent = this.slowPercent;
    enemy.addBuff(slowBuff);

    // the caster is sped up once, no matter how many enemies the shard pierces
    if (!this._grantedSpeedup) {
      this._grantedSpeedup = true;

      const speedupBuff = new Speedup(this.speedupDuration, this.owner, this.owner);
      speedupBuff.image = this.image;
      speedupBuff.percent = this.speedupPercent;
      this.owner.addBuff(speedupBuff);
    }
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this._spin);

    noStroke();
    fill(150, 140, 170);
    triangle(0, -this.size * 0.75, this.size * 0.5, this.size * 0.5, -this.size * 0.5, this.size * 0.5);

    fill(225, 220, 240);
    triangle(0, -this.size * 0.4, this.size * 0.22, this.size * 0.25, -this.size * 0.22, this.size * 0.25);

    pop();
  }
}
