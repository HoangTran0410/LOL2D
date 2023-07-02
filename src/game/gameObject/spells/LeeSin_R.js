import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Dash from '../buffs/Dash.js';
import Stun from '../buffs/Stun.js';

export default class LeeSin_R extends Spell {
  image = AssetManager.getAsset('spell_leesin_r');
  name = 'Nộ Long Cước (LeeSin_R)';
  description =
    'Tung cước làm mục tiêu văng ra phía sau, làm choáng và gây 30 sát thương. Kẻ địch bị mục tiêu va trúng sẽ bị hất tung trong 1s và gây 30 sát thương mỗi kẻ địch.';
  coolDown = 10000;

  rangeToCheckEnemies = 80;
  rangeToDashEnemy = 350;
  dashSpeed = 8;
  damage = 30;
  collideDamage = 30;

  onSpellCast() {
    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);

    let enemies = this.game.queryPlayerInRange({
      position: this.owner.position,
      range: this.rangeToCheckEnemies,
      excludePlayers: [this.owner],
      includePlayerSize: true,
    });

    // If no enemies in range, reset cooldown
    if (!enemies?.length) {
      this.currentCooldown = 0;
      this.owner.destination = mouse;
      return;
    }

    // Find closest enemy to mouse
    let closestEnemyToMouse = null;
    let closestDistanceToMouse = Infinity;
    enemies.forEach(enemy => {
      let distance = p5.Vector.dist(enemy.position, mouse);
      if (distance < closestDistanceToMouse) {
        closestDistanceToMouse = distance;
        closestEnemyToMouse = enemy;
      }
    });

    // Calculate destination
    let direction = p5.Vector.sub(closestEnemyToMouse.position, this.owner.position).normalize();
    let destination = p5.Vector.add(
      closestEnemyToMouse.position,
      direction.mult(this.rangeToDashEnemy)
    );

    // apply damage to target enemy
    closestEnemyToMouse.takeDamage(this.damage, this.owner);

    // effect object that will follow the target enemy, to check for enemies in collide
    let obj = new LeeSin_R_Object(this.owner);
    obj.targetEnemy = closestEnemyToMouse;
    obj.collideDamage = this.collideDamage;
    this.game.objects.push(obj);

    // target enemy dash to destination
    let airborneBuff = new Airborne(3000, this.owner, closestEnemyToMouse);
    closestEnemyToMouse.addBuff(airborneBuff);

    let dashBuff = new Dash(3000, this.owner, closestEnemyToMouse);
    dashBuff.dashDestination = destination;
    dashBuff.dashSpeed = this.dashSpeed;
    dashBuff.image = this.image;
    dashBuff.cancelable = false;
    dashBuff.onReachedDestination = () => {
      airborneBuff.deactivateBuff();
      obj.toRemove = true;

      // stun target enemy for 0.5s
      let stunBuff = new Stun(500, this.owner, closestEnemyToMouse);
      stunBuff.image = this.image;
      closestEnemyToMouse.addBuff(stunBuff);
    };
    closestEnemyToMouse.addBuff(dashBuff);
  }

  drawPreview() {
    push();
    stroke(200, 200);
    noFill();
    translate(this.owner.position.x, this.owner.position.y);
    circle(0, 0, this.rangeToCheckEnemies * 2);
    pop();
  }
}

export class LeeSin_R_Object extends SpellObject {
  targetEnemy = null;
  collideDamage = 0;
  effectedEnemies = [];

  update() {
    if (this.targetEnemy.isDead) this.toRemove = true;

    // find enemies in collide with targetEnemy
    let enemies = this.game.queryPlayerInRange({
      position: this.targetEnemy.position,
      range: this.targetEnemy.stats.size.value / 2,
      excludePlayers: [this.targetEnemy, this.owner, ...this.effectedEnemies],
      includePlayerSize: true,
    });

    enemies.forEach(enemy => {
      // apply damage to enemies
      enemy.takeDamage(this.collideDamage, this.owner);

      // airbone enemies
      let airbornBuff = new Airborne(1000, this.owner, enemy);
      airbornBuff.image = AssetManager.getAsset('spell_leesin_r');
      enemy.addBuff(airbornBuff);

      // add to effected enemies
      this.effectedEnemies.push(enemy);
    });
  }

  draw() {}
}
