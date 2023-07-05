import AssetManager from '../../../managers/AssetManager.js';
import CollideUtils from '../../../utils/collide.utils.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Root from '../buffs/Root.js';
import Silence from '../buffs/Silence.js';

export default class ChoGath_W extends Spell {
  image = AssetManager.getAsset('spell_chogath_w');
  name = "Tiếng Gầm Hoang Dã (Cho'Gath_W)";
  description =
    'Gầm vào hướng đã chọn, gây 20 sát thương theo hình nón và Câm lặng kẻ địch trong 1.5s và Trói chân trong 0.75s';
  coolDown = 5000;

  onSpellCast() {
    let lifeTime = 1000;
    let silenceTime = 1500;
    let rootTime = 750;
    let angleRange = PI / 2.5;
    let angle = this.game.worldMouse.copy().sub(this.owner.position).heading();

    let obj = new ChoGath_W_Object(this.owner);
    obj.speed = 10;
    obj.position = this.owner.position.copy();
    obj.angleStart = angle - angleRange / 2;
    obj.angleEnd = angle + angleRange / 2;
    obj.silenceTime = silenceTime;
    obj.rootTime = rootTime;
    obj.lifeTime = lifeTime;
    this.game.objects.push(obj);

    let rootBuff = new Root(lifeTime, this.owner, this.owner);
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

  silenceTime = 1500;
  rootTime = 750;
  lifeTime = 1000;
  age = 0;

  playersEffected = [];

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;

    this.currentRange = constrain(this.currentRange + this.speed, 0, this.range);

    let enemies = this.game.queryPlayerInRange({
      position: this.position,
      range: this.currentRange,
      includePlayerSize: true,
      excludePlayers: [this.owner, ...this.playersEffected],
      customFilter: e => {
        return CollideUtils.circleArc(
          e.position.x,
          e.position.y,
          e.stats.size.value / 2,
          this.position.x,
          this.position.y,
          this.currentRange,
          this.angleStart,
          this.angleEnd
        );
      },
    });

    if (enemies.length) {
      enemies.forEach(enemy => {
        let silenceBuff = new Silence(this.silenceTime, this.owner, enemy);
        silenceBuff.image = AssetManager.getAsset('spell_chogath_w');
        enemy.addBuff(silenceBuff);

        let rootBuff = new Root(this.rootTime, this.owner, enemy);
        rootBuff.image = AssetManager.getAsset('spell_chogath_w');
        enemy.addBuff(rootBuff);

        enemy.takeDamage(20, this.owner);
      });

      this.playersEffected.push(...enemies);
    }
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
}
