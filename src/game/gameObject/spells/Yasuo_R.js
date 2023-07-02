import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import RootBuff from '../buffs/Root.js';

export default class Yasuo_R extends Spell {
  image = AssetManager.getAsset('spell_yasuo_r');
  name = 'Trăn Trối (Yasuo_R)';
  description =
    'Yasuo lập tức dịch chuyển đến các mục tiêu gần nhất bị Hất tung. Giữ chúng trên không trong 1.5 giây và gây 30 sát thương';
  coolDown = 10000;
  manaCost = 50;

  rangeToFindEnemies = 500;
  rangeToApplyAirborne = 400;
  timeToApplyAirborne = 1500;

  onSpellCast() {
    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);

    // query all enemies that have height > 0 in range 500px
    let enemies = this.game.queryPlayerInRange({
      position: this.owner.position,
      range: this.rangeToFindEnemies,
      customFilter: p => p.stats.height.value > 0,
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
      let enemiesInRange = enemies.filter(
        enemy => enemy.position.dist(nearestEnemy.position) < this.rangeToApplyAirborne / 2
      );

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

      // add airborne buff to owner
      this.owner.addBuff(new RootBuff(this.timeToApplyAirborne, this.owner, this.owner));

      // add spell object animation
      let obj = new Yasuo_R_Object(this.owner);
      obj.oldPosition = this.owner.position.copy();
      obj.position = nearestEnemy.position.copy();
      obj.size = this.rangeToApplyAirborne;
      obj.lifeTime = this.timeToApplyAirborne;
      obj.playersEffected = enemiesInRange;
      this.game.objects.push(obj);

      // move owner to behind (10px) nearest enemy
      let nearEnemyPos = mouse
        .copy()
        .sub(nearestEnemy.position)
        .setMag(nearestEnemy.stats.size.value + this.owner.stats.size.value / 2)
        .add(nearestEnemy.position);

      this.owner.position.set(nearEnemyPos.x, nearEnemyPos.y);
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
  oldPosition = this.owner.position.copy(); // draw moving line

  position = this.owner.position.copy();
  size = 300;
  lifeTime = 2000;
  age = 0;

  playersEffected = [];

  update() {
    this.oldPosition = p5.Vector.lerp(this.oldPosition, this.owner.position, 0.1);

    this.age += deltaTime;
    if (this.age > this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    let alpha = map(this.age, 0, this.lifeTime, 100, 0);
    stroke(255, alpha);
    fill(100, 100, 200, alpha);
    circle(this.position.x, this.position.y, this.size + random(-5, 5));

    // draw line from old position to current position
    stroke(255, alpha);
    strokeWeight(this.owner.stats.size.value);
    line(this.oldPosition.x, this.oldPosition.y, this.owner.position.x, this.owner.position.y);

    pop();
  }
}
