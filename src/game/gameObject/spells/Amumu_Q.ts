import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Dash from '../buffs/Dash';
import Stun from '../buffs/Stun';
import TrailSystem from '../helpers/TrailSystem';

export default class Amumu_Q extends Spell {
  image = AssetManager.getAsset('spell_amumu_q');
  name = 'Băng Quấn Hận Thù (Amumu_Q)';
  description =
    'Ném một dải băng về hướng chỉ định. Khi trúng kẻ địch đầu tiên, gây <span class="damage">20 sát thương</span>, <span class="buff">Choáng</span> chúng trong <span class="time">1 giây</span> và <span class="buff">Kéo</span> chính bạn tới chỗ chúng <i>(các hiệu ứng khống chế lên Amumu không ngăn được cú kéo này)</i>';
  coolDown = 8000;
  manaCost = 30;

  range = 550;
  damage = 20;
  stunDuration = 1000;

  /**
   * LoL: immobilising effects do NOT prevent Amumu from commencing the dash, so
   * a root or a stun must not gate the cast — only Grounding blocks it.
   */
  checkCastCondition() {
    return !this.owner.grounded;
  }

  onSpellCast() {
    const { to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    const obj = new Amumu_Q_Object(this.owner);
    obj.destination = destination;
    obj.range = this.range;
    obj.damage = this.damage;
    obj.stunDuration = this.stunDuration;

    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Amumu_Q_Object extends MissileSpellObject {
  range = 550;
  speed = 12;
  size = 20;
  damage = 20;
  stunDuration = 1000;
  // the bandage sticks to the first victim instead of dying on impact — the
  // opposite of Blitzcrank's hook: it reels the caster in, not the target
  maxHitCount = 1;
  removeOnMaxHit = false;

  enemyHit: any = null;
  dashBuff: Dash | null = null;
  stunBuff: Stun | null = null;

  trailSystem = new TrailSystem({
    trailSize: this.size,
    trailColor: '#E8D9A044',
  });

  onHit(enemy: any) {
    this.enemyHit = enemy;
    this.isMissile = false;

    enemy.takeDamage(this.damage, this.owner);

    this.stunBuff = new Stun(this.stunDuration, this.owner, enemy);
    this.stunBuff.image = AssetManager.getAsset('spell_amumu_q');
    enemy.addBuff(this.stunBuff);

    this.dashBuff = new Dash(3000, this.owner, this.owner);
    this.dashBuff.image = AssetManager.getAsset('spell_amumu_q');
    this.dashBuff.dashDestination = enemy.position; // live ref: the rope follows them
    this.dashBuff.dashSpeed = 14;
    // CC on Amumu must not interrupt the reel-in, so the dash is uncancellable
    this.dashBuff.cancelable = false;
    this.dashBuff.onReachedDestination = () => {
      this.toRemove = true;
    };
    this.dashBuff.onDeactivate = () => {
      this.toRemove = true;
    };
    this.owner.addBuff(this.dashBuff);
  }

  update() {
    if (!this.enemyHit) {
      super.update();
      return;
    }

    // anchored on the victim while the caster is reeled towards them
    this.position.set(this.enemyHit.position.x, this.enemyHit.position.y);

    if (this.enemyHit.isDead) {
      this.dashBuff?.deactivateBuff?.();
      this.toRemove = true;
    }
  }

  onRemoved() {
    this.dashBuff?.deactivateBuff?.();
  }

  draw() {
    push();

    // the bandage itself, stretched between the caster and its head
    stroke(232, 217, 160, 220);
    strokeWeight(6);
    line(this.owner.position.x, this.owner.position.y, this.position.x, this.position.y);

    stroke(200, 185, 130, 220);
    strokeWeight(2);
    const dir = p5.Vector.sub(this.position, this.owner.position);
    const steps = Math.max(2, Math.floor(dir.mag() / 20));
    for (let i = 1; i < steps; i++) {
      const x = this.owner.position.x + (dir.x * i) / steps;
      const y = this.owner.position.y + (dir.y * i) / steps;
      point(x, y);
    }

    noStroke();
    fill(232, 217, 160);
    circle(this.position.x, this.position.y, this.size);

    pop();
  }

  // the bandage spans from the caster to its head, so the box must cover both
  getDisplayBoundingBox() {
    return new Rectangle({
      x: Math.min(this.position.x, this.owner.position.x) - this.size / 2,
      y: Math.min(this.position.y, this.owner.position.y) - this.size / 2,
      w: Math.abs(this.position.x - this.owner.position.x) + this.size,
      h: Math.abs(this.position.y - this.owner.position.y) + this.size,
      data: this,
    });
  }
}
