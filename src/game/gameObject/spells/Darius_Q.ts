import { Circle, Rectangle } from '../../../libs/quadtree';
import AssetManager from '../../../managers/AssetManager';
import { PredefinedFilters } from '../../managers/ObjectManager';
import { SpellForm } from '../../spell/runtime/CancelPolicy';
import type { CancelReason, CastContext, CastSpec } from '../../spell/runtime/types';
import Spell from '../Spell';
import SpellObject from '../SpellObject';
import Champion from '../attackableUnits/Champion';
import type AttackableUnit from '../attackableUnits/AttackableUnit';
import DamageOverTime from '../buffs/DamageOverTime';

/** He hefts the axe this long before it comes round; the whole telegraph. */
export const WINDUP_MS = 550;
/** The blade — the outer band of the sweep, where the edge actually is. */
export const OUTER_RADIUS = 235;
/** The haft. Anyone standing inside it eats the handle instead of the edge. */
export const INNER_RADIUS = 95;
export const BLADE_DAMAGE = 30;
/** 35% of the blade, the PC ratio, kept because it is the whole point of the shape. */
export const HANDLE_DAMAGE = Math.round(BLADE_DAMAGE * 0.35);
/** Per champion caught by the blade, so a swing into a fight is a sustain button. */
export const HEAL_PER_CHAMPION = 6;
export const HEAL_MAX = 18;

// ---------------------------------------------------------------------------
// Hemorrhage — the bleed the whole kit is built around.
//
// Darius has no passive slot here, so the bleed lives with Q (the spell that
// applies it most) and W/E stack it while R spends it. It is a plain
// `DamageOverTime` from the catalogue: one buff whose per-tick damage *is* the
// stack count, times `HEMORRHAGE_DAMAGE_PER_STACK`. Deriving the count from the
// damage rather than piling up five separate buffs keeps the victim wearing one
// bleed column instead of five overlapping ones, and needs no new buff class.
// ---------------------------------------------------------------------------
export const HEMORRHAGE_STACK_ID = 'darius_hemorrhage';
export const HEMORRHAGE_DAMAGE_PER_STACK = 1;
export const HEMORRHAGE_MAX_STACKS = 5;
export const HEMORRHAGE_TICK_MS = 1_000;
export const HEMORRHAGE_DURATION_MS = 5_000;

/** The live bleed on `unit`, whoever put it there. */
function hemorrhageOn(unit: AttackableUnit): DamageOverTime | undefined {
  for (const buff of unit.buffs) {
    if (buff.stackId === HEMORRHAGE_STACK_ID && !buff.toRemove) return buff as DamageOverTime;
  }
  return undefined;
}

/** How many stacks of Hemorrhage `unit` is carrying right now. */
export function hemorrhageStacks(unit: AttackableUnit): number {
  const bleed = hemorrhageOn(unit);
  if (!bleed) return 0;
  return Math.round(bleed.damagePerTick / HEMORRHAGE_DAMAGE_PER_STACK);
}

/** Cuts `victim`: one more stack, and the clock back to full. */
export function applyHemorrhage(source: AttackableUnit, victim: AttackableUnit): void {
  if (victim.isDead) return;

  const existing = hemorrhageOn(victim);
  if (existing) {
    const stacks = Math.min(HEMORRHAGE_MAX_STACKS, hemorrhageStacks(victim) + 1);
    existing.damagePerTick = stacks * HEMORRHAGE_DAMAGE_PER_STACK;
    existing.name = `Chảy Máu (${stacks})`;
    existing.renewBuff();
    return;
  }

  const bleed = new DamageOverTime(HEMORRHAGE_DURATION_MS, source, victim);
  bleed.stackId = HEMORRHAGE_STACK_ID;
  bleed.image = AssetManager.get('spell_darius_q');
  bleed.name = 'Chảy Máu (1)';
  bleed.damagePerTick = HEMORRHAGE_DAMAGE_PER_STACK;
  bleed.tickInterval = HEMORRHAGE_TICK_MS;
  // arterial red cooling to a dried-blood brown, so a bleed never reads as a burn
  bleed.flameColor = [235, 60, 55];
  bleed.emberColor = [95, 12, 12];
  victim.addBuff(bleed);
}

/**
 * Decimate: a long wind-up and then the whole circle at once.
 *
 * The wind-up is the ability. `WINDUP_MS` of axe-over-the-shoulder is what the
 * enemy gets to react to, and Darius may walk through it (`SpellForm.AIMED`) —
 * so the interesting decision is his: start the swing early and chase, or hold
 * position and land it. Crowd control still takes it off him.
 */
