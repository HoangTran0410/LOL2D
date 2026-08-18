import { Circle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { wrapAngle } from '../../../utils/math.utils';
import { effectiveRange } from '../../combat/Reach';
import { PredefinedFilters } from '../../managers/ObjectManager';
import type { CastContext, CastSpec } from '../../spell/runtime/types';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import Buff from '../Buff';
import Spell from '../Spell';
import SpellObject from '../SpellObject';

export const Q_DAMAGE = 22;
export const Q_RADIUS = 280;
export const Q_ARC_DEG = 180;
export const Q_SWEEP_MS = 550;
/** Radial half-width of the swept corridor: how far off the blade's own reach still gets cut. */
export const Q_BAND = 70;
/** How long a Moonlight mark rides its victim before Diana loses the reset. */
export const MOONLIGHT_MS = 4_000;

const Q_WINDUP_MS = 180;
const Q_FADE_MS = 280;
/** The first slice of the sweep is a windup: the blade gathers at her body before it flies. */
const Q_WIND_FRACTION = 0.18;
/** Angular slack at both ends of the arc, in units of the arc fraction. */
const Q_EDGE_PAD = 0.04;
const Q_ARC_RAD = (Q_ARC_DEG * Math.PI) / 180;
const Q_CUT_RADIUS = 46;

/** Moonlight. Pale silver-blue, cold cyan core, indigo night. Nothing here is warm. */
export const MOON_PALE = [223, 230, 245] as const;
export const MOON_CORE = [116, 185, 255] as const;
export const MOON_NIGHT = [58, 70, 120] as const;

/** Where the blade is, as a fraction of the 180 degrees it will cover. */
function sweptFraction(progress: number): number {
  if (progress <= Q_WIND_FRACTION) return 0;
  return (progress - Q_WIND_FRACTION) / (1 - Q_WIND_FRACTION);
}

/** How far out the blade rides at that fraction: it leaves her body and accelerates outward. */
export function bladeReach(fraction: number): number {
  const k = Math.min(Math.max(fraction, 0), 1);
  return Q_RADIUS * (0.12 + 0.88 * (1 - (1 - k) * (1 - k)));
}

/**
 * Diana's one shape: a thick arc with a sharp outer lip and two tapering tails.
 * Shared by all four spells so the kit reads as one champion.
 */
export function drawCrescent(
  cx: number,
  cy: number,
  radius: number,
  facing: number,
  span: number,
  weight: number,
  tone: readonly number[],
  shade: number
): void {
  const segCount = 14;
  for (let i = 0; i < segCount; i++) {
    const f0 = i / segCount;
    const f1 = (i + 1) / segCount;
    const taper = sin(0.1 * Math.PI + f0 * Math.PI * 0.9);
    stroke(tone[0], tone[1], tone[2], shade * (0.28 + 0.72 * taper));
    strokeWeight(Math.max(0.7, weight * (0.16 + 0.84 * taper)));
    const a0 = facing - span / 2 + span * f0;
    const a1 = facing - span / 2 + span * f1;
    line(
      cx + cos(a0) * radius,
      cy + sin(a0) * radius,
      cx + cos(a1) * radius,
      cy + sin(a1) * radius
    );
  }
}

/**
 * The mark Q leaves behind. A small crescent turning slowly over the victim's head,
 * because Diana_E's cooldown reset reads exactly this buff and the player has to be able
 * to pick the marked target out of a fight without opening the HUD.
 */
export class Moonlight extends Buff {
  name = 'Ánh Trăng';
  description = 'Bị đánh dấu bởi ánh trăng của Diana.';
  image = AssetManager.get('spell_diana_q');

  draw(): void {
    const victim = this.targetUnit;
    if (!victim) return;
    const spent = constrain(this.timeElapsed / Math.max(this.duration, 1), 0, 1);
    const spin = (this.timeElapsed / 1100) * TWO_PI;
    const bob = sin(this.timeElapsed / 260) * 3;
    const lift = 24 + (victim.animatedValues?.displaySize ?? 40) * 0.5;
    const shade = 235 * (1 - spent * 0.4);

    push();
    translate(victim.position.x, victim.position.y - lift + bob);
    rotate(spin);
    noFill();
    drawCrescent(0, 0, 12, 0, Math.PI * 1.1, 5, MOON_PALE, shade);
    drawCrescent(0, 0, 8, 0, Math.PI * 0.8, 2.5, MOON_CORE, shade * 0.8);
    pop();
  }
}

/** The live mark on a unit, or null. A plain loop: filter cannot narrow here. */
export function moonlightOn(unit: AttackableUnit): Moonlight | null {
  const carried = unit.buffs;
  for (let i = 0; i < carried.length; i++) {
    const buff = carried[i];
    if (buff instanceof Moonlight && !buff.toRemove) return buff;
  }
  return null;
}

export default class Diana_Q extends Spell {
  image = AssetManager.get('spell_diana_q');
  name = 'Trăng Lưỡi Liềm (Diana_Q)';
  description = `Lưỡi liềm ánh trăng quét một vòng cung ${Q_ARC_DEG} độ quanh Diana, gây
    <span class="damage">${Q_DAMAGE} sát thương</span> và đánh dấu Ánh Trăng trong
    ${MOONLIGHT_MS / 1000} giây.`;
  coolDown = 8_000;
  manaCost = 30;
  range = Q_RADIUS;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'DIRECTION',
      castTimeMs: Q_WINDUP_MS,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
    };
  }

  onSpellCast(context?: CastContext): void {
    const sweep = new Diana_Q_Sweep(this.owner, this.openingAngle(context));
    this.game.objectManager.addObject(sweep);
  }

  /** Body heading, then a fixed vector — a direction is never allowed to be (0,0). */
  private openingAngle(context?: CastContext): number {
    let aimX = 1;
    let aimY = 0;
    if (context) {
      const aim = this.firingDirection(context);
      aimX = aim.x;
      aimY = aim.y;
    } else {
      const heading = this.owner.direction;
      if (heading && (heading.x !== 0 || heading.y !== 0)) {
        aimX = heading.x;
        aimY = heading.y;
      }
    }
    return Math.atan2(aimY, aimX) - Q_ARC_RAD / 2;
  }

  drawPreview(): void {
    super.drawPreview(effectiveRange(this.range, this.owner));
  }
}

