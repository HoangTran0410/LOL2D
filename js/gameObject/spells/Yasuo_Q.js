import ASSETS from '../../../assets/index.js';
import { collidePolygonPoint, rectToVertices } from '../../utils/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import RootBuff from '../buffs/Root.js';

export default class Yasuo_Q extends Spell {
  image = ASSETS.Spells.yasuo_q1;
  name = 'Bão Kiếm (Yasuo_Q)';
  description =
    'Đâm lưỡi kiếm về hướng chỉ định, cộng dồn 2 lần sẽ tạo ra một cơn lốc lớn, hất tung kẻ địch trúng chiêu';
  coolDown = 4000;

  States = {
    Q1: {
      image: ASSETS.Spells.yasuo_q1,
    },
    Q2: {
      image: ASSETS.Spells.yasuo_q2,
    },
    Q3: {
      image: ASSETS.Spells.yasuo_q3,
    },
  };
  currentState = this.States.Q1;
  coolDownIfHit = 1000;
  hitStackCount = 0;
  lastHitTime = 0;
  timeToResetHitStack = 3000;

  changeState(newState) {
    this.currentState = newState;
    this.image = newState.image;
  }

  onSpellCast() {
    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let angle = mouse.sub(this.owner.position).heading();

    // Q1, Q2
    if (this.currentState == this.States.Q1 || this.currentState == this.States.Q2) {
      const stunTime = 300,
        range = 150,
        rayWidth = 30;

      let obj = new Yasuo_Q_Object(this.owner);
      obj.angle = angle;
      obj.lifeTime = stunTime;
      obj.range = range;
      obj.rayWidth = rayWidth;
      obj.onHit = champ => {
        this.hitStackCount++;
        this.lastHitTime = Date.now();
        this.currentCooldown = this.coolDownIfHit;
      };

      this.game.objects.push(obj);

      // stay while casting
      this.owner.addBuff(new RootBuff(stunTime, this.owner, this.owner));
    }

    // Q3
    else if (this.currentState == this.States.Q3) {
      const airBorneTime = 1000,
        range = 400;

      let destination = this.owner.position.copy().add(p5.Vector.fromAngle(angle).mult(range));

      let tornado = new Yasuo_Q3_Object(this.owner);
      tornado.destination = destination;
      tornado.airBorneTime = airBorneTime;
      this.game.objects.push(tornado);
    }
  }

  onUpdate() {
    // reset hit stack if not hit for a while
    if (this.lastHitTime + this.timeToResetHitStack < Date.now()) {
      this.hitStackCount = 0;
      if (!this.currentState != this.States.Q1) this.changeState(this.States.Q1);
    }
    this.hitStackCount = constrain(this.hitStackCount, 0, 2);

    // if hit once, change state to Q2
    if (this.currentState == this.States.Q1) {
      if (this.hitStackCount == 1) {
        this.changeState(this.States.Q2);
      }
    }

    // if hit twice, change state to Q3
    else if (this.currentState == this.States.Q2) {
      if (this.hitStackCount == 2) {
        this.changeState(this.States.Q3);
      }
    }

    // Q3
    else {
    }
  }
}

export class Yasuo_Q_Object extends SpellObject {
  isMissile = false;
  position = this.owner.position.copy();
  angle = 0;
  range = 130;
  rayWidth = 25;
  raySpeed = 30;
  currentRayLength = 0;

  lifeTime = 200;
  age = 0;

  playersEffected = [];

  update() {
    this.currentRayLength += this.raySpeed;
    if (this.currentRayLength > this.range) {
      this.currentRayLength = this.range;
    }

    // check collide with enemy
    for (let p of this.game.players) {
      if (p != this.owner && !this.playersEffected.includes(p)) {
        let vertices = rectToVertices(
          this.owner.position.x,
          this.owner.position.y - this.rayWidth / 2 - p.stats.size.value / 2,
          this.currentRayLength,
          this.rayWidth + p.stats.size.value,
          this.angle,
          {
            x: this.owner.position.x,
            y: this.owner.position.y,
          }
        );

        if (collidePolygonPoint(vertices, p.position.x, p.position.y)) {
          let buff = new RootBuff(this.lifeTime / 2, this.owner, p);
          buff.image = ASSETS.Spells.yasuo_q1;
          p.addBuff(buff);

          this.playersEffected.push(p);
          this.onHit?.(p);
        }
      }
    }

    this.age += deltaTime;
    if (this.age > this.lifeTime) this.toRemove = true;
  }

  draw() {
    push();
    let triangleHeight = this.rayWidth / 2;
    let alpha = map(this.age, 0, this.lifeTime, 255, 150);

    translate(this.owner.position.x, this.owner.position.y);
    rotate(this.angle);
    noStroke();
    fill(200, alpha);
    rect(0, -this.rayWidth / 2, this.currentRayLength - triangleHeight, this.rayWidth);

    // draw triangle
    beginShape();
    vertex(this.currentRayLength - triangleHeight, -triangleHeight);
    vertex(this.currentRayLength - triangleHeight, triangleHeight);
    vertex(this.currentRayLength, 0);
    endShape(CLOSE);
    pop();
  }
}

export class Yasuo_Q3_Object extends SpellObject {
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  speed = 4;
  size = 30;
  sizeIncreaseSpeed = 2;
  airBorneTime = 1000;
  angle = 0;

  playerEffected = [];

  update() {
    if (!this.originalLength) {
      this.originalLength = this.destination.dist(this.position);
    }

    this.size += this.sizeIncreaseSpeed;
    this.angle += 0.2;

    let distance = this.position.dist(this.destination);
    if (distance < this.speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    } else {
      this.position.add(
        p5.Vector.sub(this.destination, this.position).normalize().mult(this.speed)
      );
    }

    // check collide with enemy
    for (let p of this.game.players) {
      if (p != this.owner && !this.playerEffected.includes(p)) {
        if (p.position.dist(this.position) < this.size / 2 + p.stats.size.value / 2) {
          let buff = new Airborne(this.airBorneTime, this.owner, p);
          buff.image = ASSETS.Spells.yasuo_q3;
          p.addBuff(buff);

          this.playerEffected.push(p);
        }
      }
    }
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    // let alpha = map(this.position.dist(this.destination), 0, this.originalLength, 10, 255);
    // fill(90, 100, 180, alpha);
    // stroke(150, 105, 180, 100);
    // strokeWeight(2);
    // circle(0, 0, this.size);
    rotate(this.angle);
    imageMode(CENTER);
    image(ASSETS.Objects.yasuo_q3.image, 0, 0, this.size, this.size);

    pop();
  }
}
