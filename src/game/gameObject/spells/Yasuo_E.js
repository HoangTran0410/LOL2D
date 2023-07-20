import { Circle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import Spell from '../Spell.js';
import Dash from '../buffs/Dash.js';

export default class Yasuo_E extends Spell {
  image = AssetManager.getAsset('spell_yasuo_e');
  name = 'Quét Kiếm (Yasuo_E)';
  description =
    '<span class="buff">Lướt</span> một khoảng ngắn về hướng địch trong tầm. Gây <span class="damage">10 sát thương</span>';
  coolDown = 2000;
  manaCost = 30;

  rangeToFindEnemies = 130;

  checkCastCondition() {
    return Dash.CanDash(this.owner);
  }

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();
    this.owner.destination.set(mouse.x, mouse.y);

    // find all enemies in range
    let enemiesInRange = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.rangeToFindEnemies,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });
    if (enemiesInRange.length == 0) {
      this.resetCoolDown();
      return;
    }

    // find nearest enemy to mouse
    let nearestEnemy = null;
    let nearestDistance = Infinity;
    for (let p of enemiesInRange) {
      let d = p.position.dist(mouse);
      if (d < nearestDistance) {
        nearestEnemy = p;
        nearestDistance = d;
      }
    }

    // if found, dash to behind nearest enemy
    if (nearestEnemy) {
      let { from, to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        nearestEnemy.position,
        this.owner.position.dist(nearestEnemy.position) +
          nearestEnemy.stats.size.value / 2 +
          this.owner.stats.size.value / 2
      );

      let dashBuff = new Dash(2000, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = destination;
      dashBuff.dashSpeed = 8;
      this.owner.addBuff(dashBuff);

      nearestEnemy.takeDamage(10, this.owner);
    }
  }

  drawPreview() {
    super.drawPreview(this.rangeToFindEnemies);
  }
}
