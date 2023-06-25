import ASSETS from '../../../assets/index.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Buff from '../Buff.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import { StatsModifier } from '../Stats.js';

export default class Teemo_R extends Spell {
  image = ASSETS.Spells.teemo_r;
  name = 'Bẫy Độc Noxus (Teemo_R)';
  description =
    'Đặt 1 bẫy độc tàng hình sau 1s, tồn tại trong 20 giây, phát nổ khi kẻ địch dẫm phải, làm chậm 60% các kẻ địch trong phạm vi 150px';

  coolDown = 5000;

  onSpellCast() {
    let throwRange = 100,
      invisibleAfter = 1000,
      lifeTime = 20000,
      exploreRange = 150;

    let mouse = this.game.camera.screenToWorld(mouseX, mouseY);
    let destination = mouse.sub(this.owner.position).setMag(throwRange).add(this.owner.position);

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
  image = ASSETS.Spells.teemo_r;
  buffAddType = BuffAddType.REPLACE_EXISTING;

  onCreate() {
    this.statsModifier = new StatsModifier();
    this.statsModifier.speed.baseValue = -this.targetUnit.stats.speed.baseValue * 0.6; // slow 50%
  }
  onActivate() {
    this.targetUnit.stats.addModifier(this.statsModifier);
  }
  onDeactivate() {
    this.targetUnit.stats.removeModifier(this.statsModifier);
  }
}

export class Teemo_R_Object extends SpellObject {
  isMissile = true;
  position = createVector();
  destination = createVector();
  invisibleAfter = 1000;
  lifeTime = 30000;
  age = 0;
  moveSpeed = 6;
  exploreRange = 150;

  size = 50;
  angle = 0;
  mushroom_spots = [
    { x: 0, y: 0, r: 16 },
    { x: -5, y: -16, r: 18 },
    { x: 8, y: -16, r: 13 },
    { x: 20, y: 14, r: 14 },
    { x: -20, y: 14, r: 14 },
  ];

  STATES = {
    MOVING: 0,
    INVISIBLE: 1,
    EXPLORING: 2,
  };
  state = this.STATES.MOVING;

  update() {
    // moving phase
    if (this.state === this.STATES.MOVING) {
      let distance = this.position.dist(this.destination);
      if (distance < this.moveSpeed) {
        this.position = this.destination.copy();
        this.isMissile = false; // yasuo W cant block this
        this.state = this.STATES.INVISIBLE;
      } else {
        this.position.add(this.destination.copy().sub(this.position).setMag(this.moveSpeed));
      }
    }

    // invisible phase
    else if (this.state === this.STATES.INVISIBLE) {
      // check collide with enemy
      let enemyStepIn = this.game.players.find(
        p =>
          p != this.owner && p.position.dist(this.position) < this.size / 2 + p.stats.size.value / 2
      );
      if (enemyStepIn) {
        let enemiesInRange = this.game.players.filter(
          p =>
            p != this.owner &&
            p.position.dist(this.position) < this.exploreRange / 2 + p.stats.size.value / 2
        );

        for (let p of enemiesInRange) {
          p.addBuff(new Teemo_R_Buff(2000, this.owner, p));
        }

        this.state = this.STATES.EXPLORING;
      }

      // rotate and check age
      this.angle += 0.02;
      this.age += deltaTime;
      if (this.age > this.lifeTime) {
        this.toRemove = true;
      }
    }

    // exploring phase
    else if (this.state === this.STATES.EXPLORING) {
      this.size += 6;
      if (this.size > this.exploreRange) {
        this.toRemove = true;
      }
    }
  }

  draw() {
    if (this.state === this.STATES.MOVING || this.state === this.STATES.INVISIBLE) {
      let alpha = this.state === this.STATES.INVISIBLE && this.age > this.invisibleAfter ? 50 : 255;
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
      pop();
    } else if (this.state === this.STATES.EXPLORING) {
      let alpha = map(this.size, 0, this.exploreRange, 255, 0);
      stroke(150, alpha + 50);
      fill(114, 63, 127, alpha);
      circle(this.position.x, this.position.y, this.size);
    }
  }
}
