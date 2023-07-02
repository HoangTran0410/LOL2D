import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import RootBuff from '../buffs/Root.js';

export default class Leblanc_E extends Spell {
  image = AssetManager.getAsset('spell_leblanc_e');
  name = 'Sợi Xích Siêu Phàm (Leblanc_E)';
  description =
    'Phóng 1 sợi xích theo hướng chỉ định, gây 15 sát thương khi trúng địch. Nếu giữ được trong tầm sau 1.5s, trói chân địch trong 1.5s và gây thêm 15 sát thương';
  coolDown = 5000;

  spellObject = null;

  checkCastCondition() {
    return !this.spellObject;
  }

  onSpellCast() {
    const range = 400,
      stunTime = 1500,
      hitDamage = 15,
      stunDamage = 15,
      stunAfter = 1500,
      speed = 10,
      size = 25;

    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = mouse.sub(this.owner.position).normalize();
    let destination = this.owner.position.copy().add(direction.mult(range));

    let obj = new Leblanc_E_Object(this.owner);
    obj.destination = destination;
    obj.stunTime = stunTime;
    obj.hitDamage = hitDamage;
    obj.stunDamage = stunDamage;
    obj.stunAfter = stunAfter;
    obj.speed = speed;
    obj.range = range;
    obj.size = size;
    this.spellObject = obj;

    this.game.objects.push(obj);
  }

  onUpdate() {
    if (this.spellObject && this.spellObject.toRemove) {
      this.spellObject = null;
    }
  }
}

export class Leblanc_E_Buff extends RootBuff {
  image = AssetManager.getAsset('spell_leblanc_e');

  effectColor = [255, 255, 0];
}

export class Leblanc_E_Object extends SpellObject {
  isMissile = true;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  speed = 10;
  size = 25;

  range = 500;
  hitDamage = 15;
  stunDamage = 15;
  stunTime = 1500;
  stunAfter = 2500;
  enemyHit = null;
  timeSinceHit = 0;

  PHASES = {
    MOVING: 0,
    WAITING_FOR_STUN: 1,
  };
  phase = this.PHASES.MOVING;

  update() {
    // moving phase
    if (this.phase == this.PHASES.MOVING) {
      this.position.add(this.destination.copy().sub(this.position).setMag(this.speed));

      // remove if reach destination but not hit enemy
      let distance = this.destination.dist(this.position);
      if (distance <= this.speed) {
        this.toRemove = true;
      }

      // check collide enemy
      let enemies = this.game.queryPlayerInRange({
        position: this.position,
        range: this.size,
        includePlayerSize: true,
      });
      if (enemies.length > 0) {
        this.enemyHit = enemies[0];
        this.enemyHit.takeDamage(this.hitDamage, this.owner);
        this.isMissile = false; // cant be blocked after hit enemy
        this.phase = this.PHASES.WAITING_FOR_STUN;
      }
    }

    // stun phase
    else if (this.phase == this.PHASES.WAITING_FOR_STUN) {
      this.timeSinceHit += deltaTime;
      this.position = this.enemyHit.position.copy();

      // remove if enemy dead
      if (this.enemyHit.isDead) {
        this.toRemove = true;
      }

      // stun enemy after stunAfter
      else if (this.timeSinceHit >= this.stunAfter) {
        if (this.enemyHit) {
          let rootBuff = new Leblanc_E_Buff(this.stunTime, this.owner, this.enemyHit);
          this.enemyHit.addBuff(rootBuff);
          this.enemyHit.takeDamage(this.stunDamage, this.owner);
        }

        this.toRemove = true;
      }

      // remove if enemy out of range
      else {
        let distance = this.position.dist(this.owner.position);
        if (distance > this.range) {
          this.toRemove = true;
        }
      }
    }
  }

  draw() {
    push();

    let alpha = this.enemyHit
      ? 255
      : Math.max(map(this.owner.position.dist(this.position), 0, this.range, 255, 50), 50);

    stroke(200, 200, 40, alpha);
    strokeWeight(4 + this.timeSinceHit / 200);
    line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

    noStroke();
    fill(200, 200, 40, alpha);
    circle(this.position.x, this.position.y, this.size);
    pop();
  }
}
