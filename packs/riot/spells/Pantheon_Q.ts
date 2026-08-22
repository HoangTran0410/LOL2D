import type { ContentApi } from '@moba2d/core/content/ContentApi';
import type { CancelReason, CastContext, CastSpec, Vec2 } from '@moba2d/core/content/types';

type AttackableUnit = InstanceType<ContentApi['units']['AttackableUnit']>;
type BeamSpellObject = InstanceType<ContentApi['BeamSpellObject']>;
type CastBar = InstanceType<ContentApi['vfx']['CastBar']>;
type ChargeRangeTelegraph = InstanceType<ContentApi['vfx']['ChargeRangeTelegraph']>;
type MissileSpellObject = InstanceType<ContentApi['MissileSpellObject']>;
type Monster = InstanceType<ContentApi['units']['Monster']>;
type Rectangle = InstanceType<ContentApi['utils']['Quadtree']['Rectangle']>;
type Slow = InstanceType<ContentApi['buffs']['Slow']>;
type Spell = InstanceType<ContentApi['Spell']>;
type SpellObject = InstanceType<ContentApi['SpellObject']>;
type TrailSystem = InstanceType<ContentApi['helpers']['TrailSystem']>;
type VfxGroup = InstanceType<ContentApi['vfx']['VfxGroup']>;
type Pantheon_Q = InstanceType<ReturnType<typeof makePantheon_Q>>;
type Pantheon_Q_Spear = InstanceType<ReturnType<typeof makePantheon_Q_Spear>>;
type Pantheon_Q_Thrust = InstanceType<ReturnType<typeof makePantheon_Q_Thrust>>;



const HOLD_THRESHOLD_MS = 350;

const MAX_CHARGE_MS = 4_000;

const RANGE = 700;

const MIN_RANGE = 100;

const RANGE_CHARGE_MS = 1_500;

// The tap-cast is a melee stab: short, wide, and nothing like the thrown spear.
// Exported so tests assert the geometry is wired from these, not a copy of the
// numbers — retuning a value should not mean editing the suite.
export const THRUST_REACH = 210;

export const THRUST_WIDTH = 100;

export const THRUST_BACKSWING = 40;


type SpearTarget = AttackableUnit & {
  readonly unitType?: 'minion';
};


function __builddamageMultiplier(api: ContentApi) {
  const Monster = api.units.Monster;
  const damageMultiplier = (target: SpearTarget): number =>
    target instanceof Monster ? 0.8 : target.unitType === 'minion' ? 0.7 : 1;
  return damageMultiplier;
}
const __cachedamageMultiplier = new WeakMap<ContentApi, ReturnType<typeof __builddamageMultiplier>>();
export function makeDamageMultiplier(api: ContentApi) {
  const cached = __cachedamageMultiplier.get(api);
  if (cached) return cached;
  const built = __builddamageMultiplier(api);
  __cachedamageMultiplier.set(api, built);
  return built;
}


function __buildspearDamage(api: ContentApi) {
  const damageMultiplier = makeDamageMultiplier(api);
  const spearDamage = (target: SpearTarget, subsequent: boolean): number => {
    const executeMultiplier = target.stats.health.value < target.stats.maxHealth.value * 0.2 ? 2 : 1;
    return 20 * damageMultiplier(target) * executeMultiplier * (subsequent ? 0.5 : 1);
  };
  return spearDamage;
}
const __cachespearDamage = new WeakMap<ContentApi, ReturnType<typeof __buildspearDamage>>();
export function makeSpearDamage(api: ContentApi) {
  const cached = __cachespearDamage.get(api);
  if (cached) return cached;
  const built = __buildspearDamage(api);
  __cachespearDamage.set(api, built);
  return built;
}


/**
 * Draws the spear pointing along +x in already-translated local coordinates.
 * Shared so the thrown spear and the melee thrust show the same weapon.
 */
const drawSpearBody = (half: number, blade: number): void => {
  // haft: dark wood with a bronze highlight along the top
  stroke(84, 52, 26, 245);
  strokeWeight(blade * 0.34);
  line(-half * 0.95, 0, half * 0.34, 0);
  stroke(206, 160, 92, 220);
  strokeWeight(blade * 0.1);
  line(-half * 0.95, -blade * 0.09, half * 0.34, -blade * 0.09);

  noStroke();
  fill(176, 132, 68, 235);
  ellipse(-half * 0.95, 0, blade * 0.36, blade * 0.7);

  // socket collar, kept slim so it does not read as a bead on the shaft
  fill(198, 150, 78, 240);
  quad(
    half * 0.28,
    -blade * 0.22,
    half * 0.4,
    -blade * 0.18,
    half * 0.4,
    blade * 0.18,
    half * 0.28,
    blade * 0.22
  );

  // narrow leaf blade, drawn over the collar so the point stays the far end
  fill(255, 248, 224, 250);
  beginShape();
  vertex(half, 0);
  bezierVertex(half * 0.72, -blade * 0.85, half * 0.52, -blade * 0.55, half * 0.38, 0);
  bezierVertex(half * 0.52, blade * 0.55, half * 0.72, blade * 0.85, half, 0);
  endShape(CLOSE);

  // mid-rib keeps the blade from reading as a flat blob at speed
  stroke(198, 146, 58, 190);
  strokeWeight(blade * 0.08);
  line(half * 0.44, 0, half * 0.93, 0);
};


