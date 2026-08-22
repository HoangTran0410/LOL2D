import type { ContentApi } from '@moba2d/core/content/ContentApi';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Untargetable = InstanceType<ContentApi['buffs']['Untargetable']>;
type MasterYi_Q = InstanceType<ReturnType<typeof makeMasterYi_Q>>;
type MasterYi_Q_Object = InstanceType<ReturnType<typeof makeMasterYi_Q_Object>>;



// Exported so the suite asserts the flurry's wiring rather than a copy of the
// numbers — retuning a value must not mean editing a test.
export const SEARCH_RADIUS = 420;

/** Distinct bodies one cast may visit. Each is struck at most once. */
export const MAX_STRIKES = 6;

export const FIRST_STRIKE_DAMAGE = 22;

/** Every body after the first: the flurry spreads, it does not focus. */
export const EXTRA_STRIKE_DAMAGE = 15;

/** How long he is simply gone before the first blade lands. */
export const VANISH_MS = 100;

export const STRIKE_INTERVAL_MS = 150;

/** How far past the last victim he ends up, so he is never inside a body. */
export const REAPPEAR_OFFSET = 70;

/** The blade marks outlive the last strike by this much, then the effect ends. */
export const AFTERGLOW_MS = 260;

export const COOLDOWN_MS = 7_000;

export const MANA_COST = 50;


const STEEL: [number, number, number] = [236, 244, 255];

const EDGE: [number, number, number] = [120, 214, 255];

const SHADOW: [number, number, number] = [26, 34, 58];


/**
 * Tuyệt Kỹ Alpha. Yi vanishes and re-enters the fight once per body, striking
 * up to four different enemies and reappearing beside the last of them.
 *
 * "Vanishes" is `Untargetable` — the whole catalogue's answer to a champion who
 * is on the field but cannot be hit — and it lasts exactly as long as the
 * flurry, so the escape window is the ability's real cost to the enemy team.
 * The strikes themselves are driven by `MasterYi_Q_Object`, which owns the
 * clock; the blink stays here because `Spell.blinkOwnerTo` is the one gate that
 * knows about `Ground`.
 */
function __buildMasterYi_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Spell = api.Spell;
  const Untargetable = api.buffs.Untargetable;
  const AttackableUnit = api.units.AttackableUnit;
  const MasterYi_Q_Object = makeMasterYi_Q_Object(api);
  class MasterYi_Q extends Spell {
    // Auto-locks its own targets; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_masteryi_q');
    name = 'Tuyệt Kỹ Alpha (MasterYi_Q)';
    description =
      `Yi biến mất và <span class="buff">không thể bị chọn</span>, lướt qua tối đa` +
      ` <span class="buff">${MAX_STRIKES} kẻ địch</span> trong <span>${SEARCH_RADIUS}px</span>.` +
      ` Mục tiêu đầu nhận <span class="damage">${FIRST_STRIKE_DAMAGE} sát thương</span>,` +
      ` mỗi mục tiêu sau nhận <span class="damage">${EXTRA_STRIKE_DAMAGE} sát thương</span>.` +
      ` Mỗi kẻ địch chỉ trúng một lần, và Yi hiện lại cạnh nạn nhân cuối cùng`;
    coolDown = COOLDOWN_MS;
    manaCost = MANA_COST;

    range = SEARCH_RADIUS;

    /** The flurry currently in the air, so `onUpdate` can drive it. */
    _flurry: MasterYi_Q_Object | null = null;

    checkCastCondition(): boolean {
      return this.pickVictims().length > 0;
    }

    onSpellCast(): void {
      const victims = this.pickVictims();
      if (victims.length === 0) return;

      // A standing move order would drag him out of his own flurry between blinks.
      this.owner.stopMovement?.();

      const flurryMs = VANISH_MS + victims.length * STRIKE_INTERVAL_MS;
      const vanish = new Untargetable(flurryMs, this.owner, this.owner);
      this.owner.addBuff(vanish);

      const flurry = new MasterYi_Q_Object(this.owner);
      flurry.victims = victims;
      flurry.vanish = vanish;
      // The blink lives on the spell: `blinkOwnerTo` is the shared gate that
      // refuses a relocation while the caster is Grounded, and a SpellObject
      // reaching for `teleportTo` itself would walk straight around it.
      flurry.blinkOwner = (x: number, y: number) => this.blinkOwnerTo(x, y);
      this.game.objectManager.addObject(flurry);
      this._flurry = flurry;
    }

    onUpdate(): void {
      if (this._flurry?.toRemove) this._flurry = null;
    }

    /**
     * Who the flurry visits, in order: the enemy nearest the cursor first — the
     * one the player is actually looking at, the same rule Warwick R plays by —
     * and then whatever is nearest the body he just left, never the same body
     * twice.
     */
    pickVictims(): AttackableUnit[] {
      const candidates = this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          // Picking a unit is choosing it, so the fog has a say. See
          // tests/game/spells/target-vision-seam.test.ts.
          PredefinedFilters.visibleTo(this.owner),
        ],
      }) as AttackableUnit[];
      if (candidates.length === 0) return [];

      const chosen: AttackableUnit[] = [];
      let from = this.aimPoint;

      while (chosen.length < MAX_STRIKES) {
        let nearest: AttackableUnit | null = null;
        let nearestDistance = Infinity;
        for (const candidate of candidates) {
          if (chosen.indexOf(candidate) !== -1) continue;
          const distance = candidate.position.dist(from);
          if (distance >= nearestDistance) continue;
          nearestDistance = distance;
          nearest = candidate;
        }
        if (!nearest) break;
        chosen.push(nearest);
        from = nearest.position;
      }

      return chosen;
    }

    drawPreview(): void {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return MasterYi_Q;
}
const __cacheMasterYi_Q = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_Q>>();
export default function makeMasterYi_Q(api: ContentApi) {
  const cached = __cacheMasterYi_Q.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_Q(api);
  __cacheMasterYi_Q.set(api, built);
  return built;
}


