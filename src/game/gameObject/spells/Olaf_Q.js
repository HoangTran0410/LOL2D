import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Slow from '../buffs/Slow.js';
import Speedup from '../buffs/Speedup.js';
import ParticleSystem from '../helpers/ParticleSystem.js';
import TrailSystem from '../helpers/TrailSystem.js';

export default class Olaf_Q extends Spell {
  image = AssetManager.getAsset('spell_olaf_q');
  name = 'Phóng Rìu (Olaf_Q)';
  description =
    'Ném rìu đến điểm chỉ định, gây 15 sát thương và làm chậm 40% trong 1s cho những kẻ địch nó đi qua, bạn cũng nhận được 30% tốc chạy trong 1s cho mỗi kẻ địch bị ném trúng. Rìu tồn tại trong 4s, nếu nhặt được rìu, thời gian hồi chiêu được giảm 60%.';
  coolDown = 7500;

  maxThrowRange = 350;
  axeLifeTime = 4000;

  onSpellCast() {
    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      this.maxThrowRange
    );

    let axe = new Olaf_Q_Object(this.owner);
    axe.destination = to;
    axe.position = from;
    axe.initialAngle = to.copy().sub(from).heading();
    axe.speed = 8.5;
    axe.waitForPickUpLifeTime = this.axeLifeTime;
    axe.damage = 20;
    axe.spellSource = this;
    this.game.addObject(axe);
  }

  drawPreview() {
    super.drawPreview(this.maxThrowRange);
  }
}

export class Olaf_Q_Object extends SpellObject {
  isMissile = true;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  spellSource = null;
  angle = 0;
  initialAngle = 0;
  speed = 10;
  rotateSpeed = 0.25;
  size = 40;
  pickupRange = 100;
  timeSinceReachedDestination = 0;
  waitForPickUpLifeTime = 5000;
  damage = 15;
  color = [2, 151, 177];

  static PHASES = {
    FLYING: 'FLYING',
    WAIT_FOR_PICK_UP: 'WAIT_FOR_PICK_UP',
  };

  phase = Olaf_Q_Object.PHASES.FLYING;

  playerEffected = [];

  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: [...this.color, 100],
  });
  particleSystem = new ParticleSystem({
    isDeadFn: p => p.age > 1000,
    updateFn: p => {
      p.size += 1;
      p.age += deltaTime;
    },
    drawFn: p => {
      let alpha = map(p.age, 0, 1000, 200, 0);
      stroke(200, alpha + 10);
      fill(...this.color, alpha);
      circle(p.position.x, p.position.y, p.size);
    },
  });

  constructor(owner) {
    super(owner);

    // game will handle update and draw for this system
    this.game.addObject(this.particleSystem);
  }

  get willRotateRight() {
    return this.initialAngle > -PI / 2 && this.initialAngle < PI / 2;
  }

  update() {
    // flying phase
    if (this.phase === Olaf_Q_Object.PHASES.FLYING) {
      if (this.willRotateRight) this.angle += this.rotateSpeed;
      else this.angle -= this.rotateSpeed;

      VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

      let axeHead = this.position.copy().add(p5.Vector.fromAngle(this.angle).mult(this.size / 2));
      this.trailSystem.addTrail(axeHead);

      if (this.position.dist(this.destination) < this.speed) {
        this.phase = Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP;
        this.isMissile = false;
      }

      // check collision with enemy
      let enemies = this.game.queryPlayersInRange({
        position: this.position,
        range: this.size / 2,
        includePlayerSize: true,
        excludeTeamIds: [this.owner.teamId],
        excludePlayers: this.playerEffected,
      });

      enemies.forEach(enemy => {
        let slowBuff = new Slow(1000, this.owner, enemy);
        slowBuff.image = AssetManager.getAsset('spell_olaf_q');
        slowBuff.percent = 0.4;
        enemy.addBuff(slowBuff);
        enemy.takeDamage(this.damage, this.owner);
        this.playerEffected.push(enemy);

        this.particleSystem.addParticle({
          position: enemy.position,
          size: enemy.stats.size.value + 20,
          age: 0,
        });
      });

      // speed up owner if hit
      if (enemies.length > 0) {
        let speedUpBuff = new Speedup(1000, this.owner, this.owner);
        // speedUpBuff.buffAddType = BuffAddType.RENEW_EXISTING;
        speedUpBuff.maxStacks = 3;
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
    this.trailSystem.draw();

    // draw axe shape
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);

    stroke('#eeea');
    strokeWeight(3);
    fill(...this.color, 200);

    // prettier-ignore
    let shape = [[-45,-10],[-10,-5],[30,-10],[35,20],[0,20],[10,0],[-45,0]]
    if (!this.willRotateRight) shape = shape.map(([x, y]) => [-x, y]);
    beginShape();
    shape.forEach(([x, y]) => vertex(x, y));
    endShape(CLOSE);

    pop();

    // wait for pick up phase
    if (this.phase === Olaf_Q_Object.PHASES.WAIT_FOR_PICK_UP) {
      // draw pickup range
      push();
      // fill(100, 30);
      noFill();
      stroke(200, 100);
      let arcLength = map(
        this.timeSinceReachedDestination,
        0,
        this.waitForPickUpLifeTime,
        2 * PI,
        0
      );
      arc(this.position.x, this.position.y, this.pickupRange, this.pickupRange, 0, arcLength);
      pop();
    }
  }
}