export default class Darius_Q extends Spell {
  image = AssetManager.get('spell_darius_q');
  name = 'Tàn Sát (Darius_Q)';
  description =
    `Vung rìu quanh mình sau <span class="time">${WINDUP_MS / 1000} giây</span> vung tay:` +
    ` <span class="damage">${BLADE_DAMAGE} sát thương</span> ở vành ngoài (<span>${INNER_RADIUS}px – ${OUTER_RADIUS}px</span>),` +
    ` chỉ <span class="damage">${HANDLE_DAMAGE} sát thương</span> cho kẻ đứng sát người.` +
    ` Mỗi tướng trúng lưỡi rìu <span class="buff">hồi ${HEAL_PER_CHAMPION} máu</span> (tối đa ${HEAL_MAX})` +
    ` và bị <span class="damage">Chảy Máu</span>`;
  coolDown = 7_000;
  manaCost = 30;

  range = OUTER_RADIUS;

  /** The axe standing in the world during the wind-up; struck, then discarded. */
  private sweep: Darius_Q_Object | null = null;

  get castSpec(): Readonly<CastSpec> {
    return {
      activation: 'PRESS',
      targeting: 'SELF',
      castTimeMs: WINDUP_MS,
      resource: { commitAt: 'start', refundOn: [] },
      cooldown: { startAt: 'release', durationMs: this.coolDown },
      // "Darius can move during Decimate" — walking is part of the gesture, so
      // only real crowd control should take the swing away.
      interrupts: SpellForm.AIMED,
    };
  }

  onCastStart(_context: CastContext): void {
    this.sweep = new Darius_Q_Object(this.owner);
    this.game.objectManager.addObject(this.sweep);
  }

  onCancel(_context: CastContext, _reason: CancelReason): void {
    if (!this.sweep) return;
    this.sweep.toRemove = true;
    this.sweep = null;
  }

  onSpellCast(): void {
    const victims = this.game.objectManager.queryObjects({
      area: new Circle({
        x: this.owner.position.x,
        y: this.owner.position.y,
        r: OUTER_RADIUS,
      }),
      filters: [PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId)],
    }) as AttackableUnit[];

    let championsBladed = 0;
    for (const victim of victims) {
      const bladed = this.owner.position.dist(victim.position) > INNER_RADIUS;
      victim.takeDamage(bladed ? BLADE_DAMAGE : HANDLE_DAMAGE, this.owner);
      // The haft is a consolation prize on purpose: it neither bleeds nor heals,
      // which is what stops "stand on top of him" from being the safe answer.
      if (!bladed) continue;
      applyHemorrhage(this.owner, victim);
      if (victim instanceof Champion) championsBladed++;
    }

    const heal = Math.min(HEAL_MAX, championsBladed * HEAL_PER_CHAMPION);
    if (heal > 0) this.owner.takeHeal(heal, this.owner);

    // The object outlives the cast by the length of its own sweep animation, so
    // it is handed the strike and then let go rather than removed here.
    this.sweep?.strike(heal > 0);
    this.sweep = null;
  }

  drawPreview() {
    super.drawPreview(OUTER_RADIUS);
  }
}

/** Grit thrown off the edge, seeded once so it animates instead of flickering. */
const CHIP_COUNT = 14;
/** How long the blade takes to come round once it is released. */
const SWEEP_MS = 320;

export class Darius_Q_Object extends SpellObject {
  /** Which half of the ability is on screen: the heft, then the swing. */
  struck = false;
  healed = false;
  age = 0;
  sweepAge = 0;

  /** Seeded in `onAdded`; `random()` inside `draw()` re-rolls every frame. */
  chips: { angle: number; distance: number; size: number; drift: number }[] = [];

  onAdded(): void {
    for (let i = 0; i < CHIP_COUNT; i++) {
      this.chips.push({
        angle: random(0, TWO_PI),
        distance: random(INNER_RADIUS, OUTER_RADIUS),
        size: random(3, 9),
        drift: random(0.4, 1.6),
      });
    }
  }

  /** The wind-up is over: damage has already landed, now show it landing. */
  strike(healed: boolean): void {
    this.struck = true;
    this.healed = healed;
  }

  update(): void {
    this.position.set(this.owner.position.x, this.owner.position.y);
    this.age += deltaTime;
    if (!this.struck) {
      // The runtime owns the wind-up clock; the object is only allowed to
      // outlive it by a grace margin in case the cast was cancelled silently.
      if (this.age > WINDUP_MS * 3) this.toRemove = true;
      return;
    }
    this.sweepAge += deltaTime;
    if (this.sweepAge >= SWEEP_MS) this.toRemove = true;
  }

  draw(): void {
    push();
    translate(this.owner.position.x, this.owner.position.y);
    if (this.struck) this.drawSweep();
    else this.drawHeft();
    pop();
  }

