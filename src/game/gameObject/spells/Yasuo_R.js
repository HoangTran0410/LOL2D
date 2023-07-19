import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import AttackableUnit from '../attackableUnits/AttackableUnit.js';
import Airborne from '../buffs/Airborne.js';
import Dash from '../buffs/Dash.js';
import Speedup from '../buffs/Speedup.js';

export default class Yasuo_R extends Spell {
  image = AssetManager.getAsset('spell_yasuo_r');
  name = 'Trăn Trối (Yasuo_R)';
  description =
    'Lập tức <span class="buff">Dịch chuyển</span> đến các mục tiêu gần nhất bị <span>Hất tung</span>. <span class="buff">Giữ chúng trên không</span> trong <span class="time">1 giây</span> và gây <span class="damage">30 sát thương</span>. Bạn được <span class="buff">Tăng tốc 40%</span> trong <span class="time">2 giây</span> sau đó.';
  coolDown = 10000;
  manaCost = 50;

  rangeToFindEnemies = 600;
  rangeToApplyAirborne = 200;
  timeToApplyAirborne = 1000;

  checkCastCondition() {
    return Dash.CanDash(this.owner);
  }

  onSpellCast() {
    let mouse = this.game.worldMouse.copy();

    // query all enemies that have Airborne buff
    let enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.rangeToFindEnemies,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.excludeUntargetable,
        PredefinedFilters.excludeDead,
        PredefinedFilters.excludeTeamId(this.owner.teamId),
        p => p.buffs.filter(buff => buff.sourceUnit != p && buff instanceof Airborne)?.length > 0,
      ],
    });

    // if no enemy found, reset spell cast
    if (enemies.length == 0) {
      this.resetCoolDown();
      return;
    }

    // find enemy that is nearest to mouse
    let nearestEnemy = enemies[0];
    let nearestDistance = Infinity;
    for (let enemy of enemies) {
      let distance = enemy.position.dist(mouse);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestEnemy = enemy;
      }
    }

    // find all enemies that are in range 300px to nearest enemy
    let enemiesInRange = this.game.objectManager.queryObjects({
      area: new Circle({
        x: nearestEnemy.position.x,
        y: nearestEnemy.position.y,
        r: this.rangeToApplyAirborne,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        p => p.hasBuff(Airborne),
      ],
    });

    // add spell object animation
    let obj = new Yasuo_R_Object(this.owner);
    obj.position = nearestEnemy.position.copy();
    obj.size = this.rangeToApplyAirborne * 2;
    obj.lifeTime = this.timeToApplyAirborne;
    this.game.objectManager.addObject(obj);

    // dash owner to behind (10px) nearest enemy
    let nearEnemyPos = mouse
      .copy()
      .sub(nearestEnemy.position)
      .setMag(nearestEnemy.stats.size.value + this.owner.stats.size.value / 2 + 10)
      .add(nearestEnemy.position);

    let dashBuff = new Dash(1000, this.owner, this.owner);
    dashBuff.dashDestination = nearEnemyPos;
    dashBuff.dashSpeed = 100;
    dashBuff.cancelable = false;
    dashBuff.onReachedDestination = () => {
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

      let speedup = new Speedup(3000, this.owner, this.owner);
      speedup.percent = 0.4;
      this.owner.addBuff(speedup);
    };
    this.owner.addBuff(dashBuff);
  }

  drawPreview() {
    super.drawPreview(this.rangeToFindEnemies);
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
    let alpha = map(this.age, 0, this.lifeTime, 100, 50);
    stroke(255, alpha);
    fill(100, 100, 200, alpha);
    circle(this.position.x, this.position.y, this.size + random(-5, 5));
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }
}
