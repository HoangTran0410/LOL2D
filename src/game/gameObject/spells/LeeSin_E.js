import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import AttackableUnit from '../attackableUnits/AttackableUnit.js';
import Slow from '../buffs/Slow.js';

export default class LeeSin_E extends Spell {
  image = AssetManager.getAsset('spell_leesin_e');
  name = 'Địa Chấn / Dư Chấn (LeeSin_E)';
  description =
    'Dẫm mạnh xuống đất, gây <span class="damage">20 sát thương</span> lên kẻ địch xung quanh. <span class="buff">Làm Chậm 50%</span> các kẻ địch trong <span class="time">2 giây</span>';
  coolDown = 5000;

  range = 150;

  onSpellCast() {
    let enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [
        PredefinedFilters.includeTypes([AttackableUnit]),
        PredefinedFilters.excludeTeamIds([this.owner.teamId]),
      ],
    });

    enemies.forEach(enemy => {
      let slowBuff = new Slow(2000, this.owner, enemy);
      slowBuff.image = this.image;
      slowBuff.percent = 0.5;
      slowBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      enemy.addBuff(slowBuff);
      enemy.takeDamage(20, this.owner);
    });

    let obj = new LeeSin_E_Object(this.owner);
    obj.range = this.range;
    obj.enemies = enemies;
    this.game.objectManager.addObject(obj);
  }

  onUpdate() {}
}

export class LeeSin_E_Object extends SpellObject {
  position = this.owner.position.copy();
  range = 200;
  lifeTime = 800;
  age = 0;
  size = 0;
  enemies = [];

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    push();
    this.size = Math.min(this.size + 30, this.range * 2);

    let alpha = map(this.age, 0, this.lifeTime, 180, 10);
    fill(255, 190, 30, alpha);
    stroke(190, 190, 30, alpha + 50);
    strokeWeight(2);
    circle(this.position.x, this.position.y, this.size);

    fill(255, 190, 30, alpha);
    let sizeIncrease = map(this.age, 0, this.lifeTime, 0, 50);
    this.enemies.forEach(enemy => {
      circle(enemy.position.x, enemy.position.y, enemy.stats.size.value + sizeIncrease);
    });
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }
}
