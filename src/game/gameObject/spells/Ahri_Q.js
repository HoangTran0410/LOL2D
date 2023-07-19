import { Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Slow from '../buffs/Slow.js';
import { PredefinedParticleSystems } from '../helpers/ParticleSystem.js';
import TrailSystem from '../helpers/TrailSystem.js';

export default class Ahri_Q extends Spell {
  image = AssetManager.getAsset('spell_ahri_q');
  name = 'Quả Cầu Ma Thuật (Ahri_Q)';
  description =
    'Phóng quả cầu theo hướng chỉ định, khi tới giới hạn 350px, quả cầu sẽ quay lại. Gây <span class="damage">15 sát thương</span> và <span class="buff">Làm Chậm 50%</span> trong <span class="time">0.5 giây</span> trên cả đường đi và đường về của quả cầu';
  coolDown = 5000;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      350
    );

    let obj = new Ahri_Q_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    this.game.objectManager.addObject(obj);
  }

  onUpdate() {}
}

export class Ahri_Q_Object extends SpellObject {
  isMissile = true;
  position = createVector();
  destination = createVector();
  speed = 7;
  size = 35;

  speedBackward = 15;
  increaseSpeedBackward = 0.2;

  static PHASES = {
    FORWARD: 'FORWARD',
    BACKWARD: 'BACKWARD',
  };

  phase = Ahri_Q_Object.PHASES.FORWARD;

  playerEffected = [];
  trailSystem = new TrailSystem({
    trailColor: '#77F5',
    trailSize: this.size,
  });
  particleSystem = PredefinedParticleSystems.randomMovingParticlesDecreaseSize('#77f9');

  onAdded() {
    this.game.objectManager.addObject(this.trailSystem);
    this.game.objectManager.addObject(this.particleSystem);
  }

  update() {
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

    if (this.position.dist(this.destination) < this.speed) {
      if (this.phase === Ahri_Q_Object.PHASES.FORWARD) {
        this.destination = this.owner.position; // move back to owner
        this.playerEffected = []; // reset player effected
        this.speed = 0;
        this.phase = Ahri_Q_Object.PHASES.BACKWARD;
      } else {
        this.toRemove = true;
      }
    }

    // increase speed when move back to owner
    if (this.phase === Ahri_Q_Object.PHASES.BACKWARD) {
      this.speed = constrain(this.speed + this.increaseSpeedBackward, 0, this.speedBackward);
    }

    // trails
    this.trailSystem.addTrail(this.position);

    // dots
    if (this.phase === Ahri_Q_Object.PHASES.FORWARD && random() < 0.7) {
      let r = this.size / 2;
      this.particleSystem.addParticle({
        x: this.position.x + random(-r, r),
        y: this.position.y + random(-r, r),
        r: random(5, 10),
      });
    }
    this.particleSystem.update();

    // collide with enemy
    let enemies = this.game.queryPlayersInRange({
      position: this.position,
      range: this.size / 2,
      includePlayerSize: true,
      excludeTeamIds: [this.owner.teamId],
      excludePlayers: this.playerEffected,
    });

    enemies.forEach(enemy => {
      let slowBuff = new Slow(500, this.owner, enemy);
      slowBuff.percent = 0.5;
      slowBuff.image = AssetManager.getAsset('spell_ahri_q');
      enemy.addBuff(slowBuff);

      enemy.takeDamage(15, this.owner);
      this.playerEffected.push(enemy);
    });
  }

  draw() {
    let angle = this.destination.copy().sub(this.position).heading();

    push();
    translate(this.position.x, this.position.y);
    rotate(angle);
    fill('#77f');
    ellipse(0, 0, this.size - 5 + this.speed, this.size);
    pop();
  }

  getBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }
}