function __buildPantheon_Q(api: ContentApi) {
  const SpellForm = api.enums.SpellForm;
  const BeamSpellObject = api.BeamSpellObject;
  const Spell = api.Spell;
  const Slow = api.buffs.Slow;
  const CastBar = api.vfx.CastBar;
  const unitCastBarAnchor = api.vfx.unitCastBarAnchor;
  const ChargeRangeTelegraph = api.vfx.ChargeRangeTelegraph;
  const VfxGroup = api.vfx.VfxGroup;
  const AttackableUnit = api.units.AttackableUnit;
  const spearDamage = makeSpearDamage(api);
  const Pantheon_Q_Spear = makePantheon_Q_Spear(api);
  const Pantheon_Q_Thrust = makePantheon_Q_Thrust(api);
  class Pantheon_Q extends Spell {
    image = api.asset('spell_pantheon_q');
    name = 'Ngọn Giáo Sao Băng (Pantheon_Q)';
    description = 'Thả sớm để đâm giáo, hoặc giữ để ném một ngọn giáo xuyên.';
    coolDown = 4_000;
    manaCost = 25;

    private chargeMs = 0;
    private chargeSlow?: Slow;
    private wasThrust = false;
    private castDirection: Vec2 = { x: 0, y: 0 };
    private aimContext?: CastContext;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'TAP_OR_HOLD',
        targeting: 'DIRECTION',
        charge: { maxDurationMs: MAX_CHARGE_MS, releaseAtMax: false },
        resource: { commitAt: 'start', refundOn: ['MAX_DURATION', 'DEATH', 'SILENCE', 'STUN'] },
        cooldown: { startAt: 'end', durationMs: this.coolDown },
        // Winding up the throw: Pantheon may reposition while he charges, but
        // every piece of crowd control takes the spear away.
        interrupts: SpellForm.AIMED,
        vfx: {
          castLoop: context =>
            new VfxGroup([
              new CastBar(
                context,
                () => this.chargeMs / MAX_CHARGE_MS,
                undefined,
                () => unitCastBarAnchor(this.owner)
              ),
              new ChargeRangeTelegraph(
                () => this.owner.position,
                () => this.castDirection,
                () => this.currentRange,
                () => this.chargeMs / RANGE_CHARGE_MS
              ),
            ]),
        },
      };
    }

    onCastStart(context: CastContext): void {
      this.chargeMs = 0;
      this.wasThrust = false;
      // Not `context.direction` raw: a press whose aim landed on Pantheon would
      // leave the telegraph pointing nowhere until the first `hold` corrected it.
      this.castDirection = this.firingDirection(context);
      this.aimContext = context;
      this.chargeSlow = new Slow(MAX_CHARGE_MS, this.owner, this.owner);
      this.chargeSlow.percent = 0.1;
      this.chargeSlow.stackId = 'pantheon_q_charge_slow';
      this.owner.addBuff(this.chargeSlow);
    }

    onChargeUpdate(_context: CastContext, elapsedMs: number): void {
      this.chargeMs = elapsedMs;
    }

    hold(context: CastContext): boolean {
      this.aimContext = context;
      this.castDirection = this.directionTo(context);
      return super.hold(context);
    }

    release(context: CastContext): boolean {
      this.aimContext = context;
      this.castDirection = this.directionTo(context);
      return super.release(context);
    }

    onUpdate(): void {
      if (this.state !== 'CHARGING') return;
      if (this.owner.isDead) this.cancel('DEATH');
      else if (!this.owner.canCast) this.cancel('SILENCE');
    }

    onRelease(context: CastContext): void {
      this.removeChargeSlow();
      const start = { x: this.owner.position.x, y: this.owner.position.y };
      const direction = this.directionTo(this.aimContext ?? context);
      if (this.chargeMs <= HOLD_THRESHOLD_MS) {
        this.createThrust(start, direction);
        this.wasThrust = true;
        return;
      }

      const spear = new Pantheon_Q_Spear(this.owner);
      spear.chargeRatio = Math.min(1, this.chargeMs / RANGE_CHARGE_MS);
      spear.destination = createVector(
        start.x + direction.x * this.currentRange,
        start.y + direction.y * this.currentRange
      );
      this.game.objectManager.addObject(spear);
    }

    onCancel(_context: CastContext, reason: CancelReason): void {
      this.removeChargeSlow();
      if (
        reason === 'MAX_DURATION' ||
        reason === 'DEATH' ||
        reason === 'SILENCE' ||
        reason === 'STUN'
      ) {
        this.changeResource(this.owner.stats.mana, -this.effectiveManaCost / 2);
      }
    }

    onComplete(_context: CastContext): void {
      if (this.wasThrust) this.currentCooldown = this.reducedCooldown(this.coolDown * 0.4);
    }

    private createThrust(start: Vec2, direction: Vec2): void {
      const beam = new BeamSpellObject(
        this.owner,
        {
          start: {
            x: start.x - direction.x * THRUST_BACKSWING,
            y: start.y - direction.y * THRUST_BACKSWING,
          },
          end: { x: start.x + direction.x * THRUST_REACH, y: start.y + direction.y * THRUST_REACH },
          width: THRUST_WIDTH,
        },
        {
          candidateFilter: target =>
            target instanceof AttackableUnit &&
            target.targetable &&
            !target.isDead &&
            target.teamId !== this.owner.teamId,
          onHit: target => target.takeDamage(spearDamage(target, false), this.owner),
        }
      );
      this.game.objectManager.addObject(beam);

      // BeamSpellObject is hit detection only, and instant beams are removed the
      // frame they resolve — without this the tap-cast landed damage with no
      // visual at all.
      const thrust = new Pantheon_Q_Thrust(this.owner);
      thrust.aimDirection = direction;
      thrust.reach = THRUST_REACH;
      thrust.laneWidth = THRUST_WIDTH;
      this.game.objectManager.addObject(thrust);
    }

    private removeChargeSlow(): void {
      this.chargeSlow?.deactivateBuff();
      this.chargeSlow = undefined;
    }

    get currentRange(): number {
      return MIN_RANGE + (RANGE - MIN_RANGE) * Math.min(1, this.chargeMs / RANGE_CHARGE_MS);
    }

    /**
     * Live aim off the cursor, falling back to a direction that is never (0,0).
     *
     * The old fallback was `context.direction`, which is itself (0,0) whenever
     * the aim landed on Pantheon — a cursor on top of him, or a bot with no
     * cursor at all aiming at a `destination` parked on its own feet. That threw
     * a spear nowhere: a lane whose start equals its end hits nothing and draws
     * nothing. `firingDirection` resolves it off his own heading, which is the
     * rule `Game.facing()` states for the touch layer.
     */
    private directionTo(context: CastContext): Vec2 {
      const dx = context.cursorWorld.x - this.owner.position.x;
      const dy = context.cursorWorld.y - this.owner.position.y;
      const length = Math.hypot(dx, dy);
      if (length === 0) return this.firingDirection(context);
      return { x: dx / length, y: dy / length };
    }
  }
  return Pantheon_Q;
}
const __cachePantheon_Q = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_Q>>();
export default function makePantheon_Q(api: ContentApi) {
  const cached = __cachePantheon_Q.get(api);
  if (cached) return cached;
  const built = __buildPantheon_Q(api);
  __cachePantheon_Q.set(api, built);
  return built;
}


