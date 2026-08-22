import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec, TargetingRequest } from '@moba2d/core/content/types';
import { makeGrantRejuvenation } from './Soraka_Q';
import { hasRejuvenation } from './Soraka_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TargetResolver = InstanceType<ContentApi['combat']['TargetResolver']>;
type Soraka_W = InstanceType<ReturnType<typeof makeSoraka_W>>;
type Soraka_W_Beam = InstanceType<ReturnType<typeof makeSoraka_W_Beam>>;



/**
 * Astral Infusion. Soraka pays her own health to heal an ally — the one spell
 * in the game whose cost is the caster's life, so it is billed through the base
 * class's `healthCost` (which URF's mana rule deliberately does not touch) and
 * refused outright below a floor, exactly as the real ability is.
 *
 * `targetTeam: 'ALLY'` resolves Soraka or another champion on her Blue/Red
 * side; the checks below enforce team, visibility and range.
 */
export const COOLDOWN_MS = 4_000;

export const MANA_COST = 15;

export const RANGE = 450;

export const HEAL = 28;

/** Paid in Soraka's own health. Against a ~100 pool this is a real decision. */
export const HEALTH_COST = 12;

/** With star dust on her, the same cast costs a third as much. */
export const REJUVENATED_HEALTH_COST = 4;

/** Below this fraction of her maximum health the cast is refused, not fatal. */
export const MIN_HEALTH_RATIO = 0.05;


