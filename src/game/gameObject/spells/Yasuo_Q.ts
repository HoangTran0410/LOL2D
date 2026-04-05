import { Circle, Rectangle } from '../../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import CollideUtils from '../../../utils/collide.utils';
import { rectToVertices } from '../../../utils/index';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Airborne from '../buffs/Airborne';
import RootBuff from '../buffs/Root';

export default class Yasuo_Q extends Spell {
  PHASES = {
    Q1: {
      image: AssetManager.getAsset('spell_yasuo_q1'),
    },
    Q2: {
      image: AssetManager.getAsset('spell_yasuo_q2'),
    },
    Q3: {
      image: AssetManager.getAsset('spell_yasuo_q3'),
    },
  };
  phase = this.PHASES.Q1;

  image = this.phase.image;
  name = 'Bão Kiếm (Yasuo_Q)';
  description =
    'Đâm lưỡi kiếm về hướng chỉ định, gây <span class="damage">10 sát thương</span>. <span>Cộng dồn 2 lần</span> sẽ tạo ra một cơn lốc lớn, <span class="buff">Hất Tung</span> kẻ địch trúng chiêu trong <span class="time">1 giây</span> và gây <span class="damage">20 sát thương</span>';
  coolDown = 3500;
  manaCost = 20;

  coolDownIfHit = 500;
  hitStackCount = 0;
  lastHitTime = 0;
  timeToResetHitStack = 3500;

  changeState(newState: (typeof this.PHASES)[keyof typeof this.PHASES]) {
    this.phase = newState;
    this.image = newState.image;
  }

  onSpellCast() {
    const mouse = this.game.worldMouse.copy();
    const angle = mouse.sub(this.owner.position).heading();

    // Q1, Q2
    if (this.phase == this.PHASES.Q1 || this.phase == this.PHASES.Q2) {
      const stunTime = 300,
        range = 200,
        rayWidth = 30;

      const obj = new Yasuo_Q_Object(this.owner);
      obj.angle = angle;
      obj.lifeTime = stunTime;
      obj.range = range;
      obj.rayWidth = rayWidth;
      obj.onHit = (champ: any) => {
        this.hitStackCount++;
        this.lastHitTime = Date.now();
        this.currentCooldown = this.coolDownIfHit;
      };

      this.game.objectManager.addObject(obj);

      // stay while casting
      this.owner.addBuff(new RootBuff(stunTime, this.owner, this.owner));
    }

    // Q3
    else if (this.phase == this.PHASES.Q3) {
      const airBorneTime = 1000,
        range = 400,
        speed = 5;

      const { from: _from, to: destination } = VectorUtils.getVectorWithAngleAndRange(
        this.owner.position,
        angle,
        range
      );

      const tornado = new Yasuo_Q3_Object(this.owner);
      tornado.destination = destination;
      tornado.airBorneTime = airBorneTime;
      tornado.speed = speed;
      this.game.objectManager.addObject(tornado);

      this.changeState(this.PHASES.Q1);
    }
  }

  onUpdate() {
    // reset hit stack if not hit for a while
    if (this.lastHitTime + this.timeToResetHitStack < Date.now()) {
      this.hitStackCount = 0;
      if (this.phase != this.PHASES.Q1) this.changeState(this.PHASES.Q1);
    }
    this.hitStackCount = constrain(this.hitStackCount, 0, 2);

    // if hit once, change state to Q2
    if (this.phase == this.PHASES.Q1) {
      if (this.hitStackCount == 1) {
        this.changeState(this.PHASES.Q2);
      }
    }

    // if hit twice, change state to Q3
    else if (this.phase == this.PHASES.Q2) {
      if (this.hitStackCount == 2) {
        this.changeState(this.PHASES.Q3);
      }
    }
  }
}

export class Yasuo_Q_Object extends SpellObject {
  position = this.owner.position.copy();
  angle = 0;
  range = 130;
  rayWidth = 25;
  raySpeed = 30;
  currentRayLength = 0;

  lifeTime = 200;
  age = 0;

  playersEffected: any[] = [];
  onHit: (champ: any) => void = () => {};

  update() {
    this.age += deltaTime;
    if (this.age > this.lifeTime) this.toRemove = true;
    this.currentRayLength = Math.min(this.currentRayLength + this.raySpeed, this.range);

    // check collide with enemy
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.currentRayLength,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.excludeObjects(this.playersEffected),
        (o: any) => {
          const vertices = rectToVertices(
            this.owner.position.x,
            this.owner.position.y - this.rayWidth / 2 - o.stats.size.value / 2,
            this.currentRayLength,
            this.rayWidth + o.stats.size.value,
            this.angle,
            {
              x: this.owner.position.x,
              y: this.owner.position.y,
            }
          );
          return CollideUtils.pointPolygon(o.position.x, o.position.y, vertices);
        },
      ],
    });

    enemies.forEach(p => {
      const buff = new RootBuff(this.lifeTime / 2, this.owner, p);
      buff.image = AssetManager.getAsset('spell_yasuo_q1');
      p.addBuff(buff);
      p.takeDamage(10, this.owner);

      this.playersEffected.push(p);
      this.onHit(p);
    });
  }

  draw() {
    push();
    const triangleHeight = this.rayWidth / 2;
    const alpha = map(this.age, 0, this.lifeTime, 255, 150);

    translate(this.owner.position.x, this.owner.position.y);
    rotate(this.angle);
    noStroke();
    fill(200, alpha);
    rect(0, -this.rayWidth / 2, this.currentRayLength - triangleHeight, this.rayWidth);

    // draw triangle
    beginShape();
    vertex(this.currentRayLength - triangleHeight, -triangleHeight);
    vertex(this.currentRayLength - triangleHeight, triangleHeight);
    vertex(this.currentRayLength, 0);
    endShape(CLOSE);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.owner.position.x - this.range,
      y: this.owner.position.y - this.range,
      w: this.range * 2,
      h: this.range * 2,
      data: this,
    });
  }
}

export class Yasuo_Q3_Object extends SpellObject {
  isMissile = true;
  position = this.owner.position.copy();
  destination = this.owner.position.copy();
  speed = 5;
  minSize = 30;
  maxSize = 200;
  size = this.minSize;
  airBorneTime = 1000;
  angle = 0;
  originalLength = 0;

  playersEffected: any[] = [];

  image = AssetManager.getAsset('obj_yasuo_q3');

  update() {
    VectorUtils.moveVectorToVector(this.position, this.destination, this.speed);
    const distance = this.position.dist(this.destination);
    if (distance < this.speed) {
      this.position = this.destination.copy();
      this.toRemove = true;
    }
    if (!this.originalLength) this.originalLength = distance;

    this.size = map(distance, this.originalLength, 0, this.minSize, this.maxSize);
    this.angle += 0.2;

    // check collide with enemy
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.size / 2,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.excludeObjects(this.playersEffected),
      ],
    });

    enemies.forEach(p => {
      const buff = new Airborne(this.airBorneTime, this.owner, p);
      buff.image = AssetManager.getAsset('spell_yasuo_q3');
      p.addBuff(buff);
      p.takeDamage(20, this.owner);

      this.playersEffected.push(p);
    });
  }

  draw() {
    push();
    translate(this.position.x, this.position.y);
    rotate(this.angle);
    image(this.image?.data, 0, 0, this.size, this.size);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.size / 2,
      y: this.position.y - this.size / 2,
      w: this.size,
      h: this.size,
      data: this,
    });
  }
}
