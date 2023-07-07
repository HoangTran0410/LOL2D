import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { StatsModifier } from '../Stats.js';

export default class Lux_E extends Spell {
  name = 'Quả Cầu Ánh Sáng (Lux_E)';
  image = AssetManager.getAsset('spell_lux_e');
  description =
    'Phóng ra 1 xoáy ánh sáng tới vị trí chỉ định, làm chậm kẻ định 50%. Tái kích hoạt hoặc sau 5s sẽ phát nổ, gây 20 sát thương';
  coolDown = 6000;
  manaCost = 20;

  onSpellCast() {
    // first cast
    if (!this.luxEObject) {
      const range = 400,
        size = 200;

      let { from, to: destination } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.game.worldMouse,
        range
      );

      this.luxEObject = new Lux_E_Object(this.owner, destination, size);
      this.game.addSpellObject(this.luxEObject);
    }

    // second cast
    else if (this.luxEObject.phase === Lux_E_Object.PHASES.STATIC) {
      this.luxEObject.phase = Lux_E_Object.PHASES.EXPLODE;
      this.luxEObject = null;
    }
  }

  onUpdate() {
    // cancel cooldown on lux object reached destination
    if (this.luxEObject?.phase === Lux_E_Object.PHASES.STATIC) {
      this.currentCooldown = 0;
    }

    // reset lux object when it exploded
    if (this.luxEObject?.phase === Lux_E_Object.PHASES.EXPLODE || this.luxEObject?.toRemove) {
      this.luxEObject = null;
    }
  }
}

export class Lux_E_Buff extends Buff {
  image = AssetManager.getAsset('spell_lux_e');
  buffAddType = BuffAddType.RENEW_EXISTING;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.percentBaseBonus = -0.5;
  }

  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }

  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}

export class Lux_E_Object extends SpellObject {
  isMissile = true;
  static PHASES = {
    MOVE: 0,
    STATIC: 1,
    EXPLODE: 2,
  };
  phase = Lux_E_Object.PHASES.MOVE;

  // moving phase
  moveSpeed = 7;
  moveSize = 30;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();

  // static phase
  lifeTimeWhenStatic = 5000;
  timeSinceStatic = 0;
  staticSize = 100;

  // explode phase
  exploreSize = 100;
  explodeMaxSize = 200;
  explodeSpeed = 5;

  // for display
  size = 0;

  constructor(owner, destination, size) {
    super(owner);
    this.destination = destination;
    this.staticSize = size;
    this.exploreSize = size;
    this.explodeMaxSize = size + 50;
  }

  update() {
    // moving phase
    if (this.phase === Lux_E_Object.PHASES.MOVE) {
      VectorUtils.moveVectorToVector(this.position, this.destination, this.moveSpeed);

      let distance = this.destination.dist(this.position);
      if (distance < this.moveSpeed) {
        this.position = this.destination.copy();
        this.phase = Lux_E_Object.PHASES.STATIC;
      }

      if (!this.originalDistance) this.originalDistance = distance;

      this.size = lerp(this.size, this.moveSize, 0.1);
    }

    // static phase
    else if (this.phase === Lux_E_Object.PHASES.STATIC) {
      this.timeSinceStatic += deltaTime;

      this.size = lerp(this.size, this.staticSize, 0.3);

      // apply slow buff
      let enemies = this.game.queryPlayersInRange({
        position: this.position,
        range: this.staticSize / 2,
        excludePlayers: [this.owner],
      });
      enemies.forEach(enemy => {
        enemy.addBuff(new Lux_E_Buff(200, this.owner, enemy));
      });

      if (this.timeSinceStatic > this.lifeTimeWhenStatic) {
        this.phase = Lux_E_Object.PHASES.EXPLODE;
      }
    }

    // explode phase
    else if (this.phase === Lux_E_Object.PHASES.EXPLODE) {
      if (!this.takedDamage) {
        this.takedDamage = true;

        // apply damage to enemies in range
        let enemies = this.game.queryPlayersInRange({
          position: this.position,
          range: this.staticSize / 2,
          excludePlayers: [this.owner],
        });
        enemies.forEach(enemy => {
          enemy.takeDamage(20, this.owner);
        });
      }

      this.exploreSize += this.explodeSpeed;

      this.size = lerp(this.size, this.exploreSize, 0.1);

      if (this.exploreSize > this.explodeMaxSize) {
        this.toRemove = true;
      }
    }
  }

  draw() {
    push();

    // moving phase
    if (this.phase === Lux_E_Object.PHASES.MOVE) {
      stroke(255, 100);
      fill(255, 100);
      circle(this.position.x, this.position.y, this.size);

      // lighting effect
      stroke(255, 200);
      strokeWeight(3);
      for (let i = 0; i < 5; i++) {
        let angle = random(0, 2 * PI);
        let r = random(this.size);
        let x1 = this.position.x;
        let y1 = this.position.y;
        let x2 = this.position.x + r * cos(angle);
        let y2 = this.position.y + r * sin(angle);
        line(x1, y1, x2, y2);
      }
    }

    // static phase
    else if (this.phase === Lux_E_Object.PHASES.STATIC) {
      stroke(255, 100);
      fill(255, 100);
      circle(this.position.x, this.position.y, this.size);

      // draw lighting effect srtike from center to circle edge
      stroke(255, 200);
      strokeWeight(3);
      for (let i = 0; i < 10; i++) {
        let angle = random(0, 2 * PI);
        let r1 = random(this.staticSize / 2);
        let r2 = random(this.staticSize / 2);
        let x1 = this.position.x + r1 * cos(angle);
        let y1 = this.position.y + r1 * sin(angle);
        let x2 = this.position.x + r2 * cos(angle);
        let y2 = this.position.y + r2 * sin(angle);
        line(x1, y1, x2, y2);
      }
    }

    // explode phase
    else if (this.phase === Lux_E_Object.PHASES.EXPLODE) {
      let opacity = map(this.exploreSize, this.staticSize, this.explodeMaxSize, 100, 0);
      stroke(255, opacity);
      fill(255, opacity);
      circle(this.position.x, this.position.y, this.size);
    }

    pop();
  }
}