function __buildPantheon_Q_Spear(api: ContentApi) {
  const MissileSpellObject = api.MissileSpellObject;
  const TrailSystem = api.helpers.TrailSystem;
  const AttackableUnit = api.units.AttackableUnit;
  const spearDamage = makeSpearDamage(api);
  class Pantheon_Q_Spear extends MissileSpellObject {
    speed = 1_400 / 60;
    size = 32;
    visualWidth = 126;
    visualHeight = 42;
    maxHitCount = Infinity;
    /** 0..1 — how long the throw was wound up; drives glow and speed streaks. */
    chargeRatio = 0;

    trailSystem = new TrailSystem({
      trailColor: '#FD8A',
      trailSize: this.visualHeight * 0.4,
      trailLifeTime: 300,
    });

    draw(): void {
      const angle = Math.atan2(
        this.destination.y - this.position.y,
        this.destination.x - this.position.x
      );
      const half = this.visualWidth / 2;
      const blade = this.visualHeight * 0.4;
      const charge = this.chargeRatio;

      push();
      translate(this.position.x, this.position.y);
      rotate(angle);

      // Starlight burning along the haft, heavier the longer the throw was wound
      // up. It stops short of the tip: extended past the blade with round caps it
      // painted a gold blob in front of the point and blunted the spear.
      blendMode(ADD);
      strokeCap(SQUARE);
      noFill();
      stroke(255, 170, 70, 55 + 60 * charge);
      strokeWeight(10 + 12 * charge);
      line(-half * 1.05, 0, half * 0.3, 0);
      stroke(255, 236, 190, 90 + 70 * charge);
      strokeWeight(3.5 + 4 * charge);
      line(-half * 1.05, 0, half * 0.3, 0);

      // speed streaks trailing the haft, so a full charge reads as a hard throw
      if (charge > 0.05) {
        stroke(255, 220, 150, 90 * charge);
        strokeWeight(1.5);
        for (const offset of [-blade * 0.5, blade * 0.5]) {
          line(-half * (1.1 + 0.5 * charge), offset, -half * 0.5, offset * 0.45);
        }
      }
      blendMode(BLEND);
      strokeCap(ROUND);

      drawSpearBody(half, blade);

      pop();
    }

    onHit(enemy: AttackableUnit): void {
      enemy.takeDamage(spearDamage(enemy, this.hitTargets.length > 1), this.owner);
    }
  }
  return Pantheon_Q_Spear;
}
const __cachePantheon_Q_Spear = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_Q_Spear>>();
export function makePantheon_Q_Spear(api: ContentApi) {
  const cached = __cachePantheon_Q_Spear.get(api);
  if (cached) return cached;
  const built = __buildPantheon_Q_Spear(api);
  __cachePantheon_Q_Spear.set(api, built);
  return built;
}


