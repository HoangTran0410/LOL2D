import { Circle, Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Fear from '../buffs/Fear';
import TrailSystem from '../helpers/TrailSystem';

export default class Shaco_W extends Spell {
  image = AssetManager.getAsset('spell_shaco_w');
  name = 'Hộp Hề Ma Quái (Shaco_W)';
  description =
    'Tạo một Hộp Hề Ma Quái tàng hình sau <span class="time">1 giây</span>, tồn tại trong <span class="time">20 giây</span>. Khi kẻ địch tới gần, nó sẽ gây <span class="buff">Hoảng Sợ</span> và tấn công các kẻ địch xung quanh trong <span class="time">3 giây</span>, gây <span class="damage">7 sát thương</span> mỗi lần tấn công';
  coolDown = 5000;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      100
    );

    const obj = new Shaco_W_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }
}

export class Shaco_W_Object extends SpellObject {
  isMissile = true;
  position: p5.Vector = this.owner.position.copy();
  destination: p5.Vector = this.owner.position.copy();
  invisibleAfter = 1000;
  moveSpeed = 6;
  lifeTime = 20000;
  age = 0;

  rangeToDraw = 0;
  fearRange = 70;
  attackRange = 100;
  attackCooldown = 500;
  attackDamage = 7;
  attackMaxCount = 3;
  timeSinceLastAttack = this.attackCooldown;
  attackLifeTime = 3000;

  static PHASES = {
    WAIT_FOR_INVISIBLE: 0,
    INVISIBLE: 1,
    ATTACKING: 2,
  } as const;
  phase: (typeof Shaco_W_Object.PHASES)[keyof typeof Shaco_W_Object.PHASES] =
    Shaco_W_Object.PHASES.WAIT_FOR_INVISIBLE;

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
      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.fearRange,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.teamId)],
      });

      if (enemies.length > 0) {
        // fear all nearby enemies
        enemies.forEach((enemy: any) => {
          const fearBuff = new Fear(1000, this.owner, enemy);
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
        const enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: this.position.x,
            y: this.position.y,
            r: this.attackRange,
          }),
          filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
        });

        if (enemies.length > 0) {
          enemies.forEach((enemy: any) => {
            const bullet = new Shaco_W_Bullet_Object(this.owner);
            bullet.position = this.position.copy();
            bullet.targetEnemy = enemy;
            bullet.damage = this.attackDamage;
            this.game.objectManager.addObject(bullet);
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
      fill(255);
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
      const size = Math.min(map(this.timeSinceLastAttack, 0, this.attackCooldown, 0, 10), 30);
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
  position: p5.Vector = createVector();
  targetEnemy: any = null;
  speed = 10;
  damage = 7;
  hitEffectDuration = 300;
  timeSinceHit = 0;

  static PHASES = {
    MOVING: 0,
    HIT_EFFECT: 1,
  } as const;
  phase: (typeof Shaco_W_Bullet_Object.PHASES)[keyof typeof Shaco_W_Bullet_Object.PHASES] =
    Shaco_W_Bullet_Object.PHASES.MOVING;

  // for display
  lazerWidth = 5;
  lazerLength = 20;
  strokeColor: [number, number, number] = [255, 255, 0];
  fillColor: [number, number, number] = [255, 150, 0];

  trailSystem = new TrailSystem({
    trailColor: [...this.strokeColor, 50] as any,
    trailSize: this.lazerWidth,
    maxLength: 10,
  });

  onAdded() {
    this.game.objectManager.addObject(this.trailSystem);
  }

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
      const dir = VectorUtils.getDirectionVector(this.position, this.targetEnemy.position);
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
      const targetSize = this.targetEnemy.stats.size.value;
      const alpha = map(this.timeSinceHit, 0, this.hitEffectDuration, 150, 0);
      const size = map(this.timeSinceHit, 0, this.hitEffectDuration, targetSize, targetSize + 50);
      stroke(...this.strokeColor, alpha + 20);
      fill(...this.fillColor, alpha);
      circle(this.targetEnemy.position.x, this.targetEnemy.position.y, size);
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.lazerLength,
      y: this.position.y - this.lazerLength,
      w: this.lazerLength * 2,
      h: this.lazerLength * 2,
      data: this,
    });
  }
}
