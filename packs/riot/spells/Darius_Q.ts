import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CancelReason, CastContext, CastSpec } from '@moba2d/core/content/types';
// Relative, not `@/`: `DariusAxe` moved into `packs/riot/vfx/` (Task 2 of the
// content-pack extraction) — see `Lux_R.ts`'s identical note on `LuxBeamEffect`.
import { drawAxeArc, drawDariusAxe } from '../vfx/DariusAxe';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type DamageOverTime = InstanceType<ContentApi['buffs']['DamageOverTime']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Darius_Q = InstanceType<ReturnType<typeof makeDarius_Q>>;
type Darius_Q_Object = InstanceType<ReturnType<typeof makeDarius_Q_Object>>;



/** He hefts the axe this long before it comes round; the whole telegraph. */
export const WINDUP_MS = 550;

/** The blade — the outer band of the sweep, where the edge actually is. */
export const OUTER_RADIUS = 235;

/** The haft. Anyone standing inside it eats the handle instead of the edge. */
export const INNER_RADIUS = 95;

export const BLADE_DAMAGE = 30;

/** 35% of the blade, the PC ratio, kept because it is the whole point of the shape. */
export const HANDLE_DAMAGE = Math.round(BLADE_DAMAGE * 0.35);

/**
 * The blade's sustain is a share of the damage it actually lands, not a step
 * per body caught.
 *
 * Counting bodies made the heal a flat 10 whether the swing took a champion
 * from full health or finished one sitting on 4, and a target who ate the whole
 * hit on a shield paid Darius exactly as much as one who took it on the chin.
 * A share of the damage answers all three, and lands on the same number it used
 * to for the ordinary case: 35% of a 30-damage blade is 10.5.
 *
 * Two rates, because "damage dealt" over a minion wave is a different quantity
 * entirely — six minions is 180 damage against a ~100 health pool, so a single
 * rate would turn Decimate into a full heal on every wave. Champions are the
 * sustain the ability is for; the wave is a trickle.
 */
export const HEAL_PERCENT_CHAMPION = 0.5;

export const HEAL_PERCENT_UNIT = 0.7;


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

export const HEMORRHAGE_DAMAGE_PER_STACK = 3;

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
function __buildapplyHemorrhage(api: ContentApi) {
  const AttackableUnit = api.units.AttackableUnit;
  const DamageOverTime = api.buffs.DamageOverTime;
  function applyHemorrhage(source: AttackableUnit, victim: AttackableUnit): void {
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
    bleed.image = api.asset('spell_darius_q');
    bleed.name = 'Chảy Máu (1)';
    bleed.damagePerTick = HEMORRHAGE_DAMAGE_PER_STACK;
    bleed.tickInterval = HEMORRHAGE_TICK_MS;
    // arterial red cooling to a dried-blood brown, so a bleed never reads as a burn
    bleed.flameColor = [235, 60, 55];
    bleed.emberColor = [95, 12, 12];
    victim.addBuff(bleed);
  }
  return applyHemorrhage;
}
const __cacheapplyHemorrhage = new WeakMap<ContentApi, ReturnType<typeof __buildapplyHemorrhage>>();
export function makeApplyHemorrhage(api: ContentApi) {
  const cached = __cacheapplyHemorrhage.get(api);
  if (cached) return cached;
  const built = __buildapplyHemorrhage(api);
  __cacheapplyHemorrhage.set(api, built);
  return built;
}


/**
 * Decimate: a long wind-up and then the whole circle at once.
 *
 * The wind-up is the ability. `WINDUP_MS` of axe-over-the-shoulder is what the
 * enemy gets to react to, and Darius may walk through it (`SpellForm.AIMED`) —
 * so the interesting decision is his: start the swing early and chase, or hold
 * position and land it. Crowd control still takes it off him.
 */
