import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Fear from '../buffs/Fear.js';
import TrailSystem from '../helpers/TrailSystem.js';

export default class Shaco_W extends Spell {
  image = AssetManager.getAsset('spell_shaco_w');
  name = 'Hộp Hề Ma Quái (Shaco_W)';
  description =
    'Tạo một Hộp Hề Ma Quái tàng hình sau 1s, tồn tại trong 20s. Khi kẻ địch tới gần, nó sẽ gây hoảng sợ và tấn công các kẻ địch xung quanh trong 3s, gây 7 sát thương mỗi lần tấn công.';
  coolDown = 5000;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      100
    );

    let obj = new Shaco_W_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    this.game.addObject(obj);
  }
}

export class Shaco_W_Object extends SpellObject {
  isMissile = true;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  invisibleAfter = 1000;
  moveSpeed = 6;
  lifeTime = 20000;
  age = 0;

  rangeToDraw = 0;
  fearRange = 100;
  attackRange = 150;
  attackCooldown = 500;
  attackDamage = 7;
  attackMaxCount = 3;
  timeSinceLastAttack = this.attackCooldown;
  attackLifeTime = 3000;

  static PHASES = {
    WAIT_FOR_INVISIBLE: 0,
    INVISIBLE: 1,
    ATTACKING: 2,
  };

  phase = Shaco_W_Object.PHASES.WAIT_FOR_INVISIBLE;

  update() {
    this.age += deltaTime;
    if (this.age > this.lifeTime) {
      this.toRemove = true;
    }

    // wait for invisible phase
    if (this.phase === Shaco_W_Object.PHASES.WAIT_FOR_INVISIBLE) {
      if (this.position.dist(this.destination) > this.moveSpeed) {
        VectorUtils.moveVectorToVector(this.position, this.destination, this.moveSpeed);
      }

      this.rangeToDraw = lerp(this.rangeToDraw, this.fearRange, 0.1);

      if (this.age > this.invisibleAfter) {
        this.isMissile = false;
        this.phase = Shaco_W_Object.PHASES.INVISIBLE;
      }
    }

    // invisible phase
    else if (this.phase === Shaco_W_Object.PHASES.INVISIBLE) {
      // query nearby enemies
      let enemies = this.game.queryPlayersInRange({
        position: this.position,
        range: this.fearRange,
        excludePlayers: [this.owner],
      });

      if (enemies.length > 0) {
        // fear all nearby enemies
        enemies.forEach(enemy => {
          let fearBuff = new Fear(1000, this.owner, enemy);
          fearBuff.sourcePosition = this.position.copy();
          enemy.addBuff(fearBuff);
        });

        this.phase = Shaco_W_Object.PHASES.ATTACKING;
        this.lifeTime = this.attackLifeTime;
        this.age = 0;
        this.visionRadius = this.attackRange;
      }
    }

    // attacking phase
    else if (this.phase === Shaco_W_Object.PHASES.ATTACKING) {
      this.rangeToDraw = lerp(this.rangeToDraw, this.attackRange, 0.1);

      this.timeSinceLastAttack += deltaTime;
      if (this.timeSinceLastAttack >= this.attackCooldown) {
        // attack nearby enemies
        let enemies = this.game.queryPlayersInRange({
          position: this.position,
          range: this.attackRange,
          excludePlayers: [this.owner],
        });

        if (enemies.length > 0) {
          enemies.forEach(enemy => {
            let bullet = new Shaco_W_Bullet_Object(this.owner);
            bullet.position = this.position.copy();
            bullet.targetEnemy = enemy;
            bullet.damage = this.attackDamage;
            this.game.addObject(bullet);
          });

          this.timeSinceLastAttack = 0;
        }
      }
    }
  }

  draw() {
    push();

    // moving phase
    if (this.phase === Shaco_W_Object.PHASES.WAIT_FOR_INVISIBLE) {
      noStroke();
      fill(255, 255);
      circle(this.position.x, this.position.y, 30);

      // draw range
      stroke(100, 150);
      noFill();
      circle(this.position.x, this.position.y, this.rangeToDraw * 2);
    }

    // invisible phase
    else if (this.phase === Shaco_W_Object.PHASES.INVISIBLE) {
      noStroke();
      fill(255, 30);
      circle(this.position.x, this.position.y, 35);
    }

    // attacking phase
    else if (this.phase === Shaco_W_Object.PHASES.ATTACKING) {
      let size = Math.min(map(this.timeSinceLastAttack, 0, this.attackCooldown, 0, 10), 30);
      stroke(200, 150);
      fill(200, 100, 50, 100 + size * 10);
      ellipse(this.position.x, this.position.y, 25 + size, 25 + size);

      // draw range
      stroke(100, 150);
      noFill();
      circle(this.position.x, this.position.y, this.rangeToDraw * 2);
    }

    pop();
  }
}

export class Shaco_W_Bullet_Object extends SpellObject {
  isMissile = true;
  position = createVector();
  targetEnemy = null;
  speed = 10;
  damage = 7;
  hitEffectDuration = 300;
  timeSinceHit = 0;

  static PHASES = {
    MOVING: 0,
    HIT_EFFECT: 1,
  };

  phase = Shaco_W_Bullet_Object.PHASES.MOVING;

  // for display
  lazerWidth = 5;
  lazerLength = 20;
  strokeColor = [255, 255, 0];
  fillColor = [255, 150, 0];

  trailSystem = new TrailSystem({
    trailColor: [...this.strokeColor, 50],
    trailSize: this.lazerWidth,
    maxLength: 10,
  });

  update() {
    // move phase
    if (this.phase === Shaco_W_Bullet_Object.PHASES.MOVING) {
      if (this.position.dist(this.targetEnemy.position) > this.speed) {
        VectorUtils.moveVectorToVector(this.position, this.targetEnemy.position, this.speed);
        this.trailSystem.addTrail(this.position);
      } else {
        // hit target
        this.targetEnemy.takeDamage(this.damage, this.owner);
        this.phase = Shaco_W_Bullet_Object.PHASES.HIT_EFFECT;
      }
    }

    // hit effect phase
    else if (this.phase === Shaco_W_Bullet_Object.PHASES.HIT_EFFECT) {
      this.timeSinceHit += deltaTime;
      if (this.timeSinceHit >= this.hitEffectDuration) {
        this.toRemove = true;
      }
    }
  }

  draw() {
    push();

    // move phase
    if (this.phase === Shaco_W_Bullet_Object.PHASES.MOVING) {
      this.trailSystem.draw();

      let dir = VectorUtils.getDirectionVector(this.position, this.targetEnemy.position);
      strokeWeight(this.lazerWidth);
      stroke(...this.strokeColor);
      line(
        this.position.x - dir.x * this.lazerLength,
        this.position.y - dir.y * this.lazerLength,
        this.position.x,
        this.position.y
      );
    }

    // hit effect phase
    else if (this.phase === Shaco_W_Bullet_Object.PHASES.HIT_EFFECT) {
      // draw circle around target
      let targetSize = this.targetEnemy.stats.size.value;
      let alpha = map(this.timeSinceHit, 0, this.hitEffectDuration, 150, 0);
      let size = map(this.timeSinceHit, 0, this.hitEffectDuration, targetSize, targetSize + 50);
      stroke(...this.strokeColor, alpha + 20);
      fill(...this.fillColor, alpha);
      circle(this.targetEnemy.position.x, this.targetEnemy.position.y, size);
    }
    pop();
  }
}
