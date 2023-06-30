import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Dash from '../buffs/Dash.js';

export default class Leblanc_W extends Spell {
  STATE = {
    W1: {
      image: ASSETS.Spells.leblanc_w,
      coolDown: 5000,
    },
    W2: {
      image: ASSETS.Spells.leblanc_w2,
      coolDown: 1000,
    },
  };
  currentState = this.STATE.W1;

  image = this.currentState.image;
  name = 'Biến Ảnh (Leblanc_W)';
  description =
    'Phóng 1 khoảng cách theo hướng chỉ định, gây 20 sát thương, để lại 1 dị điểm tồn tại 3s tại ví trí cũ. Tái dùng chiêu sẽ dịch chuyển bạn về dị điểm.';
  coolDown = this.STATE.W2.coolDown;

  timeSinceW1 = 0;
  w1Object = null;

  setCurrentState(state) {
    this.currentState = state;
    this.image = state.image;
    this.currentCooldown = state.coolDown;
    this.coolDown = Math.max(this.coolDown, state.coolDown);

    if (state == this.STATE.W1) {
      this.timeSinceW1 = 0;
    }
  }

  onSpellCast() {
    if (this.currentState == this.STATE.W1) {
      let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
      let direction = mouse.copy().sub(this.owner.position);
      let distance = direction.mag();
      let maxDistance = 300;
      let destination = this.owner.position
        .copy()
        .add(direction.setMag(Math.min(distance, maxDistance)));

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
      this.w1Object.lifeTime = this.STATE.W1.coolDown;
      this.game.objects.push(this.w1Object);

      this.setCurrentState(this.STATE.W2);
    } else {
      if (this.w1Object) {
        this.owner.position.set(this.w1Object.position.x, this.w1Object.position.y);
        this.w1Object.toRemove = true;
      }

      this.setCurrentState(this.STATE.W1);
    }
  }

  onUpdate() {
    if (this.currentState == this.STATE.W2) {
      this.timeSinceW1 += deltaTime;
      if (this.timeSinceW1 >= this.STATE.W1.coolDown) {
        if (this.w1Object) this.w1Object.toRemove = true;
        this.setCurrentState(this.STATE.W1);
        this.currentCooldown = 0;
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
