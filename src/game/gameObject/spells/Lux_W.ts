import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import Shield from '../buffs/Shield';
import TrailSystem from '../helpers/TrailSystem';

export default class Lux_W extends Spell {
  image = AssetManager.getAsset('spell_lux_w');
  name = 'Lá Chắn Lăng Kính (Lux_W)';
  description =
    'Ném cây đũa ánh sáng theo hướng chỉ định rồi thu về, tạo <span class="buff">Lá Chắn</span> hấp thụ <span class="damage">60 sát thương</span> trong <span class="time">3 giây</span> cho bản thân và mọi đồng minh nó đi xuyên qua, ở cả lượt đi lẫn lượt về';
  coolDown = 8000;
  manaCost = 25;

  range = 400;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Lux_W_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }
}

export class Lux_W_Object extends MissileSpellObject {
  speed = 8;
  size = 40;
  // shields only — it must never damage anything it flies through
  maxHitCount = 0;
  // the wand turns around at max range instead of dying there
  removeOnArrive = false;

  shieldAmount = 60;
  shieldDuration = 3000;

  /** Cleared on the turnaround, so each ally can be shielded once per leg. */
  shieldedAllies: any[] = [];
  returning = false;
  spin = 0;

  trailSystem = new TrailSystem({
    maxLength: 12,
    trailSize: this.size / 3,
    trailColor: '#FFE79A55',
  });

  onBeforeMove() {
    this.spin += 0.35;
  }

  onArrive() {
    if (this.returning) {
      this.toRemove = true;
      return;
    }

    this.returning = true;
    this.destination = this.owner.position; // live ref: the wand follows the owner home
    this.shieldedAllies = [];
  }

  onAfterMove() {
    const allies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.size / 2,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
        PredefinedFilters.excludeDead,
        PredefinedFilters.excludeObjects(this.shieldedAllies),
      ],
    });

    for (const ally of allies) {
      this.shieldedAllies.push(ally);

      const shield = new Shield(this.shieldDuration, this.owner, ally);
      shield.amount = this.shieldAmount;
      shield.color = [255, 225, 140];
      shield.image = AssetManager.getAsset('spell_lux_w');
      ally.addBuff(shield);
    }
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.spin);

    noStroke();
    fill(255, 235, 170, 40);
    circle(0, 0, this.size);

    // a spinning prism: two crossed bars of light
    fill(255, 245, 200, 230);
    rect(-this.size / 2, -3, this.size, 6);
    rect(-3, -this.size / 2, 6, this.size);

    fill(255, 255, 255, 240);
    circle(0, 0, this.size / 3);

    pop();
  }
}
