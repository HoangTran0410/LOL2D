import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Katarina_Q, {
  KATARINA_BLOOD,
  KATARINA_STEEL,
  Katarina_Blade_Impact,
  Katarina_Dagger,
} from './Katarina_Q';

export const KATARINA_E_RANGE = 380;
export const KATARINA_E_STRIKE_DAMAGE = 14;
export const KATARINA_E_STRIKE_RADIUS = 130;
export const KATARINA_E_DAGGER_DAMAGE = 20;
export const KATARINA_E_DAGGER_RADIUS = 170;
export const KATARINA_E_Q_REFUND_MS = 1_500;

export default class Katarina_E extends Spell {
  image = AssetManager.get('spell_katarina_e');
  name = 'Ám Sát (Katarina_E)';
  description = `Dịch chuyển tới vị trí chỉ định và gây
    <span class="damage">${KATARINA_E_STRIKE_DAMAGE} sát thương</span> cho kẻ địch gần nhất.
    Nếu có dao của cô ở đó, cô nhảy tới <b>con dao</b>, thu lại nó để gây
    <span class="damage">${KATARINA_E_DAGGER_DAMAGE} sát thương</span> trong vùng
    ${KATARINA_E_DAGGER_RADIUS} và giảm ${KATARINA_E_Q_REFUND_MS / 1000} giây hồi chiêu Q.`;
  coolDown = 10_000;
  manaCost = 25;
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
    let requestedX = aim.x;
    let requestedY = aim.y;
    const span = Math.hypot(aim.x - origin.x, aim.y - origin.y);
    if (span < 1) {
      const heading = this.firingDirection(context);
      const length = Math.hypot(heading.x, heading.y) || 1;
      requestedX = origin.x + (heading.x / length) * reach;
      requestedY = origin.y + (heading.y / length) * reach;
    } else if (span > reach) {
      requestedX = origin.x + ((aim.x - origin.x) / span) * reach;
      requestedY = origin.y + ((aim.y - origin.y) / span) * reach;
    }

    // A dagger near the requested point wins the destination outright — that is
    // the whole reason the pickup ring is drawn on the floor.
    const snapped = Katarina_Dagger.snapTarget(this.owner, requestedX, requestedY);
    const arrivalX = snapped ? snapped.position.x : requestedX;
    const arrivalY = snapped ? snapped.position.y : requestedY;
    if (!this.blinkOwnerTo(arrivalX, arrivalY)) return;

    if (snapped) {
      snapped.consume();
      this.detonate(arrivalX, arrivalY);
      this.refundQ();
    }
    this.strike(arrivalX, arrivalY);

    const blink = new Katarina_E_Afterimage(this.owner, origin.x, origin.y, arrivalX, arrivalY);
    this.game.objectManager.addObject(blink);
    const arrival = new Katarina_E_Arrival(this.owner, arrivalX, arrivalY);
    arrival.detonationRadius = snapped ? KATARINA_E_DAGGER_RADIUS : 0;
    this.game.objectManager.addObject(arrival);
  }

  /** An area effect: it must still catch the champion standing in an unlit bush. */
  private detonate(x: number, y: number): void {
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x, y, r: KATARINA_E_DAGGER_RADIUS }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const struck = new Set<AttackableUnit>();
    for (const victim of victims) {
      if (struck.has(victim)) continue;
      struck.add(victim);
      victim.takeDamage(KATARINA_E_DAGGER_DAMAGE, this.owner);
      this.game.objectManager.addObject(
        new Katarina_Blade_Impact(this.owner, victim.position.x, victim.position.y, 30)
      );
    }
  }

  /** One chosen unit, so it goes through the fog the same way the player does. */
  private strike(x: number, y: number): void {
    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({ x, y, r: effectiveRange(KATARINA_E_STRIKE_RADIUS, this.owner) }),
      filters: [
        PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
        PredefinedFilters.visibleTo(this.owner),
      ],
    }) as AttackableUnit[];

    let chosen: AttackableUnit | null = null;
    let nearestDistance = Infinity;
    for (const candidate of candidates) {
      const gap = Math.hypot(candidate.position.x - x, candidate.position.y - y);
      if (gap < nearestDistance) {
        nearestDistance = gap;
        chosen = candidate;
      }
    }
    if (!chosen) return;
    chosen.takeDamage(KATARINA_E_STRIKE_DAMAGE, this.owner);
    this.game.objectManager.addObject(
      new Katarina_Blade_Impact(this.owner, chosen.position.x, chosen.position.y, 40)
    );
  }

  private refundQ(): void {
    const spells = this.owner?.spells as Spell[] | undefined;
    if (!spells) return;
    for (const spell of spells) {
      if (!(spell instanceof Katarina_Q)) continue;
      spell.currentCooldown = Math.max(0, spell.currentCooldown - KATARINA_E_Q_REFUND_MS);
      return;
    }
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/** The red shape she was standing in a moment ago, thinning out as it dies. */
export class Katarina_E_Afterimage extends SpellObject {
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
    // The silhouette left behind, stretched the way she went.
    noStroke();
    fill(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 150 * fade);
    ellipse(this.position.x, this.position.y, 30 * fade + 8, stretch * fade + 8);
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 130 * fade);
    strokeWeight(3 * fade + 1);
    const drawn = Math.min(length, 110) * (1 - t * 0.4);
    line(
      this.position.x,
      this.position.y,
      this.position.x + (dx / length) * drawn,
      this.position.y + (dy / length) * drawn
    );
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((110 + 30) * 2);
  }
}

/**
 * Arrival. Steel collapses *inward* onto her, which is how a reposition reads;
 * the 170 rim is drawn only when a dagger was actually eaten, so the two
 * outcomes of the same button never look alike.
 */
export class Katarina_E_Arrival extends SpellObject {
  lifeTime = 340;
  age = 0;
  detonationRadius = 0;
  /** Seeded once in the constructor. */
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
    // Inward flourish: blades start wide and fall onto her.
    stroke(KATARINA_STEEL[0], KATARINA_STEEL[1], KATARINA_STEEL[2], 220 * fade);
    strokeWeight(2.5);
    noFill();
    for (const angle of this.blades) {
      const outer = 74 * (1 - closing) + 16;
      const inner = outer - 18;
      line(
        this.position.x + cos(angle) * outer,
        this.position.y + sin(angle) * outer,
        this.position.x + cos(angle) * inner,
        this.position.y + sin(angle) * inner
      );
    }

    if (this.detonationRadius > 0) {
      // The hard rim on the radius the detonation really used.
      stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 240 * fade);
      strokeWeight(4 * fade + 1);
      circle(this.position.x, this.position.y, this.detonationRadius * 2 * closing);
      stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 90 * fade);
      strokeWeight(2);
      circle(this.position.x, this.position.y, this.detonationRadius * 1.2 * closing);
    }
    pop();
  }

  getDisplayBoundingBox() {
    const painted = Math.max(this.detonationRadius, 90) + 20;
    return this.squareDisplayBoundingBox(painted * 2);
  }
}