/** The melee tap-cast: a spear lunge down the lane BeamSpellObject just hit. */
function __buildPantheon_Q_Thrust(api: ContentApi) {
  const Rectangle = api.utils.Quadtree.Rectangle;
  const SpellObject = api.SpellObject;
  class Pantheon_Q_Thrust extends SpellObject {
    position = this.owner.position.copy();
    aimDirection: Vec2 = { x: 1, y: 0 };
    reach = 560;
    laneWidth = 120;
    age = 0;
    lifeTime = 280;

    update(): void {
      this.age += deltaTime;
      if (this.age >= this.lifeTime) this.toRemove = true;
    }

    draw(): void {
      const t = constrain(this.age / this.lifeTime, 0, 1);
      const fade = 1 - t;
      // Punch out over the first third, then drift back: a thrust reads as a
      // stab, where a constant-length beam reads as a laser.
      const reach = t < 0.33 ? Math.pow(t / 0.33, 0.55) : 1 - ((t - 0.33) / 0.67) * 0.22;
      const tip = this.reach * reach;
      const halfLane = this.laneWidth / 2;
      const spearHalf = 63;
      const blade = 21;

      push();
      translate(this.position.x, this.position.y);
      rotate(Math.atan2(this.aimDirection.y, this.aimDirection.x));

      blendMode(ADD);
      strokeCap(SQUARE);

      // the lane that was actually hit, so the tap has readable range
      noStroke();
      fill(255, 186, 88, 40 * fade);
      quad(0, -halfLane * 0.4, tip, -halfLane, tip, halfLane, 0, halfLane * 0.4);

      // white-hot core along the lunge
      noFill();
      stroke(255, 208, 128, 150 * fade);
      strokeWeight(halfLane * 0.5 * fade + 3);
      line(0, 0, tip * 0.9, 0);
      stroke(255, 250, 226, 230 * fade);
      strokeWeight(halfLane * 0.16 * fade + 2);
      line(0, 0, tip, 0);

      // shock ring where the point lands
      stroke(255, 236, 190, 200 * fade);
      strokeWeight(3 * fade + 1);
      circle(tip, 0, halfLane * (0.5 + t * 1.6));
      blendMode(BLEND);
      strokeCap(ROUND);

      // the weapon itself, riding the leading edge
      push();
      translate(tip - spearHalf, 0);
      drawSpearBody(spearHalf, blade);
      pop();

      pop();
    }

    // the lunge reaches far past `position`, so the box must cover the whole lane
    getDisplayBoundingBox(): Rectangle {
      const pad = this.reach + this.laneWidth;
      return this.squareDisplayBoundingBox(pad * 2);
    }
  }
  return Pantheon_Q_Thrust;
}
const __cachePantheon_Q_Thrust = new WeakMap<ContentApi, ReturnType<typeof __buildPantheon_Q_Thrust>>();
export function makePantheon_Q_Thrust(api: ContentApi) {
  const cached = __cachePantheon_Q_Thrust.get(api);
  if (cached) return cached;
  const built = __buildPantheon_Q_Thrust(api);
  __cachePantheon_Q_Thrust.set(api, built);
  return built;
}