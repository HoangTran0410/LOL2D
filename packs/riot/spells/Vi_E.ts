import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { BasicAttackHit } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Vi_E = InstanceType<ReturnType<typeof makeVi_E>>;
type Vi_E_Cone = InstanceType<ReturnType<typeof makeVi_E_Cone>>;



export const E_CHARGES = 2;

export const E_WINDOW_MS = 5_000;

export const E_LENGTH = 300;

export const E_WIDTH = 180;

/** The wedge is a wedge: narrow at the fist, `E_WIDTH` at the far end. */
export const E_NEAR_WIDTH = 50;

export const E_DAMAGE = 20;


const BRASS: [number, number, number] = [225, 177, 44];

const HEXTECH: [number, number, number] = [0, 168, 255];


/** Half the cleave's width `along` units out from Vi. The drawing uses the same call. */
export function viECleaveHalfWidth(along: number): number {
  const t = along <= 0 ? 0 : along >= E_LENGTH ? 1 : along / E_LENGTH;
  return (E_NEAR_WIDTH + (E_WIDTH - E_NEAR_WIDTH) * t) / 2;
}


/**
 * Arms the next basic attack so it punches through the target.
 *
 * The swing itself is left entirely alone — it lands through the engine's own
 * path and this only listens for the event that says it did, then adds the cone.
 * A spell that applied the attack's damage itself would look identical and
 * silently switch off every on-hit effect for that route.
 */
function __buildVi_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const EventType = api.enums.EventType;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Spell = api.Spell;
  const Vi_E_Cone = makeVi_E_Cone(api);
  class Vi_E extends Spell {
    targetingMode = 'SELF' as const;
    image = api.asset('spell_vi_e');
    name = 'Cú Đấm Xuyên Thấu (Vi_E)';
    description = `Đòn đánh thường kế tiếp xuyên qua mục tiêu thành một hình nêm dài
      ${E_LENGTH} đơn vị, gây <span class="damage">${E_DAMAGE} sát thương</span> cho mọi
      kẻ địch phía sau. Tích được ${E_CHARGES} lần dùng.`;
    coolDown = 9_000;
    manaCost = 25;
    range = E_LENGTH;

    private chargesLeft = E_CHARGES;
    private rechargeMs = 0;
    private armedMs = 0;
    private armed = false;
    private unsubscribe: (() => void) | null = null;

    /** Badges the HUD icon with the charges left. */
    get stackCount(): number {
      return this.chargesLeft;
    }

    get isArmed(): boolean {
      return this.armed;
    }

    checkCastCondition(): boolean {
      return this.chargesLeft > 0;
    }

    onSpellCast(): void {
      if (this.chargesLeft <= 0) return;
      this.chargesLeft -= 1;
      // The recharge clock starts the moment she drops below full, and keeps its
      // own time from there: spending the second charge must not push the first
      // one further away.
      if (this.chargesLeft === E_CHARGES - 1) this.rechargeMs = 0;

      const nearbyTarget = this.findClosestEnemyInReach();
      if (nearbyTarget) {
        this.cleave(nearbyTarget);
      } else {
        this.arm();
      }
      if (this.chargesLeft > 0) this.resetCoolDown();
    }

    private findClosestEnemyInReach(): AttackableUnit | null {
      const reach = effectiveRange(180, this.owner);
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: reach,
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      let nearest: AttackableUnit | null = null;
      let minDistance = Infinity;
      for (const candidate of candidates) {
        if (candidate === this.owner || candidate.isDead || candidate.toRemove) continue;
        const d = Math.hypot(
          candidate.position.x - this.owner.position.x,
          candidate.position.y - this.owner.position.y
        );
        if (d < minDistance) {
          minDistance = d;
          nearest = candidate;
        }
      }
      return nearest;
    }

    onUpdate(): void {
      this.tickWindow();
      this.tickRecharge();
    }

    private tickWindow(): void {
      if (!this.armed) return;
      this.armedMs += deltaTime;
      if (this.armedMs >= E_WINDOW_MS) this.disarm();
    }

    private tickRecharge(): void {
      if (this.chargesLeft >= E_CHARGES) {
        this.rechargeMs = 0;
        return;
      }
      this.rechargeMs += deltaTime;
      if (this.rechargeMs < this.reducedCooldown(this.coolDown)) return;
      this.rechargeMs = 0;
      this.chargesLeft += 1;
      this.resetCoolDown();
    }

    private arm(): void {
      this.armed = true;
      this.armedMs = 0;
      if (this.unsubscribe) return;
      this.unsubscribe = this.game.eventManager.on(EventType.ON_ATTACK_HIT, (hit: BasicAttackHit) =>
        this.onAttackLanded(hit)
      );
    }

    private disarm(): void {
      this.armed = false;
      this.armedMs = 0;
      this.unsubscribe?.();
      this.unsubscribe = null;
    }

    onAttackLanded(hit: BasicAttackHit): void {
      if (!this.armed || !hit || hit.attacker !== this.owner) return;
      const victim = hit.victim;
      if (!victim) return;
      this.disarm();
      this.cleave(victim);
    }

    /** Body heading, then a fixed vector. The convention, spelled out. */
    private ownHeading(): { x: number; y: number } {
      const dx = (this.owner.destination?.x ?? 0) - this.owner.position.x;
      const dy = (this.owner.destination?.y ?? 0) - this.owner.position.y;
      const span = Math.hypot(dx, dy);
      if (span > 0.01) return { x: dx / span, y: dy / span };
      return { x: 1, y: 0 };
    }

    private cleave(victim: AttackableUnit): void {
      const origin = this.owner.position;
      const dx = victim.position.x - origin.x;
      const dy = victim.position.y - origin.y;
      const span = Math.hypot(dx, dy);
      // Never (0,0): a victim standing exactly on her takes the caster's heading,
      // then a fixed vector, the same rule the engine states for every direction.
      const along = span > 0.01 ? { x: dx / span, y: dy / span } : this.ownHeading();

      const struck = new Set<AttackableUnit>();
      const found = this.game.objectManager.queryObjects({
        area: new Circle({
          x: origin.x,
          y: origin.y,
          r: effectiveRange(E_LENGTH, this.owner),
        }),
        filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
      }) as AttackableUnit[];

      // A plain loop: Array.prototype.filter cannot narrow here.
      for (const candidate of found) {
        if (candidate === this.owner || candidate === victim) continue;
        if (struck.has(candidate)) continue;
        const offX = candidate.position.x - origin.x;
        const offY = candidate.position.y - origin.y;
        const forward = offX * along.x + offY * along.y;
        const lateral = Math.abs(-offX * along.y + offY * along.x);
        const body = candidate.collisionRadius ?? 0;
        if (forward < -body || forward > E_LENGTH + body) continue;
        if (lateral > viECleaveHalfWidth(forward) + body) continue;
        struck.add(candidate);
        candidate.takeDamage(E_DAMAGE, this.owner);
      }

      this.game.objectManager.addObject(
        new Vi_E_Cone(this.owner, origin.copy(), Math.atan2(along.y, along.x))
      );
    }

    /** One vent flaring on the gauntlet, dimming as the window runs out. */
    drawVfx(): void {
      super.drawVfx();
      if (!this.armed) return;
      const left = 1 - constrain(this.armedMs / E_WINDOW_MS, 0, 1);
      const half = this.owner.animatedValues.displaySize / 2 || 27.5;

      push();
      translate(this.owner.position.x, this.owner.position.y - half * 0.2);
      noStroke();
      fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 70 + 130 * left);
      circle(half * 0.75, 0, 8 + 6 * left);
      stroke(255, 255, 255, 120 + 110 * left);
      strokeWeight(2);
      line(half * 0.75, -5 - 4 * left, half * 0.75, 5 + 4 * left);
      pop();
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    deactivate(): void {
      super.deactivate();
      this.disarm();
    }

    onRemoved(): void {
      super.onRemoved();
      this.disarm();
    }
  }
  return Vi_E;
}
const __cacheVi_E = new WeakMap<ContentApi, ReturnType<typeof __buildVi_E>>();
export default function makeVi_E(api: ContentApi) {
  const cached = __cacheVi_E.get(api);
  if (cached) return cached;
  const built = __buildVi_E(api);
  __cacheVi_E.set(api, built);
  return built;
}


