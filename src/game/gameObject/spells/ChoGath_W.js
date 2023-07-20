import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import AssetManager from '../../../managers/AssetManager.js';
import CollideUtils from '../../../utils/collide.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Root from '../buffs/Root.js';
import Stun from '../buffs/Stun.js';

export default class ChoGath_W extends Spell {
  image = AssetManager.getAsset('spell_chogath_w');
  name = "Tiếng Gầm Hoang Dã (Cho'Gath_W)";
  description =
    'Gầm vào hướng đã chọn theo <span>hình nón</span>, <span class="buff">Làm Choáng</span> <span class="time">1 giây</span> và gây <span class="damage">15 sát thương</span> cho các kẻ địch trong tầm.';
  coolDown = 5000;

  onSpellCast() {
    let lifeTime = 1000;
    let stunTime = 1000;
    let angleRange = PI / 2.5;
    let angle = this.game.worldMouse.copy().sub(this.owner.position).heading();

    let obj = new ChoGath_W_Object(this.owner);
    obj.speed = 10;
    obj.position = this.owner.position; // follow owner
    obj.angleStart = angle - angleRange / 2;
    obj.angleEnd = angle + angleRange / 2;
    obj.stunTime = stunTime;
    obj.lifeTime = lifeTime;
    this.game.objectManager.addObject(obj);

    let rootBuff = new Root(lifeTime, this.owner, this.owner);
    rootBuff.buffAddType = BuffAddType.RENEW_EXISTING;
    rootBuff.image = this.image;
    this.owner.addBuff(rootBuff);
  }
}

export class ChoGath_W_Object extends SpellObject {
  position = createVector();
  speed = 4;
  range = 190;
  currentRange = 0;
  angleStart = 0;
  angleEnd = 0;

  stunTime = 1000;
  lifeTime = 1000;
  age = 0;

  playersEffected = [];

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;

    this.currentRange = constrain(this.currentRange + this.speed, 0, this.range);

    let enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: this.currentRange,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.excludeObjects(this.playersEffected),
        o => {
          return CollideUtils.circleArc(
            o.position.x,
            o.position.y,
            o.stats.size.value / 2,
            this.position.x,
            this.position.y,
            this.currentRange,
            this.angleStart,
            this.angleEnd
          );
        },
      ],
    });

    enemies.forEach(enemy => {
      let stunBuff = new Stun(this.stunTime, this.owner, enemy);
      stunBuff.image = AssetManager.getAsset('spell_chogath_w');
      enemy.addBuff(stunBuff);

      enemy.takeDamage(20, this.owner);
      this.playersEffected.push(enemy);
    });
  }

  draw() {
    push();

    let alpha =
      this.age < this.lifeTime / 3
        ? map(this.age, 0, this.lifeTime / 3, 0, 200)
        : map(this.age, this.lifeTime / 3, this.lifeTime, 200, 0);

    noStroke();
    fill(200, Math.min(30, alpha));
    arc(
      this.position.x,
      this.position.y,
      this.currentRange * 2,
      this.currentRange * 2,
      this.angleStart,
      this.angleEnd,
      PIE
    );

    // draw arc waves, animation based on age, 5 waves, move from center to edge
    let arcWaves = 5;
    noStroke();
    fill(200, Math.min(alpha, 60));
    for (let i = 0; i < arcWaves; i++) {
      let r = ((i * this.currentRange) / arcWaves + this.age / 5) % this.currentRange;
      arc(this.position.x, this.position.y, r * 2, r * 2, this.angleStart, this.angleEnd, PIE);
    }

    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.currentRange,
      y: this.position.y - this.currentRange,
      w: this.currentRange * 2,
      h: this.currentRange * 2,
      data: this,
    });
  }
}
