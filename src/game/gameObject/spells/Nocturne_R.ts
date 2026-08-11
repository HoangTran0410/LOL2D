import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Champion from '../attackableUnits/Champion';
import Dash from '../buffs/Dash';
import Nearsight from '../buffs/Nearsight';

/**
 * Paranoia, in two activations like the real ultimate:
 *
 *  1. the map goes dark — every enemy *champion* is nearsighted for 6s,
 *  2. within that same window Nocturne may recast to leap at one enemy champion,
 *     tracking them the whole way and dealing damage on arrival. The leap cannot
 *     be interrupted (displacement immunity).
 *
 * Letting the window lapse without leaping puts the ultimate on full cooldown.
 */
export default class Nocturne_R extends Spell {
  static PHASES = {
    R1: { image: AssetManager.getAsset('spell_nocturne_r') },
    R2: { image: AssetManager.getAsset('spell_nocturne_r2') },
  };
  phase: 'R1' | 'R2' = 'R1';

  image = Nocturne_R.PHASES[this.phase].image;
  name = 'Hoàng Hôn Kinh Hoàng (Nocturne_R)';
  description =
    'Bao trùm bản đồ trong bóng tối: <span>mọi tướng địch</span> bị <span class="buff">Mờ Mắt</span> (tầm nhìn giảm còn 200) trong <span class="time">6 giây</span>. Trong khoảng thời gian đó, tái kích hoạt để <span class="buff">Lao</span> tới một <span>tướng địch</span> trong phạm vi <span>1200</span> (chọn tướng gần con trỏ chuột nhất), bám theo mục tiêu và gây <span class="damage">35 sát thương</span> khi tới nơi. Cú lao không thể bị chặn. Nếu không tái kích hoạt, kỹ năng vào thời gian hồi đầy đủ.';
  coolDown = 20000;
  manaCost = 100;

  nearsightTime = 6000;
  newVisionRadius = 200;
  leapRange = 1200;
  leapSpeed = 18;
  damage = 35;
  /** The wiki's 0.25s delay before Paranoia may be recast. */
  recastDelay = 250;

  _recastTimeLeft = 0;

  checkCastCondition() {
    // the leap needs a champion to land on, and a Nocturne able to move
    if (this.phase === 'R2') {
      return !!this.findLeapTarget() && Dash.CanDash(this.owner);
    }
    return true;
  }

  onSpellCast() {
    if (this.phase === 'R1') this.castDarkness();
    else this.castLeap();
  }

  castDarkness() {
    // no area = the whole map; only champions are terrorised, not monsters
    const enemyChampions = this.game.objectManager.queryObjects({
      queryByDisplayBoundingBox: true,
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.type(Champion),
      ],
    });

    enemyChampions.forEach((enemy: any) => {
      const nearsightBuff = new Nearsight(this.nearsightTime, this.owner, enemy);
      nearsightBuff.image = Nocturne_R.PHASES.R1.image;
      nearsightBuff.newVisionRadius = this.newVisionRadius;
      enemy.addBuff(nearsightBuff);
    });

    const obj = new Nocturne_R_Object(this.owner);
    this.game.objectManager.addObject(obj);

    // open the recast window; the real cooldown only starts when it closes
    this.phase = 'R2';
    this.image = Nocturne_R.PHASES.R2.image;
    this._recastTimeLeft = this.nearsightTime;
    this.currentCooldown = this.recastDelay;
  }

  castLeap() {
    const target = this.findLeapTarget();
    this.closeRecastWindow();
    if (!target) return;

    const dashBuff = new Dash(6000, this.owner, this.owner);
    dashBuff.image = Nocturne_R.PHASES.R2.image;
    dashBuff.dashDestination = target.position; // live ref: the leap chases the target
    dashBuff.dashSpeed = this.leapSpeed;
    dashBuff.cancelable = false; // displacement immunity: nothing stops the flight
    dashBuff.onReachedDestination = () => {
      if (!target.isDead) target.takeDamage(this.damage, this.owner);
    };
    this.owner.addBuff(dashBuff);
  }

  closeRecastWindow() {
    this.phase = 'R1';
    this.image = Nocturne_R.PHASES.R1.image;
    this._recastTimeLeft = 0;
    this.currentCooldown = this.coolDown;
  }

  /** The enemy champion closest to the cursor, so the player picks the victim. */
  findLeapTarget(): any {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.leapRange,
      }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.type(Champion),
      ],
    });

    const aim = this.game.worldMouse ?? this.owner.position;

    let best: any = null;
    let bestDistance = Infinity;
    for (const enemy of enemies) {
      const distance = enemy.position.dist(aim);
      if (distance < bestDistance) {
        best = enemy;
        bestDistance = distance;
      }
    }
    return best;
  }

  onUpdate() {
    if (this.phase !== 'R2') return;

    this._recastTimeLeft -= deltaTime;
    if (this._recastTimeLeft <= 0) this.closeRecastWindow();
  }

  drawPreview() {
    if (this.phase === 'R2') super.drawPreview(this.leapRange);
  }
}

/** The wave of darkness washing outwards from the caster as the ult goes off. */
export class Nocturne_R_Object extends SpellObject {
  position = this.owner.position.copy();
  age = 0;
  lifeTime = 700;
  maxRadius = 400;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw() {
    const radius = map(this.age, 0, this.lifeTime, 20, this.maxRadius);
    const alpha = map(this.age, 0, this.lifeTime, 200, 0);

    push();
    noFill();
    stroke(40, 10, 70, alpha);
    strokeWeight(14);
    circle(this.position.x, this.position.y, radius * 2);

    stroke(120, 60, 190, alpha);
    strokeWeight(3);
    circle(this.position.x, this.position.y, radius * 2);
    pop();
  }

  getDisplayBoundingBox() {
    return new Rectangle({
      x: this.position.x - this.maxRadius,
      y: this.position.y - this.maxRadius,
      w: this.maxRadius * 2,
      h: this.maxRadius * 2,
      data: this,
    });
  }
}
