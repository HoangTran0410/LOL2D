import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { makeGroundedSpheres, makeSyndra_Burst, makeSyndra_Sphere } from './Syndra_Q';
import { SPHERE_GRAB_RADIUS } from './Syndra_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type Syndra_W = InstanceType<ReturnType<typeof makeSyndra_W>>;
type Syndra_Burst = InstanceType<ReturnType<typeof makeSyndra_Burst>>;
type Syndra_Sphere = InstanceType<ReturnType<typeof makeSyndra_Sphere>>;



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


function __buildSyndra_W(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const VectorUtils = api.utils.VectorUtils;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellForm = api.enums.SpellForm;
  const AttackableUnit = api.units.AttackableUnit;
  const Slow = api.buffs.Slow;
  const Spell = api.Spell;
  const groundedSpheres = makeGroundedSpheres(api);
  const Syndra_Burst = makeSyndra_Burst(api);
  class Syndra_W extends Spell {
    image = api.asset('spell_syndra_w');
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
  return Syndra_W;
}
const __cacheSyndra_W = new WeakMap<ContentApi, ReturnType<typeof __buildSyndra_W>>();
export default function makeSyndra_W(api: ContentApi) {
  const cached = __cacheSyndra_W.get(api);
  if (cached) return cached;
  const built = __buildSyndra_W(api);
  __cacheSyndra_W.set(api, built);
  return built;
}