import { Circle, Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import VectorUtils from '../../../utils/vector.utils';
import ParticleSystem from '../helpers/ParticleSystem';
import TrailSystem from '../helpers/TrailSystem';
import Slow from '../buffs/Slow';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export default class Zed_Q extends Spell {
  image = AssetManager.getAsset('spell_zed_q');
  name = 'Phi tiêu sắc lẻm (Zed_Q)';
  description =
    'Phóng 1 phi tiêu về phía trước, gây <span class="damage">15 sát thương</span> và <span class="buff">làm chậm 50%</span> trong <span class="time">0.2 giây</span> cho mỗi kẻ địch bị xuyên qua.';
  coolDown = 3000;

  maxThrowRange = 350;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.maxThrowRange
    );

    const shuriken = new Zed_Q_Object(this.owner);
    shuriken.destination = to;
    shuriken.position = from;
    shuriken.speed = 8.5;
    shuriken.damage = 15;
    this.game.objectManager.addObject(shuriken);
  }

  onUpdate() {}
}

export class Zed_Q_Object extends SpellObject {
  isMissile = true;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  angle = 0;
  speed = 11;
  rotateSpeed = -0.5;
  size = 40;
  damage = 20;
  color: [number, number, number] = [205, 102, 147];
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

  onRemoved() {}

  update() {
    this.angle += this.rotateSpeed;

    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

    const head = this.position.copy().add(p5.Vector.fromAngle(this.angle).mult(5));
    this.trailSystem.addTrail(head);

    if (this.position.dist(this.destination) < this.speed) {
      this.toRemove = true;
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
      const slowBuff = new Slow(200, this.owner, enemy);
      slowBuff.image = AssetManager.getAsset('spell_zed_q');
      slowBuff.percent = 0.5;
      enemy.addBuff(slowBuff);

      enemy.takeDamage(this.damage, this.owner);
      this.playerEffected.push(enemy);
      this.particleSystem.addParticle({
        position: enemy.position,
        size: enemy.stats.size.value + 20,
        age: 0,
      });
    });
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    stroke('#111a');
    strokeWeight(3);
    const alpha = Math.min(255, this.position.dist(this.destination) + 50);
    (fill as any)(...(this.color as [number, number, number]), alpha);

    const shape: [number, number][] = [
      [0, -25], [0, 0], [25, -25], [25, 0], [0, 0], [26, 25], [0, 25], [0, 0], [-25, 25], [-25, 0], [0, 0], [-25, -25],
    ];
    beginShape();
    shape.forEach(([x, y]) => vertex(x, y));
    endShape(CLOSE);

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
