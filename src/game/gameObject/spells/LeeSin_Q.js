import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import SpellState from '../../enums/SpellState.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Dash from '../buffs/Dash.js';

export default class LeeSin_Q extends Spell {
  PHASES = {
    Q1: {
      image: AssetManager.getAsset('spell_leesin_q1'),
    },
    Q2: {
      image: AssetManager.getAsset('spell_leesin_q2'),
    },
  };
  phase = this.PHASES.Q1;

  image = this.phase.image;
  name = 'Sóng Âm / Vô Ảnh Cước (LeeSin_Q)';
  description =
    'Chưởng 1 luồng sóng âm về hướng chỉ định, gây 15 sát thương. Có thể tái kích hoạt trong vòng 3s để lao tới kẻ địch trúng Sóng Âm, gây thêm 15 sát thương.';
  coolDown = 1000;

  spellObject = null;
  enemyHit = null;

  onSpellCast() {
    const range = 400,
      speed = 10,
      size = 25,
      hitDamage = 15,
      lifeTimeAfterHit = 3000,
      q2HitDamage = 15;

    // phase 1: Sóng âm
    if (this.phase === this.PHASES.Q1) {
      let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
      let direction = mouse.sub(this.owner.position).normalize();
      let destination = this.owner.position.copy().add(direction.mult(range));

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
        enemy.takeDamage(hitDamage);

        // switch to phase 2 if Q1 hits
        this.phase = this.PHASES.Q2;
        this.image = this.phase.image;
        this.currentCooldown = 0; // reset cooldown -> can recast immediately
      };
      this.spellObject = obj;

      this.game.objects.push(obj);
    }

    // phase 2: Vô ảnh cước
    else {
      // dash owner to target
      let dashBuff = new Dash(99999, this.owner, this.owner);
      dashBuff.dashSpeed = 15;
      dashBuff.dashDestination = this.enemyHit.position;
      dashBuff.buffAddType = BuffAddType.RENEW_EXISTING;
      dashBuff.image = this.PHASES.Q2.image;
      dashBuff.onReachedDestination = () => {
        // deal damage to target
        if (this.enemyHit) this.enemyHit.takeDamage(q2HitDamage, this.owner);
        // remove spell object
        if (this.spellObject) this.spellObject.toRemove = true;
      };
      this.owner.addBuff(dashBuff);

      // reset to phase 1 after cast Q2
      this.phase = this.PHASES.Q1;
      this.image = this.phase.image;
    }
  }

  onUpdate() {
    // If Q1 misses, reset to phase 1, and reset cooldown
    if (this.spellObject && this.spellObject.toRemove) {
      this.spellObject = null;
      this.enemyHit = null;
      this.phase = this.PHASES.Q1;
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

  PHASES = {
    MOVING: 0,
    HIT: 1,
  };
  phase = this.PHASES.MOVING;

  enemyHit = null;

  update() {
    if (this.phase === this.PHASES.MOVING) {
      let dir = p5.Vector.sub(this.destination, this.position);
      if (dir.mag() < this.speed) {
        this.toRemove = true;
      } else {
        this.position.add(dir.setMag(this.speed));
      }

      // check collision with enemy
      let enemy = this.game.queryPlayerInRange({
        position: this.position,
        range: this.size,
        excludePlayers: [this.owner],
        includePlayerSize: true,
        includeDead: false,
        getOnlyOne: true,
      });
      if (enemy) {
        this.onHit?.(enemy);
        this.enemyHit = enemy;

        // switch to hit phase
        this.phase = this.PHASES.HIT;
        this.isMissile = false;
      }
    }

    // hit phase
    else if (this.phase === this.PHASES.HIT) {
      this.position = this.enemyHit.position.copy();

      this.lifeTimeAfterHit -= deltaTime;
      if (this.lifeTimeAfterHit <= 0) {
        this.toRemove = true;
      }
    }
  }

  draw() {
    push();

    // move phase
    if (this.phase === this.PHASES.MOVING) {
      let alpha = map(p5.Vector.sub(this.destination, this.position).mag(), 0, this.range, 50, 255);
      fill(181, 237, 232, alpha);
      stroke(190);
      translate(this.position.x, this.position.y);
      rotate(p5.Vector.sub(this.destination, this.position).heading());
      ellipse(0, 0, this.size + 15, this.size);
    }

    // hit phase
    else if (this.phase === this.PHASES.HIT) {
      // draw 4 triangle around the enemy, west, north, east, south
      let s = this.enemyHit.stats.size.value / 2;

      translate(this.position.x, this.position.y);

      fill('#b5ede8');
      noStroke();
      [0, PI / 2, PI / 2, PI / 2].forEach((angle, i) => {
        rotate(angle);
        triangle(-s, 0, -s - 15, -s, -s - 15, s);
      });
    }
    pop();
  }
}