/**
 * The sweep itself. The path *is* the hitbox: a unit is cut when the blade passes its angle
 * at roughly its distance, so nothing behind Diana is ever in the arc. Anchored to the cast
 * position rather than to her body, because a blade that follows her would lie about where
 * it already cut.
 */
export class Diana_Q_Sweep extends SpellObject {
  age = 0;
  readonly startAngle: number;
  private readonly cut = new Set<AttackableUnit>();
  /** Seeded once in onAdded: random() inside draw() flickers instead of animating. */
  private motes: { fraction: number; radial: number; phase: number }[] = [];

  constructor(owner: AttackableUnit, startAngle: number) {
    super(owner);
    this.startAngle = startAngle;
  }

  onAdded(): void {
    for (let i = 0; i < 16; i++) {
      this.motes.push({
        fraction: random(0.05, 1),
        radial: random(-Q_BAND * 0.5, Q_BAND * 0.5),
        phase: random(0, TWO_PI),
      });
    }
  }

  update(): void {
    this.age += deltaTime;
    this.applyCuts(Math.min(this.age / Q_SWEEP_MS, 1));
    if (this.age >= Q_SWEEP_MS + Q_FADE_MS) this.toRemove = true;
  }

  private applyCuts(progress: number): void {
    const swept = sweptFraction(progress);
    if (swept <= 0) return;

    const candidates = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.position.x,
        y: this.position.y,
        r: Q_RADIUS + Q_BAND + 60,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    for (const victim of candidates) {
      if (this.cut.has(victim)) continue;
      const dx = victim.position.x - this.position.x;
      const dy = victim.position.y - this.position.y;
      const away = Math.sqrt(dx * dx + dy * dy);
      const fraction = wrapAngle(Math.atan2(dy, dx) - this.startAngle) / Q_ARC_RAD;
      if (fraction < -Q_EDGE_PAD || fraction > swept + Q_EDGE_PAD) continue;
      if (Math.abs(away - bladeReach(fraction)) > Q_BAND) continue;

      this.cut.add(victim);
      victim.takeDamage(Q_DAMAGE, this.owner);
      victim.addBuff(new Moonlight(MOONLIGHT_MS, this.owner, victim));
      this.game.objectManager.addObject(new Diana_Q_Cut(this.owner, victim.position.copy()));
    }
  }

