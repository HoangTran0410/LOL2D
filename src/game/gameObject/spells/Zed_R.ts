import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Buff from '../Buff';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import BuffAddType from '../../enums/BuffAddType';
import Dash from '../buffs/Dash';
import Untargetable from '../buffs/Untargetable';
import { Zed_W_Clone } from './Zed_W';

/** Bruised purple, so the mark does not read as a normal burn. */
const SHADOW_COLOR: [number, number, number] = [215, 120, 255];

/**
 * Death Mark.
 *
 * Zed goes untargetable, dashes behind the target, leaves a Shadow at the
 * casting position and marks the victim. The mark stores a share of every point
 * of damage Zed and his shadows land on that victim, then detonates it as bonus
 * damage when it expires. Recast swaps Zed with the Shadow.
 */
export default class Zed_R extends Spell {
  static PHASES = {
    R1: {
      image: AssetManager.getAsset('spell_zed_r1'),
    },
    R2: {
      image: AssetManager.getAsset('spell_zed_r2'),
    },
  };
  phase: 'R1' | 'R2' = 'R1';

  image = Zed_R.PHASES[this.phase].image;
  name = 'Cái Chết Đến Gần (Zed_R)';
  description =
    '<span class="buff">Lướt</span> ra sau kẻ địch gần nhất trong tầm 500px, <span class="buff">Không thể bị chọn</span> trong lúc lướt và để lại 1 <span>phân thân</span> tại chỗ cũ. Mục tiêu bị đánh dấu trong <span class="time">3 giây</span>: <b>35%</b> toàn bộ sát thương Zed và phân thân gây lên nó được tích lại và <span class="damage">kích nổ</span> khi dấu ấn kết thúc. Có thể tái kích hoạt để <span class="buff">Đổi chỗ</span> với phân thân';
  coolDown = 14000;
  manaCost = 50;

  range = 500;
  damage = 20;
  markDuration = 3000;
  /** Share of Zed's damage on the victim that the mark banks up. */
  markStorePercent = 0.35;
  /** The Shadow outlives the mark so the swap stays available to the end. */
  shadowDuration = 4000;
  /** The swap unlocks 0.5s after Zed reappears. */
  coolDownBeforeSwap = 500;

  shadow: Zed_W_Clone | null = null;

  checkCastCondition() {
    // recast is a blink, not a dash — it only needs a shadow still standing
    if (this.phase === 'R2') {
      return !!this.shadow && !this.shadow.toRemove;
    }
    return Dash.CanDash(this.owner) && this._findTarget() !== null;
  }

  onSpellCast() {
    if (this.phase === 'R2') {
      this._swapWithShadow();
      return;
    }

    const target = this._findTarget();
    if (!target) return;

    const castPosition = this.owner.position.copy();

    // untargetable for the whole leap, dropped the instant he reappears
    const untargetableBuff = new Untargetable(2000, this.owner, this.owner);
    untargetableBuff.image = Zed_R.PHASES.R1.image;
    this.owner.addBuff(untargetableBuff);

    // land just past the target, so Zed ends up behind them
    const behindDistance =
      this.owner.position.dist(target.position) +
      target.stats.size.value / 2 +
      this.owner.stats.size.value / 2;
    const { to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      target.position,
      behindDistance
    );

    const dashBuff = new Dash(2000, this.owner, this.owner);
    dashBuff.image = Zed_R.PHASES.R1.image;
    dashBuff.dashDestination = destination;
    dashBuff.dashSpeed = 16;
    dashBuff.cancelable = false;
    dashBuff.onReachedDestination = () => untargetableBuff.deactivateBuff();
    dashBuff.onDeactivate = () => untargetableBuff.deactivateBuff();
    this.owner.addBuff(dashBuff);

    // the shadow stays behind at the casting position and mimics Q / E
    this._spawnShadow(castPosition);

    // mark first, so R's own hit is already banked by it
    const mark = new Zed_R_Mark(this.markDuration, this.owner, target);
    mark.storePercent = this.markStorePercent;
    mark.image = Zed_R.PHASES.R1.image;
    target.addBuff(mark);

    target.takeDamage(this.damage, this.owner);

    const obj = new Zed_R_Object(this.owner);
    obj.target = target;
    obj.lifeTime = this.markDuration;
    obj.mark = mark;
    this.game.objectManager.addObject(obj);

    this.phase = 'R2';
    this.image = Zed_R.PHASES.R2.image;
    this.currentCooldown = this.coolDownBeforeSwap;
  }

