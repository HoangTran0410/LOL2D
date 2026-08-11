import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Nearsight from '../buffs/Nearsight';
import TrailSystem from '../helpers/TrailSystem';

export default class Teemo_Q extends Spell {
  image = AssetManager.getAsset('spell_teemo_q');
  name = 'Phi Tiêu Bịt Mắt (Teemo_Q)';
  description =
    'Phóng một phi tiêu tẩm độc về hướng chỉ định, gây <span class="damage">20 sát thương</span> và <span class="buff">Mờ Mắt</span> kẻ địch đầu tiên trúng phải trong <span class="time">2 giây</span>';
  coolDown = 5000;
  manaCost = 20;

  range = 400;

  onSpellCast() {
    const { to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Teemo_Q_Object(this.owner);
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Teemo_Q_Object extends MissileSpellObject {
  speed = 10;
  size = 18;
  damage = 20;
  blindTime = 2000;
  newVisionRadius = 60;

  // a single-target dart: it sticks in the first thing it touches
  maxHitCount = 1;

  trailSystem = new TrailSystem({
    trailSize: this.size / 2,
    trailColor: '#8ede5c66',
    maxLength: 12,
  });

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const blindBuff = new Nearsight(this.blindTime, this.owner, enemy);
    blindBuff.newVisionRadius = this.newVisionRadius;
    blindBuff.image = AssetManager.getAsset('spell_teemo_q');
    enemy.addBuff(blindBuff);
  }

  draw() {
    const angle = this.destination.copy().sub(this.position).heading();

    push();
    translate(this.position.x, this.position.y);
    rotate(angle);

    // shaft
    stroke(60, 90, 40);
    strokeWeight(3);
    line(-this.size, 0, this.size / 2, 0);

    // poisoned tip
    noStroke();
    fill(150, 235, 100);
    triangle(this.size, 0, this.size / 4, -this.size / 3, this.size / 4, this.size / 3);

    // fletching
    fill(90, 160, 70);
    triangle(-this.size, 0, -this.size / 3, -this.size / 3, -this.size / 3, this.size / 3);

    pop();
  }
}
