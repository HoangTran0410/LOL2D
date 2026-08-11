import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import TrailSystem from '../helpers/TrailSystem';

export default class Ashe_Q extends Spell {
  image = AssetManager.getAsset('spell_ashe_q');
  name = 'Mưa Tên Băng Giá (Ashe_Q)';
  description =
    'Bắn liên tiếp <span>3 mũi tên băng</span> theo hình nón hẹp. Mỗi mũi tên gây <span class="damage">8 sát thương</span> và <span class="buff">Làm Chậm 30%</span> kẻ địch trúng chiêu trong <span class="time">1 giây</span>';
  coolDown = 4000;
  manaCost = 15;

  range = 500;
  arrowCount = 3;
  /** Gap between neighbouring arrows — small, so the volley stays on one target. */
  angleStep = Math.PI / 30;

  onSpellCast() {
    const angle = VectorUtils.getAngle(this.owner.position, this.game.worldMouse);

    for (let i = 0; i < this.arrowCount; i++) {
      const arrowAngle = angle + (i - (this.arrowCount - 1) / 2) * this.angleStep;
      const { from, to } = VectorUtils.getVectorWithAngleAndRange(
        this.owner.position,
        arrowAngle,
        this.range
      );

      const obj = new Ashe_Q_Object(this.owner);
      obj.position = from;
      obj.destination = to;
      obj.direction = p5.Vector.fromAngle(arrowAngle);
      this.game.objectManager.addObject(obj);
    }
  }
}

export class Ashe_Q_Object extends MissileSpellObject {
  speed = 13;
  size = 9;
  damage = 8;
  maxHitCount = 1;

  slowPercent = 0.3;
  slowDuration = 1000;

  trailSystem = new TrailSystem({
    maxLength: 8,
    trailSize: this.size / 2,
    trailColor: '#9DEAFF55',
  });

  onArrive() {
    // cut the trail at the end of the flight instead of letting it linger
    if (this.trailSystem) this.trailSystem.toRemove = true;
  }

  onHit(enemy: any) {
    const slowBuff = new Slow(this.slowDuration, this.owner, enemy);
    slowBuff.percent = this.slowPercent;
    slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
    slowBuff.image = AssetManager.getAsset('spell_ashe_q');
    enemy.addBuff(slowBuff);

    enemy.takeDamage(this.damage, this.owner);
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.direction.heading());

    noStroke();
    fill(160, 225, 255, 220);
    rect(-14, -this.size / 4, 20, this.size / 2);

    // frosted arrowhead
    fill(235, 250, 255, 230);
    triangle(6, -this.size / 2, 18, 0, 6, this.size / 2);

    pop();
  }
}
