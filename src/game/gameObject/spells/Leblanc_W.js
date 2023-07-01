import ASSETS from '../../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import SpellState from '../../enums/SpellState.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Dash from '../buffs/Dash.js';

export default class Leblanc_W extends Spell {
  PHASES = {
    W1: {
      image: ASSETS.Spells.leblanc_w,
    },
    W2: {
      image: ASSETS.Spells.leblanc_w2,
    },
  };
  phase = this.PHASES.W1;

  image = this.phase.image;
  name = 'Biến Ảnh (Leblanc_W)';
  description =
    'Phóng 1 khoảng cách theo hướng chỉ định, gây 20 sát thương, để lại 1 dị điểm tồn tại 3s tại ví trí cũ. Tái dùng chiêu sẽ dịch chuyển bạn về dị điểm.';
  coolDown = 5000;

  w1Object = null;
  w1LifeTime = 3000;
  waitTimeBeforeRecast = 1000;

  swtichPhase(phase, coolDown) {
    this.phase = phase;
    this.image = phase.image;
    this.currentCooldown = coolDown;

    if (coolDown > 0) {
      this.state = SpellState.COOLDOWN;
    }
  }

  onSpellCast() {
    if (this.phase == this.PHASES.W1) {
      let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
      let direction = mouse.copy().sub(this.owner.position);
      let distance = direction.mag();
      let maxDistance = 300;
      let destination = this.owner.position
        .copy()
        .add(direction.setMag(Math.min(distance, maxDistance)));

      // dash owner to destination
      let dashBuff = new Leblanc_W_Buff(2000, this.owner, this.owner);
      dashBuff.dashDestination = destination;
      dashBuff.onReachedDestination = () => {
        // effect at destination
        let w2Obj = new Leblanc_W_Object2(this.owner);
        w2Obj.position = destination.copy();
        w2Obj.lifeTime = 700;
        w2Obj.size = 200;
        this.game.objects.push(w2Obj);

        // enemy take damage
        let enemies = this.game.queryPlayerInRange({
          position: destination,
          range: w2Obj.size / 2,
          includePlayerSize: true,
        });
        enemies.forEach(enemy => {
          enemy.takeDamage(20, this.owner);
        });
      };

      this.owner.destination = destination;
      this.owner.addBuff(dashBuff);

      this.w1Object = new Leblanc_W_Object(this.owner);
      this.w1Object.position = this.owner.position.copy();
      this.w1Object.lifeTime = this.w1LifeTime;
      this.game.objects.push(this.w1Object);

      // switch to phase 2
      this.swtichPhase(this.PHASES.W2, this.waitTimeBeforeRecast);
    } else {
      if (this.w1Object) {
        this.owner.position.set(this.w1Object.position.x, this.w1Object.position.y);
        this.w1Object.toRemove = true;
      }

      // swith to phase 1
      this.swtichPhase(this.PHASES.W1, this.coolDown);
    }
  }

  onUpdate() {
    if (this.phase == this.PHASES.W2) {
      if (this.w1Object?.toRemove) {
        // switch to phase 1
        this.swtichPhase(this.PHASES.W1, this.coolDown);
      }
    }
  }
}

export class Leblanc_W_Buff extends Dash {
  image = ASSETS.Spells.leblanc_w;
  buffAddType = BuffAddType.REPLACE_EXISTING;
  dashSpeed = 10;
  dashDestination = createVector();
}

export class Leblanc_W_Object extends SpellObject {
  position = createVector();
  lifeTime = 3000;
  age = 0;

  update() {
    this.age += deltaTime;

    if (this.age >= this.lifeTime) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    let { stats, avatar } = this.owner;
    let size = stats.size.value;
    image(avatar.image, this.position.x - size / 2, this.position.y - size / 2, size, size);

    let alpha = map(this.age, 0, this.lifeTime, 0, 255);
    stroke('yellow');
    fill(180, 180, 120, alpha);
    circle(this.position.x, this.position.y, size);
    pop();
  }
}

export class Leblanc_W_Object2 extends Leblanc_W_Object {
  size = 200;
  draw() {
    push();
    let alpha = map(this.age, 0, this.lifeTime, 200, 0);

    stroke(100, alpha + 50);
    fill(200, 200, 50, alpha);
    circle(this.position.x, this.position.y, this.size);
    pop();
  }
}