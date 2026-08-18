import { Circle } from '@/libs/quadtree';
import AssetManager from '@/managers/AssetManager';
import { effectiveRange } from '@/game/combat/Reach';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import Spell from '@/game/gameObject/Spell';
import SpellObject from '@/game/gameObject/SpellObject';
import { MOON_CORE, MOON_NIGHT, MOON_PALE, drawCrescent } from './Diana_Q';

export const R_RADIUS = 330;
export const R_PULL_MS = 750;
export const R_DAMAGE = 42;
/** Where the crowd ends up: adjacent to her, not inside her. */
export const R_GATHER_GAP = 68;
export const R_CRASH_RADIUS = 56;

const R_AFTERGLOW_MS = 340;

/** One body under the pull, with the anchor it was caught at. */
interface DraggedBody {
  unit: AttackableUnit;
  fromX: number;
  fromY: number;
  towardX: number;
  towardY: number;
  keep: number;
}

export default class Diana_R extends Spell {
  targetingMode = 'SELF' as const;
  image = AssetManager.get('spell_diana_r');
  name = 'Trăng Mờ (Diana_R)';
  description = `Mọi kẻ địch trong bán kính ${R_RADIUS} bị kéo về sát Diana trong
    ${R_PULL_MS / 1000} giây, rồi hứng <span class="damage">${R_DAMAGE} sát thương</span> khi
    đã bị dồn lại.`;
  coolDown = 10_000;
  manaCost = 100;
  range = R_RADIUS;

