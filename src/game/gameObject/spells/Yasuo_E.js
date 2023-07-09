import SOUNDS, { playSound } from '../../../../assets/sounds/index.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import Dash from '../buffs/Dash.js';

export default class Yasuo_E extends Spell {
  image = AssetManager.getAsset('spell_yasuo_e');
  name = 'Quét Kiếm (Yasuo_E)';
  description = 'Lướt một khoảng ngắn về hướng địch trong tầm. Gây 10 sát thương';
  coolDown = 2000;
  manaCost = 30;

  rangeToFindEnemies = 180;

  checkCastCondition() {
    return Dash.CanDash(this.owner);
  }

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();
    this.owner.destination.set(mouse.x, mouse.y);

    // find all enemies in range
    let enemiesInRange = this.game.queryPlayersInRange({
      position: this.owner.position,
      range: this.rangeToFindEnemies,
      excludePlayers: [this.owner],
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

      playSound(SOUNDS.dash);
    }
  }

  drawPreview() {
    push();
    noFill();
    stroke(255, 100);
    circle(this.owner.position.x, this.owner.position.y, this.rangeToFindEnemies * 2);
    pop();
  }
}
