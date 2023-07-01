import { hasFlag, shuffleArray } from '../../../utils/index.js';
import Stats from '../Stats.js';
import StatusFlags from '../../enums/StatusFlags.js';
import BuffAddType from '../../enums/BuffAddType.js';
import * as AllSpells from '../spells/index.js';
import Airborne from '../buffs/Airborne.js';
import Root from '../buffs/Root.js';
import Silence from '../buffs/Silence.js';
import Dash from '../buffs/Dash.js';
import Stun from '../buffs/Stun.js';
import AssetManager from '../../../managers/AssetManager.js';

export default class Champion {
  constructor(game, x, y) {
    this.game = game;
    this.position = createVector(x, y);
    this.destination = createVector(x, y);
    this.isAllied = true;
    this.avatar = AssetManager.getRandomChampion();

    this.score = 0;
    this.reviveAfter = 0;

    this.spells = shuffleArray(Object.values(AllSpells))
      .slice(0, 7)
      .map(Spell => new Spell(this));

    // this.spells = [
    //   // internal spell
    //   new AllSpells.Blitzcrank_W(this),

    //   // normal spell
    //   new AllSpells.Yasuo_Q(this),
    //   new AllSpells.Yasuo_W(this),
    //   new AllSpells.Blitzcrank_Q(this),
    //   new AllSpells.Yasuo_R(this),

    //   // summoner spell
    //   new AllSpells.Flash(this),
    //   new AllSpells.Lux_E(this),
    // ];
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
    if (this.isDead || !buff) return;

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

  hasBuff(BuffClass) {
    return this.buffs.some(buff => buff instanceof BuffClass);
  }

  takeDamage(damage, source) {
    if (this.isDead) return;

    this.stats.health.baseValue -= damage;
    if (source && this.stats.health.baseValue <= 0) {
      this.die(source);
    }
  }

  die(source) {
    // this.buffs.forEach(buff => buff.deactivateBuff());
    this.reviveAfter = 3000;
    this.score--;
    source.score++;
  }

  get isDead() {
    return this.reviveAfter > 0;
  }

  update() {
    // update buffs
    this.buffs = this.buffs.filter(buff => !buff.toRemove);
    for (let buff of this.buffs) {
      buff.update();
    }

    // update spells
    for (let spell of this.spells) {
      spell.update();
    }

    // regen health and mana
    this.stats.update();

    // move
    if (!this.isDead && hasFlag(this.status, StatusFlags.CanMove)) this.move();

    // animation
    this.animatedSize = lerp(this.animatedSize || 0, this.stats.size.value, 0.1);
    this.animatedHeight = lerp(this.animatedHeight || 0, this.stats.height.value, 0.3);
    this.animatedHealth = lerp(this.animatedHealth || 0, this.stats.health.value, 0.2);
    this.animatedMana = lerp(this.animatedMana || 0, this.stats.mana.value, 0.2);

    if (this.isDead) {
      this.reviveAfter -= deltaTime;

      if (this.reviveAfter <= 0) {
        this.position.set(random(this.game.MAPSIZE), random(this.game.MAPSIZE));
        this.destination = this.position.copy();
      }
    }
  }

  draw() {
    if (hasFlag(this.status, StatusFlags.NoRender)) return;
    let alpha = hasFlag(this.status, StatusFlags.Stealthed) ? 50 : 255;

    push();

    let size = this.animatedSize + this.animatedHeight;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;
    let mana = this.stats.mana.value;
    let maxMana = this.stats.maxMana.value;
    let pos = this.position.copy();

    noStroke();
    fill(240, alpha);
    imageMode(CENTER);

    // tint alpha for image
    if (alpha < 255) tint(255, alpha);
    image(this.avatar?.data, pos.x, pos.y, size, size);

    // draw circle around champion based on allies
    stroke(this.isAllied ? [0, 255, 0, alpha] : [255, 0, 0, alpha]);
    strokeWeight(2);
    noFill();
    circle(pos.x, pos.y, size);

    // draw direction to mouse
    let mousePos = this.game.camera.screenToWorld(mouseX, mouseY);
    let mouseDir = p5.Vector.sub(mousePos, pos).setMag(size / 1.75);
    stroke(255, alpha);
    strokeWeight(4);
    line(pos.x, pos.y, pos.x + mouseDir.x, pos.y + mouseDir.y);

    // draw health bar
    let borderWidth = 3,
      barWidth = 125,
      barHeight = 17,
      manaHeight = 5,
      topleft = {
        x: this.position.x - barWidth / 2,
        y: this.position.y - size / 2 - barHeight - 15,
      };

    fill('#020F15');
    stroke('#5B5C57');
    strokeWeight(3);
    rect(
      topleft.x - borderWidth * 0.5,
      topleft.y - borderWidth * 0.5,
      barWidth + borderWidth,
      barHeight + borderWidth
    );

    // score
    fill('#F2F2F2');
    textSize(12);
    text(this.score, topleft.x + 3, topleft.y + 12);

    noStroke();

    // health
    const healthContainerW = barWidth - barHeight;
    const healthW = map(this.animatedHealth, 0, maxHealth, 0, healthContainerW);
    fill(this.isDead ? '#999' : '#43C41D');
    rect(topleft.x + barHeight, topleft.y, healthW, barHeight - manaHeight - 1);

    // mana
    const manaW = map(this.animatedMana, 0, maxMana, 0, barWidth - barHeight);
    fill(this.isDead ? '#999' : '#6CB3D5');
    rect(topleft.x + barHeight, topleft.y + barHeight - manaHeight, manaW, manaHeight);

    // draw buffs
    let x = topleft.x + 10;
    for (let buff of this.buffs) {
      buff.draw();

      if (buff.image) {
        image(buff.image.data, x, topleft.y - 13, 20, 20);
        x += 20;
      }
    }

    // draw status string
    if (this.isDead) {
      noStroke();
      fill(255);
      textAlign(CENTER, CENTER);
      textSize(13);
      text(`ĐANG HỒI SINH ${~~(this.reviveAfter / 1000)}...`, pos.x, topleft.y + barHeight + 8);

      push();
      translate(pos.x, pos.y);
      // draw black circle
      fill(0, 200);
      noStroke();
      circle(0, 0, size);

      // draw X using 2 rects
      fill(255, 0, 0, 100);
      noStroke();
      rotate(PI / 4);
      rectMode(CENTER);
      rect(0, 0, size, 15);
      rect(0, 0, 15, size);
      pop();
    } else {
      let statusString = [Airborne, Root, Silence, Dash, Stun]
        .map(BuffClass => {
          return this.hasBuff(BuffClass) ? new BuffClass().name : '';
        })
        .filter(Boolean)
        .join(', ');
      if (statusString) {
        noStroke();
        fill(255, alpha);
        textAlign(CENTER, CENTER);
        textSize(13);
        text(statusString, pos.x, topleft.y + barHeight + 8);
      }
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
