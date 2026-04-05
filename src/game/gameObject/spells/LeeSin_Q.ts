import AssetManager from '../../../managers/AssetManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Dash from '../buffs/Dash';
import VectorUtils from '../../../utils/vector.utils';
import TrailSystem from '../helpers/TrailSystem';
import TrueSight from '../buffs/TrueSight';
import { Circle, Rectangle } from '../../../../libs/quadtree';
import { PredefinedFilters } from '../../managers/ObjectManager';

export default class LeeSin_Q extends Spell {
  static PHASES = {
    Q1: {
      image: AssetManager.getAsset('spell_leesin_q1'),
    },
    Q2: {
      image: AssetManager.getAsset('spell_leesin_q2'),
    },
  };
  phase: 'Q1' | 'Q2' = 'Q1';

  image = (this.phase as any).image;
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
      const { from, to: destination } = VectorUtils.getVectorWithRange(
        this.owner.position,
        this.game.worldMouse,
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
      obj.onHit = (enemy: any) => {
        this.enemyHit = enemy;
        enemy.takeDamage(hitDamage, this.owner);

        const trueSightBuff = new TrueSight(1000, this.owner, enemy);
        enemy.addBuff(trueSightBuff);

        this.phase = 'Q2';
        this.image = (this.phase as any).image;
        this.currentCooldown = this.collDownAfterQ1;
      };
      this.spellObject = obj;

      this.game.objectManager.addObject(obj);
    } else {
      const dashBuff = new Dash(10000, this.owner, this.owner);
      dashBuff.dashDestination = this.enemyHit.position;
      dashBuff.image = (LeeSin_Q as any).PHASES.Q2.image;
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
      this.image = (this.phase as any).image;
    }
  }

  onUpdate() {
    if (this.spellObject && this.spellObject.toRemove) {
      this.spellObject = null;
      this.enemyHit = null;
      this.phase = 'Q1';
      this.image = (this.phase as any).image;
      this.currentCooldown = this.coolDown;
    }
  }
}

export class LeeSin_Q_Object extends SpellObject {
  isMissile = true;
  destination = createVector();
  range = 400;
  speed = 10;
  size = 25;
  hitDamage = 15;
  lifeTimeAfterHit = 3000;

  static PHASES = {
    MOVING: 0,
    HIT: 1,
  } as const;
  phase: (typeof LeeSin_Q_Object.PHASES)[keyof typeof LeeSin_Q_Object.PHASES] =
    LeeSin_Q_Object.PHASES.MOVING;

  enemyHit: any = null;
  onHit: ((enemy: any) => void) | null = null;

  trailSystem: TrailSystem;

  constructor(owner: any) {
    super(owner);
    this.trailSystem = new TrailSystem({
      trailSize: this.size,
      trailColor: '#b5ede822',
    });
  }

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

      const enemies = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.position.x,
          y: this.position.y,
          r: this.size / 2,
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      });

      const enemy = enemies?.[0];
      if (enemy) {
        this.onHit?.(enemy);
        this.enemyHit = enemy;
        this.phase = LeeSin_Q_Object.PHASES.HIT;
        this.isMissile = false;
      }
    } else if (this.phase === LeeSin_Q_Object.PHASES.HIT) {
      this.position = this.enemyHit.position.copy();

      this.lifeTimeAfterHit -= deltaTime;
      if (this.lifeTimeAfterHit <= 0) {
        this.toRemove = true;
      }
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
      return new Rectangle({
        x: this.position.x - this.size / 2,
        y: this.position.y - this.size / 2,
        w: this.size,
        h: this.size,
        data: this,
      });
    } else if (this.phase === LeeSin_Q_Object.PHASES.HIT) {
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
}
