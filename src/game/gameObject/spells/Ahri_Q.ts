import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Slow from '../buffs/Slow';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem';
import TrailSystem from '../helpers/TrailSystem';

export default class Ahri_Q extends Spell {
  image = AssetManager.get('spell_ahri_q');
  name = 'Quả Cầu Ma Thuật (Ahri_Q)';
  description =
    'Phóng quả cầu theo hướng chỉ định, khi tới giới hạn 350px, quả cầu sẽ quay lại. Gây <span class="damage">15 sát thương</span> và <span class="buff">Làm Chậm 50%</span> trong <span class="time">0.5 giây</span> trên cả đường đi và đường về của quả cầu';
  coolDown = 5000;

  onSpellCast() {
    const { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.aimPoint,
      350
    );

    const obj = new Ahri_Q_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }

  onUpdate() {}
}

export class Ahri_Q_Object extends MissileSpellObject {
  speed = 7;
  size = 35;
  // the orb turns around at max range instead of dying there
  removeOnArrive = false;

  speedBackward = 15;
  increaseSpeedBackward = 0.2;

  static PHASES = {
    FORWARD: 'FORWARD',
    BACKWARD: 'BACKWARD',
  } as const;

  phase: (typeof Ahri_Q_Object.PHASES)[keyof typeof Ahri_Q_Object.PHASES] =
    Ahri_Q_Object.PHASES.FORWARD;

  trailSystem = new TrailSystem({
    trailColor: '#77F5',
    trailSize: this.size,
  });
  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#77f9');

  onAdded() {
    super.onAdded();
    this.game.objectManager.addObject(this.particleSystem);
  }

  onBeforeMove() {
    // increase speed when move back to owner
    if (this.phase === Ahri_Q_Object.PHASES.BACKWARD) {
      this.speed = constrain(this.speed + this.increaseSpeedBackward, 0, this.speedBackward);
    }
  }

  onArrive() {
    if (this.phase === Ahri_Q_Object.PHASES.FORWARD) {
      this.destination = this.owner.position; // move back to owner (live ref: follows the owner)
      this.hitTargets = []; // the return trip may hit the same enemies again
      this.speed = 0;
      this.phase = Ahri_Q_Object.PHASES.BACKWARD;
    } else {
      this.toRemove = true;
    }
  }

  onHit(enemy: any) {
    const slowBuff = new Slow(500, this.owner, enemy);
    slowBuff.percent = 0.5;
    enemy.addBuff(slowBuff);

    enemy.takeDamage(15, this.owner);
  }

  update() {
    super.update();

    // dots
    if (this.phase === Ahri_Q_Object.PHASES.FORWARD && random() < 0.7) {
      const r = this.size / 2;
      this.particleSystem.addParticle({
        x: this.position.x + random(-r, r),
        y: this.position.y + random(-r, r),
        r: random(5, 10),
      });
    }
  }

  draw() {
    const angle = this.destination.copy().sub(this.position).heading();

    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    fill('#77f');
    ellipse(0, 0, this.size - 5 + this.speed, this.size);
    pop();
  }
}
