import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec, CancelReason } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import { KATARINA_BLOOD, KATARINA_STEEL } from './Katarina_Q';

export const KATARINA_R_DURATION_MS = 2_500;
export const KATARINA_R_RADIUS = 320;
export const KATARINA_R_TICK_MS = 300;
export const KATARINA_R_TICK_DAMAGE = 6;
/** Whole ticks the channel has room for — the last partial window pays nothing. */
export const KATARINA_R_TICK_COUNT = Math.floor(KATARINA_R_DURATION_MS / KATARINA_R_TICK_MS);
const VOLLEY_MS = 260;

export default class Katarina_R extends Spell {
  image = AssetManager.get('spell_katarina_r');
  name = 'Bông Sen Tử Thần (Katarina_R)';
  description = `Xoay tròn trong ${KATARINA_R_DURATION_MS / 1000} giây, phóng dao ra mọi hướng:
    <span class="damage">${KATARINA_R_TICK_DAMAGE} sát thương</span> mỗi
    ${KATARINA_R_TICK_MS / 1000} giây cho mọi kẻ địch trong vùng ${KATARINA_R_RADIUS}
    (tối đa <span class="damage">${KATARINA_R_TICK_COUNT * KATARINA_R_TICK_DAMAGE}</span>).
    Bị choáng hoặc di chuyển sẽ ngắt kênh.`;
  coolDown = 10_000;
  manaCost = 100;
  range = KATARINA_R_RADIUS;

  private lotus: Katarina_R_Lotus | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      channel: { durationMs: KATARINA_R_DURATION_MS, tickEveryMs: KATARINA_R_TICK_MS },
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'start', durationMs: this.coolDown },
    };
  }

  onCastStart(_context: CastContext): void {
    if (this.lotus && !this.lotus.toRemove) return;
    // The clock lives on the object, not on the runtime: the blades, the rim and
    // the damage are one animation and must not be able to disagree.
    const lotus = new Katarina_R_Lotus(this.owner, effectiveRange(this.range, this.owner));
    this.lotus = lotus;
    this.game.objectManager.addObject(lotus);
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    this.endChannel();
  }

  onComplete(_context: CastContext): void {
    this.endChannel();
  }

  /** Death, interrupt and natural end all converge here, and it may run twice. */
  private endChannel(): void {
    this.lotus?.finish();
    this.lotus = null;
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

interface LotusVolley {
  elapsed: number;
  blades: { angle: number; reach: number; landed: boolean }[];
}

/**
 * The lotus itself. Each tick throws a volley that lands *on the units it hurt*;
 * a tick that hurt nobody throws a shorter, steel-only fan that stops well
 * inside the rim, so "I am hitting someone" and "I am hitting air" never look
 * the same. The rim is drawn at the radius the damage really uses and closes as
 * the channel runs out, which is the cast bar.
 */
export class Katarina_R_Lotus extends SpellObject {
  radius: number;
  lifeTime = KATARINA_R_DURATION_MS;
  age = 0;
  ticksDone = 0;
  volleys: LotusVolley[] = [];
  /** Seeded once: the fan for a tick that finds nobody. */
  spokes: number[] = [];

  constructor(owner: AttackableUnit, radius: number) {
    super(owner);
    this.radius = radius;
    this.position = createVector(owner.position.x, owner.position.y);
    for (let i = 0; i < 9; i++) {
      this.spokes.push((i / 9) * TWO_PI + random(-0.12, 0.12));
    }
  }

  /** Idempotent — the spell calls it on cancel and on complete. */
  finish(): void {
    this.toRemove = true;
  }

  update(): void {
    if (this.owner.isDead || this.owner.toRemove) {
      this.finish();
      return;
    }
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;

    while (
      this.ticksDone < KATARINA_R_TICK_COUNT &&
      this.age >= (this.ticksDone + 1) * KATARINA_R_TICK_MS
    ) {
      this.ticksDone++;
      this.throwVolley();
    }

    const alive: LotusVolley[] = [];
    for (const volley of this.volleys) {
      volley.elapsed += deltaTime;
      if (volley.elapsed < VOLLEY_MS) alive.push(volley);
    }
    this.volleys = alive;

    if (this.age >= this.lifeTime) this.finish();
  }

  private throwVolley(): void {
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({ x: this.position.x, y: this.position.y, r: this.radius }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const blades: { angle: number; reach: number; landed: boolean }[] = [];
    const struck = new Set<AttackableUnit>();
    for (const victim of victims) {
      if (struck.has(victim)) continue;
      struck.add(victim);
      victim.takeDamage(KATARINA_R_TICK_DAMAGE, this.owner);
      const dx = victim.position.x - this.position.x;
      const dy = victim.position.y - this.position.y;
      blades.push({ angle: Math.atan2(dy, dx), reach: Math.hypot(dx, dy), landed: true });
    }

    if (blades.length === 0) {
      for (const angle of this.spokes) {
        blades.push({ angle, reach: this.radius * 0.55, landed: false });
      }
    }
    this.volleys.push({ elapsed: 0, blades });
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const remaining = 1 - t;

    push();
    noFill();
    // The rim is the whole decision the enemy is making, so it is always there.
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 70);
    strokeWeight(2);
    circle(this.position.x, this.position.y, this.radius * 2);
    // ... and the bright part of it is the cast bar closing.
    stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 235);
    strokeWeight(4);
    arc(
      this.position.x,
      this.position.y,
      this.radius * 2,
      this.radius * 2,
      -HALF_PI,
      -HALF_PI + TWO_PI * remaining
    );

    for (const volley of this.volleys) {
      const flight = constrain(volley.elapsed / VOLLEY_MS, 0, 1);
      const flown = 1 - (1 - flight) * (1 - flight);
      const fade = 1 - flight;
      for (const blade of volley.blades) {
        const tipX = this.position.x + cos(blade.angle) * blade.reach * flown;
        const tipY = this.position.y + sin(blade.angle) * blade.reach * flown;
        const tailX = tipX - cos(blade.angle) * 18;
        const tailY = tipY - sin(blade.angle) * 18;
        stroke(
          KATARINA_STEEL[0],
          KATARINA_STEEL[1],
          KATARINA_STEEL[2],
          (blade.landed ? 240 : 130) * fade
        );
        strokeWeight(blade.landed ? 3 : 1.5);
        line(tailX, tailY, tipX, tipY);
        if (blade.landed && flight > 0.6) {
          // The blade arrives on the body it billed, and says so there.
          stroke(KATARINA_BLOOD[0], KATARINA_BLOOD[1], KATARINA_BLOOD[2], 235 * fade);
          strokeWeight(2.5);
          circle(tipX, tipY, 26 * flown);
        }
      }
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((this.radius + 40) * 2);
  }
}
