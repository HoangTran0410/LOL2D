import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import VectorUtils from '@/utils/vector.utils';
import { effectiveRange, withinRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import { SpellForm } from '@/game/spell/runtime/CancelPolicy';
import type { CastContext, CastSpec } from '@/game/spell/runtime/types';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Slow from '@/game/gameObject/buffs/Slow';
import Spell from '@/game/gameObject/Spell';
import { groundedSpheres, SPHERE_GRAB_RADIUS, Syndra_Burst, type Syndra_Sphere } from './Syndra_Q';

/**
 * Syndra W — she picks a grounded sphere up and throws it somewhere else.
 *
 * The sphere is the resource and the throw *moves* it: after the impact it is
 * lying on the ground again at the point it hit, so the count she is tracking
 * for R never changes. Refusing the cast when nothing is in reach happens in
 * `checkCastCondition`, which the runtime consults before it bills anything.
 */

export const SYNDRA_W_DAMAGE = 24;
export const SYNDRA_W_RADIUS = 150;
export const SYNDRA_W_THROW_RANGE = 450;
export const SYNDRA_W_SLOW = 0.25;
export const SYNDRA_W_SLOW_MS = 1_500;
export const SYNDRA_W_HOLD_MS = 4_000;

export default class Syndra_W extends Spell {
  image = AssetManager.get('spell_syndra_w');
  name = 'Ý Lực (Syndra_W)';
  description = `Nhấc quả cầu gần nhất trong ${SPHERE_GRAB_RADIUS} lên đầu, rồi nhấn lại để ném
    tới điểm chỉ định: <span class="damage">${SYNDRA_W_DAMAGE} sát thương</span> trong bán kính
    ${SYNDRA_W_RADIUS} và <b>làm chậm ${Math.round(SYNDRA_W_SLOW * 100)}%</b>. Quả cầu
    <b>nằm lại</b> ở điểm rơi — cô chỉ dịch chuyển nó.`;
  coolDown = 9_000;
  manaCost = 40;
  range = SYNDRA_W_THROW_RANGE;

  heldSphere: Syndra_Sphere | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'RECAST',
      targeting: 'POINT',
      active: { maxDurationMs: SYNDRA_W_HOLD_MS },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
      // She keeps walking with a sphere over her head; a stun or a silence drops it.
      interrupts: SpellForm.TETHERED,
    };
  }

  checkCastCondition(): boolean {
    if (this.heldSphere && !this.heldSphere.toRemove) return true;
    return this.reachableSphere() !== null;
  }

  onActivate(_context?: CastContext): void {
    const sphere = this.reachableSphere();
    if (!sphere) return;
    sphere.seize();
    this.heldSphere = sphere;
  }

  onRecast(context?: CastContext): void {
    this.throwHeldSphere(context);
  }

  onComplete(_context?: CastContext): void {
    this.dropHeldSphere();
  }

  /** Death, a stun, a silence or the scene going away: she puts it down. */
  onCancel(): void {
    this.dropHeldSphere();
  }

  /** Her closest grounded sphere she can actually reach, or nothing. */
  private reachableSphere(): Syndra_Sphere | null {
    for (const sphere of groundedSpheres(this.owner)) {
      if (withinRange(SPHERE_GRAB_RADIUS, this.owner, sphere)) return sphere;
    }
    return null;
  }

  private throwHeldSphere(context?: CastContext): void {
    const sphere = this.heldSphere;
    this.heldSphere = null;
    if (!sphere || sphere.toRemove) return;

    const cursor = context?.cursorWorld ?? this.aimPoint;
    const { to } = VectorUtils.getVectorWithMaxRange(
      this.owner.position,
      createVector(cursor.x, cursor.y),
      effectiveRange(this.range, this.owner)
    );

    sphere.launchTo(to, landed => this.detonate(landed.position.x, landed.position.y));
  }

  private dropHeldSphere(): void {
    const sphere = this.heldSphere;
    this.heldSphere = null;
    if (!sphere || sphere.toRemove) return;
    sphere.dropAt(this.owner.position.x, this.owner.position.y);
  }

  private detonate(x: number, y: number): void {
    const struck = new Set<AttackableUnit>();
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x, y, r: SYNDRA_W_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of victims) {
      if (struck.has(victim)) continue;
      struck.add(victim);
      victim.takeDamage(SYNDRA_W_DAMAGE, this.owner);

      const slow = new Slow(SYNDRA_W_SLOW_MS, this.owner, victim);
      slow.percent = SYNDRA_W_SLOW;
      slow.stackId = 'syndra_w_slow';
      victim.addBuff(slow);

      this.game.objectManager.addObject(
        new Syndra_Burst(this.owner, victim.position.x, victim.position.y, 36, 260)
      );
    }

    this.game.objectManager.addObject(new Syndra_Burst(this.owner, x, y, SYNDRA_W_RADIUS, 380));
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}
