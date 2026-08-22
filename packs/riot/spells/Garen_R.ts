import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { ExecuteFallback, ExecuteSpell } from '@moba2d/core/content/types';

type AoePulse = InstanceType<ContentApi['AoePulse']>;
type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type Champion = InstanceType<ContentApi['units']['Champion']>;
type Circle = InstanceType<ContentApi['utils']['Quadtree']['Circle']>;
type Pet = InstanceType<ContentApi['units']['Pet']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type Garen_R = InstanceType<ReturnType<typeof makeGaren_R>>;
type Garen_R_Strike = InstanceType<ReturnType<typeof makeGaren_R_Strike>>;



export const RANGE = 200;

export const BASE_DAMAGE = 30;

/** Wiki: "+25–35% of target's missing health", as true damage. */
export const MISSING_HEALTH_PERCENT = 0.35;

export const REVEAL_MS = 1000;

/**
 * The sword takes this long to come down.
 *
 * A 400px unit-targeted execute that resolved on the keypress had no moment at
 * all: the victim died, and the blade art then appeared over the corpse, which
 * read as a killfeed animation rather than as the thing that did the killing.
 * The damage now lands when the point does — and because it is computed at that
 * moment rather than at cast, damage the victim takes during the descent makes
 * the execute hit harder, which is the shape the ability is supposed to have.
 */
export const WINDUP_MS = 450;

/** How long the planted blade lingers after it lands. */
export const IMPACT_MS = 260;

/** How far above the victim the sword starts its fall. */
export const DROP_HEIGHT = 360;

/** Length of the descending blade, tip to pommel. */
export const BLADE_LENGTH = 165;

/** Radius of the `blades` pulse the strike leaves on the ground. */
export const PULSE_RADIUS = 110;


/** Demacian gold, Demacian steel, and the light between them. */
const GOLD: [number, number, number] = [255, 208, 104];

const STEEL: [number, number, number] = [226, 234, 246];

const LIGHT: [number, number, number] = [255, 250, 210];


/**
 * Demacian Justice — the execute this game did not have.
 *
 * `docs/abilities/garen/r.json`: unit-targeted at an enemy *champion*, deals
 * **true damage** of `125–275 (+ 25–35% of target's missing health)` and
 * reveals them for 1 second.
 *
 * True damage has no meaning here yet (there is no armour to ignore), so the
 * part that survives the translation is the shape everyone remembers: the
 * lower the target is, the harder it hits. At full health it is a modest nuke;
 * on someone who has already lost most of their bar it is the sword out of the
 * sky. Champions only, exactly as the wiki says — you cannot execute a minion
 * with it.
 *
 * The sword out of the sky is now literally that: `Garen_R_Strike` owns the
 * descent *and* the damage, so there is exactly one place either can happen.
 */