  /**
   * The heft. Everything grows toward the real hit radius so the enemy can read
   * both "how long have I got" and "how far do I need to walk".
   */
  private drawHeft(): void {
    const t = constrain(this.age / WINDUP_MS, 0, 1);
    // wind-in easing: slow at first, then he yanks it round
    const wind = t * t;

    // the ground the blade will cover, filling up as the swing charges
    noStroke();
    fill(150, 20, 25, 18 + 34 * wind);
    circle(0, 0, OUTER_RADIUS * 2);
    // the dead zone, drawn as a hole rather than a disc: standing here is safer
    fill(20, 18, 22, 90);
    circle(0, 0, INNER_RADIUS * 2);

    // the rim is the actual hitbox, so it is the brightest thing on screen
    noFill();
    stroke(255, 90 + 90 * wind, 60, 120 + 120 * wind);
    strokeWeight(2 + 4 * wind);
    circle(0, 0, OUTER_RADIUS * 2);

    // the axe, hauled up over his shoulder and back
    push();
    rotate(-HALF_PI - wind * 2.4);
    // haft
    stroke(120, 84, 52);
    strokeWeight(7);
    line(0, 0, OUTER_RADIUS * 0.62, 0);
    // head — a heavy crescent, Noxian iron, nothing like Garen's straight blade
    noStroke();
    fill(210, 214, 224);
    arc(OUTER_RADIUS * 0.62, 0, 74, 96, -HALF_PI, HALF_PI, PIE);
    fill(160, 30, 32);
    arc(OUTER_RADIUS * 0.62, 0, 46, 62, -HALF_PI, HALF_PI, PIE);
    pop();

    // four ticks counting the wind-up down around the rim
    stroke(255, 220, 200, 200);
    strokeWeight(3);
    for (let i = 0; i < 4; i++) {
      if (t < (i + 1) / 4) continue;
      const a = -HALF_PI + (i / 4) * TWO_PI;
      line(
        cos(a) * (OUTER_RADIUS - 16),
        sin(a) * (OUTER_RADIUS - 16),
        cos(a) * (OUTER_RADIUS + 8),
        sin(a) * (OUTER_RADIUS + 8)
      );
    }
  }

  /** The swing: one full turn of the edge, thrown out and gone in a third of a second. */
  private drawSweep(): void {
    const t = constrain(this.sweepAge / SWEEP_MS, 0, 1);
    // snap-out easing — the edge is fastest on the first frames
    const out = 1 - (1 - t) * (1 - t);
    const fade = 1 - t;

    // the cut itself: a band between the two radii, not a filled disc, because
    // the hole in the middle is what the ability is about
    noFill();
    stroke(255, 235, 225, 220 * fade);
    strokeWeight((OUTER_RADIUS - INNER_RADIUS) * 0.22 * fade + 2);
    arc(
      0,
      0,
      (INNER_RADIUS + OUTER_RADIUS) * 0.95,
      (INNER_RADIUS + OUTER_RADIUS) * 0.95,
      -HALF_PI,
      -HALF_PI + TWO_PI * out
    );

    // the leading edge, still travelling
    const lead = -HALF_PI + TWO_PI * out;
    stroke(255, 120, 80, 240 * fade);
    strokeWeight(9 * fade + 2);
    line(
      cos(lead) * INNER_RADIUS,
      sin(lead) * INNER_RADIUS,
      cos(lead) * OUTER_RADIUS,
      sin(lead) * OUTER_RADIUS
    );

    // hard rim on the real hit radius: the hitbox must never be a guess
    stroke(255, 70, 60, 200 * fade);
    strokeWeight(3);
    circle(0, 0, OUTER_RADIUS * 2);
    stroke(120, 120, 130, 120 * fade);
    strokeWeight(2);
    circle(0, 0, INNER_RADIUS * 2);

    // grit knocked loose along the cut
    noStroke();
    for (const chip of this.chips) {
      const d = chip.distance + chip.drift * 40 * out;
      fill(190, 40, 38, 220 * fade);
      circle(cos(chip.angle) * d, sin(chip.angle) * d, chip.size * fade + 1);
    }

    // the blood he takes back, pulled inward instead of thrown outward
    if (!this.healed) return;
    stroke(120, 235, 140, 200 * fade);
    strokeWeight(3);
    noFill();
    circle(0, 0, OUTER_RADIUS * 2 * (1 - out) + 20);
  }

  getDisplayBoundingBox() {
    const r = OUTER_RADIUS + 60;
    return new Rectangle({
      x: this.owner.position.x - r,
      y: this.owner.position.y - r,
      w: r * 2,
      h: r * 2,
      data: this,
    });
  }
}