function __buildDarius_Q(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const SpellForm = api.enums.SpellForm;
  const Spell = api.Spell;
  const Champion = api.units.Champion;
  const AttackableUnit = api.units.AttackableUnit;
  const applyHemorrhage = makeApplyHemorrhage(api);
  const Darius_Q_Object = makeDarius_Q_Object(api);
  class Darius_Q extends Spell {
    image = api.asset('spell_darius_q');
    name = 'Tàn Sát (Darius_Q)';
    description =
      `Vung rìu quanh mình sau <span class="time">${WINDUP_MS / 1000} giây</span> vung tay:` +
      ` <span class="damage">${BLADE_DAMAGE} sát thương</span> ở vành ngoài (<span>${INNER_RADIUS}px – ${OUTER_RADIUS}px</span>),` +
      ` chỉ <span class="damage">${HANDLE_DAMAGE} sát thương</span> cho kẻ đứng sát người.` +
      ` Lưỡi rìu <span class="buff">hút ${HEAL_PERCENT_CHAMPION * 100}% sát thương gây lên tướng</span>` +
      ` (<span class="buff">${HEAL_PERCENT_UNIT * 100}%</span> lên lính và quái) và gây <span class="damage">Chảy Máu</span>`;
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

      let healOwed = 0;
      const landed: QHit[] = [];
      for (const victim of victims) {
        const bladed = this.owner.position.dist(victim.position) > INNER_RADIUS;
        // Where the cut happened, relative to the caster at the moment of the
        // swing. The art is centred on his live position and he may walk during
        // it, so an offset travels with the swing where a world point would not.
        landed.push({
          dx: victim.position.x - this.owner.position.x,
          dy: victim.position.y - this.owner.position.y,
          bladed,
        });

        // What the swing *deals* is not what it swings for: shields eat their
        // share inside takeDamage, and a 30-damage blade on a target holding 4
        // health deals 4. `takeDamage` already resolves both and books the answer
        // as `landed` on the victim's ledger, so read it there rather than
        // predicting it here — a second guess at the mitigation chain would be
        // wrong the first time a new shield type shipped.
        const takenBefore = victim.tally.damageTaken;
        victim.takeDamage(bladed ? BLADE_DAMAGE : HANDLE_DAMAGE, this.owner);
        const dealt = victim.tally.damageTaken - takenBefore;

        // The haft is a consolation prize on purpose: it neither bleeds nor heals,
        // which is what stops "stand on top of him" from being the safe answer.
        if (!bladed) continue;
        applyHemorrhage(this.owner, victim);
        healOwed += dealt * (victim instanceof Champion ? HEAL_PERCENT_CHAMPION : HEAL_PERCENT_UNIT);
      }

      // Rounded here rather than left to takeHeal, so the sweep's "it healed"
      // flag below agrees with whether anything was actually restored.
      const heal = Math.round(healOwed);
      if (heal > 0) this.owner.takeHeal(heal, this.owner);

      // The object outlives the cast by the length of its own sweep animation, so
      // it is handed the strike and then let go rather than removed here.
      this.sweep?.strike(heal > 0, landed);
      this.sweep = null;
    }

    drawPreview() {
      super.drawPreview(OUTER_RADIUS);
    }
  }
  return Darius_Q;
}
const __cacheDarius_Q = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_Q>>();
export default function makeDarius_Q(api: ContentApi) {
  const cached = __cacheDarius_Q.get(api);
  if (cached) return cached;
  const built = __buildDarius_Q(api);
  __cacheDarius_Q.set(api, built);
  return built;
}


/** One cut, recorded at the swing so the sweep can show where it landed. */
export interface QHit {
  /** Offset from the caster, not a world point — see `onSpellCast`. */
  dx: number;
  dy: number;
  /** Outer band or handle; the two hits look different because they are different. */
  bladed: boolean;
}


/** Grit thrown off the edge, seeded once so it animates instead of flickering. */
const CHIP_COUNT = 14;

/** How long the blade takes to come round once it is released. */
const SWEEP_MS = 320;