function __buildGaren_R(api: ContentApi) {
  const Circle = api.utils.Quadtree.Circle;
  const pickExecuteTarget = api.combat.ExecuteTargeting.pickExecuteTarget;
  const effectiveRange = api.combat.Reach.effectiveRange;
  const PredefinedFilters = api.combat.PredefinedFilters;
  const Champion = api.units.Champion;
  const Pet = api.units.Pet;
  const Spell = api.Spell;
  const AttackableUnit = api.units.AttackableUnit;
  const Garen_R_Strike = makeGaren_R_Strike(api);
  class Garen_R extends Spell implements ExecuteSpell {
    // Auto-locks its own target; see "auto-locking spells" in docs/ADDING_SPELLS.md.
    targetingMode = 'SELF' as const;
    image = api.asset('spell_garen_r');
    name = 'Công Lý Demacia (Garen_R)';
    description =
      `Giáng kiếm lên <span class="damage">tướng địch</span> yếu nhất trong <span>${RANGE}px</span>` +
      ` sau <span class="time">${WINDUP_MS / 1000} giây</span>:` +
      ` <span class="damage">${BASE_DAMAGE} sát thương</span> cộng thêm` +
      ` <span class="damage">${MISSING_HEALTH_PERCENT * 100}% lượng máu đã mất</span> của mục tiêu,` +
      ` và <span class="buff">lộ diện</span> chúng trong <span class="time">${REVEAL_MS / 1000} giây</span>`;
    coolDown = 10000;
    manaCost = 60;

    range = RANGE;

    /**
     * Never the nearest one. An execute that picks by distance would routinely
     * kill the wrong person — the whole point of the ability is finishing the one
     * who is nearly dead, and with nobody finishable the lowest bar is still the
     * best use of a ten-second cooldown.
     */
    readonly executeFallback: ExecuteFallback = 'weakest';

    checkCastCondition() {
      return !!this.findVictim();
    }

    /**
     * The champion this sentence falls on: whoever it kills, else the weakest.
     *
     * "Weakest" alone was one shield away from wrong — a 5-health champion behind
     * a 300 absorb is the lowest bar on the map and the one target the sword
     * cannot touch, while someone at 20 with no shield dies outright.
     * `pickExecuteTarget` weighs the shield, and only sorts by bar height once it
     * has established that nobody dies. See `combat/ExecuteTargeting.ts`.
     */
    findVictim(): AttackableUnit | null {
      return pickExecuteTarget(this);
    }

    /**
     * The same expression `Garen_R_Strike._strike` uses. It is an estimate here
     * only in the sense that it is read `WINDUP_MS` early: whatever the victim
     * loses during the descent makes the real number bigger, never smaller, so a
     * target marked lethal at cast time stays lethal unless they are healed.
     */
    executeDamageAgainst(target: AttackableUnit): number {
      const max = target.stats.maxHealth.value;
      const missing = max > 0 ? Math.max(0, max - target.stats.health.value) : 0;
      return BASE_DAMAGE + missing * MISSING_HEALTH_PERCENT;
    }

    /** Champions only, exactly as the wiki says — no minion is executed by this. */
    executeCandidates(): AttackableUnit[] {
      return this.game.objectManager.queryObjects({
        area: new Circle({
          x: this.owner.position.x,
          y: this.owner.position.y,
          r: effectiveRange(this.range, this.owner),
        }),
        filters: [
          PredefinedFilters.canTakeDamageFromTeam(this.owner.teamId),
          PredefinedFilters.type(Champion),
          PredefinedFilters.excludeType(Pet),
        ],
      }) as AttackableUnit[];
    }

    onSpellCast() {
      const victim = this.findVictim();
      if (!victim) return;

      // The sentence is passed here; it is carried out when the blade lands.
      const strike = new Garen_R_Strike(this.owner);
      strike.victim = victim;
      strike.position = victim.position.copy();
      this.game.objectManager.addObject(strike);
    }

    drawPreview() {
      super.drawPreview(effectiveRange(this.range, this.owner));
    }
  }
  return Garen_R;
}
const __cacheGaren_R = new WeakMap<ContentApi, ReturnType<typeof __buildGaren_R>>();
export default function makeGaren_R(api: ContentApi) {
  const cached = __cacheGaren_R.get(api);
  if (cached) return cached;
  const built = __buildGaren_R(api);
  __cacheGaren_R.set(api, built);
  return built;
}


/**
 * The sword, falling.
 *
 * Everything is driven by `age` against `WINDUP_MS`: the blade accelerates
 * downward (`drop` is eased *in*, because a falling object speeds up), the
 * shadow under it tightens as it nears the ground, and the ring on the victim
 * closes as the count runs out. Nothing happens to the victim until `_strike`,
 * which latches — the object being removed for any reason converges here too,
 * and the ability must resolve exactly once.
 *
 * The blade tracks the victim while they live, so walking does not dodge a
 * unit-targeted execute; if they die first the sword still lands where they
 * were standing, because a strike that vanished mid-air would read as a bug.
 */
