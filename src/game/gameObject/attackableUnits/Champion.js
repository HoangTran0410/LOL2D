import { hasFlag, uuidv4 } from '../../../utils/index.js';
import Stats from '../Stats.js';
import StatusFlags from '../../enums/StatusFlags.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Airborne from '../buffs/Airborne.js';
import Root from '../buffs/Root.js';
import Silence from '../buffs/Silence.js';
import Dash from '../buffs/Dash.js';
import Stun from '../buffs/Stun.js';
import AssetManager from '../../../managers/AssetManager.js';
import Slow from '../buffs/Slow.js';
import SAT from '../../../../libs/SAT.js';
import Charm from '../buffs/Charm.js';
import ActionState from '../../enums/ActionState.js';
import Fear from '../buffs/Fear.js';
import CombatText from '../helpers/CombatText.js';

export default class Champion {
  respawnTime = 3000;
  showName = false;
  score = 0;
  reviveAfter = 0;
  toRemove = false;

  teamId = uuidv4();

  buffs = [];
  stats = new Stats();
  status = StatusFlags.CanCast | StatusFlags.CanMove | StatusFlags.Targetable;

  _buffEffectsToEnable = 0;
  _buffEffectsToDisable = 0;

  constructor(game, x = 0, y = 0, preset) {
    this.game = game;
    this.position = createVector(x, y);
    this.destination = createVector(x, y);

    if (preset) {
      this.name = preset.name;
      this.avatar = AssetManager.getAsset(preset.avatar);
      this.spells = preset.spells.map(Spell => new Spell(this));
    } else {
      this.avatar = AssetManager.getRandomChampion();
      this.spells = [];
    }
  }

  setStatus(status, enabled) {
    let _statusBeforeApplyingBuffEfects = 0;
    if (enabled) _statusBeforeApplyingBuffEfects |= status;
    else _statusBeforeApplyingBuffEfects &= ~status;

    this.status =
      (_statusBeforeApplyingBuffEfects & ~this._buffEffectsToDisable) | this._buffEffectsToEnable;

    this.stats.updateActionState(this.status);
  }

  moveTo(x, y) {
    this.destination.set(x, y);
  }

  move() {
    const direction = p5.Vector.sub(this.destination, this.position);
    const distance = direction.mag();
    const delta = Math.min(distance, this.stats.speed.value);

    this.position.add(direction.setMag(delta));
  }

  addBuff(buff) {
    if (this.isDead || !buff) return;

    let preBuffs = this.buffs.filter(_buff => _buff.constructor === buff.constructor);

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
    let damageText = new CombatText(this);
    damageText.text = ' - ' + ~~damage;
    damageText.textColor = [255, 0, 0];
    this.game.addSpellObject(damageText);

    if (this.isDead) return;

    this.stats.health.baseValue -= damage;
    if (source && this.stats.health.baseValue <= 0) {
      this.die(source);
    }
  }

  die(source) {
    // this.buffs.forEach(buff => buff.deactivateBuff());
    this.reviveAfter = this.respawnTime;
    this.score--;
    source.score++;
  }

  respawn() {
    let pos = this.game.getRandomSpawnLocation();
    this.position.set(pos.x, pos.y);
    this.destination.set(this.position.x, this.position.y);
    this.stats.health.baseValue = this.stats.maxHealth.value;
  }

  get isDead() {
    return this.reviveAfter > 0;
  }

  get canCast() {
    return hasFlag(this.stats.actionState, ActionState.CAN_CAST);
  }

  get canMove() {
    return hasFlag(this.stats.actionState, ActionState.CAN_MOVE);
  }

  get isAllied() {
    return this.teamId == this.game.player.teamId;
  }

  updateBuffs() {
    this.buffs = this.buffs.filter(buff => !buff.toRemove);

    // Combine the status effects of all the buffs
    this._buffEffectsToEnable = 0;
    this._buffEffectsToDisable = 0;

    for (let buff of this.buffs) {
      buff.update();

      this._buffEffectsToEnable |= buff.statusFlagsToEnable;
      this._buffEffectsToDisable |= buff.statusFlagsToDisable;
    }

    // If the effect should be enabled, it overrides disable.
    this._buffEffectsToDisable &= ~this._buffEffectsToEnable;

    this.setStatus(StatusFlags.None, true);
  }

