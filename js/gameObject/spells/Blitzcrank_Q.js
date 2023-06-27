import ASSETS from '../../../assets/index.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import RootBuff from '../buffs/Root.js';

export default class Blitzcrank_Q extends Spell {
  name = 'Bàn Tay Hỏa Tiễn (Blitzcrank_Q)';
  image = ASSETS.Spells.blitzcrank_q;
  description =
    'Bắn bàn tay theo hướng chỉ định, kéo kẻ địch đầu tiên trúng phải, gây 20 sát thương và làm choáng chúng trong 0.5 giây';
  coolDown = 5000;
  manaCost = 20;

  onSpellCast() {
    // if (this.owner == this.game.player) {
    //   let angle = random(TWO_PI);
    //   let num = 100;
    //   for (let i = 0; i < num; i++) {
    //     let pos = this.owner.position.copy().add(p5.Vector.fromAngle(angle).mult(500));
    //     let obj = new Blitzcrank_Q_Object(this.owner);
    //     obj.destination = pos;
    //     this.game.objects.push(obj);
    //     angle += TWO_PI / num;
    //   }
    // } else {
    this.blitObj = new Blitzcrank_Q_Object(this.owner);
    this.game.objects.push(this.blitObj);

    this.ownerStunBuff = new RootBuff(100000, this.owner, this.owner);
    this.owner.addBuff(this.ownerStunBuff);
    // }
  }

  onUpdate() {
    if (this.blitObj && (this.blitObj?.state == this.blitObj.STATE.GRAB || this.blitObj.toRemove)) {
      this.ownerStunBuff.deactivateBuff();
      this.blitObj = null;
    }
  }
}

export class Blitzcrank_Q_Object extends SpellObject {
  isMissile = true;

  init() {
    this.range = 500;
    this.speed = 10;
    this.grabSpeed = 10;
    this.position = this.owner.position.copy();

    let worldMouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = worldMouse.sub(this.position).normalize();
    this.destination = this.position.copy().add(direction.mult(this.range));

    this.STATE = {
      FORWARD: 'forward',
      GRAB: 'grab',
    };
    this.state = this.STATE.FORWARD;
  }

  update() {
    let distance = this.destination.dist(this.position);
    let speed = this.state == this.STATE.FORWARD ? this.speed : this.grabSpeed;
    if (distance < speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    } else {
      let direction = this.destination.copy().sub(this.position).setMag(speed);
      this.position.add(direction);
    }

    // check collision with enemy
    if (this.state == this.STATE.FORWARD) {
      for (let champ of this.game.players) {
        if (champ != this.owner) {
          let distance = champ.position.dist(this.position);
          if (distance < champ.stats.size.value / 2) {
            this.state = this.STATE.GRAB;
            this.champToGrab = champ;
            this.destination = this.owner.position;

            champ.addBuff(new Airborne(500, this.owner, champ));
            champ.takeDamage(20);
            break;
          }
        }
      }
    } else if (this.champToGrab) {
      this.champToGrab.position.set(this.position.x, this.position.y);
    }
  }

  draw() {
    push();

    // draw line from hand to owner
    let alpha = map(this.position.dist(this.owner.position), 0, this.range, 200, 0);
    stroke(255, alpha);
    strokeWeight(4);
    line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

    // draw hand with five circle fingers
    let handSize = 30;
    noStroke();
    fill(255, 150, 50);
    circle(this.position.x, this.position.y, handSize);

    fill(200, 100, 90);
    let dir = p5.Vector.sub(this.destination, this.position).normalize();
    for (let i = 0; i < 3; i++) {
      let angle = dir.heading() + (i - 1) * 0.5;
      let x = this.position.x + cos(angle) * handSize;
      let y = this.position.y + sin(angle) * handSize;
      circle(x, y, 15);
    }

    pop();
  }
}
