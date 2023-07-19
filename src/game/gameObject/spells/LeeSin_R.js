import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Dash from '../buffs/Dash.js';
import Stun from '../buffs/Stun.js';
import ParticleSystem from '../helpers/ParticleSystem.js';

export default class LeeSin_R extends Spell {
  image = AssetManager.getAsset('spell_leesin_r');
  name = 'Nộ Long Cước (LeeSin_R)';
  description =
    'Tung cước đá mục tiêu <span class="buff">Văng ra xa</span>, gây <span class="damage">30 sát thương</span> và <span class="buff">Làm Choáng</span> mục tiêu trong <span class="time">0.5 giây</span>. Những kẻ địch khác bị mục tiêu va trúng sẽ bị <span class="buff">Hất Tung</span> trong <span class="time">1 giây</span> và nhận <span class="damage">30 sát thương</span>';
  coolDown = 10000;

  rangeToCheckEnemies = 80;
  rangeToDashEnemy = 350;
  dashSpeed = 8;
  damage = 30;
  collideDamage = 30;

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();

    let enemies = this.game.queryPlayersInRange({
      position: this.owner.position,
      range: this.rangeToCheckEnemies,
      excludeTeamIds: [this.owner.teamId],
      includePlayerSize: true,
    });

    // If no enemies in range, reset cooldown
    if (!enemies?.length) {
      this.resetCoolDown();
      this.owner.moveTo(mouse.x, mouse.y);
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
    let { from, to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      closestEnemyToMouse.position,
      this.rangeToDashEnemy
    );

    // effect object that will follow the target enemy, to check for enemies in collide
    let obj = new LeeSin_R_Object(this.owner);
    obj.targetEnemy = closestEnemyToMouse;
    obj.collideDamage = this.collideDamage;
    obj.destination = destination;
    this.game.objectManager.addObject(obj);

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
    dashBuff.addDeactivateListener(() => {
      airborneBuff.deactivateBuff();
      obj.toRemove = true;
    });
    closestEnemyToMouse.addBuff(dashBuff);

    // apply damage to target enemy
    closestEnemyToMouse.takeDamage(this.damage, this.owner);

    // use particles system to create effect
    let particleSystem = new ParticleSystem({
      isDeadFn: p => p.lifeSpan <= 0,
      updateFn: p => {
        p.position.add(p.velocity);
        p.lifeSpan -= deltaTime;
      },
      drawFn: p => {
        let alpha = map(p.lifeSpan, 0, p.lifeTime, 100, 255);
        stroke(255, 234, 79, alpha);
        strokeWeight(random(3, 8));
        let len = p.velocity.copy().setMag(random(5, 10));
        line(p.position.x, p.position.y, p.position.x + len.x, p.position.y + len.y);
      },
    });

    // pos is contact point
    let dir = p5.Vector.sub(destination, from);
    let pos = closestEnemyToMouse.position
      .copy()
      .sub(dir.setMag(closestEnemyToMouse.stats.size.value / 2));

    for (let i = 0; i < 20; i++) {
      let lifeTime = random(300, 1500);
      particleSystem.addParticle({
        position: pos.copy(),
        velocity: dir
          .copy()
          .setMag(random(2, 6))
          .rotate(random(-PI / 4, PI / 4)),
        lifeSpan: lifeTime,
        lifeTime,
      });
    }
    this.game.objectManager.addObject(particleSystem);
  }

  drawPreview() {
    super.drawPreview(this.rangeToCheckEnemies);
  }
}

export class LeeSin_R_Object extends SpellObject {
  targetEnemy = null;
  collideDamage = 0;
  effectedEnemies = [];

  update() {
    if (this.targetEnemy.isDead) this.toRemove = true;

    // find enemies in collide with targetEnemy
    let enemies = this.game.queryPlayersInRange({
      position: this.targetEnemy.position,
      range: this.targetEnemy.stats.size.value / 2,
      excludeTeamIds: [this.owner.teamId],
      excludePlayers: [this.targetEnemy, ...this.effectedEnemies],
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
