import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CastContext, CastSpec } from '@moba2d/core/content/types';
import { makeKatarina_Blade_Impact, makeKatarina_Dagger } from './Katarina_Q';
import { KATARINA_BLOOD, KATARINA_STEEL, KATARINA_DAGGER_SLASH_DAMAGE } from './Katarina_Q';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Katarina_E = InstanceType<ReturnType<typeof makeKatarina_E>>;
type Katarina_E_Afterimage = InstanceType<ReturnType<typeof makeKatarina_E_Afterimage>>;
type Katarina_E_Arrival = InstanceType<ReturnType<typeof makeKatarina_E_Arrival>>;
type Katarina_Blade_Impact = InstanceType<ReturnType<typeof makeKatarina_Blade_Impact>>;
type Katarina_Dagger = InstanceType<ReturnType<typeof makeKatarina_Dagger>>;



export const KATARINA_E_RANGE = 420;

export const KATARINA_E_STRIKE_DAMAGE = 14;

export const KATARINA_E_STRIKE_RADIUS = 130;

export const KATARINA_E_DAGGER_DAMAGE = KATARINA_DAGGER_SLASH_DAMAGE;

export const KATARINA_E_Q_REFUND_MS = 1_500;


function __buildKatarina_E(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const AttackableUnit = api.units.AttackableUnit;
  const Spell = api.Spell;
  const Katarina_Blade_Impact = makeKatarina_Blade_Impact(api);
  const Katarina_Dagger = makeKatarina_Dagger(api);
  const Katarina_E_Afterimage = makeKatarina_E_Afterimage(api);
  const Katarina_E_Arrival = makeKatarina_E_Arrival(api);
  class Katarina_E extends Spell {
    image = api.asset('spell_katarina_e');
    name = 'Ám Sát (Katarina_E)';
    description = `Dịch chuyển tức thời tới một <b>kẻ địch, đồng minh</b> hoặc <b>con dao</b>.
      Nếu tới kẻ địch, gây <span class="damage">${KATARINA_E_STRIKE_DAMAGE} sát thương</span>.
      Nếu tới con dao, kích hoạt <b>xoay kiếm diện rộng</b> gây
      <span class="damage">${KATARINA_DAGGER_SLASH_DAMAGE} sát thương</span> và hồi lại phần lớn thời gian hồi chiêu Ám Sát.`;
    coolDown = 10_000;
    manaCost = 0;
    range = KATARINA_E_RANGE;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'POINT',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    checkCastCondition(): boolean {
      return !this.owner.grounded;
    }

    onSpellCast(context: CastContext): void {
      const reach = effectiveRange(this.range, this.owner);
      const aim = context?.cursorWorld ?? this.aimPoint;
      const origin = createVector(this.owner.position.x, this.owner.position.y);

      // 1. Check if aim is near an active/landing Dagger
      const dagger = Katarina_Dagger.snapTarget(this.owner, aim.x, aim.y);

      // 2. Check if aim is near an AttackableUnit (enemy, ally, monster, minion)
      const unitCandidates = this.game.objectManager.queryObjects({
        area: new Circle({ x: aim.x, y: aim.y, r: 90 }),
        filters: [
          PredefinedFilters.type(AttackableUnit),
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];

      let targetUnit: AttackableUnit | null = null;
      let closestDist = Infinity;
      for (const u of unitCandidates) {
        if (u === this.owner || u.isDead || u.toRemove || !(u instanceof AttackableUnit)) continue;
        const d = Math.hypot(u.position.x - aim.x, u.position.y - aim.y);
        if (d < closestDist) {
          closestDist = d;
          targetUnit = u;
        }
      }

      let arrivalX = aim.x;
      let arrivalY = aim.y;
      let snappedDagger: Katarina_Dagger | null = null;

      if (dagger) {
        arrivalX = dagger.position.x;
        arrivalY = dagger.position.y;
        snappedDagger = dagger;
      } else if (targetUnit) {
        arrivalX = targetUnit.position.x;
        arrivalY = targetUnit.position.y;
      } else {
        const span = Math.hypot(aim.x - origin.x, aim.y - origin.y);
        if (span < 1) {
          const heading = this.firingDirection(context);
          const length = Math.hypot(heading.x, heading.y) || 1;
          arrivalX = origin.x + (heading.x / length) * reach;
          arrivalY = origin.y + (heading.y / length) * reach;
        } else if (span > reach) {
          arrivalX = origin.x + ((aim.x - origin.x) / span) * reach;
          arrivalY = origin.y + ((aim.y - origin.y) / span) * reach;
        }
      }

      // Clamp distance to max reach
      const finalSpan = Math.hypot(arrivalX - origin.x, arrivalY - origin.y);
      if (finalSpan > reach) {
        arrivalX = origin.x + ((arrivalX - origin.x) / finalSpan) * reach;
        arrivalY = origin.y + ((arrivalY - origin.y) / finalSpan) * reach;
      }

      if (!this.blinkOwnerTo(arrivalX, arrivalY)) return;

      // Afterimage & Arrival effects
      this.game.objectManager.addObject(
        new Katarina_E_Afterimage(this.owner, origin.x, origin.y, arrivalX, arrivalY)
      );
      this.game.objectManager.addObject(new Katarina_E_Arrival(this.owner, arrivalX, arrivalY));

      // If destination is near a dagger (or snapped dagger), consume & slash
      const daggerAtArrival =
        snappedDagger ?? Katarina_Dagger.snapTarget(this.owner, arrivalX, arrivalY);
      if (daggerAtArrival) {
        daggerAtArrival.consumeAndSlash();
      }

      // Single target strike if an enemy was targeted / is at arrival
      this.strike(arrivalX, arrivalY, targetUnit);
    }

    private strike(x: number, y: number, explicitTarget: AttackableUnit | null): void {
      let chosen: AttackableUnit | null =
        explicitTarget instanceof AttackableUnit ? explicitTarget : null;
      if (!chosen || chosen.teamId === this.owner.teamId || chosen.isDead || chosen.toRemove) {
        const candidates = this.game.objectManager.queryObjects({
          area: new Circle({ x, y, r: effectiveRange(KATARINA_E_STRIKE_RADIUS, this.owner) }),
          filters: [
            PredefinedFilters.type(AttackableUnit),
            PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
            PredefinedFilters.visibleTo(this.owner),
          ],
        }) as AttackableUnit[];

        let nearestDistance = Infinity;
        chosen = null;
        for (const candidate of candidates) {
          if (!(candidate instanceof AttackableUnit)) continue;
          const gap = Math.hypot(candidate.position.x - x, candidate.position.y - y);
          if (gap < nearestDistance) {
            nearestDistance = gap;
            chosen = candidate;
          }
        }
      }

      if (
        chosen &&
        chosen instanceof AttackableUnit &&
        typeof chosen.takeDamage === 'function' &&
        chosen.teamId !== this.owner.teamId
      ) {
        chosen.takeDamage(KATARINA_E_STRIKE_DAMAGE, this.owner);
        this.game.objectManager.addObject(
          new Katarina_Blade_Impact(this.owner, chosen.position.x, chosen.position.y, 42)
        );
      }
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Katarina_E;
}
const __cacheKatarina_E = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_E>>();
export default function makeKatarina_E(api: ContentApi) {
  const cached = __cacheKatarina_E.get(api);
  if (cached) return cached;
  const built = __buildKatarina_E(api);
  __cacheKatarina_E.set(api, built);
  return built;
}


/** The red silhouette left behind, stretched along the teleport trajectory. */
function __buildKatarina_E_Afterimage(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Katarina_E_Afterimage extends SpellObject {
    lifeTime = 320;
    age = 0;
    toX: number;
    toY: number;

    constructor(owner: AttackableUnit, x: number, y: number, toX: number, toY: number) {
      super(owner);
      this.position = createVector(x, y);
      this.toX = toX;
      this.toY = toY;
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      const dx = this.toX - this.position.x;
      const dy = this.toY - this.position.y;
      const length = Math.hypot(dx, dy) || 1;
      const stretch = 26 + 22 * t;

      push();
      noStroke();
      fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 160 * fade);
      ellipse(this.position.x, this.position.y, 30 * fade + 8, stretch * fade + 8);
      stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 140 * fade);
      strokeWeight(3 * fade + 1);
      const drawn = Math.min(length, 120) * (1 - t * 0.4);
      line(
        this.position.x,
        this.position.y,
        this.position.x + (dx / length) * drawn,
        this.position.y + (dy / length) * drawn
      );
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox((120 + 30) * 2);
    }
  }
  return Katarina_E_Afterimage;
}
const __cacheKatarina_E_Afterimage = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_E_Afterimage>>();
export function makeKatarina_E_Afterimage(api: ContentApi) {
  const cached = __cacheKatarina_E_Afterimage.get(api);
  if (cached) return cached;
  const built = __buildKatarina_E_Afterimage(api);
  __cacheKatarina_E_Afterimage.set(api, built);
  return built;
}


/**
 * Arrival flash. Steel blades collapse inward onto Katarina.
 */
function __buildKatarina_E_Arrival(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const SpellObject = api.SpellObject;
  class Katarina_E_Arrival extends SpellObject {
    lifeTime = 320;
    age = 0;
    blades: number[] = [];

    constructor(owner: AttackableUnit, x: number, y: number) {
      super(owner);
      this.position = createVector(x, y);
      for (let i = 0; i < 8; i++) this.blades.push(random(0, TWO_PI));
    }

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const closing = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;

      push();
      stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 230 * fade);
      strokeWeight(2.5);
      noFill();
      for (const angle of this.blades) {
        const outer = 70 * (1 - closing) + 16;
        const inner = outer - 18;
        line(
          this.position.x + cos(angle) * outer,
          this.position.y + sin(angle) * outer,
          this.position.x + cos(angle) * inner,
          this.position.y + sin(angle) * inner
        );
      }
      pop();
    }

    getDisplayBoundingBox() {
      return this.squareDisplayBoundingBox(120);
    }
  }
  return Katarina_E_Arrival;
}
const __cacheKatarina_E_Arrival = new WeakMap<ContentApi, ReturnType<typeof __buildKatarina_E_Arrival>>();
export function makeKatarina_E_Arrival(api: ContentApi) {
  const cached = __cacheKatarina_E_Arrival.get(api);
  if (cached) return cached;
  const built = __buildKatarina_E_Arrival(api);
  __cacheKatarina_E_Arrival.set(api, built);
  return built;
}