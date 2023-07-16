import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Dash from '../buffs/Dash.js';
import VectorUtils from '../../../utils/vector.utils.js';
import TrailSystem from '../helpers/TrailSystem.js';
import TrueSight from '../buffs/TrueSight.js';

export default class LeeSin_Q extends Spell {
  static PHASES = {
    Q1: {
      image: AssetManager.getAsset('spell_leesin_q1'),
    },
    Q2: {
      image: AssetManager.getAsset('spell_leesin_q2'),
    },
  };
  phase = LeeSin_Q.PHASES.Q1;

  image = this.phase.image;
  name = 'Sóng Âm / Vô Ảnh Cước (LeeSin_Q)';
  description =
    'Chưởng 1 luồng sóng âm về hướng chỉ định, gây 15 sát thương. Có thể tái kích hoạt trong vòng 3s để lao tới kẻ địch trúng Sóng Âm, gây thêm 15 sát thương.';
  coolDown = 5000;
  collDownAfterQ1 = 500;

  spellObject = null;
  enemyHit = null;

  checkCastCondition() {
    // if Q1 hitted, but can't move => can't cast Q2
    if (this.phase === LeeSin_Q.PHASES.Q2 && !this.owner.canMove) {
      return false;
    }
    return true;
  }

  onSpellCast() {
    const range = 400,
      speed = 10,
      size = 25,
      hitDamage = 15,
      lifeTimeAfterHit = 3000,
      q2HitDamage = 15;

    // phase 1: Sóng âm
    if (this.phase === LeeSin_Q.PHASES.Q1) {
      let { from, to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.game.worldMouse,
        range
      );

      let obj = new LeeSin_Q_Object(this.owner);
      obj.position = this.owner.position.copy();
      obj.destination = destination;
      obj.speed = speed;
      obj.range = range;
      obj.size = size;
      obj.hitDamage = hitDamage;
      obj.lifeTimeAfterHit = lifeTimeAfterHit;
      obj.onHit = enemy => {
        this.enemyHit = enemy;
        enemy.takeDamage(hitDamage, this.owner);

        // true sight
        let trueSightBuff = new TrueSight(1000, this.owner, enemy);
        enemy.addBuff(trueSightBuff);

        // switch to phase 2 if Q1 hits
        this.phase = LeeSin_Q.PHASES.Q2;
        this.image = this.phase.image;
        this.currentCooldown = this.collDownAfterQ1;
      };
      this.spellObject = obj;

      this.game.addObject(obj);
    }

    // phase 2: Vô ảnh cước
    else {
      // dash owner to target
      let dashBuff = new LeeSin_Q_Buff(10000, this.owner, this.owner);
      dashBuff.spell = this;
      dashBuff.hitDamage = q2HitDamage;
      dashBuff.dashDestination = this.enemyHit.position;
      this.owner.addBuff(dashBuff);

      // reset to phase 1 after cast Q2
      this.phase = LeeSin_Q.PHASES.Q1;
      this.image = this.phase.image;
    }
  }

  onUpdate() {
    // If Q1 misses, reset to phase 1, and reset cooldown
    if (this.spellObject && this.spellObject.toRemove) {
      this.spellObject = null;
      this.enemyHit = null;
      this.phase = LeeSin_Q.PHASES.Q1;
      this.image = this.phase.image;
      this.currentCooldown = this.coolDown;
    }
  }
}

export class LeeSin_Q_Buff extends Dash {
  image = LeeSin_Q.PHASES.Q2.image;
  hitDamage = 15;
  spell = null;

  onReachedDestination() {
    super.onReachedDestination?.();

    // deal damage to target
    if (this.spell?.enemyHit) this.spell.enemyHit.takeDamage(this.hitDamage, this.sourceUnit);
    // remove spell object
    if (this.spell?.spellObject) this.spell.spellObject.toRemove = true;
  }

  onCancelled() {
    super.onCancelled?.();
    if (this.spell?.spellObject) this.spell.spellObject.toRemove = true;
  }

  onDeactivate() {
    super.onDeactivate?.();
    if (this.spell?.spellObject) this.spell.spellObject.toRemove = true;
  }
}

export class LeeSin_Q_Object extends SpellObject {
  isMissile = true;
  range = 400;
  speed = 10;
  size = 25;
  hitDamage = 15;
  lifeTimeAfterHit = 3000;

  static PHASES = {
    MOVING: 0,
    HIT: 1,
  };
  phase = LeeSin_Q_Object.PHASES.MOVING;

  enemyHit = null;

  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: '#b5ede822',
  });

  update() {
    if (this.phase === LeeSin_Q_Object.PHASES.MOVING) {
      VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

      if (this.destination.dist(this.position) < this.speed) {
        this.toRemove = true;
      }

      this.trailSystem.addTrail(this.position);

      // check collision with enemy
      let enemy = this.game.queryPlayersInRange({
        position: this.position,
        range: this.size / 2,
        excludePlayers: [this.owner],
        includePlayerSize: true,
        getOnlyOne: true,
      });

      if (enemy) {
        this.onHit?.(enemy);
        this.enemyHit = enemy;

        // switch to hit phase
        this.phase = LeeSin_Q_Object.PHASES.HIT;
        this.isMissile = false;
      }
    }

    // hit phase
    else if (this.phase === LeeSin_Q_Object.PHASES.HIT) {
      this.position = this.enemyHit.position.copy();

      this.lifeTimeAfterHit -= deltaTime;
      if (this.lifeTimeAfterHit <= 0) {
        this.toRemove = true;
      }
    }
  }

  draw() {
    // move phase
    if (this.phase === LeeSin_Q_Object.PHASES.MOVING) {
      this.trailSystem.draw();

      push();
      let alpha = map(this.destination.dist(this.position), 0, this.range, 99, 255);
      fill(181, 237, 232, alpha);
      stroke(190);
      translate(this.position.x, this.position.y);
      rotate(p5.Vector.sub(this.destination, this.position).heading());
      ellipse(0, 0, this.size + 15, this.size);
      pop();
    }

    // hit phase
    else if (this.phase === LeeSin_Q_Object.PHASES.HIT) {
      push();
      // draw 4 triangle around the enemy, west, north, east, south
      let s = this.enemyHit.stats.size.value / 2;

      translate(this.position.x, this.position.y);

      fill('#b5ede8');
      noStroke();
      [0, PI / 2, PI / 2, PI / 2].forEach((angle, i) => {
        rotate(angle);
        let r = random(15, 20);
        triangle(-s, 0, -s - r, -s, -s - r, s);
      });
      pop();
    }
  }
}
