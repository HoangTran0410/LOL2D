import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Slow from '../buffs/Slow';
import ParticleSystem from '../helpers/ParticleSystem';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export default class Zed_E extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_zed_e');
  name = 'Đường kiếm bóng tối (Zed_E)';
  description =
    'Xoay lưỡi kiếm xung quanh bản thân. Gây <span class="damage">15 sát thương</span> và <span class="buff">Làm chậm 30%</span> các kẻ địch trong <span class="time">1 giây</span>';
  coolDown = 1000;

  onSpellCast() {
    const obj = new Zed_E_Object(this.owner);
    // the blade sweeps around Zed's body, so it goes when the body does
    obj.attachTo(this.owner);
    this.game.objectManager.addObject(obj);
  }
}

export class Zed_E_Object extends SpellObject {
  angle = 0;
  angleSpeed = 0.5;
  radius = 100;
  damage = 15;
  slowPercent = 0.3;
  slowDuration = 1000;

  /** Hit once each, as the blade sweeps past them. */
  playersEffected: any[] = [];

  particleSystem = new ParticleSystem({
    getParticlePosFn: (p: any) => p.position,
    getParticleSizeFn: () => 10,
    isDeadFn: (p: any) => p.lifeSpan <= 0,
    updateFn: (p: any) => {
      p.position.add(p.velocity);
      p.lifeSpan -= deltaTime;
    },
    drawFn: (p: any) => {
      const alpha = map(p.lifeSpan, 0, p.lifeTime, 100, 255);
      stroke(255, 234, 79, alpha);
      strokeWeight(random(3, 8));
      const len = p.velocity.copy().setMag(random(5, 10));
      line(p.position.x, p.position.y, p.position.x + len.x, p.position.y + len.y);
    },
  });

  onAdded() {
    this.game.objectManager.addObject(this.particleSystem);
  }

  onRemoved() {}

  update() {
    if (this.dropIfAttachmentLost()) return;

    this.position.set(this.owner.position.x, this.owner.position.y);

    this.angle += this.angleSpeed;
    if (this.angle > 2 * Math.PI) {
      this.toRemove = true;
      return;
    }

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.radius,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.excludeObjects(this.playersEffected),
      ],
    });

    for (const enemy of enemies) {
      const bearing = Math.atan2(
        enemy.position.y - this.position.y,
        enemy.position.x - this.position.x
      );

      // the blade is a bar through the centre, so both ends sweep at once —
      // fold the difference into [0, PI/2] and hit whichever end arrives
      let delta = Math.abs(((this.angle - bearing + Math.PI) % (2 * Math.PI)) - Math.PI);
      delta = Math.min(delta, Math.PI - delta);
      // wide enough that a bearing can never slip between two frames' angles
      if (delta > this.angleSpeed) continue;

      enemy.takeDamage(this.damage, this.owner);

      const slowBuff = new Slow(this.slowDuration, this.owner, enemy);
      slowBuff.percent = this.slowPercent;
      enemy.addBuff(slowBuff);

      this.playersEffected.push(enemy);
      this.particleSystem.addParticle({
        position: enemy.position.copy(),
        velocity: p5.Vector.fromAngle(bearing).mult(random(1, 3)),
        lifeSpan: 300,
        lifeTime: 300,
      });
    }
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    fill(200);
    rect(-this.radius, -5, this.radius * 2, 10);

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.radius,
      y: this.position.y - this.radius,
      w: this.radius * 2,
      h: this.radius * 2,
      data: this,
    });
  }
}
