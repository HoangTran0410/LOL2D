import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { Shaco_W_Bullet_Object } from './Shaco_W.js';

export default class Shaco_E extends Spell {
  image = AssetManager.getAsset('spell_shaco_e');
  name = 'Dao Độc (Shaco_E)';
  description =
    'Ném dao tới kẻ địch, làm chậm kẻ địch 40%. Gây 15 sát thương, gây thêm 10 sát thương nếu mục tiêu dưới 30% máu.';
  coolDown = 5000;

  range = 250;
  targetEnemy = null;

  checkCastCondition() {
    let enemies = this.game.queryPlayersInRange({
      position: this.owner.position,
      range: this.range,
      excludePlayers: [this.owner],
    });

    if (!enemies.length) {
      this.targetEnemy = null;
      return false;
    }

    if (enemies.length === 1) {
      this.targetEnemy = enemies[0];
      return true;
    }

    // Find the closest enemy to the mouse
    let closestEnemy = enemies[0];
    let closestDistance = closestEnemy.position.dist(this.game.worldMouse);
    enemies.forEach(enemy => {
      let distance = enemy.position.dist(this.game.worldMouse);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestEnemy = enemy;
      }
    });
    this.targetEnemy = closestEnemy;

    return true;
  }

  onSpellCast() {
    let damage = 15;
    let { health, maxHealth } = this.targetEnemy.stats;
    if (health < maxHealth * 0.3) {
      damage += 10;
    }

    let obj = new Shaco_E_Object(this.owner);
    obj.targetEnemy = this.targetEnemy;
    obj.damage = damage;
    this.game.addSpellObject(obj);
  }

  drawPreview() {
    push();
    stroke(200, 100);
    strokeWeight(2);
    noFill();
    circle(this.owner.position.x, this.owner.position.y, this.range * 2);
    pop();
  }
}

export class Shaco_E_Object extends Shaco_W_Bullet_Object {
  position = this.owner.position.copy();
  strokeColor = [255, 150, 50];
  lazerWidth = 10;
  lazerLength = 20;
  speed = 8;
}