/** One landed blade, kept so it can fade instead of blinking out. */
interface BladeMark {
  x: number;
  y: number;
  angle: number;
  age: number;
  /** Rolled once, when the mark is cut, so it does not shimmer as it fades. */
  arc: number;
}


/**
 * The flurry itself: the clock, the damage, and the katana marks left behind.
 *
 * Multi-hit protection is structural rather than a filter — the victim list is
 * built distinct up front and each entry is consumed exactly once — so no body
 * can be visited twice however the fight moves during the 800ms it runs.
 */
function __buildMasterYi_Q_Object(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const Untargetable = api.buffs.Untargetable;
  const AttackableUnit = api.units.AttackableUnit;
  class MasterYi_Q_Object extends SpellObject {
    victims: AttackableUnit[] = [];
    vanish: Untargetable | null = null;
    blinkOwner: ((x: number, y: number) => boolean) | null = null;

    age = 0;
    /** How many of `victims` have already been cut. */
    struck = 0;
    _marks: BladeMark[] = [];
    /** Where he was standing when each blade landed: the afterimage path. */
    _path: { x: number; y: number }[] = [];

    onAdded(): void {
      this._path.push({ x: this.owner.position.x, y: this.owner.position.y });
    }

    update(): void {
      this.age += deltaTime;

      while (
        this.struck < this.victims.length &&
        this.age >= VANISH_MS + this.struck * STRIKE_INTERVAL_MS
      ) {
        this.strike(this.victims[this.struck]);
        this.struck++;
      }

      if (this.struck < this.victims.length) return;

      // Every blade has landed: he is solid again the moment the flurry ends,
      // not when the art finishes fading.
      if (this.vanish && !this.vanish.toRemove) this.vanish.deactivateBuff();
      if (this.age >= VANISH_MS + this.victims.length * STRIKE_INTERVAL_MS + AFTERGLOW_MS) {
        this.toRemove = true;
      }
    }

    /** One body, once. A corpse still costs its slot in the sequence. */
    strike(victim: AttackableUnit): void {
      if (!victim || victim.isDead || victim.toRemove) return;

      const previous = this.owner.position.copy();
      const angle = Math.atan2(victim.position.y - previous.y, victim.position.x - previous.x);

      // He passes *through* them and lands on the far side, which is what makes
      // the flurry read as a pass rather than a series of taps.
      this.blinkOwner?.(
        victim.position.x + Math.cos(angle) * REAPPEAR_OFFSET,
        victim.position.y + Math.sin(angle) * REAPPEAR_OFFSET
      );

      victim.takeDamage(this.struck === 0 ? FIRST_STRIKE_DAMAGE : EXTRA_STRIKE_DAMAGE, this.owner);

      this._marks.push({
        x: victim.position.x,
        y: victim.position.y,
        angle,
        age: 0,
        arc: random(0.7, 1.15),
      });
      this._path.push({ x: this.owner.position.x, y: this.owner.position.y });
    }

    draw(): void {
      for (const mark of this._marks) mark.age += deltaTime;

      push();
      this.drawPath();
      for (const mark of this._marks) this.drawMark(mark);
      pop();
    }

    /** The line he took, drawn as a thinning steel ribbon behind him. */
    drawPath(): void {
      if (this._path.length < 2) return;
      const [sr, sg, sb] = SHADOW;
      const [er, eg, eb] = EDGE;

      for (let i = 1; i < this._path.length; i++) {
        // The oldest leg is the faintest; the newest is the one still moving.
        const freshness = i / (this._path.length - 1);
        const a = this._path[i - 1];
        const b = this._path[i];
        stroke(sr, sg, sb, 90 * freshness);
        strokeWeight(9 * freshness + 2);
        line(a.x, a.y, b.x, b.y);
        stroke(er, eg, eb, 190 * freshness);
        strokeWeight(2.5 * freshness + 0.5);
        line(a.x, a.y, b.x, b.y);
      }
    }

    /** One katana cut: two crossed arcs that snap open and then thin away. */
    drawMark(mark: BladeMark): void {
      const t = constrain(mark.age / AFTERGLOW_MS, 0, 1);
      if (t >= 1) return;
      // Snap-out easing: the cut is fully open almost immediately, then bleeds.
      const open = 1 - (1 - t) * (1 - t);
      const fade = 1 - t;
      const span = 46 + 26 * open;
      const [sr, sg, sb] = STEEL;
      const [er, eg, eb] = EDGE;

      push();
      translate(mark.x, mark.y);
      rotate(mark.angle);
      noFill();

      for (const lean of [-1, 1]) {
        push();
        rotate(lean * mark.arc);
        stroke(er, eg, eb, 150 * fade);
        strokeWeight(7 * fade + 1);
        arc(0, 0, span, span * 0.55, -0.9, 0.9);
        stroke(sr, sg, sb, 240 * fade);
        strokeWeight(2.5 * fade + 0.5);
        arc(0, 0, span, span * 0.55, -0.9, 0.9);
        pop();
      }

      // The flash of the hit itself, gone in the first fifth of the mark's life.
      if (t < 0.2) {
        const flash = 1 - t / 0.2;
        noStroke();
        fill(sr, sg, sb, 200 * flash);
        circle(0, 0, 14 + 26 * (1 - flash));
      }
      pop();
    }

    /**
     * The flurry paints the whole path it took, from where he started to the body
     * he ended on, so the box has to span every leg — not just the last blade.
     */
    getDisplayBoundingBox(): Rectangle {
      let minX = this.owner.position.x;
      let minY = this.owner.position.y;
      let maxX = minX;
      let maxY = minY;
      const points: { x: number; y: number }[] = [...this._path, ...this._marks];
      for (const point of points) {
        if (point.x < minX) minX = point.x;
        if (point.y < minY) minY = point.y;
        if (point.x > maxX) maxX = point.x;
        if (point.y > maxY) maxY = point.y;
      }
      const pad = 90;
      return new Rectangle({
        x: minX - pad,
        y: minY - pad,
        w: maxX - minX + pad * 2,
        h: maxY - minY + pad * 2,
        data: this,
      });
    }
  }
  return MasterYi_Q_Object;
}
const __cacheMasterYi_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildMasterYi_Q_Object>>();
export function makeMasterYi_Q_Object(api: ContentApi) {
  const cached = __cacheMasterYi_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildMasterYi_Q_Object(api);
  __cacheMasterYi_Q_Object.set(api, built);
  return built;
}