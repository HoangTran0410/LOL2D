import { Circle, Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import VectorUtils from '../../../utils/vector.utils';
import ParticleSystem from '../helpers/ParticleSystem';
import TrailSystem from '../helpers/TrailSystem';
import Slow from '../buffs/Slow';
import Speedup from '../buffs/Speedup';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export default class Olaf_Q extends Spell {
  image = AssetManager.getAsset('spell_olaf_q');
  name = 'Phóng Rìu (Olaf_Q)';
  description =
    'Ném rìu đến điểm chỉ định, gây <span class="damage">15 sát thương</span> và <span class="buff">Làm chậm 40%</span> trong <span class="time">1 giây</span> cho những kẻ địch trúng chiêu. Bạn được <span class="buff">Tăng Tốc 30%</span> trong <span class="time">1 giây</span> cho mỗi kẻ địch trúng chiêu. Rìu tồn tại trong <span class="time">4 giây</span>, nếu nhặt được rìu <span>thời gian hồi chiêu</span> được <span class="buff">Giảm 60%</span>.';
  coolDown = 7500;

  maxThrowRange = 350;
  axeLifeTime = 4000;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.maxThrowRange
    );

    const axe = new Olaf_Q_Object(this.owner);
    axe.destination = to;
    axe.position = from;
    axe.initialAngle = to.copy().sub(from).heading();
    axe.speed = 8.5;
    axe.waitForPickUpLifeTime = this.axeLifeTime;
    axe.damage = 15;
    axe.spellSource = this;
    this.game.objectManager.addObject(axe);
  }

  drawPreview() {
    super.drawPreview(this.maxThrowRange);
  }
}

export class Olaf_Q_Object extends SpellObject {
  isMissile = true;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  spellSource: Olaf_Q | null = null;
  angle = 0;
  initialAngle = 0;
  speed = 10;
  rotateSpeed = 0.25;
  size = 40;
  pickupRange = 100;
  timeSinceReachedDestination = 0;
  waitForPickUpLifeTime = 5000;
  damage = 15;
  color: [number, number, number] = [2, 151, 177];

  static PHASES = {
    FLYING: 'FLYING',
    WAIT_FOR_PICK_UP: 'WAIT_FOR_PICK_UP',
  };

  phase: string = Olaf_Q_Object.PHASES.FLYING;

  playerEffected: any[] = [];

  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: [...this.color, 100] as any,
  });
  particleSystem = new ParticleSystem({
    getParticlePosFn: (p: any) => p.position,
    getParticleSizeFn: (p: any) => p.size,
    isDeadFn: (p: any) => p.age > 1000,
    updateFn: (p: any) => {
      p.size += 1;
      p.age += deltaTime;
    },
    drawFn: (p: any) => {
      const alpha = map(p.age, 0, 1000, 200, 0);
      stroke(200, alpha + 10);
      (fill as any)(...(this.color as [number, number, number]), alpha);
      circle(p.position.x, p.position.y, p.size);
    },
  });

  onAdded() {
    this.game.objectManager.addObject(this.trailSystem);
    this.game.objectManager.addObject(this.particleSystem);
  }

  get willRotateRight() {
    return this.initialAngle > -PI / 2 && this.initialAngle < PI / 2;
  }

  update() {
    if (this.phase === Olaf_Q_Object.PHASES.FLYING) {
      if (this.willRotateRight) this.angle += this.rotateSpeed;
      else this.angle -= this.rotateSpeed;

      VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

      const axeHead = this.position.copy().add(p5.Vector.fromAngle(this.angle).mult(this.size / 2));
      this.trailSystem.addTrail(axeHead);

      if (this.position.dist(this.destination) < this.speed) {
        this.phase = Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP;
        this.isMissile = false;
      }

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.playerEffected),
        ],
      });

      enemies.forEach((enemy: any) => {
        const slowBuff = new Slow(1000, this.owner, enemy);
        slowBuff.image = AssetManager.getAsset('spell_olaf_q');
        slowBuff.percent = 0.4;
        enemy.addBuff(slowBuff);
        enemy.takeDamage(this.damage, this.owner);
        this.playerEffected.push(enemy);

        this.particleSystem.addParticle({
          position: enemy.position,
          size: enemy.stats.size.value + 20,
          age: 0,
        });
      });

      if (enemies.length > 0) {
        const speedUpBuff = new Speedup(1000, this.owner, this.owner);
        speedUpBuff.maxStacks = 3;
        speedUpBuff.image = AssetManager.getAsset('spell_olaf_q');
        speedUpBuff.percent = 0.3;
        this.owner.addBuff(speedUpBuff);
      }
    } else if (this.phase === Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP) {
      this.timeSinceReachedDestination += deltaTime;
      if (this.timeSinceReachedDestination >= this.waitForPickUpLifeTime) {
        this.toRemove = true;
      }

      if (
        this.owner.position.dist(this.position) <
        this.owner.stats.size.value / 2 + this.size / 2
      ) {
        if (this.spellSource) {
          this.spellSource.currentCooldown *= 0.4;
        }
        this.toRemove = true;
      }
    }
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    stroke('#eeea');
    strokeWeight(3);
    (fill as any)(...(this.color as [number, number, number]), 200);

    let shape: [number, number][] = [[-45, -10], [-10, -5], [30, -10], [35, 20], [0, 20], [10, 0], [-45, 0]];
    if (!this.willRotateRight) shape = shape.map(([x, y]) => [-x, y]);
    beginShape();
    shape.forEach(([x, y]) => vertex(x, y));
    endShape(CLOSE);

    pop();

    if (this.phase === Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP) {
      push();
      noFill();
      stroke(200, 100);
      const arcLength = map(
        this.timeSinceReachedDestination,
        0,
        this.waitForPickUpLifeTime,
        2 * PI,
        0
      );
      arc(this.position.x, this.position.y, this.pickupRange, this.pickupRange, 0, arcLength);
      pop();
    }
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.pickupRange / 2,
      y: this.position.y - this.pickupRange / 2,
      w: this.pickupRange,
      h: this.pickupRange,
      data: this,
    });
  }
}
