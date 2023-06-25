import { hasFlag } from '../../utils/index.js';
import Stats from '../Stats.js';
import StatusFlags from '../../enums/StatusFlags.js';
import BuffAddType from '../../enums/BuffAddType.js';
import ASSETS from '../../../assets/index.js';
import {
  Flash,
  Ghost,
  Heal,
  Blitzcrank_R,
  Blitzcrank_Q,
  Blitzcrank_W,
  Lux_E,
  Lux_R,
  Lux_Q,
  Yasuo_W,
  Yasuo_Q,
} from '../spells/index.js';

export default class Champion {
  static avatars = [];

  constructor(game, x, y) {
    this.game = game;
    this.position = createVector(x, y);
    this.destination = createVector(x, y);
    this.isAllied = true;
    this.avatar = random(Object.values(ASSETS.Champions));

    this.spells = [
      // internal spell
      new Blitzcrank_W(this),

      // normal spell
      new Blitzcrank_Q(this),
      new Yasuo_Q(this),
      new Blitzcrank_R(this),
      new Lux_R(this),

      // summoner spell
      new Flash(this),
      new Ghost(this),
    ];
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
    // update buffs
    this.buffs = this.buffs.filter(buff => !buff.isToRemove);
    for (let buff of this.buffs) {
      buff.update();
    }

    // update spells
    for (let spell of this.spells) {
      spell.update();
    }

    // move
    if (hasFlag(this.status, StatusFlags.CanMove)) this.move();

    this.animatedSize = lerp(this.animatedSize || 0, this.stats.size.value, 0.1);
    this.animatedHeight = lerp(this.animatedHeight || 0, this.stats.height.value, 0.07);
  }

  draw() {
    if (hasFlag(this.status, StatusFlags.NoRender)) return;
    let alpha = hasFlag(this.status, StatusFlags.Stealthed) ? 50 : 255;

    push();

    let size = this.animatedSize + this.animatedHeight;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;

    let pos = this.position.copy();
    // let isFlying = this.animatedHeight > 0;
    // if (isFlying) {
    //   pos.y -= this.animatedHeight;
    // }

    noStroke();
    fill(240, alpha);
    imageMode(CENTER);

    // draw shadow
    // if (isFlying) {
    //   fill(200, 100);
    //   circle(this.position.x, this.position.y, size - this.animatedHeight);
    // }

    // tint alpha for image
    if (alpha < 255) tint(255, alpha);
    image(this.avatar?.image, pos.x, pos.y, size, size);

    // draw circle around champion based on allies
    stroke(this.isAllied ? [0, 255, 0, alpha] : [255, 0, 0, alpha]);
    strokeWeight(3);
    noFill();
    circle(pos.x, pos.y, size);

    // draw direction to mouse
    let mousePos = this.game.camera.screenToWorld(mouseX, mouseY);
    let mouseDir = p5.Vector.sub(mousePos, pos).setMag(size / 1.75);
    stroke(255, alpha);
    strokeWeight(4);
    line(pos.x, pos.y, pos.x + mouseDir.x, pos.y + mouseDir.y);

    // draw health bar
    if (this !== this.game.player) {
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
    }

    for (let buff of this.buffs) {
      buff.draw();
    }

    pop();
  }

  toSATCircle() {
    return new SAT.Circle(
      new SAT.Vector(this.position.x, this.position.y),
      this.stats.size.value / 2
    );
  }
}
