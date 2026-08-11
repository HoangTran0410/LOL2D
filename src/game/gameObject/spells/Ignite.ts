import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import DamageOverTime from '../buffs/DamageOverTime';

export default class Ignite extends Spell {
  image = AssetManager.getAsset('spell_ignite');
  name = 'Thiêu Đốt (Ignite)';
  description =
    'Thiêu đốt kẻ địch gần nhất trong phạm vi <span>350px</span>, gây <span class="damage">6 sát thương</span> mỗi <span class="time">0.5 giây</span> trong <span class="time">5 giây</span> (tổng <span class="damage">60 sát thương</span>)';
  coolDown = 15000;
  willDrawPreview = true;

  range = 350;
  duration = 5000;
  damagePerTick = 6;
  tickInterval = 500;

  checkCastCondition() {
    return !!this._findNearestEnemy();
  }

  onSpellCast() {
    const target = this._findNearestEnemy();
    if (!target) return;

    const burn = new DamageOverTime(this.duration, this.owner, target);
    burn.stackId = 'ignite_burn';
    burn.image = this.image;
    burn.damagePerTick = this.damagePerTick;
    burn.tickInterval = this.tickInterval;
    target.addBuff(burn);
  }

  _findNearestEnemy() {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let nearest = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = this.owner.position.dist(enemy.position);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearest = enemy;
      }
    }
    return nearest;
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}
