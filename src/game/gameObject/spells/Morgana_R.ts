import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Buff from '../Buff';
import AttackableUnit from '../attackableUnits/AttackableUnit';
import Slow from '../buffs/Slow';
import Stun from '../buffs/Stun';
import Speedup from '../buffs/Speedup';
import { createReveal } from '../buffs/TrueSight';

// Exported so the suite asserts the tether's wiring, not a copy of the
// numbers — retuning a value should not mean editing the test.
export const CAST_TIME_MS = 350;
export const LATCH_RADIUS = 500;
// Wider than LATCH_RADIUS on purpose: once caught, a target can roam a bit
// further than the acquire range before the tether actually snaps, mirroring
// the wiki (acquire 575 vs tether 625).
export const TETHER_RANGE = 620;
export const TETHER_DURATION_MS = 3_000;
export const INITIAL_DAMAGE = 35;
export const RESOLVE_DAMAGE = 35;
export const STUN_DURATION_MS = 1_500;
export const SLOW_PERCENT = 0.2;
export const SELF_HASTE_PERCENT = 0.2;
export const MANA_COST = 100;
/** Morgana's own reveal slot, so hers neither evicts nor is evicted by another spell's. */
export const REVEAL_STACK_ID = 'morgana_r_reveal';

type ShackleTarget = AttackableUnit;

export default class Morgana_R extends Spell {
  image = AssetManager.get('spell_morgana_r');
  name = 'Xiềng Xích Linh Hồn (Morgana_R)';
  description =
    'Móc xiềng năng lượng vào các kẻ địch gần đó, gây <span class="damage">35 sát thương</span>, <span class="buff">Lộ Diện</span> và <span class="buff">Làm Chậm 20%</span> chúng trong <span class="time">3 giây</span>. Nếu mục tiêu vẫn còn trong tầm xiềng khi hết hạn, chúng nhận thêm <span class="damage">35 sát thương</span> và bị <span class="buff">Choáng 1.5 giây</span>. Bản thân Morgana được <span class="buff">Tăng Tốc 20%</span> trong lúc xiềng còn hiệu lực.';
  coolDown = 10_000;
  manaCost = MANA_COST;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: CAST_TIME_MS,
      resource: { commitAt: 'release', refundOn: [] },
      cooldown: { startAt: 'end', durationMs: this.coolDown },
    };
  }

  onRelease(context: CastContext): void {
    const origin = context.origin;
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x: origin.x, y: origin.y, r: LATCH_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as ShackleTarget[];

    const targets = candidates.filter(
      target =>
        Math.hypot(target.position.x - origin.x, target.position.y - origin.y) <=
        LATCH_RADIUS + target.collisionRadius
    );

    if (targets.length === 0) return;

    const haste = new Speedup(TETHER_DURATION_MS, this.owner, this.owner);
    haste.percent = SELF_HASTE_PERCENT;
    this.owner.addBuff(haste);

    for (const target of targets) this.latch(target);
  }

  drawPreview(): void {
    super.drawPreview(LATCH_RADIUS);
  }

  private latch(target: ShackleTarget): void {
    target.takeDamage(INITIAL_DAMAGE, this.owner);

    const slow = new Slow(TETHER_DURATION_MS, this.owner, target);
    slow.percent = SLOW_PERCENT;
    target.addBuff(slow);

    const reveal = createReveal({
      stackId: REVEAL_STACK_ID,
      durationMs: TETHER_DURATION_MS,
      source: this.owner,
      target,
    });
    target.addBuff(reveal);

    const mark = new Morgana_R_Tether(TETHER_DURATION_MS, this.owner, target);
    target.addBuff(mark);

    // Both ends of the tether read a unit's position every frame, so it must
    // ride `attachTo` for the target-death/removal case. `attachTo` only
    // watches one anchor, and the owner (Morgana) is the second end, so her
    // death/removal is checked by hand in `update()` alongside it.
    const tether = new Morgana_R_Tether_Object(this.owner).attachTo(target);
    tether.target = target;
    tether.slowBuff = slow;
    tether.revealBuff = reveal;
    tether.markBuff = mark;
    this.game.objectManager.addObject(tether);
  }
}

/**
 * The victim-facing half of the tether: a shifting rune ring plus orbiting
 * shackle studs that close in as the timer runs out. This is what tells a
 * caught target to run — the connecting line to Morgana may be off-screen
 * or easy to miss, but this sits right on their own body.
 *
 * Removed the instant a target escapes `TETHER_RANGE` (see
 * `Morgana_R_Tether_Object.endTether`), which is itself the "you got away"
 * signal: the marker just vanishes well before its own timer would have run out.
 */
export class Morgana_R_Tether extends Buff {
  name = 'Xiềng Hồn';
  image: Buff['image'] = AssetManager.get('spell_morgana_r');

