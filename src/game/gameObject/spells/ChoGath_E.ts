import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import DamageOverTime from '../buffs/DamageOverTime';
import TrailSystem from '../helpers/TrailSystem';

export default class ChoGath_E extends Spell {
  image = AssetManager.getAsset('spell_chogath_e');
  name = "Gai Xương (Cho'Gath_E)";
  description =
    'Phóng một chùm gai xương <span>xuyên qua mọi kẻ địch</span> trên đường bay, gây <span class="damage">12 sát thương</span> và khiến chúng <span class="buff">Chảy Máu</span> <span class="damage">4 sát thương</span> mỗi <span class="time">0.5 giây</span> trong <span class="time">3 giây</span>';
  coolDown = 6000;
  manaCost = 20;

  range = 550;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new ChoGath_E_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    obj.direction = p5.Vector.sub(to, from).normalize();
    this.game.objectManager.addObject(obj);
  }
}

export class ChoGath_E_Object extends MissileSpellObject {
  speed = 12;
  size = 26;
  damage = 12;
  // a wall of spikes: it goes through everyone and only stops at max range
  maxHitCount = Infinity;

  bleedDuration = 3000;
  bleedDamagePerTick = 4;
  bleedTickInterval = 500;

  trailSystem = new TrailSystem({
    maxLength: 8,
    trailSize: this.size / 2,
    trailColor: '#C9A88044',
  });

  onHit(enemy: any) {
    enemy.takeDamage(this.damage, this.owner);

    const bleed = new DamageOverTime(this.bleedDuration, this.owner, enemy);
    bleed.stackId = 'chogath_e_bleed';
    bleed.damagePerTick = this.bleedDamagePerTick;
    bleed.tickInterval = this.bleedTickInterval;
    bleed.flameColor = [235, 120, 150]; // reads as a bleed rather than a burn
    bleed.image = AssetManager.getAsset('spell_chogath_e');
    enemy.addBuff(bleed);
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.direction.heading());

    noStroke();
    // three staggered bone spikes so the volley reads as a cluster
    for (let i = -1; i <= 1; i++) {
      const offset = i * (this.size / 3);
      const len = this.size * (i === 0 ? 1 : 0.7);

      fill(238, 230, 205, 235);
      triangle(len, offset, -len / 2, offset - this.size / 6, -len / 2, offset + this.size / 6);

      fill(180, 165, 140, 200);
      triangle(len * 0.5, offset, -len / 2, offset, -len / 2, offset + this.size / 6);
    }
    pop();
  }
}