function __buildDarius_Q_Object(api: ContentApi) {
  const SpellObject = api.SpellObject;
  class Darius_Q_Object extends SpellObject {
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

    /** Every cut this swing made, in the order the query returned them. */
    hits: QHit[] = [];

    /** The wind-up is over: damage has already landed, now show it landing. */
    strike(healed: boolean, hits: QHit[] = []): void {
      this.struck = true;
      this.healed = healed;
      this.hits = hits;
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

      // The axe, hauled up over his shoulder and wound back. It is the same
      // silhouette W hangs at his hip and E hooks with — see `vfx/DariusAxe.ts`
      // for why all three call one function.
      push();
      rotate(-HALF_PI - wind * 2.4);
      // Never fully cold: dark iron on the dark-red telegraph disc is the one
      // place this weapon can disappear, so it keeps a floor of heat and comes up
      // to a full glow as the swing charges.
      drawDariusAxe(OUTER_RADIUS * 0.82, { heat: 0.4 + wind * 0.6 });
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

      // The two zones, still two zones while the blade is coming round: the outer
      // band is the one that bleeds and heals, the hole is the consolation prize,
      // and a player standing in one has to be able to tell which. A thin line
      // between them was not enough — they are painted as separate regions.
      noStroke();
      fill(150, 20, 25, 40 * fade);
      circle(0, 0, OUTER_RADIUS * 2);
      fill(20, 18, 22, 105 * fade);
      circle(0, 0, INNER_RADIUS * 2);

      const lead = -HALF_PI + TWO_PI * out;

      // The blade's own trail, hottest right behind the edge, so the eye follows
      // the weapon round rather than watching a ring fill in.
      drawAxeArc(
        (INNER_RADIUS + OUTER_RADIUS) * 0.5,
        lead,
        Math.min(TWO_PI * out, 1.5),
        240 * fade,
        (OUTER_RADIUS - INNER_RADIUS) * 0.3
      );

      // The axe itself, out at the end of his arms. The wind-up showed the weapon
      // and the swing used to replace it with an anonymous orange line; carrying
      // the same silhouette through the swing is the whole point of the rewrite.
      // Grip sits inside the dead zone and the head reaches exactly OUTER_RADIUS,
      // so the hitbox is drawn by the thing that makes it.
      const grip = INNER_RADIUS * 0.34;
      push();
      rotate(lead);
      translate(grip, 0);
      drawDariusAxe(OUTER_RADIUS - grip, {
        alpha: 255 * fade,
        heat: 1,
        bloodied: this.healed,
      });
      pop();

      // hard rim on the real hit radius: the hitbox must never be a guess
      stroke(255, 70, 60, 200 * fade);
      strokeWeight(3);
      circle(0, 0, OUTER_RADIUS * 2);
      stroke(120, 120, 130, 120 * fade);
      strokeWeight(2);
      circle(0, 0, INNER_RADIUS * 2);

      // Every cut, on the body that took it, appearing as the edge reaches it.
      // The grit below is decoration — it is thrown at seeded angles and says
      // nothing about whether the swing connected. These say exactly that, and
      // say which of the two zones caught them.
      for (const hit of this.hits) {
        // How far round the swing this body sits, measured from the same start
        // angle the blade uses, so the mark cannot appear before the edge arrives.
        let turn = (Math.atan2(hit.dy, hit.dx) + HALF_PI) % TWO_PI;
        if (turn < 0) turn += TWO_PI;
        const since = out - turn / TWO_PI;
        if (since <= 0) continue;
        // Opens fast, then stays for the rest of the swing and fades out with it.
        // On its own short clock (it expired 0.4 of the way round) every mark was
        // gone before the blade had finished the circle, so the one thing that
        // tells a player they connected was invisible for most of the ability.
        // Not named `pop` — that is p5's, and a local would shadow the `pop()`
        // that closes this very block. See the p5-globals trap in CLAUDE.md.
        const opened = constrain(since / 0.1, 0, 1);
        const flash = fade;
        if (flash <= 0) continue;

        push();
        translate(hit.dx, hit.dy);
        rotate(Math.atan2(hit.dy, hit.dx) + HALF_PI);
        noFill();
        if (hit.bladed) {
          // A cut, opening along the direction the edge travelled.
          stroke(255, 240, 232, 245 * flash);
          strokeWeight(4 * flash + 1);
          line(-16 - 12 * opened, 0, 16 + 12 * opened, 0);
          stroke(206, 32, 34, 230 * flash);
          strokeWeight(2 * flash + 1);
          line(-11 - 8 * opened, 5, 11 + 8 * opened, 5);
        } else {
          // The handle: a dull thud ring, no cut and no blood, because it does
          // neither. Two hits that behave differently must not look the same.
          stroke(178, 176, 182, 190 * flash);
          strokeWeight(2 * flash + 1);
          circle(0, 0, 16 + 22 * opened);
        }
        pop();
      }

      // grit knocked loose along the cut
      noStroke();
      for (const chip of this.chips) {
        const d = chip.distance + chip.drift * 40 * out;
        fill(190, 40, 38, 160 * fade);
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
      return this.squareDisplayBoundingBox(r * 2);
    }
  }
  return Darius_Q_Object;
}
const __cacheDarius_Q_Object = new WeakMap<ContentApi, ReturnType<typeof __buildDarius_Q_Object>>();
export function makeDarius_Q_Object(api: ContentApi) {
  const cached = __cacheDarius_Q_Object.get(api);
  if (cached) return cached;
  const built = __buildDarius_Q_Object(api);
  __cacheDarius_Q_Object.set(api, built);
  return built;
}