  draw(): void {
    const pos = this.targetUnit.position;
    const size = this.targetUnit.animatedValues.displaySize;
    const urgency = this.duration > 0 ? constrain(this.timeElapsed / this.duration, 0, 1) : 0;
    const fast = urgency > 0.7;
    const pulse = 0.5 + 0.5 * sin(frameCount / (fast ? 5 : 13));

    push();
    translate(pos.x, pos.y);

    noFill();
    stroke(150, 60, 200, 130 + 100 * pulse * (0.35 + urgency));
    strokeWeight(3 + 2 * urgency);
    circle(0, 0, size + 16 + 6 * pulse);

    // shackle studs orbiting the victim, spinning faster and drawing in as
    // the resolve moment approaches
    const spin = frameCount / (fast ? 16 : 34);
    for (let i = 0; i < 4; i++) {
      const a = spin + (i * TWO_PI) / 4;
      const r = size / 2 + 15 - urgency * 5;
      noStroke();
      fill(190, 90, 230, 210);
      circle(cos(a) * r, sin(a) * r, 6 + 3 * urgency);
      fill(240, 210, 255, 220);
      circle(cos(a) * r, sin(a) * r, 2.5);
    }

    pop();
  }
}

/**
 * The line between Morgana and one latched target, plus the escape/resolve
 * clock. `attachTo(target)` drops this the instant the target dies or is
 * removed, matching every other body-attached effect in this codebase.
 * Distance and duration are otherwise tracked independently — the mark buff
 * is never watched for its own removal, since it and this object would
 * otherwise race to end the tether on the exact same frame.
 */
export class Morgana_R_Tether_Object extends SpellObject {
  target!: ShackleTarget;
  slowBuff?: Buff;
  revealBuff?: Buff;
  markBuff?: Buff;

  elapsedMs = 0;
  durationMs = TETHER_DURATION_MS;
  maxRange = TETHER_RANGE;
  resolveDamage = RESOLVE_DAMAGE;
  stunDurationMs = STUN_DURATION_MS;

  update(deltaMs = deltaTime): void {
    if (this.toRemove) return;
    if (this.dropIfAttachmentLost() || this.owner.isDead || this.owner.toRemove) {
      this.toRemove = true;
      this.cleanupBuffs();
      return;
    }

    this.elapsedMs += Math.max(0, deltaMs);
    const distance = Math.hypot(
      this.target.position.x - this.owner.position.x,
      this.target.position.y - this.owner.position.y
    );

    if (distance > this.maxRange) {
      this.endTether(false);
      return;
    }
    if (this.elapsedMs >= this.durationMs) {
      this.endTether(true);
    }
  }

  draw(): void {
    const t = constrain(this.elapsedMs / this.durationMs, 0, 1);
    const urgency = t > 0.7 ? (t - 0.7) / 0.3 : 0;
    const pulse = 0.5 + 0.5 * sin(frameCount / (urgency > 0.3 ? 5 : 12));
    const ox = this.owner.position.x;
    const oy = this.owner.position.y;
    const tx = this.target.position.x;
    const ty = this.target.position.y;

    push();
    blendMode(ADD);
    stroke(150, 70, 210, 80 + 100 * pulse * (0.35 + urgency));
    strokeWeight(5 + 3 * urgency);
    line(ox, oy, tx, ty);
    stroke(230, 200, 255, 110 + 110 * pulse * (0.35 + urgency));
    strokeWeight(1.5 + urgency);
    line(ox, oy, tx, ty);
    blendMode(BLEND);

    // shackle cuffs anchored at both ends — the tether has two sides
    noStroke();
    fill(150, 70, 210, 220);
    circle(ox, oy, 14);
    circle(tx, ty, 14);
    fill(230, 200, 255, 210);
    circle(ox, oy, 6);
    circle(tx, ty, 6);
    pop();
  }

  // spans from Morgana to the target — the box must cover both
  getDisplayBoundingBox(): Rectangle {
    const pad = 24;
    return new Rectangle({
      x: Math.min(this.owner.position.x, this.target.position.x) - pad,
      y: Math.min(this.owner.position.y, this.target.position.y) - pad,
      w: Math.abs(this.target.position.x - this.owner.position.x) + pad * 2,
      h: Math.abs(this.target.position.y - this.owner.position.y) + pad * 2,
      data: this,
    });
  }

  private endTether(resolved: boolean): void {
    this.toRemove = true;
    if (resolved && !this.target.isDead) {
      this.target.takeDamage(this.resolveDamage, this.owner);
      this.target.addBuff(new Stun(this.stunDurationMs, this.owner, this.target));
    }
    this.cleanupBuffs();
  }

  private cleanupBuffs(): void {
    this.slowBuff?.deactivateBuff();
    this.revealBuff?.deactivateBuff();
    this.markBuff?.deactivateBuff();
  }
}
