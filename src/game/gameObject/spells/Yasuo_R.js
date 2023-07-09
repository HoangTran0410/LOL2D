import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Dash from '../buffs/Dash.js';

export default class Yasuo_R extends Spell {
  image = AssetManager.getAsset('spell_yasuo_r');
  name = 'Trăn Trối (Yasuo_R)';
  description =
    'Yasuo lập tức dịch chuyển đến các mục tiêu gần nhất bị Hất tung. Giữ chúng trên không trong 1 giây và gây 30 sát thương';
  coolDown = 10000;
  manaCost = 50;

  rangeToFindEnemies = 500;
  rangeToApplyAirborne = 200;
  timeToApplyAirborne = 1000;

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();

    // query all enemies that have height > 0 in range 500px
    let enemies = this.game.queryPlayersInRange({
      position: this.owner.position,
      range: this.rangeToFindEnemies,
      customFilter: p => p.hasBuff(Airborne), // p.stats.height.value > 0,
      excludePlayers: [this.owner],
    });

    // find enemy that is nearest to mouse
    let nearestEnemy = null;
    let nearestDistance = Infinity;
    for (let enemy of enemies) {
      let distance = enemy.position.dist(mouse);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = enemy;
      }
    }

    if (nearestEnemy) {
      // find all enemies that are in range 300px to nearest enemy
      let enemiesInRange = this.game.queryPlayersInRange({
        position: nearestEnemy.position,
        range: this.rangeToApplyAirborne,
        customFilter: p => p.hasBuff(Airborne), // p.stats.height.value > 0,
        excludePlayers: [this.owner],
      });

      // add airborne buff to owner
      this.owner.addBuff(new Airborne(this.timeToApplyAirborne, this.owner, this.owner));

      // add airborne buff to all enemies in range
      for (let enemy of enemiesInRange) {
        let buff = new Airborne(this.timeToApplyAirborne, this.owner, enemy);
        buff.buffAddType = BuffAddType.STACKS_AND_CONTINUE;
        buff.image = this.image;
        buff.draw = () => {
          push();
          strokeWeight(5);
          stroke(255, 200);

          // draw random lines inside enemy
          let { x, y } = enemy.position;
          let size = enemy.stats.size.value;
          stroke(random(200, 255));
          for (let i = 0; i < 1; i++) {
            let x1 = x + random(-size, size);
            let y1 = y + random(-size, size);
            let x2 = x + random(-size, size);
            let y2 = y + random(-size, size);
            line(x1, y1, x2, y2);
          }

          // draw line from owner to enemy
          stroke(100, 100, 255);
          line(this.owner.position.x, this.owner.position.y, x, y);
          pop();
        };
        enemy.addBuff(buff);
        enemy.takeDamage(30, this.owner);
      }

      // add spell object animation
      let obj = new Yasuo_R_Object(this.owner);
      obj.position = nearestEnemy.position.copy();
      obj.size = this.rangeToApplyAirborne * 2;
      obj.lifeTime = this.timeToApplyAirborne;
      this.game.addSpellObject(obj);

      // dash owner to behind (10px) nearest enemy
      let nearEnemyPos = mouse
        .copy()
        .sub(nearestEnemy.position)
        .setMag(nearestEnemy.stats.size.value + this.owner.stats.size.value / 2 + 10)
        .add(nearestEnemy.position);

      let dashBuff = new Dash(1000, this.owner, this.owner);
      dashBuff.dashDestination = nearEnemyPos;
      dashBuff.dashSpeed = 50;
      dashBuff.cancelable = false;
      this.owner.addBuff(dashBuff);
    } else {
      // if no enemy is found, reset cooldown
      this.currentCooldown = 0;
    }
  }

  drawPreview() {
    push();
    stroke(255, 100);
    noFill();
    circle(this.owner.position.x, this.owner.position.y, this.rangeToFindEnemies * 2);
    pop();
  }
}

export class Yasuo_R_Object extends SpellObject {
  position = this.owner.position.copy();
  size = 300;
  lifeTime = 2000;
  age = 0;

  update() {
    this.age += deltaTime;
    if (this.age > this.lifeTime) this.toRemove = true;
  }

  draw() {
    push();
    let alpha = map(this.age, 0, this.lifeTime, 100, 0);
    stroke(255, alpha);
    fill(100, 100, 200, alpha);
    circle(this.position.x, this.position.y, this.size + random(-5, 5));
    pop();
  }
}
