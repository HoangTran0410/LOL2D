import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';

export default class Teemo_R extends Spell {
  image = AssetManager.getAsset('spell_teemo_r');
  name = 'Bẫy Độc Noxus (Teemo_R)';
  description =
    'Đặt 1 bẫy độc tàng hình sau 1s, tồn tại trong 20 giây, phát nổ khi kẻ địch dẫm phải, làm chậm 70% các kẻ địch trong 2s và gây 30 sát thương';

  coolDown = 3000;

  onSpellCast() {
    let throwRange = 100,
      invisibleAfter = 1000,
      lifeTime = 20000,
      exploreRange = 200;

    let mouse = this.game.worldMouse.copy();
    let mouseDistance = mouse.dist(this.owner.position);
    let destination = mouse
      .sub(this.owner.position)
      .setMag(Math.min(throwRange, mouseDistance))
      .add(this.owner.position);

    let obj = new Teemo_R_Object(this.owner);
    obj.position = this.owner.position.copy();
    obj.destination = destination;
    obj.invisibleAfter = invisibleAfter;
    obj.lifeTime = lifeTime;
    obj.exploreRange = exploreRange;

    this.game.objects.push(obj);
  }
}

export class Teemo_R_Buff extends Buff {
  image = AssetManager.getAsset('spell_teemo_r');
  buffAddType = BuffAddType.RENEW_EXISTING;
  percent = 0.7;
}

export class Teemo_R_Object extends SpellObject {
  isMissile = true;
  position = createVector();
  destination = createVector();
  invisibleAfter = 1000;
  lifeTime = 30000;
  age = 0;
  moveSpeed = 6;
  exploreRange = 200;
  exploreLifeTime = 1500;

  size = 50;
  angle = 0;
  mushroom_spots = [
    { x: 0, y: 0, r: 16 },
    { x: -5, y: -16, r: 18 },
    { x: 8, y: -16, r: 13 },
    { x: 20, y: 14, r: 14 },
    { x: -20, y: 14, r: 14 },
  ];

  static PHASES = {
    MOVING: 0,
    INVISIBLE: 1,
    EXPLORING: 2,
  };
  phase = Teemo_R_Object.PHASES.MOVING;

  update() {
    // moving phase
    if (this.phase === Teemo_R_Object.PHASES.MOVING) {
      let distance = this.position.dist(this.destination);
      if (distance < this.moveSpeed) {
        this.position = this.destination.copy();
        this.isMissile = false; // yasuo W cant block this
        this.phase = Teemo_R_Object.PHASES.INVISIBLE;
      } else {
        this.position.add(this.destination.copy().sub(this.position).setMag(this.moveSpeed));
      }
    }

    // invisible phase
    else if (this.phase === Teemo_R_Object.PHASES.INVISIBLE) {
      // rotate and check age
      this.angle += 0.02;
      this.age += deltaTime;
      if (this.age > this.lifeTime) {
        this.toRemove = true;
      }

      if (this.age > this.invisibleAfter) {
        // check collide with enemy
        let enemyStepIn = this.game.players.find(
          p =>
            !p.isDead &&
            p != this.owner &&
            p.position.dist(this.position) < this.size / 2 + p.stats.size.value / 2
        );
        if (enemyStepIn) {
          let enemiesInRange = this.game.players.filter(
            p =>
              !p.isDead && p != this.owner && p.position.dist(this.position) < this.exploreRange / 2
          );

          for (let p of enemiesInRange) {
            p.addBuff(new Teemo_R_Buff(2000, this.owner, p));
            p.takeDamage(30, this.owner);
          }

          this.phase = Teemo_R_Object.PHASES.EXPLORING;
          this.age = 0; // reset age
          this.size = this.exploreRange;
        }
      }
    }

    // exploring phase
    else if (this.phase === Teemo_R_Object.PHASES.EXPLORING) {
      this.age += deltaTime;
      if (this.age > this.exploreLifeTime) {
        this.toRemove = true;
      }
    }
  }

  draw() {
    // moving phase + invisible phase
    if (
      this.phase === Teemo_R_Object.PHASES.MOVING ||
      this.phase === Teemo_R_Object.PHASES.INVISIBLE
    ) {
      let alpha =
        this.phase === Teemo_R_Object.PHASES.INVISIBLE && this.age > this.invisibleAfter ? 25 : 255;
      push();
      // stroke(100, alpha);
      noStroke();
      fill(40, 97, 40, alpha);
      circle(this.position.x, this.position.y, this.size);

      fill(114, 63, 127, alpha);
      for (let spot of this.mushroom_spots) {
        let x = spot.x * cos(this.angle) - spot.y * sin(this.angle);
        let y = spot.x * sin(this.angle) + spot.y * cos(this.angle);
        circle(this.position.x + x, this.position.y + y, spot.r);
      }

      // fill(200, alpha);
      // textAlign(CENTER, CENTER);
      // text(~~((this.lifeTime - this.age) / 1000), this.position.x, this.position.y);
      pop();
    }

    // exploring phase
    else if (this.phase === Teemo_R_Object.PHASES.EXPLORING) {
      let alpha = map(this.age, 0, this.exploreLifeTime, 255, 0);
      stroke(150, alpha + 50);
      strokeWeight(2);
      fill(114, 63, 127, alpha);
      circle(this.position.x, this.position.y, this.size);

      // draw random circle
      stroke(100);
      fill(150, 100, 160);
      let delta = p5.Vector.random2D().mult(random(0, this.size / 2));
      let r = random(10, 20);
      circle(this.position.x + delta.x, this.position.y + delta.y, r);
    }
  }
}