  onSpellCast(): void {
    const caught = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        // A query keeps its own collide test, so only the caster term comes from Reach.
        r: effectiveRange(this.range, this.owner),
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    const gather = new Diana_R_Gather(this.owner);
    gather.attachTo(this.owner);
    for (const victim of caught) gather.capture(victim);
    this.game.objectManager.addObject(gather);
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The gather. Everything about this effect travels inward: the rim closes, the crescents ride
 * from the 330 line down onto her body, and each victim wears a streak pointing at her. The
 * damage is charged at the end of the pull, on the crowd that has already arrived.
 */
export class Diana_R_Gather extends SpellObject {
  age = 0;
  resolved = false;
  readonly dragged: DraggedBody[] = [];
  private readonly struck = new Set<AttackableUnit>();
  private resolvedAt = -1;
  private ribs: { angle: number; lag: number; span: number }[] = [];

  capture(victim: AttackableUnit): void {
    const dx = victim.position.x - this.position.x;
    const dy = victim.position.y - this.position.y;
    const span = Math.hypot(dx, dy);
    this.dragged.push({
      unit: victim,
      fromX: victim.position.x,
      fromY: victim.position.y,
      towardX: span === 0 ? 1 : dx / span,
      towardY: span === 0 ? 0 : dy / span,
      keep: Math.min(span, R_GATHER_GAP),
    });
    victim.stopMovement();
    victim.markDisplaced();
  }

  onAdded(): void {
    for (let i = 0; i < 9; i++) {
      this.ribs.push({
        angle: (i / 9) * TWO_PI + random(-0.18, 0.18),
        lag: random(0, 0.35),
        span: random(0.7, 1.3),
      });
    }
  }

  update(): void {
    if (this.dropIfAttachmentLost()) return;
    this.age += deltaTime;
    this.position.set(this.owner.position.x, this.owner.position.y);

    const t = Math.min(this.age / R_PULL_MS, 1);
    const drawnIn = t * t * (3 - 2 * t);

    for (const body of this.dragged) {
      const victim = body.unit;
      if (victim.toRemove || victim.isDead) continue;
      const goalX = this.position.x + body.towardX * body.keep;
      const goalY = this.position.y + body.towardY * body.keep;
      victim.teleportTo(
        body.fromX + (goalX - body.fromX) * drawnIn,
        body.fromY + (goalY - body.fromY) * drawnIn
      );
    }

    if (!this.resolved && t >= 1) {
      this.resolved = true;
      this.resolvedAt = this.age;
      for (const body of this.dragged) {
        const victim = body.unit;
        if (this.struck.has(victim) || victim.toRemove || victim.isDead) continue;
        this.struck.add(victim);
        victim.takeDamage(R_DAMAGE, this.owner);
        this.game.objectManager.addObject(new Diana_R_Crash(this.owner, victim.position.copy()));
      }
    }

    if (this.resolved && this.age - this.resolvedAt >= R_AFTERGLOW_MS) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / R_PULL_MS, 0, 1);
    const drawnIn = t * t * (3 - 2 * t);
    const glow = this.resolved
      ? constrain(1 - (this.age - this.resolvedAt) / R_AFTERGLOW_MS, 0, 1)
      : 0;

    push();
    noFill();

    // The decision circle: hard and full-size from the first frame, because that rim is the
    // only information an enemy gets. It then closes inward as the pull resolves.
    stroke(MOON_NIGHT[0] + 40, MOON_NIGHT[1] + 50, MOON_NIGHT[2] + 80, 90 * (1 - drawnIn * 0.7));
    strokeWeight(1.2);
    circle(this.position.x, this.position.y, R_RADIUS * 2);

    const rim = R_RADIUS - (R_RADIUS - R_GATHER_GAP - 20) * drawnIn;
    stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 200 + 55 * glow);
    strokeWeight(3.5 + 4 * glow);
    circle(this.position.x, this.position.y, rim * 2);

    // Crescents riding the rim down onto her: the motion has to travel the way the pull does.
    for (const rib of this.ribs) {
      const own = constrain((drawnIn - rib.lag) / Math.max(1 - rib.lag, 0.001), 0, 1);
      const away = R_RADIUS - (R_RADIUS - R_GATHER_GAP * 0.6) * own;
      drawCrescent(
        this.position.x + cos(rib.angle) * away * 0.5,
        this.position.y + sin(rib.angle) * away * 0.5,
        away * 0.5,
        rib.angle,
        rib.span,
        7 * (1 - own) + 1.5,
        MOON_CORE,
        215 * (0.35 + 0.65 * (1 - own))
      );
    }

    // Every victim wears a streak pointing at Diana — the direction they are being taken.
    stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 170 * (1 - glow * 0.5));
    strokeWeight(2.5);
    for (const body of this.dragged) {
      const victim = body.unit;
      if (victim.toRemove || victim.isDead) continue;
      const dx = this.position.x - victim.position.x;
      const dy = this.position.y - victim.position.y;
      const span = Math.hypot(dx, dy);
      if (span < 1) continue;
      const reach = Math.min(span, 40 + 30 * drawnIn);
      line(
        victim.position.x,
        victim.position.y,
        victim.position.x + (dx / span) * reach,
        victim.position.y + (dy / span) * reach
      );
    }

    if (glow > 0) {
      stroke(MOON_CORE[0], MOON_CORE[1], MOON_CORE[2], 230 * glow);
      strokeWeight(2 + 6 * glow);
      circle(this.position.x, this.position.y, (R_GATHER_GAP + 30) * 2 * (1 - 0.4 * glow));
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_RADIUS + 50) * 2);
  }
}

/** The blow, on each gathered body. */
export class Diana_R_Crash extends SpellObject {
  lifeTime = 360;
  age = 0;
  private blades: number[] = [];

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    for (let i = 0; i < 5; i++) this.blades.push((i / 5) * TWO_PI + random(-0.25, 0.25));
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const closing = 1 - (1 - t) * (1 - t);
    push();
    noFill();
    stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 225 * (1 - t));
    strokeWeight(4 * (1 - t) + 1);
    circle(this.position.x, this.position.y, R_CRASH_RADIUS * 2 * (1 - 0.7 * closing));
    for (const blade of this.blades) {
      const away = R_CRASH_RADIUS * (1 - 0.75 * closing);
      drawCrescent(
        this.position.x + cos(blade) * away * 0.4,
        this.position.y + sin(blade) * away * 0.4,
        away * 0.55,
        blade + PI,
        1.4,
        6 * (1 - t) + 1,
        MOON_CORE,
        235 * (1 - t)
      );
    }
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((R_CRASH_RADIUS + 28) * 2);
  }
}
