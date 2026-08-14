import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import RootBuff from '../buffs/Root';

export default class Lux_Q extends Spell {
  targetingMode = 'DIRECTION' as const;
  name = 'Khóa Ánh Sáng (Lux_Q)';
  image = AssetManager.get('spell_lux_q');
  description =
    'Lux phóng ra một quả cầu ánh sáng theo đường thẳng, gây <span class="damage">20 sát thương</span> và <span class="buff">Trói Chân</span> 2 kẻ địch đầu tiên trúng phải trong <span class="time">2 giây</span>';
  coolDown = 5000;
  manaCost = 20;

  onSpellCast() {
    const range = 500;
    const stunTime = 2000;

    const { to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      range
    );

    const obj = new Lux_Q_Object(this.owner);
    obj.destination = destination;
    obj.stunTime = stunTime;
    obj.maxHitCount = 2;

    this.game.objectManager.addObject(obj);
  }
}

export class Lux_Q_Object extends MissileSpellObject {
  speed = 7;
  size = 15;
  stunTime = 2000;
  maxHitCount = 2;

  onHit(enemy: any) {
    const stunBuff = new RootBuff(this.stunTime, this.owner, enemy);
    enemy.addBuff(stunBuff);
    enemy.takeDamage(20, this.owner);
  }

  draw() {
    const alpha = Math.min(255, this.position.dist(this.destination) + 50);

    push();
    stroke(255, alpha);
    strokeWeight(2);
    fill(255, Math.max(50, alpha / 3));
    circle(this.position.x, this.position.y, this.size);

    stroke(255, alpha);
    strokeWeight(2);
    for (let i = 0; i < 5; i++) {
      const angle = random(0, 2 * PI);
      const len = random(this.size, this.size + 10);
      const x = this.position.x + len * cos(angle);
      const y = this.position.y + len * sin(angle);
      line(this.position.x, this.position.y, x, y);
    }
    pop();
  }
}
