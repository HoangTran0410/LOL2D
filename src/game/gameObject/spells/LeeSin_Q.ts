import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import MissileSpellObject from '../MissileSpellObject';
import Dash from '../buffs/Dash';
import VectorUtils from '../../../utils/vector.utils';
import TrailSystem from '../helpers/TrailSystem';
import TrueSight from '../buffs/TrueSight';
import { Rectangle } from '../../../libs/quadtree';

export default class LeeSin_Q extends Spell {
  static PHASES = {
    Q1: {
      image: AssetManager.get('spell_leesin_q1'),
    },
    Q2: {
      image: AssetManager.get('spell_leesin_q2'),
    },
  };
  phase: 'Q1' | 'Q2' = 'Q1';

  image = LeeSin_Q.PHASES[this.phase].image;
  name = 'Sóng Âm / Vô Ảnh Cước (LeeSin_Q)';
  description =
    'Chưởng 1 luồng Sóng Âm về hướng chỉ định, gây <span class="damage">15 sát thương</span> khi trúng địch. Có thể tái kích hoạt trong vòng <span class="time">3 giây</span> để <span class="buff">Lướt</span> tới kẻ địch trúng Sóng Âm, gây thêm <span class="damage">15 sát thương</span> khi tới nơi';
  coolDown = 5000;
  collDownAfterQ1 = 500;
  spellObject: LeeSin_Q_Object | null = null;
  enemyHit: any = null;

  checkCastCondition() {
    if (this.phase === 'Q2' && !this.owner.canMove) {
      return false;
    }
    return true;
  }

  onSpellCast() {
    const range = 400;
    const speed = 10;
    const size = 25;
    const hitDamage = 15;
    const lifeTimeAfterHit = 3000;
    const q2HitDamage = 15;

    if (this.phase === 'Q1') {
      const { to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.aimPoint,
        range
      );

      const obj = new LeeSin_Q_Object(this.owner);
      obj.position = this.owner.position.copy();
      obj.destination = destination;
      obj.speed = speed;
      obj.range = range;
      obj.size = size;
      obj.hitDamage = hitDamage;
      obj.lifeTimeAfterHit = lifeTimeAfterHit;
      obj.onHitCallback = (enemy: any) => {
        this.enemyHit = enemy;
        enemy.takeDamage(hitDamage, this.owner);

        const trueSightBuff = new TrueSight(1000, this.owner, enemy);
        enemy.addBuff(trueSightBuff);

        this.phase = 'Q2';
        this.image = LeeSin_Q.PHASES[this.phase].image;
        this.currentCooldown = this.collDownAfterQ1;
      };
      this.spellObject = obj;

      this.game.objectManager.addObject(obj);
    } else {
      const dashBuff = new Dash(10000, this.owner, this.owner);
      dashBuff.dashDestination = this.enemyHit.position;
      dashBuff.image = LeeSin_Q.PHASES.Q2.image;
      dashBuff.onCancelled = () => {
        if (this.spellObject) this.spellObject.toRemove = true;
      };
      dashBuff.onDeactivate = () => {
        if (this.spellObject) this.spellObject.toRemove = true;
      };
      dashBuff.onReachedDestination = () => {
        if (this.enemyHit) this.enemyHit.takeDamage(q2HitDamage, this.owner);
        if (this.spellObject) this.spellObject.toRemove = true;
      };
      this.owner.addBuff(dashBuff);

      this.phase = 'Q1';
      this.image = LeeSin_Q.PHASES[this.phase].image;
    }
  }

  onUpdate() {
    if (this.spellObject && this.spellObject.toRemove) {
      this.spellObject = null;
      this.enemyHit = null;
      this.phase = 'Q1';
      this.image = LeeSin_Q.PHASES[this.phase].image;
      this.currentCooldown = this.coolDown;
    }
  }
}

export class LeeSin_Q_Object extends MissileSpellObject {
  range = 400;
  speed = 10;
  size = 25;
  hitDamage = 15;
  lifeTimeAfterHit = 3000;
  // the wave sticks to whoever it hits so Q2 has something to dash at
  maxHitCount = 1;
  removeOnMaxHit = false;

  static PHASES = {
    MOVING: 0,
    HIT: 1,
  } as const;
  phase: (typeof LeeSin_Q_Object.PHASES)[keyof typeof LeeSin_Q_Object.PHASES] =
    LeeSin_Q_Object.PHASES.MOVING;

  enemyHit: any = null;
  onHitCallback: ((enemy: any) => void) | null = null;

  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: '#b5ede822',
  });

  onHit(enemy: any) {
    this.onHitCallback?.(enemy);
    this.enemyHit = enemy;
    this.phase = LeeSin_Q_Object.PHASES.HIT;
    this.isMissile = false;
    // the mark rides the victim for three seconds; it had no death check at
    // all, so it used to sit on the corpse and give Q2 something to dash at
    this.attachTo(enemy);
  }

  update() {
    if (this.phase === LeeSin_Q_Object.PHASES.MOVING) {
      super.update();
      return;
    }

    if (this.dropIfAttachmentLost()) return;

    this.position = this.enemyHit.position.copy();

    this.lifeTimeAfterHit -= deltaTime;
    if (this.lifeTimeAfterHit <= 0) {
      this.toRemove = true;
    }
  }

  draw() {
    if (this.phase === LeeSin_Q_Object.PHASES.MOVING) {
      push();
      const alpha = map(this.destination.dist(this.position), 0, this.range, 99, 255);
      fill(181, 237, 232, alpha);
      stroke(190);
      translate(this.position.x, this.position.y);
      rotate(p5.Vector.sub(this.destination, this.position).heading());
      ellipse(0, 0, this.size + 15, this.size);
      pop();
    } else if (this.phase === LeeSin_Q_Object.PHASES.HIT) {
      push();
      const s = (this.enemyHit?.animatedValues?.size ?? 40) / 2;
      translate(this.position.x, this.position.y);
      fill('#b5ede8');
      noStroke();
      ([0, PI / 2, PI / 2, PI / 2] as number[]).forEach((angle, i) => {
        rotate(angle);
        const r = random(15, 20);
        triangle(-s, 0, -s - r, -s, -s - r, s);
      });
      pop();
    }
  }

  getDisplayBoundingBox() {
    if (this.phase === LeeSin_Q_Object.PHASES.MOVING) {
      return super.getDisplayBoundingBox();
    }

    // once latched, the marker is drawn around the victim, not the missile
    const enemySize = this.enemyHit?.animatedValues?.size ?? 40;
    return new Rectangle({
      x: this.position.x - enemySize / 2 - 20,
      y: this.position.y - enemySize / 2 - 20,
      w: enemySize + 40,
      h: enemySize + 40,
      data: this,
    });
  }
}
