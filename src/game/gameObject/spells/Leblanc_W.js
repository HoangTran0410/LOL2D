import AssetManager from '../../../managers/AssetManager.js';
import BuffAddType from '../../enums/BuffAddType.js';
import Spell from '../Spell.js';
import SpellObject from '../SpellObject.js';
import Dash from '../buffs/Dash.js';
import VectorUtils from '../../../utils/vector.utils.js';
import { Circle, Rectangle } from '../../../../libs/quadtree.js';
import { PredefinedFilters } from '../../managers/ObjectManager.js';
import AttackableUnit from '../attackableUnits/AttackableUnit.js';

export default class Leblanc_W extends Spell {
  PHASES = {
    W1: {
      image: AssetManager.getAsset('spell_leblanc_w1'),
    },
    W2: {
      image: AssetManager.getAsset('spell_leblanc_w2'),
    },
  };
  phase = this.PHASES.W1;

  image = this.phase.image;
  name = 'Biến Ảnh (Leblanc_W)';
  description =
    '<span class="buff">Lướt</span> tới vị trí chỉ định, gây <span class="damage">20 sát thương</span> cho những kẻ địch tại vị trí đó, đồng thời để lại <span>1 dị điểm</span> tồn tại <span class="time">3 giây</span> tại ví trí cũ. Tái kích hoạt sẽ lập tức <span class="buff">Dịch Chuyển</span> bạn về dị điểm.';
  coolDown = 5000;

  w1Object = null;
  w1LifeTime = 3000;
  waitTimeBeforeRecast = 1000;

  swtichPhase(phase, coolDown) {
    this.phase = phase;
    this.image = phase.image;
    this.currentCooldown = coolDown;
  }

  checkCastCondition() {
    if (this.phase == this.PHASES.W1) {
      return this.owner.canMove;
    } else if (this.phase == this.PHASES.W2) {
      return this.w1Object != null;
    }
  }

  onSpellCast() {
    if (this.phase == this.PHASES.W1) {
      let maxDistance = 300;

      let { from, to: destination } = VectorUtils.getVectorWithMaxRange(
        this.owner.position,
        this.game.worldMouse,
        maxDistance
      );

      // dash owner to destination
      let dashBuff = new Dash(2000, this.owner, this.owner);
      dashBuff.image = AssetManager.getAsset('spell_leblanc_w1');
      dashBuff.dashSpeed = 10;
      dashBuff.dashDestination = destination;
      dashBuff.onReachedDestination = () => {
        // effect at destination
        let w2Obj = new Leblanc_W_Object2(this.owner);
        w2Obj.position = destination.copy();
        w2Obj.lifeTime = 700;
        w2Obj.size = 200;
        this.game.objectManager.addObject(w2Obj);

        // enemy take damage
        let enemies = this.game.objectManager.queryObjects({
          area: new Circle({
            x: destination.x,
            y: destination.y,
            r: w2Obj.size / 2,
          }),
          filters: [
            PredefinedFilters.includeTypes([AttackableUnit]),
            PredefinedFilters.excludeTeamIds([this.owner.teamId]),
          ],
        });
        enemies.forEach(enemy => {
          enemy.takeDamage(20, this.owner);
        });
      };

      this.owner.moveTo(destination.x, destination.y);
      this.owner.addBuff(dashBuff);

      this.w1Object = new Leblanc_W_Object(this.owner);
      this.w1Object.position = this.owner.position.copy();
      this.w1Object.lifeTime = this.w1LifeTime;
      this.game.objectManager.addObject(this.w1Object);

      // switch to phase 2
      this.swtichPhase(this.PHASES.W2, this.waitTimeBeforeRecast);
    } else {
      if (this.w1Object) {
        this.owner.position.set(this.w1Object.position.x, this.w1Object.position.y);
        this.w1Object.toRemove = true;
      }

      // swith to phase 1
      this.swtichPhase(this.PHASES.W1, this.coolDown);
    }
  }

  onUpdate() {
    if (this.phase == this.PHASES.W2) {
      if (this.w1Object?.toRemove) {
        // switch to phase 1
        this.swtichPhase(this.PHASES.W1, this.coolDown);
      }
    }
  }
}

export class Leblanc_W_Object extends SpellObject {
  position = createVector();
  lifeTime = 3000;
  age = 0;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    push();
    let { stats, avatar } = this.owner;
    let size = stats.size.value;
    image(avatar.data, this.position.x, this.position.y, size, size);

    let alpha = map(this.age, 0, this.lifeTime, 0, 255);
    stroke('yellow');
    fill(180, 180, 120, alpha);
    circle(this.position.x, this.position.y, size);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.owner.stats.size.value / 2,
      y: this.position.y - this.owner.stats.size.value / 2,
      w: this.owner.stats.size.value,
      h: this.owner.stats.size.value,
      data: this,
    });
  }
}

export class Leblanc_W_Object2 extends Leblanc_W_Object {
  size = 200;
  draw() {
    push();
    let alpha = map(this.age, 0, this.lifeTime, 200, 0);
    stroke(100, alpha + 50);
    fill(200, 200, 50, alpha);
    circle(this.position.x, this.position.y, this.size);
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
