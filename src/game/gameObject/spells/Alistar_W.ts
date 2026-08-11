import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import Airborne from '../buffs/Airborne';
import Dash from '../buffs/Dash';

export default class Alistar_W extends Spell {
  image = AssetManager.getAsset('spell_alistar_w');
  name = 'Húc Bay (Alistar_W)';
  description =
    '<span class="buff">Lướt</span> tới kẻ địch gần nhất trong phạm vi rồi húc chúng bay ra xa, gây <span class="damage">30 sát thương</span> và <span class="buff">Hất Tung</span> trong <span class="time">0.7 giây</span>';
  coolDown = 10000;
  manaCost = 50;

  range = 400;
  knockbackDistance = 250;
  damage = 30;
  airborneTime = 700;

  findNearestEnemy(): any {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let nearestEnemy: any = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = enemy.position.dist(this.owner.position);
      if (distance < nearestDistance) {
        nearestEnemy = enemy;
        nearestDistance = distance;
      }
    }
    return nearestEnemy;
  }

  checkCastCondition() {
    return Dash.CanDash(this.owner) && !!this.findNearestEnemy();
  }

  onSpellCast() {
    const target = this.findNearestEnemy();
    if (!target) return;

    // stop just short of the target so the knockback direction stays well defined
    const gap = (target.stats.size.value + this.owner.stats.size.value) / 2;
    const distance = Math.max(1, this.owner.position.dist(target.position) - gap);
    const { to: dashTo } = VectorUtils.getVectorWithRange(
      this.owner.position,
      target.position,
      distance
    );

    const dashBuff = new Dash(2000, this.owner, this.owner);
    dashBuff.image = this.image;
    dashBuff.dashDestination = dashTo;
    dashBuff.dashSpeed = 14;
    dashBuff.onReachedDestination = () => {
      if (target.isDead) return;

      target.takeDamage(this.damage, this.owner);

      const airborneBuff = new Airborne(this.airborneTime, this.owner, target);
      airborneBuff.image = this.image;
      airborneBuff.height = 25;
      target.addBuff(airborneBuff);

      // sent flying further along the same line the charge came in on
      const direction = VectorUtils.getDirectionVector(this.owner.position, target.position);
      const knockTo = p5.Vector.add(target.position, direction.mult(this.knockbackDistance));

      const knockBuff = new Dash(this.airborneTime + 500, this.owner, target);
      knockBuff.image = this.image;
      knockBuff.dashDestination = knockTo;
      knockBuff.dashSpeed = 12;
      knockBuff.showTrail = false;
      knockBuff.cancelable = false;
      target.addBuff(knockBuff);
    };
    this.owner.addBuff(dashBuff);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}