  draw(): void {
    const progress = Math.min(this.age / Q_SWEEP_MS, 1);
    const swept = sweptFraction(progress);
    const tail =
      this.age <= Q_SWEEP_MS ? 1 : constrain(1 - (this.age - Q_SWEEP_MS) / Q_FADE_MS, 0, 1);
    if (tail <= 0) return;

    push();
    noFill();

    // The corridor already covered, drawn as its two edges: the shape of the ability,
    // legible after the fact instead of only during the frame that cut you.
    const samples = 26;
    for (let i = 1; i < samples; i++) {
      const f0 = ((i - 1) / (samples - 1)) * swept;
      const f1 = (i / (samples - 1)) * swept;
      const behind = swept > 0 ? 1 - f1 / swept : 1;
      const shade = 130 * tail * (1 - behind * 0.8);
      stroke(MOON_NIGHT[0] + 60, MOON_NIGHT[1] + 70, MOON_NIGHT[2] + 90, shade);
      strokeWeight(1 + 1.6 * (1 - behind));
      const a0 = this.startAngle + Q_ARC_RAD * f0;
      const a1 = this.startAngle + Q_ARC_RAD * f1;
      const r0 = bladeReach(f0);
      const r1 = bladeReach(f1);
      for (let edge = -1; edge <= 1; edge += 2) {
        const e0 = r0 + edge * Q_BAND * 0.62;
        const e1 = r1 + edge * Q_BAND * 0.62;
        line(
          this.position.x + cos(a0) * e0,
          this.position.y + sin(a0) * e0,
          this.position.x + cos(a1) * e1,
          this.position.y + sin(a1) * e1
        );
      }
    }

    // Motes shaken loose along the corridor.
    for (const mote of this.motes) {
      if (mote.fraction > swept) continue;
      const angle = this.startAngle + Q_ARC_RAD * mote.fraction;
      const away = bladeReach(mote.fraction) + mote.radial;
      const twinkle = 0.4 + 0.6 * Math.abs(sin(mote.phase + this.age / 130));
      stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 150 * tail * twinkle);
      strokeWeight(2);
      point(this.position.x + cos(angle) * away, this.position.y + sin(angle) * away);
    }

    // The blade, bulging outward, brighter than anything it left behind.
    const lead = this.startAngle + Q_ARC_RAD * swept;
    const reach = bladeReach(swept);
    const bow = 32;
    const bx = this.position.x + cos(lead) * (reach - bow);
    const by = this.position.y + sin(lead) * (reach - bow);
    const rising = progress < Q_WIND_FRACTION ? progress / Q_WIND_FRACTION : 1;
    drawCrescent(bx, by, bow, lead, 1.55, 8 * rising, MOON_PALE, 240 * tail);
    drawCrescent(bx, by, bow - 7, lead, 1.15, 4 * rising, MOON_CORE, 215 * tail);
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Q_RADIUS + Q_BAND + 40) * 2);
  }
}

/** The cut, on the body that took it. */
export class Diana_Q_Cut extends SpellObject {
  lifeTime = 300;
  age = 0;
  private lean = 0;

  constructor(owner: AttackableUnit, at: p5.Vector) {
    super(owner);
    this.position = at;
  }

  onAdded(): void {
    this.lean = random(0, TWO_PI);
  }

  update(): void {
    this.age += deltaTime;
    if (this.age >= this.lifeTime) this.toRemove = true;
  }

  draw(): void {
    const t = constrain(this.age / this.lifeTime, 0, 1);
    const opened = 1 - (1 - t) * (1 - t);
    push();
    noFill();
    // The hard rim sits on the radius the cut really reached.
    stroke(MOON_PALE[0], MOON_PALE[1], MOON_PALE[2], 220 * (1 - t));
    strokeWeight(3.5 * (1 - t) + 1);
    circle(this.position.x, this.position.y, 16 + (Q_CUT_RADIUS * 2 - 16) * opened);
    drawCrescent(
      this.position.x,
      this.position.y,
      Q_CUT_RADIUS * 0.62 * opened + 6,
      this.lean,
      2.1,
      7 * (1 - t) + 1,
      MOON_CORE,
      230 * (1 - t)
    );
    pop();
  }

  getDisplayBoundingBox() {
    return this.squareDisplayBoundingBox((Q_CUT_RADIUS + 30) * 2);
  }
}