function __buildSoraka_W(api: ContentApi) {
  const effectiveRange = api.combat.Reach.effectiveRange;
  const withinRange = api.combat.Reach.withinRange;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const TargetResolver = api.combat.TargetResolver;
  const canSee = api.combat.Vision.canSee;
  const grantRejuvenation = makeGrantRejuvenation(api);
  const isInfusionTarget = makeIsInfusionTarget(api);
  const Soraka_W_Beam = makeSoraka_W_Beam(api);
  class Soraka_W extends Spell {
    image = api.asset('spell_soraka_w');
    name = 'Tinh Tú Hộ Mệnh (Soraka_W)';
    description = `Hồi <span class="damage">${HEAL} máu</span> cho một đồng minh, trả bằng <span class="damage">${HEALTH_COST} máu</span> của chính Soraka (chỉ còn <span class="damage">${REJUVENATED_HEALTH_COST}</span> khi cô đang có bụi sao từ Vẫn Tinh, và khi đó đồng minh cũng nhận được bụi sao). Không thể dùng khi Soraka còn dưới <span class="buff">${Math.round(MIN_HEALTH_RATIO * 100)}% máu tối đa</span>.`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;
    healthCost = HEALTH_COST;

    range = RANGE;
    healAmount = HEAL;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'UNIT',
        resource: { commitAt: 'release', refundOn: ['TARGET_INVALID', 'OUT_OF_RANGE'] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    get targetingRequest(): Readonly<TargetingRequest> {
      return {
        range: this.range,
        targetTeam: 'ALLY',
        queryCandidates: () => this.game.objectManager.objects,
        isTargetable: candidate => isInfusionTarget(candidate),
        getTargetInfo: candidate =>
          isInfusionTarget(candidate)
            ? {
                position: candidate.position,
                teamId: candidate.teamId,
                selectionRadius: candidate.animatedValues?.displaySize
                  ? candidate.animatedValues.displaySize / 2
                  : candidate.collisionRadius,
              }
            : null,
      };
    }

    /**
     * The health price is decided the instant the key goes down, before the base
     * class bills for it. It cannot be a getter: `Spell` declares `healthCost` as
     * a class field, and native field semantics *define* an own property on the
     * instance, which would shadow any accessor a subclass put on the prototype.
     */
    press(context: CastContext): boolean {
      this.healthCost = hasRejuvenation(this.owner) ? REJUVENATED_HEALTH_COST : HEALTH_COST;
      if (context.target !== undefined) return super.press(context);

      const result = TargetResolver.resolve('UNIT', {
        ...context,
        casterTeamId: this.owner.teamId,
        ...this.targetingRequest,
      });
      return result.ok ? super.press(result.context) : false;
    }

    checkCastCondition(): boolean {
      return this.hasHealthToSpare && this.isValidTarget(this.castContext?.target);
    }

    onUpdate(): void {
      if (this.state === 'CASTING' && !this.isValidTarget(this.castContext?.target)) {
        this.cancel('TARGET_INVALID');
      }
    }

    onSpellCast(context: CastContext): void {
      const target = context.target;
      if (!isInfusionTarget(target)) return;

      target.takeHeal(this.healAmount, this.owner);

      // While the dust is on her it passes down the beam too — the real ability's
      // reason to weave Q before every W.
      if (hasRejuvenation(this.owner) && target !== this.owner) {
        grantRejuvenation(this.owner, target);
      }

      const beam = new Soraka_W_Beam(this.owner, target);
      this.game.objectManager.addObject(beam);
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }

    /** Astral Infusion never kills its own caster; it simply refuses to fire. */
    private get hasHealthToSpare(): boolean {
      const max = this.owner.stats.maxHealth.value;
      if (max <= 0) return false;
      return this.owner.stats.health.value > max * MIN_HEALTH_RATIO + this.healthCost;
    }

    private isValidTarget(target: unknown): target is AttackableUnit {
      return (
        isInfusionTarget(target) &&
        canSee(this.owner, target) &&
        target.teamId === this.owner.teamId &&
        withinRange(this.range, this.owner, target)
      );
    }
  }
  return Soraka_W;
}
const __cacheSoraka_W = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_W>>();
export default function makeSoraka_W(api: ContentApi) {
  const cached = __cacheSoraka_W.get(api);
  if (cached) return cached;
  const built = __buildSoraka_W(api);
  __cacheSoraka_W.set(api, built);
  return built;
}


function __buildisInfusionTarget(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const isInfusionTarget = (target: unknown): target is AttackableUnit =>
    target instanceof AttackableUnit && target.targetable && !target.toRemove && !target.isDead;
  return isInfusionTarget;
}
const __cacheisInfusionTarget = new WeakMap<ContentApi, ReturnType<typeof __buildisInfusionTarget>>();
export function makeIsInfusionTarget(api: ContentApi) {
  const cached = __cacheisInfusionTarget.get(api);
  if (cached) return cached;
  const built = __buildisInfusionTarget(api);
  __cacheisInfusionTarget.set(api, built);
  return built;
}


/** The ribbon of stars poured from Soraka into the ally. */
function __buildSoraka_W_Beam(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AttackableUnit = api.units.AttackableUnit;
  class Soraka_W_Beam extends SpellObject {
    target: AttackableUnit;
    age = 0;
    lifeTime = 500;

    /** Where each star sits along the ribbon, so the flow does not re-roll a frame. */
    _offsets: number[] = [];

    constructor(owner: AttackableUnit, target: AttackableUnit) {
      super(owner);
      this.target = target;
      this.position = owner.position.copy();
    }

    onAdded() {
      for (let i = 0; i < 9; i++) this._offsets.push(random(0, 1));
    }

    update() {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
      this.position.set(this.owner.position.x, this.owner.position.y);
    }

    draw() {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const alpha = 255 * (1 - t * t);
      const ax = this.owner.position.x;
      const ay = this.owner.position.y;
      const bx = this.target.position.x;
      const by = this.target.position.y;
      const dx = bx - ax;
      const dy = by - ay;
      // perpendicular, so the ribbon bows instead of being a straight laser
      const nx = -dy;
      const ny = dx;
      const bow = 0.11 * sin(t * PI);

      push();
      noFill();
      stroke(60, 45, 110, alpha * 0.6);
      strokeWeight(9);
      this._ribbon(ax, ay, bx, by, nx, ny, bow);
      stroke(215, 230, 255, alpha);
      strokeWeight(3);
      this._ribbon(ax, ay, bx, by, nx, ny, bow);

      // stars travelling down the ribbon toward the ally
      noStroke();
      for (const offset of this._offsets) {
        const u = (offset + t * 1.4) % 1;
        const curve = 4 * u * (1 - u);
        const x = ax + dx * u + nx * bow * curve;
        const y = ay + dy * u + ny * bow * curve;
        fill(255, 250, 220, alpha * 0.9);
        circle(x, y, 9 - u * 3);
        fill(170, 205, 255, alpha * 0.5);
        circle(x, y, 18 - u * 6);
      }

      // the ally lights up as the gift arrives
      const arrival = constrain((t - 0.35) / 0.65, 0, 1);
      if (arrival > 0) {
        const size = (this.target.animatedValues?.displaySize ?? 40) + 26 * arrival;
        noFill();
        stroke(200, 255, 220, alpha * (1 - arrival));
        strokeWeight(3);
        circle(bx, by, size);
      }
      pop();
    }

    _ribbon(ax: number, ay: number, bx: number, by: number, nx: number, ny: number, bow: number) {
      beginShape();
      for (let i = 0; i <= 10; i++) {
        const u = i / 10;
        const curve = 4 * u * (1 - u);
        vertex(ax + (bx - ax) * u + nx * bow * curve, ay + (by - ay) * u + ny * bow * curve);
      }
      endShape();
    }

    /** Drawn from Soraka all the way to the ally, so the box has to hold both. */
    getDisplayBoundingBox() {
      const ax = this.owner.position.x;
      const ay = this.owner.position.y;
      const bx = this.target.position.x;
      const by = this.target.position.y;
      const pad = 60;
      const x = Math.min(ax, bx) - pad;
      const y = Math.min(ay, by) - pad;
      return new Rectangle({
        x,
        y,
        w: Math.abs(bx - ax) + pad * 2,
        h: Math.abs(by - ay) + pad * 2,
        data: this,
      });
    }
  }
  return Soraka_W_Beam;
}
const __cacheSoraka_W_Beam = new WeakMap<ContentApi, ReturnType<typeof __buildSoraka_W_Beam>>();
export function makeSoraka_W_Beam(api: ContentApi) {
  const cached = __cacheSoraka_W_Beam.get(api);
  if (cached) return cached;
  const built = __buildSoraka_W_Beam(api);
  __cacheSoraka_W_Beam.set(api, built);
  return built;
}