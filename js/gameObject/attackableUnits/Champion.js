import { hasFlag } from '../../utils/index.js';
import Stats from '../Stats.js';
import StatusFlags from '../../enums/StatusFlags.js';
import BuffAddType from '../../enums/BuffAddType.js';

export default class Champion {
  static avatars = [];

  constructor(game, x, y) {
    this.game = game;
    this.position = createVector(x, y);
    this.destination = createVector(x, y);
    this.isAllied = true;
    this.avatar = random(Champion.avatars);

    this.spells = [];
    this.buffs = [];
    this.stats = new Stats();
    this.status = StatusFlags.CanCast | StatusFlags.CanMove | StatusFlags.Targetable;
  }

  // setStatus(status, enabled) {
  //   let _statusBeforeApplyingBuffEfects = 0;
  //   if (enabled) _statusBeforeApplyingBuffEfects |= status;
  //   else _statusBeforeApplyingBuffEfects &= ~status;

  //   this.status =
  //     (_statusBeforeApplyingBuffEfects & ~this._buffEffectsToDisable) | this._buffEffectsToEnable;
  // }

  moveTo(x, y) {
    this.destination = createVector(x, y);
  }

  move() {
    const direction = p5.Vector.sub(this.destination, this.position);
    const distance = direction.mag();
    const delta = Math.min(distance, this.stats.speed.value);

    this.position.add(direction.setMag(delta));
  }

  updateBuff() {
    this.buffs = this.buffs.filter(buff => !buff.isToRemove);

    for (let buff of this.buffs) {
      buff.update();
    }
  }

  addBuff(buff) {
    let preBuffs = this.buffs.filter(_buff => _buff.name == buff.name);

    switch (buff.buffAddType) {
      case BuffAddType.REPLACE_EXISTING:
        // remove all buffs with the same name
        for (let b of preBuffs) b.deactivateBuff();
        // add new buff
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.RENEW_EXISTING:
        if (preBuffs.length > 0) {
          preBuffs[0].renewBuff();
        } else {
          this.buffs.push(buff);
          buff.activateBuff();
        }
        break;

      case BuffAddType.STACKS_AND_CONTINUE:
        if (preBuffs.length >= buff.maxStacks) {
          buff.timeElapsed = preBuffs[0].timeElapsed; // continue from current timeElapsed
          preBuffs[0].deactivateBuff();
        }
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.STACKS_AND_OVERLAPS:
        // remove oldest buff
        if (preBuffs.length >= buff.maxStacks) {
          preBuffs[0].deactivateBuff();
        }

        // add new buff
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      case BuffAddType.STACKS_AND_RENEWS:
        // renew preBuffs
        for (let b of preBuffs) b.renewBuff();

        // remove oldest buff (if maxStacks is reached)
        if (preBuffs.length >= buff.maxStacks) {
          preBuffs[0].deactivateBuff();
        }

        // add new buff
        this.buffs.push(buff);
        buff.activateBuff();
        break;

      default:
        break;
    }
  }

  update() {
    this.updateBuff();
    if (hasFlag(this.status, StatusFlags.CanMove)) this.move();
  }

  draw() {
    if (hasFlag(this.status, StatusFlags.NoRender)) return;
    let alpha = hasFlag(this.status, StatusFlags.Stealthed) ? 50 : 255;

    push();

    this.animatedSize = lerp(this.animatedSize || 0, this.stats.size.value, 0.3);
    let size = this.animatedSize;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;

    noStroke();
    fill(240, alpha);
    imageMode(CENTER);

    // tint alpha for image
    if (alpha < 255) tint(255, alpha);
    image(this.avatar, this.position.x, this.position.y, size, size);

    // draw circle around champion based on allies
    stroke(this.isAllied ? [0, 255, 0, alpha] : [255, 0, 0, alpha]);
    strokeWeight(3);
    noFill();
    circle(this.position.x, this.position.y, size);

    // draw direction to mouse
    let mousePos = this.game.camera.screenToWorld(mouseX, mouseY);
    let mouseDir = p5.Vector.sub(mousePos, this.position).setMag(size / 1.75);
    stroke(255, alpha);
    strokeWeight(4);
    line(
      this.position.x,
      this.position.y,
      this.position.x + mouseDir.x,
      this.position.y + mouseDir.y
    );

    // draw health bar
    let x = this.position.x,
      y = this.position.y + size / 2 + 15,
      w = 100,
      h = 13;

    noStroke();
    fill(70, alpha);
    rect(x - w / 2, y - h / 2, w, h); // background
    fill(this.isAllied ? [0, 150, 0, 180] : [150, 0, 0, 180]);
    rect(x - w / 2, y - h / 2, w * (health / maxHealth), h); // health

    fill(255);
    textAlign(CENTER, CENTER);
    textSize(13);
    text(Math.ceil(health), x, y);
    pop();
  }

  toSATCircle() {
    return new SAT.Circle(
      new SAT.Vector(this.position.x, this.position.y),
      this.stats.size.value / 2
    );
  }
}
