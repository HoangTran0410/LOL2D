import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Slow from '../buffs/Slow.js';
import TrailSystem from '../helpers/TrailSystem.js';

export default class Ahri_W extends Spell {
  image = AssetManager.getAsset('spell_ahri_w');
  name = 'Lửa Hồ Ly (Ahri_W)';
  description =
    'Tạo ra 3 ngọn lửa quay xung quanh bản thân trong 5s. Sau 1s sẽ tự tìm và bay tới mục tiêu trong tầm, gây 10 sát thương và giảm 20% tốc chạy trong 0.5s mỗi ngọn lửa. ';
  coolDown = 5000;

  onSpellCast() {
    for (let i = 0; i < 3; i++) {
      let obj = new Ahri_W_Object(this.owner);
      obj.angle = (i * 2 * PI) / 3;
      this.game.objectManager.addObject(obj);
    }
  }
}

export class Ahri_W_Object extends SpellObject {
  position = this.owner.position.copy();
  lifeTime = 5000;
  prepairTime = 1000;
  age = 0;
  angle = 0;
  rotateSpeed = 0.07;
  moveSpeed = 8;
  size = 25;
  rangeToFindEnemy = 160;
  damage = 10;
  targetEnemy = null;

  trailSystem = new TrailSystem({
    trailColor: '#77F3',
    trailSize: this.size,
  });

  static PHASES = {
    PREPARING: 'PREPARING',
    ROTATING: 'ROTATING',
    ATTACKING: 'ATTACKING',
  };

  phase = Ahri_W_Object.PHASES.PREPARING;

  update() {
    this.age += deltaTime;
    this.angle += this.rotateSpeed;
    if (this.age >= this.lifeTime) this.toRemove = true;

    // preparing
    if (this.phase === Ahri_W_Object.PHASES.PREPARING) {
      this.position = p5.Vector.lerp(this.position, this.getPosition(), 0.2);

      if (this.age >= this.prepairTime) {
        this.phase = Ahri_W_Object.PHASES.ROTATING;
      }
    }

    // rotating
    else if (this.phase === Ahri_W_Object.PHASES.ROTATING) {
      this.position = p5.Vector.lerp(this.position, this.getPosition(), 0.2);
      this.trailSystem.addTrail(this.position);

      // query players in range
      let enemies = this.game.queryPlayersInRange({
        position: this.position,
        range: this.rangeToFindEnemy,
        excludeTeamIds: [this.owner.teamId],
      });

      // find the closest enemy
      let closestEnemy = null;
      let closestDistance = Infinity;
      enemies.forEach(enemy => {
        let distance = this.position.dist(enemy.position);
        if (distance < closestDistance) {
          closestDistance = distance;
          closestEnemy = enemy;
        }
      });

      if (closestEnemy) {
        this.targetEnemy = closestEnemy;
        this.isMissile = true;
        this.phase = Ahri_W_Object.PHASES.ATTACKING;
      }
    }

    // attacking
    else if (this.phase === Ahri_W_Object.PHASES.ATTACKING && this.targetEnemy) {
      VectorUtils.moveVectorToVector(this.position, this.targetEnemy.position, this.moveSpeed);
      this.trailSystem.addTrail(this.position);

      let distance = this.position.dist(this.targetEnemy.position);
      if (distance <= this.targetEnemy.stats.size.value / 2) {
        let slowBuff = new Slow(500, this.owner, this.targetEnemy);
        slowBuff.image = AssetManager.getAsset('spell_ahri_w');
        slowBuff.percent = 0.2;
        this.targetEnemy.addBuff(slowBuff);
        this.targetEnemy.takeDamage(this.damage, this.owner);
        this.toRemove = true;
      }
    }
  }

  getPosition() {
    return this.owner.position.copy().add(
      p5.Vector.fromAngle(this.angle).mult(
        this.owner.stats.size.value / 2 + this.size / 2 + 20 // 20 is padding between owner and this object
      )
    );
  }

  draw() {
    this.trailSystem.draw();

    push();
    let alpha = this.phase === Ahri_W_Object.PHASES.PREPARING ? 50 : 255;
    let size = this.phase === Ahri_W_Object.PHASES.ROTATING ? this.size + random(-3, 3) : this.size;
    translate(this.position.x, this.position.y);
    noStroke();
    fill(119, 119, 245, alpha);
    circle(random(-3, 3), random(-3, 3), size);

    // stroke(200);
    // noFill();
    // circle(0, 0, this.rangeToFindEnemy * 2);
    pop();
  }
}