function __buildGaren_R_Strike(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  const AoePulse = api.AoePulse;
  const createReveal = api.buffs.createReveal;
  const AttackableUnit = api.units.AttackableUnit;
  class Garen_R_Strike extends SpellObject {
    position: p5.Vector = this.owner.position.copy();
    victim: AttackableUnit | null = null;
    age = 0;
    hasStruck = false;

    update() {
      this.age += deltaTime;

      // Follow the victim while there is a victim to follow; once there is not,
      // `position` is already the last place they stood.
      const victim = this.victim;
      if (victim && !victim.isDead && !victim.toRemove) {
        this.position = victim.position.copy();
      } else {
        this.victim = null;
      }

      if (!this.hasStruck && this.age >= WINDUP_MS) this._strike();
      if (this.age >= WINDUP_MS + IMPACT_MS) this.toRemove = true;
    }

    onRemoved() {
      // Scene exit and an early removal both arrive here; `_strike` latches, so
      // the execute still resolves exactly once whichever path got here first.
      if (this.age >= WINDUP_MS) this._strike();
      super.onRemoved();
    }

    _strike() {
      if (this.hasStruck) return;
      this.hasStruck = true;

      const victim = this.victim;
      if (victim) {
        const max = victim.stats.maxHealth.value;
        const missing = max > 0 ? Math.max(0, max - victim.stats.health.value) : 0;
        victim.takeDamage(BASE_DAMAGE + missing * MISSING_HEALTH_PERCENT, this.owner);

        victim.addBuff(
          createReveal({
            durationMs: REVEAL_MS,
            source: this.owner,
            target: victim,
            stackId: 'garen_r_reveal',
          })
        );
      }

      // The ground mark: blades of light driven down point-first, Garen's own
      // shape in the shared catalogue rather than a borrowed ring.
      const pulse = new AoePulse(this.owner);
      pulse.position = this.position.copy();
      pulse.radius = PULSE_RADIUS;
      pulse.lifeTime = 520;
      pulse.color = [...LIGHT];
      pulse.style = 'blades';
      pulse.spokes = 10;
      this.game.objectManager.addObject(pulse);
    }

    draw() {
      if (!this.hasStruck) this._drawDescent();
      else this._drawPlanted();
    }

    _drawDescent() {
      const t = constrain(this.age / WINDUP_MS, 0, 1);
      // Eased *in*: a sword dropped from the sky is slowest at the top. Easing it
      // out would make it float down, which is a feather, not judgement.
      const fall = t * t;
      const height = DROP_HEIGHT * (1 - fall);
      const closeness = fall;

      push();
      translate(this.position.x, this.position.y);

      // The column of light the blade is coming down through — the only warning
      // the victim gets, and it is on screen from the first frame.
      noStroke();
      fill(LIGHT[0], LIGHT[1], LIGHT[2], 26 + 46 * closeness);
      quad(-26 - 20 * closeness, -DROP_HEIGHT, 26 + 20 * closeness, -DROP_HEIGHT, 34, 0, -34, 0);

      // The mark on the ground, closing as the count runs out.
      noFill();
      stroke(GOLD[0], GOLD[1], GOLD[2], 160 + 80 * closeness);
      strokeWeight(3);
      circle(0, 0, PULSE_RADIUS * 2);
      stroke(LIGHT[0], LIGHT[1], LIGHT[2], 230);
      strokeWeight(5);
      arc(0, 0, PULSE_RADIUS * 1.6, PULSE_RADIUS * 1.6, -HALF_PI, -HALF_PI + TWO_PI * t);

      // The shadow: proof the sword is genuinely above the ground and not simply
      // drawn larger. It tightens and darkens all the way down.
      fill(20, 18, 12, 60 + 110 * closeness);
      noStroke();
      ellipse(0, 0, 24 + 70 * closeness, 10 + 26 * closeness);

      // The blade itself, planted point-down and dropping.
      push();
      translate(0, -height);
      this._drawSword(0.8 + 0.35 * closeness, 200 + 55 * closeness);
      pop();

      // Motes of light falling with it, spread along the column.
      noStroke();
      for (let i = 0; i < 6; i++) {
        const p = (this.age / 300 + i / 6) % 1;
        fill(LIGHT[0], LIGHT[1], LIGHT[2], 200 * (1 - p));
        circle(
          sin(this.age / 120 + i * 2.1) * 22,
          -DROP_HEIGHT * (1 - p) * (1 - fall * 0.5),
          5 * (1 - p) + 2
        );
      }

      pop();
    }

    _drawPlanted() {
      const t = constrain((this.age - WINDUP_MS) / IMPACT_MS, 0, 1);
      const fade = 1 - t;
      const flash = 1 - constrain(t / 0.35, 0, 1);

      push();
      translate(this.position.x, this.position.y);

      // The white instant of the blow, on top of the crater the pulse draws.
      if (flash > 0) {
        noStroke();
        fill(255, 255, 255, 215 * flash);
        circle(0, 0, PULSE_RADIUS * 0.85 * flash + 22);
        noFill();
        stroke(LIGHT[0], LIGHT[1], LIGHT[2], 240 * flash);
        strokeWeight(8 * flash + 2);
        circle(0, 0, PULSE_RADIUS * 2.1 * (1 - flash) + 18);
      }

      // The sword standing in the ground, sinking out of sight as it fades.
      push();
      translate(0, 14 * t);
      this._drawSword(1.05, 235 * fade);
      pop();

      pop();
    }

    /**
     * One Demacian greatsword, tip at the local origin, hilt above it. Drawn
     * rather than sprited because it has to change scale as it falls, and because
     * a flat icon at 165px reads as a decal glued to the screen.
     */
    _drawSword(scale: number, alpha: number) {
      const length = BLADE_LENGTH * scale;
      const halfWidth = 11 * scale;

      push();
      // glow first, so the steel reads on top of it
      noStroke();
      fill(GOLD[0], GOLD[1], GOLD[2], alpha * 0.3);
      triangle(-halfWidth * 2.2, -length * 0.86, halfWidth * 2.2, -length * 0.86, 0, length * 0.08);

      // the blade: a long taper to the point, with a lit fuller down its middle
      fill(STEEL[0], STEEL[1], STEEL[2], alpha);
      triangle(-halfWidth, -length * 0.86, halfWidth, -length * 0.86, 0, 0);
      fill(255, 255, 255, alpha * 0.85);
      triangle(-halfWidth * 0.3, -length * 0.84, halfWidth * 0.3, -length * 0.84, 0, -length * 0.06);

      // crossguard, grip and pommel, all Demacian gold
      fill(GOLD[0], GOLD[1], GOLD[2], alpha);
      rectMode(CENTER);
      rect(0, -length * 0.86, halfWidth * 6, 7 * scale, 2 * scale);
      rect(0, -length * 0.94, halfWidth * 1.1, length * 0.14);
      circle(0, -length * 1.02, halfWidth * 1.9);
      pop();
    }

    getDisplayBoundingBox() {
      // The sword starts a full DROP_HEIGHT above the victim and the column of
      // light spans the whole of it; a box drawn around the victim alone would
      // cull the descent for exactly as long as it is interesting.
      const up = DROP_HEIGHT + BLADE_LENGTH * 1.2;
      const side = Math.max(PULSE_RADIUS * 2.2, BLADE_LENGTH);
      return new Rectangle({
        x: this.position.x - side,
        y: this.position.y - up,
        w: side * 2,
        h: up + PULSE_RADIUS * 2.2,
        data: this,
      });
    }
  }
  return Garen_R_Strike;
}
const __cacheGaren_R_Strike = new WeakMap<ContentApi, ReturnType<typeof __buildGaren_R_Strike>>();
export function makeGaren_R_Strike(api: ContentApi) {
  const cached = __cacheGaren_R_Strike.get(api);
  if (cached) return cached;
  const built = __buildGaren_R_Strike(api);
  __cacheGaren_R_Strike.set(api, built);
  return built;
}