import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Stun from '../buffs/Stun.js';
import ParticleSystem from '../helpers/ParticleSystem.js';

export default class Veigar_E extends Spell {
  image = AssetManager.getAsset('spell_veigar_e');
  name = 'Bẻ Cong Không Gian (Veigar_E)';
  description =
    'Vặn xoắn không gian, tạo ra một lồng giam tồn tại trong <span class="time">3 giây</span>. <span class="buff">Làm Choáng</span> <span class="time">1.5 giây</span> những kẻ địch dám bước qua.';
  coolDown = 5000;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      300
    );

    let obj = new Veigar_E_Object(this.owner);
    obj.position = to;
    this.game.objectManager.addObject(obj);
  }
}

export class Veigar_E_Object extends SpellObject {
  position = this.owner.position.copy();
  prepairTime = 1000;
  lifeTime = 3000;
  age = 0;
  strokeWidth = 30;
  size = 300;

  static PHASES = {
    PREPAIRING: 0,
    ACTIVE: 1,
  };

  phase = Veigar_E_Object.PHASES.PREPAIRING;

  particleSystem = new ParticleSystem({
    isDeadFn: p => p.r <= 0,
    updateFn: p => {
      p.r -= 0.3;
      p.x += random(-1, 1);
      p.y += random(-1, 1);
    },
    preDrawFn: () => {
      let alpha = map(this.age, this.prepairTime, this.lifeTime, 150, 30);
      noStroke();
      fill(200, alpha);
    },
    drawFn: p => {
      ellipse(p.x, p.y, p.r * 2, p.r * 2);
    },
  });

  enemiesEffected = [];

  onAdded() {
    this.game.objectManager.addObject(this.particleSystem);
  }

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }

    // prepairing phase
    if (this.phase === Veigar_E_Object.PHASES.PREPAIRING) {
      if (this.age >= this.prepairTime) {
        this.phase = Veigar_E_Object.PHASES.ACTIVE;
      }
    }

    // active phase
    else if (this.phase === Veigar_E_Object.PHASES.ACTIVE) {
      // check collision
      let enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.excludeObjects(this.enemiesEffected),
          o => {
            let distance = o.position.dist(this.position);
            // collide with edge of the circle
            return (
              distance <= this.size / 2 + this.strokeWidth / 2 &&
              distance >= this.size / 2 - this.strokeWidth / 2
            );
          },
        ],
      });

      enemies.forEach(enemy => {
        let stunBuff = new Stun(1500, this.owner, enemy);
        stunBuff.image = AssetManager.getAsset('spell_veigar_e');
        enemy.addBuff(stunBuff);

        this.enemiesEffected.push(enemy);
      });

      // update particle system
      if (random() < 0.4) {
        let pos = p5.Vector.random2D()
          .mult(random(this.size / 2 + this.strokeWidth / 2, this.size / 2 - this.strokeWidth / 2))
          .add(this.position);
        this.particleSystem.addParticle({
          x: pos.x,
          y: pos.y,
          r: 10,
        });
      }
      this.particleSystem.update();
    }
  }

  draw() {
    push();
    if (this.phase === Veigar_E_Object.PHASES.PREPAIRING) {
      // draw arc animate from 0 to full circle in prepairTime
      let alpha = map(this.age, 0, this.prepairTime, 0, 200);
      let arcLength = map(this.age, 0, this.prepairTime, 0, TWO_PI);
      strokeWeight(this.strokeWidth);
      stroke(70, 40, 162, alpha);
      noFill();
      arc(this.position.x, this.position.y, this.size, this.size, 0, arcLength);
    } else {
      let alpha = map(this.age, this.prepairTime, this.lifeTime, 200, 10);
      strokeWeight(this.strokeWidth);
      stroke(70, 40, 162, alpha);
      noFill();
      ellipse(this.position.x, this.position.y, this.size, this.size);

      // draw 5 circles at the edge of the circle
      fill(100, 80, 200, alpha + 50);
      noStroke();
      for (let i = 0; i < 5; i++) {
        let angle = map(i, 0, 5, 0, TWO_PI);
        let x = this.position.x + (cos(angle) * this.size) / 2;
        let y = this.position.y + (sin(angle) * this.size) / 2;
        ellipse(x, y, this.strokeWidth + 10, this.strokeWidth + 10);
      }
    }
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2 - this.strokeWidth / 2,
      y: this.position.y - this.size / 2 - this.strokeWidth / 2,
      w: this.size + this.strokeWidth,
      h: this.size + this.strokeWidth,
      data: this,
    });
  }
}
