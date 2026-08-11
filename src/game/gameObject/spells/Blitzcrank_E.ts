import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Airborne from '../buffs/Airborne';

export default class Blitzcrank_E extends Spell {
  image = AssetManager.getAsset('spell_blitzcrank_e');
  name = 'Nắm Đấm Thép (Blitzcrank_E)';
  description =
    'Vung nắm đấm thành <span>hình nón</span> ngay trước mặt, gây <span class="damage">25 sát thương</span> và <span class="buff">Hất Tung</span> mọi kẻ địch trúng đòn trong <span class="time">0.6 giây</span>';
  coolDown = 6000;
  manaCost = 20;
  willDrawPreview = true;

  range = 170;
  /** Half-width of the cone: PI/4 gives a 90° swing in front of the caster. */
  halfAngle = Math.PI / 4;
  damage = 25;
  airborneDuration = 600;
  airborneHeight = 25;

  onSpellCast() {
    const angle = VectorUtils.getAngle(this.owner.position, this.game.worldMouse);
    const facing = p5.Vector.fromAngle(angle);
    const minDot = Math.cos(this.halfAngle);

    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        // dot product rather than comparing raw headings: no seam at ±PI
        (o: any) => {
          const toEnemy = p5.Vector.sub(o.position, this.owner.position);
          if (toEnemy.magSq() === 0) return true;
          return facing.dot(toEnemy.normalize()) >= minDot;
        },
      ],
    });

    enemies.forEach((enemy: any) => {
      const airborneBuff = new Airborne(this.airborneDuration, this.owner, enemy);
      airborneBuff.height = this.airborneHeight;
      airborneBuff.image = this.image;
      enemy.addBuff(airborneBuff);

      enemy.takeDamage(this.damage, this.owner);
    });

    const obj = new Blitzcrank_E_Object(this.owner);
    obj.angle = angle;
    obj.halfAngle = this.halfAngle;
    obj.range = this.range;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Blitzcrank_E_Object extends SpellObject {
  angle = 0;
  halfAngle = Math.PI / 4;
  range = 170;
  lifeTime = 320;
  age = 0;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    // the fist sweeps out fast then fades
    const reach = this.range * (0.35 + 0.65 * t) * 2;
    const alpha = 180 * (1 - t);

    push();
    noStroke();
    fill(255, 190, 80, alpha * 0.45);
    arc(
      this.position.x,
      this.position.y,
      reach,
      reach,
      this.angle - this.halfAngle,
      this.angle + this.halfAngle,
      PIE
    );

    stroke(255, 225, 160, alpha);
    strokeWeight(3);
    noFill();
    arc(
      this.position.x,
      this.position.y,
      reach,
      reach,
      this.angle - this.halfAngle,
      this.angle + this.halfAngle
    );

    // the fist itself, thrown out along the aim line
    noStroke();
    fill(220, 150, 60, alpha + 60);
    const fistDist = this.range * (0.35 + 0.65 * t);
    circle(
      this.position.x + cos(this.angle) * fistDist,
      this.position.y + sin(this.angle) * fistDist,
      28 * (1 - t * 0.4)
    );
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.range,
      y: this.position.y - this.range,
      w: this.range * 2,
      h: this.range * 2,
      data: this,
    });
  }
}