  update() {
    // update buffs
    this.updateBuffs();

    // update spells
    for (let spell of this.spells) {
      spell.update();
    }

    // regen health and mana
    this.stats.update();

    // move
    if (!this.isDead && this.canMove) this.move();

    // animation
    this.animatedSize = lerp(this.animatedSize || 10, this.stats.size.value, 0.1);
    this.animatedHeight = lerp(this.animatedHeight || 0, this.stats.height.value, 0.3);
    this.animatedHealth = lerp(this.animatedHealth || 0, this.stats.health.value, 0.2);
    this.animatedMana = lerp(this.animatedMana || 0, this.stats.mana.value, 0.2);
    this.animatedAlphaColor =
      this.alphaColor > this.animatedAlphaColor
        ? lerp(this.animatedAlphaColor || 0, this.alphaColor, 0.2) // smooth fade in
        : this.alphaColor; // instant fade out

    if (this.isDead) {
      this.reviveAfter -= deltaTime;
      if (this.reviveAfter <= 0) {
        this.respawn();
      }
    }
  }

  draw() {
    if (hasFlag(this.stats.actionState, ActionState.NO_RENDER)) return;
    let isInsideBush = hasFlag(this.status, StatusFlags.InBush);
    this.alphaColor = isInsideBush
      ? 100
      : hasFlag(this.stats.actionState, ActionState.STEALTHED)
      ? 20
      : 255;

    push();

    let size = this.animatedSize + this.animatedHeight;
    let health = this.stats.health.value;
    let maxHealth = this.stats.maxHealth.value;
    let mana = this.stats.mana.value;
    let maxMana = this.stats.maxMana.value;
    let pos = this.position.copy();
    let alpha = this.animatedAlphaColor;

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
    if (!this.isDead && this.game.worldMouse) {
      let mouseDir = p5.Vector.sub(this.game.worldMouse, pos).setMag(size / 1.75);
      stroke(255, Math.min(alpha, 125));
      strokeWeight(4);
      line(pos.x, pos.y, pos.x + mouseDir.x, pos.y + mouseDir.y);
    }

    // draw health bar
    let borderWidth = 3,
      barWidth = 125,
      barHeight = 17,
      manaHeight = 5,
      topleft = {
        x: this.position.x - barWidth / 2,
        y: this.position.y - size / 2 - barHeight - 15,
      };

    // if (!this.isDead) {
    fill(2, 15, 21, alpha);
    stroke(91, 92, 87, alpha);
    strokeWeight(3);
    rect(
      topleft.x - borderWidth * 0.5,
      topleft.y - borderWidth * 0.5,
      barWidth + borderWidth,
      barHeight + borderWidth
    );

    // score
    fill(242, 242, 242, alpha);
    textSize(12);
    text(this.score, topleft.x + 3, topleft.y + 12);

    noStroke();

    // health
    const healthContainerW = barWidth - barHeight;
    const healthW = map(this.animatedHealth, 0, maxHealth, 0, healthContainerW);
    fill(
      this.isDead
        ? [153, 153, 153, alpha]
        : this.isAllied
        ? [67, 196, 29, alpha]
        : [196, 67, 29, alpha]
    );
    rect(topleft.x + barHeight, topleft.y, healthW, barHeight - manaHeight - 1);

    // mana
    const manaW = map(this.animatedMana, 0, maxMana, 0, barWidth - barHeight);
    fill(this.isDead ? [153, 153, 153, alpha] : [108, 179, 213, alpha]);
    rect(topleft.x + barHeight, topleft.y + barHeight - manaHeight, manaW, manaHeight);
    // }

    // draw buffs
    let x = topleft.x + 10;
    for (let buff of this.buffs) {
      buff.draw();

      if (buff.image) {
        image(buff.image.data, x, topleft.y - 13, 20, 20);
        x += 20;
      }
    }

    // draw name
    if (this.showName && this.name) {
      fill(150);
      noStroke();
      textAlign(CENTER, CENTER);
      textSize(13);
      text(this.name, pos.x, topleft.y - 13);
    }

    // draw status string
    if (this.isDead) {
      noStroke();
      fill(200);
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
      // fill(255, 0, 0, 100);
      // noStroke();
      // rotate(PI / 4);
      // rectMode(CENTER);
      // rect(0, 0, size, 15);
      // rect(0, 0, 15, size);
      pop();
    } else {
      let statusString = [Airborne, Root, Silence, Dash, Stun, Slow, Charm, Fear]
        .map(BuffClass => {
          let buff = this.buffs.find(b => b instanceof BuffClass);
          if (buff && buff.sourceUnit !== this) return buff.name;
        })
        .filter(Boolean)
        .join(', ');

      if (statusString) {
        noStroke();
        fill(200);
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

  onCollideWall() {}
  onCollideMapEdge() {}
}
