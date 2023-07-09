import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Slow from '../buffs/Slow.js';
import { Ghost_Buff } from './Ghost.js';

export default class Olaf_Q extends Spell {
  image = AssetManager.getAsset('spell_olaf_q');
  name = 'Phóng Rìu (Olaf_Q)';
  description =
    'Ném rìu đến điểm chỉ định, gây 15 sát thương và làm chậm 40% trong 1s cho những kẻ địch nó đi qua, bạn cũng nhận được 30% tốc chạy trong 1s nếu ném trúng. Rìu tồn tại trong 5s, nếu nhặt được rìu, thời gian hồi chiêu được giảm 60%.';
  coolDown = 5000;

  maxThrowRange = 350;
  axeLifeTime = 5000;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.maxThrowRange
    );

    let axe = new Olaf_Q_Object(this.owner);
    axe.destination = to;
    axe.position = from;
    axe.angle = to.copy().sub(from).heading();
    axe.speed = 8.5;
    axe.waitForPickUpLifeTime = this.axeLifeTime;
    axe.damage = 20;
    axe.spellSource = this;
    this.game.addSpellObject(axe);
  }

  drawPreview() {
    push();
    noFill();
    stroke(200, 100);
    circle(this.owner.position.x, this.owner.position.y, this.maxThrowRange * 2);
    pop();
  }
}

export class Olaf_Q_Object extends SpellObject {
  isMissile = true;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  spellSource = null;
  angle = 0;
  speed = 10;
  size = 30;
  pickupRange = 100;
  timeSinceReachedDestination = 0;
  waitForPickUpLifeTime = 5000;
  damage = 15;

  static PHASES = {
    FLYING: 'FLYING',
    WAIT_FOR_PICK_UP: 'WAIT_FOR_PICK_UP',
  };

  phase = Olaf_Q_Object.PHASES.FLYING;

  playerEffected = [];

  update() {
    // flying phase
    if (this.phase === Olaf_Q_Object.PHASES.FLYING) {
      this.angle += 0.2;

      VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);
      if (this.position.dist(this.destination) < this.speed) {
        this.phase = Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP;
        this.isMissile = false;
      }

      // check collision with enemy
      let enemies = this.game.queryPlayersInRange({
        position: this.position,
        range: this.size,
        includePlayerSize: true,
        excludePlayers: [this.owner, ...this.playerEffected],
      });

      enemies.forEach(enemy => {
        let slowBuff = new Slow(1000, this.owner, enemy);
        slowBuff.image = AssetManager.getAsset('spell_olaf_q');
        slowBuff.percent = 0.4;
        enemy.addBuff(slowBuff);
        enemy.takeDamage(this.damage, this.owner);
        this.playerEffected.push(enemy);
      });

      // speed up owner if hit
      if (enemies.length > 0) {
        let speedUpBuff = new Ghost_Buff(1000, this.owner, this.owner);
        speedUpBuff.buffAddType = BuffAddType.RENEW_EXISTING;
        speedUpBuff.image = AssetManager.getAsset('spell_olaf_q');
        speedUpBuff.percent = 0.3;
        this.owner.addBuff(speedUpBuff);
      }
    }

    // wait for pick up phase
    else if (this.phase === Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP) {
      this.timeSinceReachedDestination += deltaTime;
      if (this.timeSinceReachedDestination >= this.waitForPickUpLifeTime) {
        this.toRemove = true;
      }

      // if owner is close enough, pick up the axe => reset cooldown
      if (
        this.owner.position.dist(this.position) <
        this.owner.stats.size.value / 2 + this.size / 2
      ) {
        // this.owner.spells
        //   ?.filter?.(spell => spell instanceof Olaf_Q)
        //   ?.forEach?.(spell => {
        //     spell.resetCoolDown();
        //   });

        this.spellSource.currentCooldown *= 0.4;
        this.toRemove = true;
      }
    }
  }

  draw() {
    // draw axe shape, with small rect is the handle, and 2 triangle is the blade
    push();
    noStroke();
    fill(200, 150, 200);
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    let handleLength = this.size * 1.5;
    let handleWidth = 10;
    let bladeSize = 30;

    rect(-handleLength, -handleWidth / 2, handleLength, handleWidth);
    triangle(0, bladeSize / 2, bladeSize / 3, -bladeSize, -bladeSize, -bladeSize);
    triangle(0, -bladeSize / 2, bladeSize / 3, bladeSize, -bladeSize, bladeSize);
    pop();

    // wait for pick up phase
    if (this.phase === Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP) {
      // draw pickup range
      push();
      fill(100, 30);
      stroke(200, 100);
      let arcLength = map(
        this.timeSinceReachedDestination,
        0,
        this.waitForPickUpLifeTime,
        2 * PI,
        0
      );
      arc(this.position.x, this.position.y, this.pickupRange, this.pickupRange, 0, arcLength, PIE);
      pop();
    }
  }
}