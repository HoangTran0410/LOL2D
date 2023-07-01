import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Dash from '../buffs/Dash.js';
import RootBuff from '../buffs/Root.js';

export default class Blitzcrank_Q extends Spell {
  name = 'Bàn Tay Hỏa Tiễn (Blitzcrank_Q)';
  image = AssetManager.getAsset('spell_blitzcrank_q');
  description =
    'Bắn bàn tay theo hướng chỉ định, kéo kẻ địch đầu tiên trúng phải, gây 20 sát thương và làm choáng chúng trong 0.5 giây';
  coolDown = 5000;
  manaCost = 20;

  onSpellCast() {
    this.blitObj = new Blitzcrank_Q_Object(this.owner);
    this.game.objects.push(this.blitObj);

    this.ownerStunBuff = new RootBuff(100000, this.owner, this.owner);
    this.ownerStunBuff.image = this.image;
    this.owner.addBuff(this.ownerStunBuff);
  }

  onUpdate() {
    if (this.blitObj) {
      if (this.blitObj.phase == this.blitObj.PHASES.GRAB || this.blitObj.toRemove) {
        this.ownerStunBuff.deactivateBuff();
      }

      if (this.blitObj.toRemove) {
        this.blitObj = null;
      }
    }
  }
}

export class Blitzcrank_Q_Object extends SpellObject {
  isMissile = true;

  airborneBuff = null;
  dashBuff = null;
  champToGrab = null;

  init() {
    this.range = 500;
    this.speed = 10;
    this.grabSpeed = 10;
    this.position = this.owner.position.copy();

    let worldMouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let direction = worldMouse.sub(this.position).normalize();
    this.destination = this.position.copy().add(direction.mult(this.range));

    this.PHASES = {
      FORWARD: 'forward',
      GRAB: 'grab',
    };
    this.phase = this.PHASES.FORWARD;
  }

  update() {
    let distance = this.destination.dist(this.position);
    let speed = this.phase == this.PHASES.FORWARD ? this.speed : this.grabSpeed;
    if (distance < speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    } else {
      let direction = this.destination.copy().sub(this.position).setMag(speed);
      this.position.add(direction);
    }

    // check collision with enemy
    if (this.phase == this.PHASES.FORWARD) {
      for (let champ of this.game.players) {
        if (champ != this.owner && !champ.isDead) {
          let distance = champ.position.dist(this.position);
          if (distance < champ.stats.size.value / 2) {
            this.phase = this.PHASES.GRAB;
            this.champToGrab = champ;
            this.destination = this.owner.position;

            this.airborneBuff = new Airborne(999999, this.owner, champ);
            this.airborneBuff.image = AssetManager.getAsset('spell_blitzcrank_q');
            champ.addBuff(this.airborneBuff);

            this.dashBuff = new Dash(999999, this.owner, champ);
            this.dashBuff.showTrail = false;
            this.dashBuff.cancelable = false;
            champ.addBuff(this.dashBuff);

            champ.takeDamage(20, this.owner);
            break;
          }
        }
      }
    } else if (this.champToGrab) {
      this.dashBuff.destination = this.owner.position.copy();
      this.champToGrab.position.set(this.position.x, this.position.y);

      if (this.champToGrab.isDead) {
        this.toRemove = true;
      }
    }
  }

  onBeforeRemove() {
    this.airborneBuff?.deactivateBuff?.();
    this.dashBuff?.deactivateBuff?.();
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
