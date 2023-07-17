import AssetManager from '../../../managers/AssetManager.js';
import VectorUtils from '../../../utils/vector.utils.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Slow from '../buffs/Slow.js';

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
      explodeRange = 200;

    let { from, to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      this.game.worldMouse,
      throwRange
    );

    let obj = new Teemo_R_Object(this.owner);
    obj.position = from;
    obj.destination = to;
    obj.invisibleAfter = invisibleAfter;
    obj.lifeTime = lifeTime;
    obj.explodeRange = explodeRange;

    this.game.addObject(obj);
  }
}

export class Teemo_R_Buff extends Slow {
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
  explodeRange = 200;
  explodeLifeTime = 1500;

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
    exploding: 2,
  };
  phase = Teemo_R_Object.PHASES.MOVING;

  update() {
    // moving phase
    if (this.phase === Teemo_R_Object.PHASES.MOVING) {
      VectorUtils.moveVectorToVector(this.position, this.destination, this.moveSpeed);

      if (this.position.dist(this.destination) < this.moveSpeed) {
        this.position = this.destination.copy();
        this.isMissile = false; // yasuo W cant block this
        this.phase = Teemo_R_Object.PHASES.INVISIBLE;
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
        let enemyStepIn = this.game.queryPlayersInRange({
          position: this.position,
          range: this.size / 2,
          includePlayerSize: true,
          excludeTeamIds: [this.owner.teamId],
          getOnlyOne: true,
        });

        if (enemyStepIn) {
          let enemiesInRange = this.game.queryPlayersInRange({
            position: this.position,
            range: this.explodeRange / 2,
            includePlayerSize: false,
            excludeTeamIds: [this.owner.teamId],
          });

          enemiesInRange.forEach(enemy => {
            enemy.addBuff(new Teemo_R_Buff(2000, this.owner, enemy));
            enemy.takeDamage(30, this.owner);
          });

          this.phase = Teemo_R_Object.PHASES.exploding;
          this.age = 0; // reset age
          this.size = this.explodeRange;
          this.visionRadius = this.explodeRange;
        }
      }
    }

    // exploding phase
    else if (this.phase === Teemo_R_Object.PHASES.exploding) {
      this.age += deltaTime;
      if (this.age > this.explodeLifeTime) {
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

    // exploding phase
    else if (this.phase === Teemo_R_Object.PHASES.exploding) {
      let alpha = map(this.age, 0, this.explodeLifeTime, 255, 0);
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
