import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import BuffAddType from '../../enums/BuffAddType';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Buff from '../Buff';
import Spell from '../Spell';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import Champion from '../attackableUnits/Champion';
import Dash from '../buffs/Dash';
import Shield from '../buffs/Shield';

/**
 * Safeguard / Iron Will.
 *
 * Stage 1 (Safeguard): Lee Sin dashes to a nearby allied unit and both of them
 * get a shield when he lands — no shield at all if the dash is interrupted,
 * exactly like the real spell. With nobody around he self-casts and shields
 * himself on the spot. Reaching an allied *champion* halves the cooldown.
 *
 * Stage 2 (Iron Will): recastable for 3s afterwards. The real Iron Will is pure
 * omnivamp, which is meaningless here because this game has no basic attacks —
 * it is adapted into a heal-over-time of the same "sustain in a fight" shape.
 */
export default class LeeSin_W extends Spell {
  static PHASES = {
    W1: { image: AssetManager.getAsset('spell_leesin_w') },
    W2: { image: AssetManager.getAsset('spell_leesin_w2') },
  };
  phase: 'W1' | 'W2' = 'W1';

  image = LeeSin_W.PHASES[this.phase].image;
  name = 'Kim Cương Bất Hoại / Ý Chí Sắt Đá (LeeSin_W)';
  description =
    'Lee Sin <span class="buff">Lướt</span> tới đồng minh gần nhất trong phạm vi, khi tới nơi cả hai nhận <span class="buff">Lá Chắn</span> hấp thụ <span class="damage">70 sát thương</span> trong <span class="time">3 giây</span> (không có đồng minh thì tự khoác lá chắn tại chỗ; nếu cú lướt bị chặn thì không có lá chắn). Lướt tới đồng minh là tướng sẽ giảm một nửa thời gian hồi. Có thể tái kích hoạt trong <span class="time">3 giây</span> để dùng <span class="buff">Ý Chí Sắt Đá</span>: game không có đòn đánh thường nên hút máu được chuyển thành <span class="buff">hồi 60 máu</span> trong <span class="time">4 giây</span>';
  coolDown = 9000;
  manaCost = 30;

  range = 400;
  dashSpeed = 14;
  shieldAmount = 70;
  shieldDuration = 3000;

  /** How long Iron Will stays available after Safeguard, like the real 3s window. */
  ironWillWindow = 3000;
  ironWillDuration = 4000;
  ironWillHeal = 60;

  _ironWillTimeLeft = 0;
  _cooldownAfterSafeguard = 9000;

  onSpellCast() {
    if (this.phase === 'W1') this.castSafeguard();
    else this.castIronWill();
  }

  castSafeguard() {
    const ally = this.findNearestAlly();

    // the real spell halves its cooldown when it lands on an allied champion
    this._cooldownAfterSafeguard =
      ally instanceof Champion ? this.coolDown / 2 : this.coolDown;

    if (ally && Dash.CanDash(this.owner)) {
      const dashBuff = new Dash(3000, this.owner, this.owner);
      dashBuff.image = this.image;
      dashBuff.dashDestination = ally.position; // live ref: the dash follows the ally
      dashBuff.dashSpeed = this.dashSpeed;
      dashBuff.onReachedDestination = () => {
        this.grantShield(this.owner);
        // only champions are shielded alongside him, minions/wards are not
        if (ally instanceof Champion && !ally.isDead) this.grantShield(ally);
      };
      this.owner.addBuff(dashBuff);
    } else {
      // self-cast: shield goes up immediately, no travel
      this.grantShield(this.owner);
    }

    this.phase = 'W2';
    this.image = LeeSin_W.PHASES.W2.image;
    this._ironWillTimeLeft = this.ironWillWindow;
    // Iron Will has to become castable right away; the real cooldown only
    // starts once the recast window is used up or has lapsed
    this.currentCooldown = 300;
  }

  castIronWill() {
    const ironWill = new LeeSin_W_IronWill(this.ironWillDuration, this.owner, this.owner);
    ironWill.image = this.image;
    ironWill.totalHeal = this.ironWillHeal;
    this.owner.addBuff(ironWill);

    this.endRecastWindow();
  }

  grantShield(unit: any) {
    const shieldBuff = new Shield(this.shieldDuration, this.owner, unit);
    shieldBuff.amount = this.shieldAmount;
    shieldBuff.color = [140, 210, 255];
    shieldBuff.image = LeeSin_W.PHASES.W1.image;
    shieldBuff.stackId = 'leesin_w_shield';
    unit.addBuff(shieldBuff);
  }

  endRecastWindow() {
    this.phase = 'W1';
    this.image = LeeSin_W.PHASES.W1.image;
    this._ironWillTimeLeft = 0;
    this.currentCooldown = this._cooldownAfterSafeguard;
  }

  findNearestAlly(): any {
    const allies = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: this.range,
      }),
      filters: [
        PredefinedFilters.type(AttackableUnit),
        PredefinedFilters.teamId(this.owner.teamId),
        PredefinedFilters.excludeDead,
        PredefinedFilters.excludeObjects([this.owner]),
      ],
    });

    let nearest: any = null;
    let nearestDistance = Infinity;
    for (const ally of allies) {
      const distance = ally.position.dist(this.owner.position);
      if (distance < nearestDistance) {
        nearest = ally;
        nearestDistance = distance;
      }
    }
    return nearest;
  }

  onUpdate() {
    if (this.phase !== 'W2') return;

    this._ironWillTimeLeft -= deltaTime;
    if (this._ironWillTimeLeft <= 0) this.endRecastWindow();
  }

  drawPreview() {
    if (this.phase === 'W1') super.drawPreview(this.range);
  }
}

/**
 * Iron Will, adapted: the real one is omnivamp on his attacks and spells, which
 * this game has no way to express, so the sustain is paid out as a heal spread
 * over the same 4 seconds.
 */
export class LeeSin_W_IronWill extends Buff {
  name = 'Ý Chí Sắt Đá';
  buffAddType = BuffAddType.RENEW_EXISTING;

  totalHeal = 60;
  tickInterval = 500;
  _tickTimer = 0;

  onUpdate(): void {
    if (this.targetUnit.isDead) return;

    this._tickTimer += deltaTime;
    if (this._tickTimer < this.tickInterval) return;
    this._tickTimer -= this.tickInterval;

    const ticks = Math.max(1, Math.round(this.duration / this.tickInterval));
    this.targetUnit.takeHeal(Math.round(this.totalHeal / ticks), this.sourceUnit);
  }

  draw(): void {
    if (this.targetUnit.isDead) return;

    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    noFill();
    stroke(120, 220, 255, 160);
    strokeWeight(2);
    // a slowly turning brace of arcs, "hardened" rather than shielded
    const a = frameCount / 25;
    for (let i = 0; i < 3; i++) {
      const start = a + (i * TWO_PI) / 3;
      arc(pos.x, pos.y, size + 18, size + 18, start, start + 0.9);
    }
    pop();
  }
}
