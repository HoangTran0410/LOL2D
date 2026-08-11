import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import Airborne from '../buffs/Airborne';
import Charm from '../buffs/Charm';
import Dash from '../buffs/Dash';
import Fear from '../buffs/Fear';
import Ground from '../buffs/Ground';
import Root from '../buffs/Root';
import Shield from '../buffs/Shield';
import Silence from '../buffs/Silence';
import Slow from '../buffs/Slow';
import Stun from '../buffs/Stun';

export default class Morgana_E extends Spell {
  image = AssetManager.getAsset('spell_morgana_e');
  name = 'Lá Chắn Đen (Morgana_E)';
  description =
    'Ban cho đồng minh có ít máu nhất trong phạm vi (hoặc chính mình) một <span class="buff">Lá Chắn Đen</span> hấp thụ <span class="damage">90 sát thương</span> trong <span class="time">5 giây</span>. Khi lá chắn còn tồn tại, mục tiêu <span class="buff">miễn nhiễm mọi hiệu ứng khống chế</span> của kẻ địch (choáng, trói, câm lặng, làm chậm, hất tung, mê hoặc, khiếp sợ, ghìm, kéo/đẩy) — mỗi hiệu ứng bị chặn sẽ bị xoá ngay lập tức. Không chặn được <span class="buff">Mờ Mắt</span>, cũng không chặn khống chế từ chính mình hoặc đồng đội. Game không phân biệt sát thương phép và vật lý nên lá chắn hấp thụ mọi loại sát thương.';
  coolDown = 12000;
  manaCost = 40;

  range = 500;
  shieldAmount = 90;
  shieldTime = 5000;

  onSpellCast() {
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
      ],
    });

    // the ally who needs it most; the caster shields themself when nobody is around
    let target = this.owner;
    let lowestHealth = Infinity;
    for (const ally of allies) {
      const health = ally.stats.health.value;
      if (health < lowestHealth) {
        target = ally;
        lowestHealth = health;
      }
    }

    const shieldBuff = new Morgana_E_BlackShield(this.shieldTime, this.owner, target);
    shieldBuff.image = this.image;
    shieldBuff.amount = this.shieldAmount;
    target.addBuff(shieldBuff);

    const obj = new Morgana_E_Object(this.owner);
    obj.targetUnit = target;
    this.game.objectManager.addObject(obj);
  }

  drawPreview() {
    super.drawPreview(this.range);
  }
}

/**
 * Black Shield: a shield that also grants crowd control immunity while it holds.
 *
 * The engine has no "before a buff is applied" hook, so immunity is enforced from
 * the buff's own update: every frame it walks the target's buff list and kills any
 * enemy-sourced crowd control that appeared after the shield went up. Because
 * `AttackableUnit.updateBuffs` re-accumulates the status flags of every buff each
 * frame *in list order*, and this shield always sits earlier in that list than the
 * crowd control it is blocking, zeroing the offender's flags here removes them from
 * the same frame's status — the target is never actually stunned/rooted/slowed.
 *
 * Faithful details taken from the wiki:
 *  - it does not cleanse crowd control that was already on the target, only blocks new,
 *  - it does not resist self or allied crowd control,
 *  - it does not resist nearsight (so `Nearsight` is absent from the blocked list).
 */
export class Morgana_E_BlackShield extends Shield {
  name = 'Lá Chắn Đen';
  stackId = 'morgana_e_blackshield';
  color: [number, number, number] = [180, 90, 230];

  /** Crowd control this shield eats. `Dash` covers enemy displacements (hooks, pulls). */
  static BLOCKED_BUFFS: any[] = [Stun, Root, Silence, Slow, Airborne, Charm, Fear, Ground, Dash];

  /** Buffs present when the shield went up: those are left alone, no cleansing. */
  _preExisting: Set<any> = new Set();
  blockedCount = 0;
  _flash = 0;

  onActivate(): void {
    for (const buff of this.targetUnit.buffs) this._preExisting.add(buff);
  }

  onUpdate(): void {
    if (this._flash > 0) this._flash -= deltaTime;
    if (this.toRemove || this.targetUnit.isDead) return;

    const targetTeamId = this.targetUnit.teamId;

    for (const buff of this.targetUnit.buffs) {
      if (buff === this || buff.toRemove || this._preExisting.has(buff)) continue;
      // self and allied crowd control goes through, like the real spell
      if (!buff.sourceUnit || buff.sourceUnit.teamId === targetTeamId) continue;
      if (!Morgana_E_BlackShield.BLOCKED_BUFFS.some((BuffClass: any) => buff instanceof BuffClass))
        continue;

      // strip the status it would contribute this very frame, then end it
      buff.statusFlagsToEnable = 0;
      buff.statusFlagsToDisable = 0;
      buff.deactivateBuff();

      this.blockedCount++;
      this._flash = 250;
    }
  }

  draw(): void {
    super.draw();
    if (this.targetUnit.isDead) return;

    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;

    push();
    noFill();
    // dark runic ring, brightening for a moment whenever it eats a disable
    const flashAlpha = this._flash > 0 ? map(this._flash, 0, 250, 0, 180) : 0;
    stroke(40, 0, 60, 140 + flashAlpha);
    strokeWeight(3);
    circle(pos.x, pos.y, size + 18);

    stroke(200, 120, 255, 120 + flashAlpha);
    strokeWeight(2);
    const a = -frameCount / 40;
    for (let i = 0; i < 5; i++) {
      const angle = a + (i * TWO_PI) / 5;
      const r1 = size / 2 + 6;
      const r2 = size / 2 + 14;
      line(
        pos.x + cos(angle) * r1,
        pos.y + sin(angle) * r1,
        pos.x + cos(angle) * r2,
        pos.y + sin(angle) * r2
      );
    }
    pop();
  }
}

/** The cast flash: a dark ring blooming outwards on whoever got the shield. */
export class Morgana_E_Object extends SpellObject {
  targetUnit: any = null;
  age = 0;
  lifeTime = 500;
  maxRadius = 60;

  update() {
    this.age += deltaTime;
    if (this.age >= this.lifeTime || !this.targetUnit) this.toRemove = true;
  }

  draw() {
    if (!this.targetUnit) return;

    const pos = this.targetUnit.position;
    const radius = map(this.age, 0, this.lifeTime, 5, this.maxRadius);
    const alpha = map(this.age, 0, this.lifeTime, 220, 0);

    push();
    noFill();
    stroke(180, 90, 230, alpha);
    strokeWeight(4);
    circle(pos.x, pos.y, radius * 2);
    pop();
  }

  getDisplayBoundingBox() {
    const pos = this.targetUnit?.position ?? this.owner.position;
    return new Rectangle({
      x: pos.x - this.maxRadius,
      y: pos.y - this.maxRadius,
      w: this.maxRadius * 2,
      h: this.maxRadius * 2,
      data: this,
    });
  }
}
