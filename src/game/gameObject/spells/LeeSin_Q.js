import AssetManager from '../../../managers/AssetManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Dash from '../buffs/Dash.js';
import VectorUtils from '../../../utils/vector.utils.js';
import TrailSystem from '../helpers/TrailSystem.js';
import TrueSight from '../buffs/TrueSight.js';
import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import AttackableUnit from '../attackableUnits/AttackableUnit.js';

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
    'Chưởng 1 luồng Sóng Âm về hướng chỉ định, gây <span class="damage">15 sát thương</span> khi trúng địch. Có thể tái kích hoạt trong vòng <span class="time">3 giây</span> để <span class="buff">Lướt</span> tới kẻ địch trúng Sóng Âm, gây thêm <span class="damage">15 sát thương</span> khi tới nơi';
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

      this.game.objectManager.addObject(obj);
    }

    // phase 2: Vô ảnh cước
    else {
      // dash owner to target
      let dashBuff = new Dash(10000, this.owner, this.owner);
      dashBuff.dashDestination = this.enemyHit.position;
      dashBuff.image = LeeSin_Q.PHASES.Q2.image;
      dashBuff.onCancelled = () => {
        if (this.spellObject) this.spellObject.toRemove = true;
      };
      dashBuff.onDeactivate = () => {
        if (this.spellObject) this.spellObject.toRemove = true;
      };
      dashBuff.onReachedDestination = () => {
        // deal damage to target
        if (this.enemyHit) this.enemyHit.takeDamage(q2HitDamage, this.owner);
        // remove spell object
        if (this.spellObject) this.spellObject.toRemove = true;
      };
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

  onAdded() {
    this.game.objectManager.addObject(this.trailSystem);
  }

  update() {
    if (this.phase === LeeSin_Q_Object.PHASES.MOVING) {
      VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);

      if (this.destination.dist(this.position) < this.speed) {
        this.toRemove = true;
      }

      this.trailSystem.addTrail(this.position);

      // check collision with enemy
      let enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      let enemy = enemies?.[0];
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
      let s = this.enemyHit.animatedValues.size / 2;
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

  getDisplayBoundingBox() {
    if (this.phase === LeeSin_Q_Object.PHASES.MOVING) {
      return new Rectangle({
        x: this.position.x - this.size / 2,
        y: this.position.y - this.size / 2,
        w: this.size,
        h: this.size,
        data: this,
      });
    } else if (this.phase === LeeSin_Q_Object.PHASES.HIT) {
      return new Rectangle({
        x: this.position.x - this.enemyHit.animatedValues.size / 2 - 20,
        y: this.position.y - this.enemyHit.animatedValues.size / 2 - 20,
        w: this.enemyHit.animatedValues.size + 40,
        h: this.enemyHit.animatedValues.size + 40,
        data: this,
      });
    }
  }
}