/**
 * The cleave itself, 300 long and 180 across at the far end, punched through the
 * victim and away from Vi. The apex sits on her but the art reaches 300 units
 * out, so this is a SpellObject with a real box rather than caster VFX.
 */
function __buildVi_E_Cone(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  const GROUND_Z_INDEX = api.layers.GROUND_Z_INDEX;
  class Vi_E_Cone extends SpellObject {
    // Ground art: an un-overridden SpellObject subclass resolves to
    // SPELL_EFFECT_Z_INDEX and would cover the feet of everyone standing in the wedge.
    zIndex = GROUND_Z_INDEX;
    lifeTime = 320;
    age = 0;
    radius = E_LENGTH;
    heading: number;
    private splits: { at: number; spread: number; length: number }[] = [];

    constructor(owner: AttackableUnit, apex: p5.Vector, heading: number) {
      super(owner);
      this.position = apex;
      this.heading = heading;
    }

    onAdded(): void {
      for (let i = 0; i < 8; i++) {
        this.splits.push({
          at: random(0.15, 0.9),
          spread: random(-0.9, 0.9),
          length: random(0.2, 0.5),
        });
      }
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const punched = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      const reach = E_LENGTH * punched;
      const nearHalf = E_NEAR_WIDTH / 2;
      const farHalf = viECleaveHalfWidth(reach);

      push();
      translate(this.position.x, this.position.y);
      rotate(this.heading);

      noStroke();
      fill(HEXTECH[0], HEXTECH[1], HEXTECH[2], 120 * fade);
      quad(0, -nearHalf, reach, -farHalf, reach, farHalf, 0, nearHalf);

      // The rim states the real reach of the damage.
      noFill();
      stroke(BRASS[0], BRASS[1], BRASS[2], 235 * fade);
      strokeWeight(3);
      line(reach, -farHalf, reach, farHalf);
      stroke(BRASS[0], BRASS[1], BRASS[2], 170 * fade);
      strokeWeight(2);
      line(0, -nearHalf, reach, -farHalf);
      line(0, nearHalf, reach, farHalf);

      // Fractures fanning along the axis, straight lines only.
      stroke(255, 255, 255, 200 * fade * fade);
      strokeWeight(2);
      for (const split of this.splits) {
        const base = E_LENGTH * split.at * punched;
        const side = viECleaveHalfWidth(base) * split.spread;
        line(base, side, base + E_LENGTH * split.length * punched, side * 1.6);
      }
      pop();
    }

    getDisplayBoundingBox() {
      // The apex is our centre and the art reaches a full E_LENGTH from it, so a
      // square of that half-extent covers the cone whichever way it points.
      return this.squareDisplayBoundingBox((this.radius + 40) * 2);
    }
  }
  return Vi_E_Cone;
}
const __cacheVi_E_Cone = new WeakMap<ContentApi, ReturnType<typeof __buildVi_E_Cone>>();
export function makeVi_E_Cone(api: ContentApi) {
  const cached = __cacheVi_E_Cone.get(api);
  if (cached) return cached;
  const built = __buildVi_E_Cone(api);
  __cacheVi_E_Cone.set(api, built);
  return built;
}