  _spawnShadow(position: p5.Vector) {
    const shadow = new Zed_W_Clone({
      game: this.game,
      position,
      teamId: this.owner.teamId,
      avatar: this.owner.avatar,
    } as any);
    shadow.owner = this.owner;
    // marks this spell as the source, so the shadow never mimics R back at us
    shadow.spellSource = this as any;
    shadow.destination = position.copy(); // spawns in place instead of dashing out
    shadow.lifeTime = this.shadowDuration;
    this.game.objectManager.addObject(shadow);
    this.shadow = shadow;
  }

  _swapWithShadow() {
    const shadow = this.shadow!;
    const curPos = this.owner.position.copy();

    this.owner.teleportTo(shadow.position.x, shadow.position.y);
    shadow.teleportTo(curPos.x, curPos.y);
    shadow.swapable = false;

    this.shadow = null;
    this.phase = 'R1';
    this.image = Zed_R.PHASES.R1.image;
    this.currentCooldown = this.coolDown;
  }

  onUpdate() {
    // shadow expired before the swap was used
    if (this.phase === 'R2' && (!this.shadow || this.shadow.toRemove)) {
      this.shadow = null;
      this.phase = 'R1';
      this.image = Zed_R.PHASES.R1.image;
      this.currentCooldown = this.coolDown;
    }
  }

  /** Nearest damageable enemy within `range`, or null. */
  _findTarget(): any {
    const enemies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    });

    let nearest: any = null;
    let nearestDistance = Infinity;
    for (const enemy of enemies) {
      const d = this.owner.position.dist(enemy.position);
      if (d < nearestDistance) {
        nearest = enemy;
        nearestDistance = d;
      }
    }

    return nearest;
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

/**
 * Marked for Death: a pure observer on the victim's damage pipeline. It never
 * changes what gets through — it only banks a share of whatever Zed (or one of
 * his shadows) lands, and pays it all back at once when the mark expires.
 */
export class Zed_R_Mark extends Buff {
  name = 'Dấu Ấn Tử Thần';
  buffAddType = BuffAddType.REPLACE_EXISTING;

  storePercent = 0.35;
  storedDamage = 0;

  _detonated = false;

  /** True for Zed himself and for anything he owns (his shadows). */
  _isFromZed(attacker: any): boolean {
    if (!attacker || !this.sourceUnit) return false;
    return attacker === this.sourceUnit || attacker.owner === this.sourceUnit;
  }

  modifyIncomingDamage(damage: number, attacker: any): number {
    if (!this._detonated && damage > 0 && this._isFromZed(attacker)) {
      this.storedDamage += damage * this.storePercent;
    }
    return damage;
  }

  onDeactivate(): void {
    if (this._detonated) return;
    this._detonated = true; // guard: the detonation itself re-enters takeDamage

    const payload = Math.round(this.storedDamage);
    if (payload > 0 && this.targetUnit && !this.targetUnit.isDead) {
      this.targetUnit.takeDamage(payload, this.sourceUnit);
    }
  }
}

/** The death-mark rune spinning over the victim while the mark lasts. */
export class Zed_R_Object extends SpellObject {
  position = this.owner.position.copy();
  target: any = null;
  mark: Zed_R_Mark | null = null;
  lifeTime = 3000;
  age = 0;
  size = 60;

  update() {
    this.age += deltaTime;

    if (!this.target || this.target.isDead || this.age >= this.lifeTime) {
      this.toRemove = true;
      return;
    }

    this.position.set(this.target.position.x, this.target.position.y);
  }

  draw() {
    const alpha =
      this.age > this.lifeTime - 400
        ? map(this.age, this.lifeTime - 400, this.lifeTime, 200, 0)
        : 200;
    const size = this.target
      ? Math.max(this.size, this.target.animatedValues.displaySize + 16)
      : this.size;

    push();
    translate(this.position.x, this.position.y);
    rotate(frameCount / 30);

    noFill();
    strokeWeight(3);
    stroke(SHADOW_COLOR[0], SHADOW_COLOR[1], SHADOW_COLOR[2], alpha);

    // two counter-set arcs plus a triangle: a simple, readable death rune
    arc(0, 0, size, size, 0, PI * 0.6);
    arc(0, 0, size, size, PI, PI * 1.6);

    strokeWeight(2);
    stroke(255, alpha * 0.8);
    const r = size / 3;
    triangle(0, -r, cos(PI / 6) * r, sin(PI / 6) * r, -cos(PI / 6) * r, sin(PI / 6) * r);

    // banked damage swells the rune, so the payload is readable before it lands
    const stored = this.mark?.storedDamage ?? 0;
    if (stored > 0) {
      noStroke();
      fill(SHADOW_COLOR[0], SHADOW_COLOR[1], SHADOW_COLOR[2], alpha * 0.5);
      circle(0, 0, constrain(stored * 1.5, 4, size));
    }

    pop();
  }

  getDisplayBoundingBox() {
    const r = this.size;
    return new Rectangle({
      x: this.position.x - r,
      y: this.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
