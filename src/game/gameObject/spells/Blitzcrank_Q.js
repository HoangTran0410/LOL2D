import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Airborne from '../buffs/Airborne.js';
import Dash from '../buffs/Dash.js';
import RootBuff from '../buffs/Root.js';
import VectorUtils from '../../../utils/vector.utils.js';

export default class Blitzcrank_Q extends Spell {
  name = 'Bàn Tay Hỏa Tiễn (Blitzcrank_Q)';
  image = AssetManager.getAsset('spell_blitzcrank_q');
  description =
    'Bắn bàn tay theo hướng chỉ định, kéo kẻ địch đầu tiên trúng phải, gây 20 sát thương và làm choáng chúng trong 0.5 giây';
  coolDown = 5000;
  manaCost = 20;

  onSpellCast() {
    let range = 500,
      speed = 10,
      grabSpeed = 10;

    let { from, to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      range
    );

    this.blitObj = new Blitzcrank_Q_Object(this.owner);
    this.blitObj.position = this.owner.position.copy();
    this.blitObj.destination = destination;
    this.blitObj.speed = speed;
    this.blitObj.grabSpeed = grabSpeed;
    this.blitObj.range = range;
    this.game.addObject(this.blitObj);

    this.ownerStunBuff = new RootBuff(1500, this.owner, this.owner);
    this.ownerStunBuff.buffAddType = BuffAddType.REPLACE_EXISTING;
    this.ownerStunBuff.image = this.image;
    this.owner.addBuff(this.ownerStunBuff);
  }

  onUpdate() {
    if (this.blitObj) {
      if (this.blitObj.phase == Blitzcrank_Q_Object.PHASES.GRAB || this.blitObj.toRemove) {
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

  position = createVector();
  destination = createVector();
  range = 500;
  speed = 10;
  grabSpeed = 10;
  handSize = 30;

  airborneBuff = null;
  dashBuff = null;
  champToGrab = null;

  static PHASES = {
    FORWARD: 'forward',
    GRAB: 'grab',
  };
  phase = Blitzcrank_Q_Object.PHASES.FORWARD;

  update() {
    let distance = this.destination.dist(this.position);
    let speed = this.phase == Blitzcrank_Q_Object.PHASES.FORWARD ? this.speed : this.grabSpeed;
    if (distance < speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    } else {
      VectorUtils.moveVectorToVector(this.position, this.destination, speed);
    }

    // check collision with enemy
    if (this.phase == Blitzcrank_Q_Object.PHASES.FORWARD) {
      let enemy = this.game.queryPlayersInRange({
        position: this.position,
        range: this.handSize / 2,
        includePlayerSize: true,
        excludeTeamIds: [this.owner.teamId],
        getOnlyOne: true,
      });

      if (enemy) {
        this.phase = Blitzcrank_Q_Object.PHASES.GRAB;
        this.champToGrab = enemy;
        this.destination = this.owner.position;

        this.airborneBuff = new Airborne(7000, this.owner, enemy);
        this.airborneBuff.image = AssetManager.getAsset('spell_blitzcrank_q');
        enemy.addBuff(this.airborneBuff);

        this.dashBuff = new Dash(10000, this.owner, enemy);
        this.dashBuff.showTrail = false;
        this.dashBuff.cancelable = false;
        enemy.addBuff(this.dashBuff);

        enemy.takeDamage(20, this.owner);
      }
    } else if (this.champToGrab) {
      this.dashBuff.destination = this.owner.position.copy();
      this.champToGrab.position.set(this.position.x, this.position.y);

      if (this.champToGrab.isDead) {
        this.toRemove = true;
      }
    }
  }

  onRemoved() {
    this.airborneBuff?.deactivateBuff?.();
    this.dashBuff?.deactivateBuff?.();
  }

  draw() {
    push();

    // draw line from hand to owner
    let alpha = constrain(
      map(this.position.dist(this.owner.position), 0, this.range, 200, 50),
      50,
      200
    );
    stroke(255, alpha);
    strokeWeight(4);
    line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

    // draw hand with five circle fingers
    noStroke();
    fill(255, 150, 50);
    circle(this.position.x, this.position.y, this.handSize);

    fill(200, 100, 90);
    let dir = p5.Vector.sub(this.destination, this.position).normalize();
    for (let i = 0; i < 3; i++) {
      let angle = dir.heading() + (i - 1) * 0.5;
      let x = this.position.x + cos(angle) * this.handSize;
      let y = this.position.y + sin(angle) * this.handSize;
      circle(x, y, 15);
    }

    pop();
  }
}
