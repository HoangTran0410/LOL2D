import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Root from '../buffs/Root';
import TrailSystem from '../helpers/TrailSystem';

export default class Morgana_Q extends Spell {
  image = AssetManager.getAsset('spell_morgana_q');
  name = 'Xiềng Xích Bóng Tối (Morgana_Q)';
  description =
    'Phóng một xiềng xích bóng tối đi rất xa theo hướng chỉ định, gây <span class="damage">25 sát thương</span> và <span class="buff">Trói Chân</span> kẻ địch đầu tiên trúng phải trong <span class="time">2 giây</span>';
  coolDown = 8000;
  manaCost = 30;

  range = 700;
  damage = 25;
  rootTime = 2000;

  onSpellCast() {
    const { to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Morgana_Q_Object(this.owner);
    obj.destination = destination;
    obj.range = this.range;
    obj.damage = this.damage;
    obj.rootTime = this.rootTime;

    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Morgana_Q_Object extends MissileSpellObject {
  speed = 9;
  size = 22;
  range = 700;
  damage = 25;
  rootTime = 2000;
  angle = 0;
  // the chain binds the first target it reaches and stops there
  maxHitCount = 1;

  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: '#7B2FBE55',
  });

  onBeforeMove() {
    this.angle += 0.15;
  }

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const rootBuff = new Root(this.rootTime, this.owner, enemy);
    rootBuff.image = AssetManager.getAsset('spell_morgana_q');
    rootBuff.effectColor = [150, 60, 200, 220];
    enemy.addBuff(rootBuff);
  }

  draw() {
    const alpha = map(this.position.dist(this.destination), this.range, 0, 255, 120);

    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    noStroke();
    fill(60, 20, 90, alpha);
    circle(0, 0, this.size + 8);

    fill(180, 90, 230, alpha);
    circle(0, 0, this.size);

    // a couple of chain links spinning around the core
    stroke(200, 140, 255, alpha);
    strokeWeight(2);
    noFill();
    for (let i = 0; i < 3; i++) {
      const a = (i * TWO_PI) / 3;
      ellipse(cos(a) * this.size * 0.7, sin(a) * this.size * 0.7, 9, 6);
    }

    pop();
  }
}
