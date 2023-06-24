import ASSETS from '../../../assets/index.js';
import { rectToVertices } from '../../utils/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Yasuo_Q extends Spell {
  image = ASSETS.Spells.yasuo_q1;
  description =
    'Đâm lưỡi kiếm về hướng chỉ định, cộng dồn 2 lần sẽ tạo ra một cơn lốc lớn, hất tung kẻ địch trúng chiêu';
  coolDown = 1000;

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

  changeState(newState) {
    this.currentState = newState;
    this.image = newState.image;
  }

  onSpellCast() {
    if (this.currentState == this.States.Q1) {
      let obj = new Yasuo_Q_Object(this.owner);
      this.game.objects.push(obj);
    }
  }

  onUpdate() {}
}

export class Yasuo_Q_Object extends SpellObject {
  isMissile = false;
  position = this.owner.position.copy();
  destination = this.owner.direction.copy();
  rayWidth = 50;
  liveTime = 300;
  age = 0;

  update() {
    this.age += this.game.dt;
    if (this.age > this.liveTime) {
      this.toRemove = true;
    }
  }

  draw() {
    push();
    fill(255);
    // draw rect from position to destination, with rayWidth
    let dir = this.destination.copy().sub(this.position).normalize();
    let vertices = rectToVertices(this.position, dir, this.rayWidth, this.destination);
    beginShape();
    for (let v of vertices) {
      vertex(v.x, v.y);
    }
    endShape(CLOSE);
    pop();
  }
}
