import { Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import VectorUtils from '../../../utils/vector.utils';
import BuffAddType from '../../enums/BuffAddType';
import MissileSpellObject from '../MissileSpellObject';
import Spell from '../Spell';
import Dash from '../buffs/Dash';
import RootBuff from '../buffs/Root';
import Stun from '../buffs/Stun';

/**
 * Death Sentence / Deathly Leap.
 *
 * The hook does NOT drag the victim home. On impact it stuns for 1.5s and Thresh
 * tugs the chain exactly twice (0.1s after the hit, then again 0.6s later), each
 * tug hauling the victim only a short distance. 0.5s after the hit Thresh may
 * recast to leap to the shackled victim himself.
 */
export default class Thresh_Q extends Spell {
  static PHASES = {
    Q1: {
      image: AssetManager.getAsset('spell_thresh_q'),
    },
    Q2: {
      image: AssetManager.getAsset('spell_thresh_q2'),
    },
  };
  phase: 'Q1' | 'Q2' = 'Q1';

  image = Thresh_Q.PHASES[this.phase].image;
  name = 'Bàn Tay Tử Thần / Nhảy Tử Thần (Thresh_Q)';
  description =
    'Quăng lưỡi hái theo hướng chỉ định, móc trúng kẻ địch đầu tiên, gây <span class="damage">25 sát thương</span> và <span class="buff">Choáng</span> chúng trong <span class="time">1.5 giây</span>. Thresh giật xích <b>2 lần</b> (sau <span class="time">0.1 giây</span> và <span class="time">0.6 giây</span> kế tiếp), mỗi lần kéo nạn nhân lại gần một đoạn ngắn. Sau <span class="time">0.5 giây</span> có thể tái kích hoạt để <span class="buff">Lướt</span> tới chỗ nạn nhân đang bị xích';
  coolDown = 8000;
  manaCost = 30;

  /** Deathly Leap unlocks 0.5s after the hook connects. */
  coolDownAfterHook = 500;

  range = 550;

  threshObj: Thresh_Q_Object | null = null;
  ownerRootBuff: RootBuff | null = null;

  checkCastCondition() {
    // the recast needs a victim still on the chain, and legs to leap with
    if (this.phase === 'Q2') {
      const victim = this.threshObj?.champHooked;
      return (
        !!this.threshObj && !this.threshObj.toRemove && !!victim && !victim.isDead && Dash.CanDash(this.owner)
      );
    }
    return true;
  }

  onSpellCast() {
    if (this.phase === 'Q2') {
      this._deathlyLeap();
      return;
    }

    const { to: destination } = VectorUtils.getVectorWithRange(
      this.owner.position,
      this.game.worldMouse,
      this.range
    );

    this.threshObj = new Thresh_Q_Object(this.owner);
    this.threshObj.position = this.owner.position.copy();
    this.threshObj.destination = destination;
    this.threshObj.range = this.range;
    this.threshObj.onHookLanded = () => {
      // shackled: the recast becomes available once the short lockout passes
      this.phase = 'Q2';
      this.image = Thresh_Q.PHASES.Q2.image;
      this.currentCooldown = this.coolDownAfterHook;
    };
    this.game.objectManager.addObject(this.threshObj);

    // Thresh plants himself while the chain flies out
    this.ownerRootBuff = new RootBuff(1500, this.owner, this.owner);
    this.ownerRootBuff.buffAddType = BuffAddType.REPLACE_EXISTING;
    this.ownerRootBuff.image = Thresh_Q.PHASES.Q1.image;
    this.owner.addBuff(this.ownerRootBuff);
  }

  /** Recast: stop tugging and leap to the shackled victim instead. */
  _deathlyLeap() {
    const victim = this.threshObj!.champHooked;

    const dashBuff = new Dash(2000, this.owner, this.owner);
    dashBuff.image = Thresh_Q.PHASES.Q2.image;
    dashBuff.dashDestination = victim.position; // live ref: home in on the victim
    dashBuff.dashSpeed = 16;
    dashBuff.cancelable = false;
    this.owner.addBuff(dashBuff);

    this.threshObj!.toRemove = true; // ends the shackle and any pending tug
    this.threshObj = null;
    this.phase = 'Q1';
    this.image = Thresh_Q.PHASES.Q1.image;
  }

  onUpdate() {
    if (!this.threshObj) return;

    // the wind-up root ends the moment the chain connects (or misses)
    if (this.threshObj.phase === Thresh_Q_Object.PHASES.SHACKLE || this.threshObj.toRemove) {
      this.ownerRootBuff?.deactivateBuff();
    }

    if (this.threshObj.toRemove) {
      this.threshObj = null;

      // the shackle ran out without a leap — back to a fresh Q1
      if (this.phase === 'Q2') {
        this.phase = 'Q1';
        this.image = Thresh_Q.PHASES.Q1.image;
        this.currentCooldown = this.coolDown;
      }
    }
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

export class Thresh_Q_Object extends MissileSpellObject {
  range = 550;
  speed = 12;
  size = 26;
  damage = 25;

  /** Stun + shackle window. */
  shackleDuration = 1500;
  /** Tug timings measured from the hit: 0.1s, then 0.6s after that. */
  tugDelays = [100, 700];
  /** How far a single tug hauls the victim — a jerk, not a full drag. */
  tugDistance = 100;
  tugSpeed = 13;

  // the scythe latches onto one victim instead of dying on impact
  maxHitCount = 1;
  removeOnMaxHit = false;

  champHooked: any = null;
  stunBuff: Stun | null = null;
  tugBuff: Dash | null = null;
  onHookLanded: (() => void) | null = null;

  _timeSinceHit = 0;
  _tugsDone = 0;

  static PHASES = {
    FORWARD: 'forward',
    SHACKLE: 'shackle',
  } as const;
  phase: (typeof Thresh_Q_Object.PHASES)[keyof typeof Thresh_Q_Object.PHASES] =
    Thresh_Q_Object.PHASES.FORWARD;

  onHit(enemy: any) {
    this.phase = Thresh_Q_Object.PHASES.SHACKLE;
    this.champHooked = enemy;
    this.isMissile = false; // stop colliding; the chain is spent

    enemy.takeDamage(this.damage, this.owner);

    this.stunBuff = new Stun(this.shackleDuration, this.owner, enemy);
    this.stunBuff.image = AssetManager.getAsset('spell_thresh_q');
    enemy.addBuff(this.stunBuff);

    this.onHookLanded?.();
  }

  update() {
    if (this.phase === Thresh_Q_Object.PHASES.FORWARD) {
      super.update();
      return;
    }

    // the scythe rides on the victim for as long as the shackle holds
    this.position.set(this.champHooked.position.x, this.champHooked.position.y);

    this._timeSinceHit += deltaTime;

    if (
      this._tugsDone < this.tugDelays.length &&
      this._timeSinceHit >= this.tugDelays[this._tugsDone]
    ) {
      this._tugsDone++;
      this._tug();
    }

    if (this.champHooked.isDead || this._timeSinceHit >= this.shackleDuration) {
      this.toRemove = true;
    }
  }

  /** One short haul towards Thresh — a snapshot destination, never a live ref. */
  _tug() {
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.champHooked.position,
      this.owner.position,
      this.tugDistance
    );

    this.tugBuff?.deactivateBuff?.();

    const tug = new Dash(500, this.owner, this.champHooked);
    tug.image = AssetManager.getAsset('spell_thresh_q');
    tug.dashDestination = to;
    tug.dashSpeed = this.tugSpeed;
    tug.showTrail = false;
    tug.cancelable = false; // the stun we applied must not cancel our own tug
    this.champHooked.addBuff(tug);
    this.tugBuff = tug;
  }

  onRemoved() {
    this.tugBuff?.deactivateBuff?.();
  }

  draw() {
    const ownerPos = this.owner.position;
    const alpha = constrain(map(this.position.dist(ownerPos), 0, this.range, 220, 70), 70, 220);

    push();

    // chain: evenly spaced links between Thresh and the scythe
    const dist = this.position.dist(ownerPos);
    const links = Math.max(1, Math.floor(dist / 18));
    noStroke();
    fill(120, 255, 170, alpha);
    for (let i = 1; i <= links; i++) {
      const t = i / (links + 1);
      circle(lerp(ownerPos.x, this.position.x, t), lerp(ownerPos.y, this.position.y, t), 6);
    }

    stroke(90, 200, 130, alpha / 2);
    strokeWeight(2);
    line(ownerPos.x, ownerPos.y, this.position.x, this.position.y);

    // the scythe head — flies point-first, then bites back towards Thresh
    const angle =
      this.phase === Thresh_Q_Object.PHASES.SHACKLE
        ? VectorUtils.getAngle(this.position, ownerPos)
        : VectorUtils.getAngle(this.position, this.destination);
    translate(this.position.x, this.position.y);
    rotate(angle);

    stroke(40, 90, 60);
    strokeWeight(2);
    fill(170, 255, 200);
    triangle(this.size / 2, 0, -this.size / 2, -this.size / 2, -this.size / 4, 0);
    triangle(this.size / 2, 0, -this.size / 2, this.size / 2, -this.size / 4, 0);

    noStroke();
    fill(220, 255, 235, 200);
    circle(0, 0, this.size / 3);

    pop();
  }

  // the chain spans from the caster to the scythe, so the box must cover both
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
