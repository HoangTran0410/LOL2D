import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import Dash from '../buffs/Dash.js';

export default class Yasuo_E extends Spell {
  image = ASSETS.Spells.yasuo_e;
  name = 'Quét Kiếm (Yasuo_E)';
  description = 'Lướt một khoảng ngắn về hướng địch';
  coolDown = 2000;

  onSpellCast() {
    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
    this.owner.destination.set(mouse.x, mouse.y);

    if (!Dash.CanDash(this.owner)) {
      this.currentCooldown = 0;
      return;
    }

    const rangeToCheck = 230;

    // find all enemies in range
    let enemiesInRange = this.game.players.filter(
      p => p != this.owner && p.position.dist(this.owner.position) < rangeToCheck
    );
    if (enemiesInRange.length == 0) {
      this.currentCooldown = 0;
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

    // if found, dash to nearest enemy
    if (nearestEnemy) {
      let destination = nearestEnemy.position
        .copy()
        .sub(this.owner.position)
        .setMag(nearestEnemy.stats.size.value / 2 + this.owner.stats.size.value / 2)
        .add(nearestEnemy.position);

      let buff = new Dash(100000, this.owner, this.owner);
      buff.buffAddType = BuffAddType.REPLACE_EXISTING;
      buff.dashDestination = destination;
      buff.dashSpeed = 8;

      this.owner.addBuff(buff);
      this.owner.destination.set(destination.x, destination.y);
    }
  }
}
