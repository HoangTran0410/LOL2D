import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Charm from '../buffs/Charm';
import TrailSystem from '../helpers/TrailSystem';

export default class Ahri_E extends Spell {
  targetingMode = 'DIRECTION' as const;
  image = AssetManager.get('spell_ahri_e');
  name = 'Hôn Gió (Ahri_E)';
  description =
    'Hôn gió theo hướng chỉ định, gây <span class="damage">15 sát thương</span> và <span class="buff">Mê Hoặc</span> kẻ địch trong <span class="time">1.5 giây</span>';
  coolDown = 5000;

  onSpellCast() {
    const range = 350;
    const charmTime = 1500;

    const { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      range
    );

    const obj = new Ahri_E_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    obj.range = range;
    obj.charmTime = charmTime;
    this.game.objectManager.addObject(obj);
  }
}

export class Ahri_E_Object extends MissileSpellObject {
  speed = 9;
  size = 25;
  range = 350;
  charmTime = 1500;
  maxHitCount = 1;

  trailSystem = new TrailSystem({
    trailColor: '#F738DE33',
    trailSize: this.size,
  });

  onHit(enemy: any) {
    const charmBuff = new Charm(this.charmTime, this.owner, enemy);
    charmBuff.speed = 1;
    enemy.addBuff(charmBuff);
  }

  draw() {
    push();
    const alpha = map(this.position.dist(this.destination), this.range, 0, 255, 50);
    noStroke();
    fill(247, 56, 222, alpha);
    circle(
      this.position.x + random(-3, 3),
      this.position.y + random(-3, 3),
      this.size + random(-3, 3)
    );
    pop();
  }
}
