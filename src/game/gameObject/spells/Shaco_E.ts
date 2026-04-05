import { Circle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import { Shaco_W_Bullet_Object } from './Shaco_W';

export default class Shaco_E extends Spell {
  image = AssetManager.getAsset('spell_shaco_e');
  name = 'Dao Độc (Shaco_E)';
  description =
    'Ném dao tới kẻ địch, <span class="buff">Làm Chậm 40%</span> và gây <span class="damage">15 sát thương</span>, gây thêm <span class="damage">10 sát thương</span> nếu mục tiêu <span>dưới 30% máu</span>';
  coolDown = 5000;

  range = 250;
  targetEnemy: any = null;

  checkCastCondition() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
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
    enemies.forEach((enemy: any) => {
      const distance = enemy.position.dist(this.game.worldMouse);
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
    const { health, maxHealth } = this.targetEnemy.stats;
    if (health < maxHealth * 0.3) {
      damage += 10;
    }

    const obj = new Shaco_E_Object(this.owner);
    obj.targetEnemy = this.targetEnemy;
    obj.damage = damage;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Shaco_E_Object extends Shaco_W_Bullet_Object {
  position: p5.Vector = this.owner.position.copy();
  strokeColor: [number, number, number] = [255, 100, 50];
  lazerWidth = 10;
  lazerLength = 35;
  speed = 7;
}
