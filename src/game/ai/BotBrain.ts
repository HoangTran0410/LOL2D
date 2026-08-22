import Champion from '@/game/gameObject/attackableUnits/Champion';
import Minion from '@/game/gameObject/attackableUnits/Minion';
import { canSee, type Seeable } from '@/game/combat/Vision';
import { profileFor, type DifficultyProfile } from '@/game/ai/Difficulty';
import {
  blackboardFor,
  type BlackboardHost,
  type SeenEnemy,
  type TeamView,
} from '@/game/ai/TeamBlackboard';
import { laneApproach } from '@/game/ai/LaneObjectives';
import { clampToSafeApproach, escapePoint, insideThreat } from '@/game/ai/TurretThreat';
import type AIChampion from '@/game/gameObject/attackableUnits/AIChampion';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
import type Turret from '@/game/gameObject/structures/Turret';
import {
  isChargeActivation,
  requireChargeSpec,
  type CastContext,
  type Vec2,
} from '@/game/spell/runtime/types';
import {
  hasRole,
  roles,
  rolesOf,
  SpellRole,
  ULTIMATE_SLOT,
  type SpellRoleMask,
} from '@/game/ai/SpellRole';
import { effectiveRange } from '@/game/combat/Reach';
import { MELEE_RANGE_THRESHOLD } from '@/game/combat/BasicAttack';
import { resolveInterrupts } from '@/game/spell/runtime/CancelPolicy';
import { effectiveHealth } from '@/game/combat/ExecuteTargeting';
import { DEFAULT_PROJECTILE_SPEED, predictAim } from '@/game/ai/AimPredictor';
import { Circle } from '@/libs/quadtree';
import { PredefinedFilters } from '@/game/managers/ObjectManager';
import TargetResolver from '@/game/spell/targeting/TargetResolver';
import { uuidv4 } from '@/utils';
import type Spell from '@/game/gameObject/Spell';

/** How much a target's remaining health pulls the choice, at full health missing. */
export const TARGET_LOW_HEALTH_WEIGHT = 12;
/** Pixels per point of target score. 100px of walking is worth one point. */
export const TARGET_DISTANCE_DIVISOR = 100;

export type Posture =
  'RETREAT' | 'RECOVER' | 'DISENGAGE' | 'FIGHT' | 'SEARCH' | 'ENGAGE' | 'PUSH' | 'ROAM';

/** How far from an ally a focus target counts as "a fight worth joining". */
export const ASSIST_RANGE = 700;
export const ROAM_RADIUS = 500;
/**
 * How close our own wave has to be to a turret before a bot will hit it.
 *
 * A turret out-ranges a champion (430 against a melee body) and out-damages one
 * per swing, so a bot that walks up to a building on its own is a bot that
 * feeds it. This is the "are there minions here to shoot at instead" test,
 * measured from the turret to the front of our wave — a little past the
 * turret's own reach, so a wave that is still trading with it counts and one
 * that has not arrived yet does not.
 */
export const PUSH_TURRET_ESCORT_PX = 450;
/**
 * Clearance a bot keeps outside an enemy turret's reach.
 *
 * Two rules are written against it and they must not fight each other: a bot
 * walking somewhere is held at `reach + this`, and a bot that has ended up
 * *inside* `reach` walks back out to `reach + this`. Because the disengage
 * trigger is the smaller radius of the two, a bot parked on the ring is not
 * inside anything and the pair is stable — the yo-yo you get from a keep-out
 * distance and an escape distance that are the same number.
 */
export const TURRET_KEEP_OUT_PX = 60;
/**
 * How long a turret that has fired on this bot stays off-limits to it.
 *
 * `turret.target === this.owner` is a true fact and a terrible gate on its own,
 * because it stops being true the moment the bot steps out of range. A bot with
 * a wave escorting it dived, `Turret.findAllyAttacker` swung the building onto
 * it, it disengaged — and the instant it cleared the ring the building dropped
 * it, the escort rule said yes again and it walked straight back in. Reported
 * from a real match as a bot pacing the edge of turret range, and the slower of
 * the two halves of that (the faster one is in `clampToSafeApproach`).
 *
 * A turret shot is a thing that happened, not a thing that is happening, so it
 * has to outlive the range check. Four seconds is about how long a player stays
 * off a tower after eating one — long enough for the wave to matter, short
 * enough that the ground genuinely reopens.
 */
export const TURRET_HOSTILE_MS = 4_000;
/**
 * How much closer a push has to be able to get before it is worth calling one.
 *
 * A shade under one think tick of walking (`moveSpeed` 3 x 15 frames = 45px),
 * so a bot that can still take a real step keeps its lane and only a bot that
 * genuinely cannot move toward its objective gives it up.
 */
export const PUSH_PROGRESS_PX = 40;
/**
 * How long a lane stays given up on once its objective proved unreachable.
 *
 * Without it the give-up is self-cancelling: the bot walks away, the objective
 * becomes "approachable" again from further out purely because there is room to
 * take a step, and it walks back to the same line — pacing, rebuilt out of the
 * cure for pacing. Latched, like `TURRET_HOSTILE_MS` and `headingHome`, and
 * cleared the moment the lane genuinely opens.
 */
export const PUSH_BLOCKED_MS = 6_000;
/**
 * Health a bot must still have before it will trade a turret shot for a kill.
 *
 * Above `hard`'s `retreatHealthPct` of 0.4, so the dive rule is never what a
 * nearly-dead bot is deciding with — that bot is already retreating.
 */
export const DIVE_HEALTH_PCT = 0.55;
/** Effective health at or under which a target is worth diving a turret for. */
export const DIVE_LETHAL_HEALTH = 30;
/**
 * How much of its own attack reach a kiting bot keeps between it and its
 * target. Under 1 on purpose: `BasicAttackController.update` chases anything
 * beyond the reach, so a step over the line is undone on the next frame and
 * reads as a bot vibrating in place rather than as spacing.
 */
export const KITE_HOLD_PCT = 0.85;
/** How far back one kite step goes, before the hold line trims it. */
export const KITE_STEP_PX = 140;
/** Swing timer left, under which a bot plants and fires instead of stepping. */
export const KITE_COMMIT_MS = 120;
/**
 * How long since the last hit before standing still for a recall is worth it.
 *
 * Reported from a real match: the bot ran to its turret with an enemy bot right
 * behind it, stopped dead and opened a four-second channel. Nothing in the
 * interrupt table can prevent that — an enemy standing next to you is not a
 * move, a stun or a hit — so the *decision* has to carry the safety check, and
 * carry it every tick rather than only at the moment the key goes down.
 */
export const RECALL_SAFE_MS = 3_000;
/** And no enemy the team has seen this recently, this close. */
export const RECALL_CLEAR_PX = 900;
/** Both must be met before a recovering bot rejoins. */
export const RECOVER_HEALTH_PCT = 0.7;
export const RECOVER_MANA_PCT = 0.5;
export const OUTNUMBERED_BY = 2;
export const OUTNUMBERED_HEALTH_PCT = 0.6;
/** Ceiling on how far a remembered heading is projected forward. */
export const SEARCH_MAX_LEAD_PX = 300;
/**
 * How close counts as "arrived" at the retreat point.
 *
 * Sized to a body, not to a step. This was `moveSpeed * 2` — 6px at the
 * default speed of 3 — while the retreat point is usually a turret, and body
 * separation holds a 55px champion about 74px from a 92px turret's centre
 * (`UnitCollisionSystem` separates by the sum of the radii). A bot retreating
 * to a turret could therefore never arrive, and never left RETREAT for RECOVER.
 */
export const RETREAT_ARRIVE_PX = 120;
/** How far a bot will walk to investigate a team-wide sighting. */
export const SEARCH_MAX_DISTANCE_PX = 900;
/** One frame, in ms. `SeenEnemy.vel` is pixels per *frame*, elapsed time is ms. */
export const FRAME_MS = 1000 / 60;
/** How far ahead an aimless cast points. Any positive number; never 0. */
export const FALLBACK_AIM_PX = 100;
/**
 * ms between decisions. Four a second, jittered per bot on construction, and
 * the whole performance story of this module: the code it replaces rolled
 * `random() < 0.1` sixty times a second per bot. Matches `BLACKBOARD_TTL_MS`,
 * so one board is built per window for the whole match rather than one per bot.
 */
export const THINK_INTERVAL_MS = 250;
/**
 * How long one kite step buys the right to move while an attack order stands.
 *
 * Longer than the think interval, so the window cannot lapse between two
 * decisions and leave the bot planted for a frame; `BasicAttackController` ends
 * it the instant the swing comes ready regardless, which is what keeps a
 * kiting bot firing rather than running.
 */
export const KITE_WINDOW_MS = THINK_INTERVAL_MS + 50;

/**
 * The three postures whose whole content is "stop fighting and get out".
 *
 * They share one set of consequences — the standing attack order is dropped,
 * only self-preservation spells may be pressed, and the attack scan stops
 * answering — so they are named once rather than re-listed at each of them.
 */
export const isLeavingPosture = (posture: Posture): boolean =>
  posture === 'RETREAT' || posture === 'RECOVER' || posture === 'DISENGAGE';

/**
 * A resource as a fraction. **No pool reads as full**, not as empty: a champion
 * with `maxMana` 0 would otherwise sit at 0% forever, never satisfy
 * `manaPct > RECOVER_MANA_PCT`, and latch into RECOVER permanently after one
 * low-health moment. Latent today — every shipped champion has a pool.
 */
const ratio = (value: number, max: number): number => (max > 0 ? value / max : 1);

export interface SpellChoice {
  spell: Spell;
  slotIndex: number;
  mask: SpellRoleMask;
  score: number;
}

/**
 * The whole tuning surface for spell choice, exported so no test hard-codes one
 * of them. Retuning a bot's priorities is editing this block and nothing else.
 */
export const SCORE_DAMAGE = 10;
export const SCORE_POKE = 6;
export const SCORE_BURST = 14;
export const SCORE_CC = 12;
export const SCORE_SUPPORT = 20;
export const SCORE_SUPPORT_WASTED = -5;
export const SCORE_ESCAPE = 25;
export const SCORE_ESCAPE_WASTED = -10;
export const SCORE_DASH_GAPCLOSE = 6;
export const SCORE_DASH_WASTED = -4;
export const SCORE_BUFF = 5;
export const SCORE_ZONE = 8;
export const SCORE_ULTIMATE = 6;

/** Below this effective health, a target is worth spending a burst spell on. */
export const BURST_TARGET_HEALTH = 40;
/** Below this fraction, a heal or shield is worth more than another hit. */
export const SUPPORT_HEALTH_PCT = 0.5;

/**
 * The only roles a bot running away is allowed to press.
 *
 * `scoreSpell` prices an escape at `SCORE_ESCAPE` **only** while the posture is
 * RETREAT, and a heal at `SCORE_SUPPORT` only below half health — and neither
 * row was reachable. `maybeCast` returned unless the posture was FIGHT, ENGAGE
 * or SEARCH, while `decidePosture` latches a hurt bot into RETREAT/RECOVER
 * until it has healed, which it cannot do without casting. So a bot at 20%
 * health ran to its turret, stood there with a heal off cooldown, and pressed
 * nothing.
 *
 * A fleeing bot may now cast, narrowed to these three roles: it presses its
 * escape and its heal, and it does not turn round to trade damage while
 * running. The rate limit (`castIntervalMs`) still applies, as everywhere else.
 */
export const RETREAT_ROLES: SpellRoleMask = roles(
  SpellRole.Escape,
  SpellRole.Heal,
  SpellRole.Shield
);

/**
 * May a bot running away press this spell?
 *
 * `RETREAT_ROLES` on its own is not that question, and shipping it as one made
 * a fleeing bot worse than the bug it fixed. **No spell in
 * `src/game/gameObject/spells/` declares `static aiRoles`** — the field exists
 * on `Spell`, nothing sets it — so `Escape`, `Heal` and `Shield` are produced
 * *solely* by `inferRoles`, which hands `roles(Buff, Shield)` to every `SELF`
 * cast with a mana cost: about seventy files. While retreating that mask scores
 * Shield `SCORE_SUPPORT` (health is below `SUPPORT_HEALTH_PCT` by definition
 * there) + Buff + Ultimate, and it is the only candidate the role filter leaves,
 * so it always wins. One self-cast auto-lock ultimate is exactly that shape — `SELF`, 50 mana, `range`
 * 500 — and it auto-locks the nearest enemy inside 500px and dashes *behind*
 * them. So a bot below its retreat threshold ulted into the champion chasing it,
 * where before the last wave it pressed nothing at all. Three more self-cast
 * ultimates are the same shape.
 *
 * The `Shield` bit is therefore inference noise on every costed `SELF` cast, and
 * the retreat set cannot trust it alone. Two further axes separate a genuine
 * self-preservation spell from a self-cast engage tool, and both must hold:
 *
 * - **Not the ultimate slot.** That catches those four by construction.
 * - **Declares no range.** A real shield or heal reaches nobody; a `SELF` spell
 *   carrying a `declaredRange` reaches *out* to something, and a self-cast
 *   auto-lock ultimate's 500 is
 *   precisely that reach.
 *
 * The consequence is accepted: with nothing hand-tagged this leaves the retreat
 * set small — self-buffs and shields that declare no range. Casting little while
 * fleeing is right; ulting into the pursuer is not. The day spells do carry
 * hand-written `aiRoles`, these two guards should apply to *inferred* masks
 * only, or a hand-tagged blink (a ranged `Escape`) would be excluded with them.
 */
export function isRetreatCandidate(spell: Spell, mask: SpellRoleMask): boolean {
  return (
    hasRole(mask, RETREAT_ROLES) &&
    !hasRole(mask, SpellRole.Ultimate) &&
    spell.declaredRange === undefined
  );
}

/**
 * What narrows the kit for one cast decision.
 *
 * - `FREE` — a real fight: everything castable is a candidate.
 * - `RETREAT` — running away, so only what helps the bot leave. See
 *   `isRetreatCandidate`, which is three axes rather than a role mask.
 * - `WAVE` — farming, so only cheap damage. See `isWaveClearCandidate`.
 */
export type CastMode = 'FREE' | 'RETREAT' | 'WAVE';

/**
 * May a bot spend this on minions?
 *
 * Damage only, and never the ultimate. The point of letting a pushing bot cast
 * at all is that four abilities off cooldown while it plinks a wave with
 * autoattacks is what makes it read as asleep — not that the wave is worth a
 * teamfight ability. The mana floor (`DifficultyProfile.waveClearManaPct`, a
 * tier knob) is the other half,
 * and it is checked once per decision rather than per spell.
 *
 * `Dash` and `Escape` are excluded explicitly even though `inferRoles` never
 * produces either: the day a spell carries a hand-written `aiRoles`, a bot
 * blinking into a wave is not the way to find out.
 */
/**
 * May a bot press this with nobody to press it at?
 *
 * Every term in `scoreSpell` that depends on a target already carries
 * `&& target` — but three do not, because they are not about one: `Buff` (+5),
 * the support row (which pays `SCORE_SUPPORT` whenever the caster is hurt), and
 * `SCORE_ULTIMATE` (+6). That is enough to win a selection on its own, and
 * `inferRoles` hands `roles(Buff, Shield)` to **every** `SELF` cast with a mana
 * cost — about seventy files — while `rolesOf` adds `Ultimate` from the slot.
 * So a self-cast R scored 11 with nothing in sight, and a bot walking an empty
 * lane pressed its ultimate every `castIntervalMs`. Reported from a real match.
 *
 * The two axes are `isRetreatCandidate`'s, for the same reason and against the
 * same inference noise:
 *
 * - **Not the ultimate slot.** An ultimate is a spell you spend *on* something.
 *   `SCORE_ULTIMATE` is a priority bump between candidates that already earned
 *   their place, never a reason to cast.
 * - **Declares no range.** A `SELF` spell carrying a `declaredRange` reaches
 *   *out* at something — a self-cast auto-lock ultimate's 500 auto-locks the
 *   nearest enemy inside it —
 *   and with no target there is nothing out there.
 *
 * A genuine self-buff or shield, which declares no range and is not the
 * ultimate, is still pressable before contact. That is deliberate and
 * `chooseSpell`'s "lets a SELF spell be chosen with no target at all" covers it.
 */
export function isTargetlessCandidate(spell: Spell, mask: SpellRoleMask): boolean {
  return !hasRole(mask, SpellRole.Ultimate) && spell.declaredRange === undefined;
}

export function isWaveClearCandidate(mask: SpellRoleMask): boolean {
  return (
    hasRole(mask, SpellRole.Damage) &&
    !hasRole(mask, SpellRole.Ultimate) &&
    !hasRole(mask, roles(SpellRole.Dash, SpellRole.Escape))
  );
}

export class BotBrain {
  /**
   * The terrain half of perception, injectable purely so a test can state a
   * line-of-sight answer without building walls. Always `canSee` in the game.
   */
  sees: (observer: AIChampion, target: AttackableUnit) => boolean = (observer, target) =>
    canSee(observer as unknown as Seeable, target as unknown as Seeable);

  private lastThinkAtMs: number;
  private lastCastAtMs = Number.NEGATIVE_INFINITY;
  /**
   * The clock, written once per frame at the top of `update`. `findAttackTarget`
   * reads it too — `AIChampion.update` calls `updateAttackTargeting()` on its own
   * cooldown, which is not this one, so without a shared field that path would
   * ask the blackboard for a snapshot at whatever time it last thought.
   */
  private nowMs = 0;
  private pendingCharge?: {
    spell: Spell;
    context: CastContext;
    elapsedMs: number;
    releaseAtMs: number;
  };
  /**
   * A recast ability the bot has opened and still owes presses to.
   *
   * `cast` used to arrange a follow-through for charge activations and nothing
   * else, so the seven `activation: 'RECAST'` spells got exactly one press each:
   * one four-round ultimate raised its curtain and fired none of its four rounds, a
   * detonation spell never detonated, a slashing ultimate never slashed, a
   * second-dash ability never dashed back.
   *
   * `choice` rather than a bare spell so each recast can be re-aimed through
   * `aimFor` — the four-round ultimate's rounds should track a target that is still running.
   */
  private pendingRecast?: {
    choice: SpellChoice;
    context: CastContext;
    target: AttackableUnit | null;
    remaining: number;
    delayMs: number;
    nextAtMs: number;
  };

  constructor(readonly owner: AIChampion) {
    // Jittered so five bots never think on the same frame. `Math.random` and
    // not p5's `random`, per the no-globals rule for this directory.
    this.lastThinkAtMs = -Math.random() * THINK_INTERVAL_MS;
  }

  get profile(): Readonly<DifficultyProfile> {
    return profileFor(this.owner._difficulty);
  }

  /**
   * Whether this bot may *acquire* `target`.
   *
   * Four gates, and which of them a tier skips is the whole of the difficulty
   * knob:
   *
   * - **Targetability** blocks at every tier. `findAttackTarget`'s quadtree scan
   *   gets this free from `PredefinedFilters.canTakeDamageFromTeam`, but the
   *   blackboard path — `pickTarget` walking `view.enemies` — has no filter of
   *   its own, so this is the only place it can come from. Without it a bot
   *   chased and cast at a champion holding `Untargetable` (a brief leap
   *   invulnerability, a shadow pet): the `UNIT` resolve fizzles and the skillshot is spent mana.
   * - **Range** is `profile.aggroRange`, at every tier. It is not vision's job:
   *   `canSee` applies no sight-radius cap on purpose (`Vision.ts:33`), because
   *   `Reach.ts` owns range and a 500px cap here once trimmed one leap ability to 500
   *   from its authored 550. And it is emphatically not
   *   `AttackableUnit.visionRadius`, which is a lerped animation value written
   *   every frame from 0 upward, not a constant.
   * - **Stealth** blocks at every tier.
   * - **Terrain and bushes** block at every tier. There used to be a
   *   `seesThroughTerrain` column here, on for `normal` and `hard`, and it made
   *   this the one acquisition path in the game that skipped the fog — minions,
   *   monsters, pets, turrets and the player's own right click all go through
   *   `PredefinedFilters.visibleTo`. A player hits it as "a bot autoattacked me
   *   through a wall while neither of us had vision". A tier's sight advantage
   *   is `memoryTtlMs` now: how long it hunts what it lost, not whether it ever
   *   loses it.
   *
   * Acquisition only. A standing attack order is kept regardless, by
   * `BasicAttackController.canKeep`, which has no vision check and must keep
   * none: vision gates acquisition, never damage or retention.
   */
  canPerceive(target: Champion): boolean {
    if (target === this.owner) return false;
    if (target.isDead || target.toRemove) return false;
    if (!target.targetable) return false;
    if (target.isStealthed) return false;

    const dx = target.position.x - this.owner.position.x;
    const dy = target.position.y - this.owner.position.y;
    if (Math.hypot(dx, dy) > this.profile.aggroRange) return false;

    return this.sees(this.owner, target);
  }

  /**
   * The enemy worth hitting: near, nearly dead, or the one the team is already
   * on. Weighted rather than ranked, so no single term can veto the others —
   * a bot does not walk past a dying enemy to reach a marginally closer one.
   */
  pickTarget(view: TeamView): Champion | null {
    let best: Champion | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const enemy of view.enemies) {
      if (!this.canPerceive(enemy)) continue;
      const score = this.scoreTarget(enemy, view);
      if (score > bestScore) {
        bestScore = score;
        best = enemy;
      }
    }
    return best;
  }

  /** Not `private`: `findAttackTarget` ranks the quadtree's candidates with it. */
  scoreTarget(enemy: Champion, view: TeamView): number {
    const dx = enemy.position.x - this.owner.position.x;
    const dy = enemy.position.y - this.owner.position.y;
    let score = -Math.hypot(dx, dy) / TARGET_DISTANCE_DIVISOR;

    const maxHealth = enemy.stats.maxHealth.value;
    if (maxHealth > 0) {
      // `effectiveHealth`, not the raw pool: it counts the shields standing in
      // front of it, which is the answer `pickFocus` and the `Burst` check both
      // already use. Reading `stats.health` alone made one shielded enemy look
      // nearly dead to the target picker and perfectly healthy to the burst
      // check, on the same tick.
      const healthPct = effectiveHealth(enemy) / maxHealth;
      score += TARGET_LOW_HEALTH_WEIGHT * (1 - healthPct);
    }

    if (enemy === view.focusTarget) score += this.profile.focusBonus;
    if (enemy === this.owner.game.player) score += this.profile.playerBias;

    return score;
  }

  posture: Posture = 'ROAM';
  /**
   * Latched by a retreat and cleared only when health *and* mana are back.
   *
   * Without it, healing past `retreatHealthPct` alone makes rule 1 stop firing,
   * the bot turns round at 31% health, gets hit once, and retreats again: a
   * bot that yo-yos on the edge of its own threshold and never actually heals.
   */
  private recovering = false;
  /**
   * When each enemy turret stops counting as hostile to this bot. Bounded by
   * the number of buildings in the match, and only ever written for one the
   * blackboard is publishing. See `TURRET_HOSTILE_MS`.
   */
  private readonly turretHostileUntilMs = new Map<Turret, number>();
  /**
   * Set while a recovering bot is walking to the platform rather than resetting
   * at its turret. See the note in `decidePosture`; `retreatPoint()` reads it.
   */
  private headingHome = false;
  /**
   * Match time until which this bot's lane is treated as closed. See
   * `pushApproach` and `PUSH_BLOCKED_MS`.
   */
  private pushBlockedUntilMs = Number.NEGATIVE_INFINITY;
  /**
   * Match time of the last hit this bot took, written by `AIChampion.takeDamage`.
   *
   * `-Infinity` so a bot that has never been hit reads as safe rather than as
   * "hit at time zero", which every bot would be for the first three seconds of
   * a match.
   */
  lastDamagedAtMs = Number.NEGATIVE_INFINITY;

  /**
   * Whether it is worth standing still for four seconds.
   *
   * Team knowledge, not omniscience: `view.memory` is what an ally has actually
   * seen, terrain-honest and aged out by the tier's own `memoryTtlMs`. An enemy
   * currently chasing this bot is in it by definition — the bot can see them —
   * and one that broke line of sight a moment ago still counts, which is the
   * case worth being careful about.
   */
  safeToRecall(view: TeamView, nowMs: number): boolean {
    if (nowMs - this.lastDamagedAtMs < RECALL_SAFE_MS) return false;
    return !this.enemySeenNear(view, nowMs, RECALL_CLEAR_PX);
  }

  private enemySeenNear(view: TeamView, nowMs: number, radius: number): boolean {
    for (const entry of view.memory.values()) {
      if (entry.unit.isDead || entry.unit.toRemove) continue;
      if (nowMs - entry.atMs > this.profile.memoryTtlMs) continue;
      const away = Math.hypot(
        entry.pos.x - this.owner.position.x,
        entry.pos.y - this.owner.position.y
      );
      if (away <= radius) return true;
    }
    return false;
  }

  /**
   * `target` is the enemy this tick already picked, handed in so the scan runs
   * once. `undefined` means "nobody has asked yet" and `null` is a real answer
   * — a bot that can perceive nobody — so this cannot be a `??`.
   */
  evaluatePosture(view: TeamView, nowMs: number, target?: Champion | null): Posture {
    // The clock, written here as well as at the top of `update`, because this is
    // the entry point the suites use and `turretIsHostile` reads `this.nowMs`
    // from paths that are handed no time at all (`findAttackTarget`).
    this.nowMs = nowMs;
    this.noteTurretFire(view);
    const chosen = target === undefined ? this.pickTarget(view) : target;
    const posture = this.decidePosture(view, nowMs, chosen);
    this.posture = posture;
    return posture;
  }

  private decidePosture(view: TeamView, nowMs: number, target: Champion | null): Posture {
    const healthPct = ratio(this.owner.stats.health.value, this.owner.stats.maxHealth.value);
    const manaPct = ratio(this.owner.stats.mana.value, this.owner.stats.maxMana.value);

    // **First**, above even going home, and that ordering was worth a bug.
    //
    // It used to sit below the health retreat, which reads sensibly — a bot
    // about to die should head for its own turret — and is wrong, because
    // RETREAT walks a straight line to that turret and is deliberately not
    // clamped by `safely()` (it has to be: a bot has to be able to cross a ring
    // to get home). So a bot the turret had shot below its retreat threshold
    // stopped disengaging and started walking home *through the guns*.
    // `drive-bot-discipline.mjs` planted a full-health bot 150px inside a ring
    // and watched it end up 228px inside one, dead.
    //
    // Getting out of the guns is not an alternative to going home, it is the
    // first leg of it: `escapePoint` is the shortest way out, and the retreat
    // resumes from there on the next tick.
    const tower = this.threateningTurret(view);
    if (tower && !this.divingAllowed(view, tower, target)) return 'DISENGAGE';

    if (this.recovering) {
      if (healthPct > RECOVER_HEALTH_PCT && manaPct > RECOVER_MANA_PCT) {
        this.recovering = false;
        this.headingHome = false;
      } else {
        // Being chased turns the trip into a real one: the turret is where a
        // healthy bot resets, and a hunted one keeps walking to the platform,
        // which restores 12% of health and mana every half second and is the
        // one place on the map an enemy champion will not follow it to.
        //
        // The latch is set by an enemy being *near*, and deliberately not by
        // the damage clock: one stray hit with nobody around should cost three
        // seconds of standing still, not a walk across the map when a
        // four-second channel would do the same job. It clears on arrival
        // rather than the moment the chaser drifts back out of
        // `RECALL_CLEAR_PX`, so a bot committed to the walk finishes it instead
        // of turning round between the two and arriving at neither.
        if (this.enemySeenNear(view, nowMs, RECALL_CLEAR_PX)) this.headingHome = true;
        if (this.headingHome && this.atOwnFountain()) this.headingHome = false;
        return this.atRetreatPoint() ? 'RECOVER' : 'RETREAT';
      }
    }

    const outnumbered = view.enemies.length - view.allies.length >= OUTNUMBERED_BY;
    if (
      healthPct < this.profile.retreatHealthPct ||
      (outnumbered && healthPct < OUTNUMBERED_HEALTH_PCT)
    ) {
      this.recovering = true;
      return 'RETREAT';
    }

    // An order already running outranks perception: `canKeep` has no vision
    // check, so the chase continues whatever the bot can currently see.
    //
    // A *champion* order, which the bare `basicAttack.target` stopped being the
    // moment PUSH landed: a pushing bot's standing order is usually a minion,
    // and reading the order alone would flip it into FIGHT on its first swing
    // at a wave — with `target` null, which is `maybeCast`'s cue to choose a
    // spell for nobody and empty the pool into a melee minion.
    // `killCredit === 'champion'` is the discriminator the codebase already
    // treats as authoritative (see CLAUDE.md); `instanceof` is not, because
    // `Pet` and a shadow-clone spell's own clone class both extend `Champion`.
    //
    // Both gated on `guardedByTurret`, and that gate is the point: it is the
    // same test `findAttackTarget` has always applied to *acquisition*, and
    // leaving it out here made the two halves of this layer contradict each
    // other. The posture said close in, `safely()` said no further, and the bot
    // paced the edge of the guns at 4Hz — reported from a real match, and
    // legible from across the screen as a machine. A champion this bot may not
    // walk to is not a fight; falling through sends it to its wave instead,
    // which is also what eventually earns it the dive.
    //
    // The standing order is tested against itself rather than against `target`:
    // they are often different champions, and a bot chasing a reachable one
    // must not be talked out of it by a second enemy sitting under a turret.
    // `maybeCast` still gets `target`, so a poke thrown from outside the ring
    // is untouched — this is about where the feet go.
    const order = this.owner.basicAttack?.target;
    if (order?.killCredit === 'champion' && !this.guardedByTurret(view, order)) return 'FIGHT';
    if (target && !this.guardedByTurret(view, target)) return 'FIGHT';
    // Gated the same way and for the same reason: a sighting under a turret
    // this bot may not dive is not somewhere to go. Without it the fall-through
    // from FIGHT lands here instead of on the wave, and the bot stands on the
    // keep-out line staring at the memory — which the seeded probe measured as
    // 189 of 240 samples in SEARCH, going nowhere.
    const memory = this.rememberedTarget(view, nowMs);
    if (memory && !this.guardedByTurret(view, memory.unit)) return 'SEARCH';
    if (this.assistableFocus(view)) return 'ENGAGE';
    // Below every way of answering "is there a champion to deal with" and above
    // wandering: decision 2 of the lane layer. A bot only farms when there is
    // nobody to fight.
    if (this.pushApproach(view, nowMs)) return 'PUSH';
    return 'ROAM';
  }

  /** Half the body, which is what a turret's reach has to cover to hit it. */
  private get bodyRadius(): number {
    return this.owner.stats.size.value / 2;
  }

  /**
   * The enemy turret whose guns this bot is standing in, nearest first.
   *
   * `view.enemyTurrets` and not `game.turrets`: the blackboard gathers them
   * inside the one pass it already makes over the object list, which is the
   * only full-list walk this layer is allowed (`TeamBlackboard.lanes.test.ts`).
   * Six buildings is a loop nobody has to think about.
   */
  threateningTurret(view: TeamView): Turret | null {
    let best: Turret | null = null;
    let bestAway = Number.POSITIVE_INFINITY;
    for (const turret of view.enemyTurrets) {
      if (!insideThreat(turret, this.owner.position, this.bodyRadius)) continue;
      const away = Math.hypot(
        turret.position.x - this.owner.position.x,
        turret.position.y - this.owner.position.y
      );
      if (away < bestAway) {
        bestAway = away;
        best = turret;
      }
    }
    return best;
  }

  /**
   * Whether standing in this turret's reach is currently worth it.
   *
   * Two ways, and only two:
   *
   * - **The kill is there.** A bot at healthy health, against a target one hit
   *   from dying, may take a turret shot for it. That is the dive, and it is
   *   the only reason to be under a building without an escort.
   * - **Our own wave is under it.** `Turret.findTarget` shoots minions before
   *   champions, so a wave standing under a turret is what makes the ground
   *   holdable — the same escort rule `findObjectiveTarget` already applies
   *   before it will let a bot hit the building, measured with the same
   *   constant. It stops counting the moment the building switches onto us:
   *   `Turret.findAllyAttacker` does exactly that as soon as the bot attacks a
   *   champion standing under it, and the ring the turret draws round itself
   *   plus a barrel pointing at the bot is what a human reads off the screen at
   *   the same moment.
   */
  divingAllowed(view: TeamView, turret: Turret, target: AttackableUnit | null): boolean {
    const healthPct = ratio(this.owner.stats.health.value, this.owner.stats.maxHealth.value);
    if (target && healthPct >= DIVE_HEALTH_PCT && effectiveHealth(target) <= DIVE_LETHAL_HEALTH) {
      return true;
    }
    if (this.turretIsHostile(turret)) return false;
    return this.waveEscorts(view, turret);
  }

  /**
   * Whether this building has had its barrel pointed at this bot lately.
   *
   * The live read is kept as well as the latch: a turret can switch onto a bot
   * between two think ticks, and waiting a quarter of a second to notice is a
   * quarter of a second of free shots.
   */
  private turretIsHostile(turret: Turret): boolean {
    if (turret.target === this.owner) return true;
    return this.nowMs < (this.turretHostileUntilMs.get(turret) ?? Number.NEGATIVE_INFINITY);
  }

  /**
   * Stamps every enemy turret currently shooting at this bot. One pass over the
   * six buildings the blackboard already gathered, once per decision.
   *
   * Deliberately here and not inside `divingAllowed`: that one is asked several
   * times a tick, by `forbiddenTurrets` on behalf of two different callers, and
   * a predicate that writes the state it reads answers differently depending on
   * how many times it has been asked.
   */
  private noteTurretFire(view: TeamView): void {
    for (const turret of view.enemyTurrets) {
      if (turret.target !== this.owner) continue;
      this.turretHostileUntilMs.set(turret, this.nowMs + TURRET_HOSTILE_MS);
    }
  }

  /** Whether this team's wave has reached the ground under `turret`. */
  private waveEscorts(view: TeamView, turret: Turret): boolean {
    for (const state of view.lanes.values()) {
      const front = state.frontier;
      if (!front) continue;
      const away = Math.hypot(front.x - turret.position.x, front.y - turret.position.y);
      if (away <= PUSH_TURRET_ESCORT_PX) return true;
    }
    return false;
  }

  /** The enemy turrets this bot has no business walking into right now. */
  private forbiddenTurrets(view: TeamView, target: AttackableUnit | null): Turret[] {
    const out: Turret[] = [];
    for (const turret of view.enemyTurrets) {
      if (!this.divingAllowed(view, turret, target)) out.push(turret);
    }
    return out;
  }

  /**
   * `to`, with the walk stopped at the first forbidden turret ring it crosses.
   *
   * The movement half of the rule. Its acquisition half is `guardedByTurret`,
   * and both are needed: `BasicAttackController.update` re-issues
   * `navigateTo(target)` every frame while an order is out of reach, so a
   * destination this method held back is overwritten sixty times a second by
   * the order the bot is still carrying.
   */
  private safely(view: TeamView, target: AttackableUnit | null, to: Vec2): Vec2 {
    return clampToSafeApproach(
      this.owner.position,
      to,
      this.forbiddenTurrets(view, target),
      this.bodyRadius,
      TURRET_KEEP_OUT_PX
    );
  }

  /**
   * Whether this bot may take a fight with `unit` at all.
   *
   * The public form of `guardedByTurret`, for the acquisition paths that do not
   * already hold a `TeamView`. There are three of them and only two used to ask:
   * `findAttackTarget` (the scan) and `decidePosture` (the posture). The third
   * is `AIChampion.takeDamage`, which hits back at whoever hit it — so a
   * champion standing under their own turret could simply poke a bot and have
   * it hand itself an attack order that `BasicAttackController` then walked
   * into the guns, every frame, with the scan and the posture both refusing the
   * same target on the same tick. Found by the seeded probe in
   * `drive-bot-discipline.mjs`, which no unit test had a shape for.
   */
  mayFight(unit: AttackableUnit): boolean {
    return !this.guardedByTurret(this.currentView(), unit);
  }

  /**
   * Whether picking a fight with `unit` means walking under a turret.
   *
   * Acquisition only, the same boundary vision keeps: an order already running
   * is dropped by the posture layer rather than here, and damage is never
   * gated. A turret the bot is *already* inside is skipped — it is not a reason
   * to refuse the fight the bot is in, it is a reason to leave, which is
   * DISENGAGE's job.
   */
  private guardedByTurret(view: TeamView, unit: AttackableUnit): boolean {
    const bodyRadius = this.bodyRadius;
    for (const turret of this.forbiddenTurrets(view, unit)) {
      if (insideThreat(turret, this.owner.position, bodyRadius)) continue;
      if (insideThreat(turret, unit.position, bodyRadius, TURRET_KEEP_OUT_PX)) return true;
    }
    return false;
  }

  /**
   * Where a push should actually walk, or `null` when it cannot walk anywhere.
   *
   * `pushTarget` answers with the objective; this answers with the part of it
   * the bot is allowed to reach, and that difference is a deadlock if nobody
   * asks for it. Once the lane's wave is dead, `pushTarget` names the enemy
   * turret itself, `safely` holds the walk at the keep-out line — and from the
   * moment the bot is standing on that line the clamp's answer *is* its own
   * position. It re-issued a walk to its own feet four times a second and
   * stood in the jungle beside the lane until something else happened to it.
   * Reported from a real match, and the direct cost of fixing the *pacing*
   * version of the same standoff: refusing the inward step turned an
   * oscillation into a parking space.
   *
   * The two cases the clamp cannot tell apart on its own are separated here.
   * Having *arrived* at a frontier is not a deadlock — the wave is right there
   * and `findObjectiveTarget` has something to swing at — so the give-up only
   * fires when a turret actually shortened the walk and what is left of it is
   * nothing.
   */
  pushApproach(view: TeamView, nowMs: number): Vec2 | null {
    const front = this.pushTarget(view);
    if (!front) return null;

    const stop = this.safely(view, null, front);
    // Nothing got in the way, so the lane is open however far off the objective
    // is — and a bot that had given this lane up gets it back here, which is
    // what makes the latch below expire on the wave arriving rather than on a
    // clock nobody is watching.
    if (Math.hypot(stop.x - front.x, stop.y - front.y) <= 1) {
      this.pushBlockedUntilMs = Number.NEGATIVE_INFINITY;
      return stop;
    }

    if (nowMs < this.pushBlockedUntilMs) return null;

    const gain = Math.hypot(stop.x - this.owner.position.x, stop.y - this.owner.position.y);
    if (gain >= PUSH_PROGRESS_PX) return stop;

    this.pushBlockedUntilMs = nowMs + PUSH_BLOCKED_MS;
    return null;
  }

  /**
   * Where the front of this bot's lane is, or `null` if it has no lane.
   *
   * Three answers in order of how much they are worth walking to: our own wave,
   * because standing with it is what makes it win; the next enemy turret, which
   * is what the wave is for; and failing both, the last lane waypoint before
   * the enemy fountain, which is where a bot with an empty lane should be
   * heading. Never the fountain itself — see `laneApproach`.
   */
  pushTarget(view: TeamView): Vec2 | null {
    const lane = view.laneAssignments.get(this.owner);
    if (lane === undefined) return null;

    const state = view.lanes.get(lane);
    if (state?.frontier) return state.frontier;

    const turret = state?.nextEnemyTurret;
    if (turret && !turret.isDead && !turret.toRemove) {
      return { x: turret.position.x, y: turret.position.y };
    }
    return laneApproach(lane, this.owner.teamId);
  }

  /** The freshest sighting this tier still remembers. */
  rememberedTarget(view: TeamView, nowMs: number): SeenEnemy | null {
    let best: SeenEnemy | null = null;
    for (const entry of view.memory.values()) {
      if (entry.unit.isDead || entry.unit.toRemove) continue;
      if (nowMs - entry.atMs > this.profile.memoryTtlMs) continue;
      // The memory is TEAM-wide: `TeamBlackboard` writes an entry when any ally
      // can see the enemy. Without a distance bound a bot in one lane abandons
      // what it is doing to investigate a sighting its teammate made across the
      // map, every tick.
      const away = Math.hypot(
        entry.pos.x - this.owner.position.x,
        entry.pos.y - this.owner.position.y
      );
      if (away > SEARCH_MAX_DISTANCE_PX) continue;
      if (!best || entry.atMs > best.atMs) best = entry;
    }
    return best;
  }

  /**
   * Where the remembered enemy probably is now: last seen position, carried
   * forward along the heading it was taking, capped so an old memory points at
   * a plausible spot rather than at the far wall.
   */
  searchPoint(entry: SeenEnemy, nowMs: number): Vec2 {
    const frames = Math.max(0, nowMs - entry.atMs) / FRAME_MS;
    let dx = entry.vel.x * frames;
    let dy = entry.vel.y * frames;
    const lead = Math.hypot(dx, dy);
    if (lead > SEARCH_MAX_LEAD_PX) {
      // `shrink`, not `scale`: `scale` is a p5 global. See CLAUDE.md.
      const shrink = SEARCH_MAX_LEAD_PX / lead;
      dx *= shrink;
      dy *= shrink;
    }
    return { x: entry.pos.x + dx, y: entry.pos.y + dy };
  }

  private assistableFocus(view: TeamView): Champion | null {
    const focus = view.focusTarget;
    if (!focus) return null;
    for (const ally of view.allies) {
      if (ally === this.owner) continue;
      const dx = focus.position.x - ally.position.x;
      const dy = focus.position.y - ally.position.y;
      if (Math.hypot(dx, dy) <= ASSIST_RANGE) return focus;
    }
    return null;
  }

  /**
   * Where a retreat is aimed: the nearest living friendly turret, else the team
   * fountain — **unless** the bot has been driven past wanting a turret, in
   * which case it is the platform. See the `headingHome` latch in
   * `decidePosture`.
   */
  retreatPoint(): Vec2 | null {
    const game = this.owner.game as {
      turrets?: { teamId?: unknown; isDead?: boolean; position: Vec2 }[];
      fountains?: { teamId?: unknown; position: Vec2 }[];
    };
    if (this.headingHome) {
      const home = this.homeFountain();
      if (home) return { x: home.position.x, y: home.position.y };
    }
    let best: Vec2 | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const turret of game.turrets ?? []) {
      if (turret.teamId !== this.owner.teamId || turret.isDead) continue;
      const distance = Math.hypot(
        turret.position.x - this.owner.position.x,
        turret.position.y - this.owner.position.y
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { x: turret.position.x, y: turret.position.y };
      }
    }
    if (best) return best;
    const fountain = (game.fountains ?? []).find(one => one.teamId === this.owner.teamId);
    return fountain ? { x: fountain.position.x, y: fountain.position.y } : null;
  }

  /** This team's restore platform, or `null` in a headless or FFA context. */
  private homeFountain(): { position: Vec2; radius: number } | null {
    const game = this.owner.game as {
      fountains?: { teamId?: unknown; radius?: number; position: Vec2 }[];
    };
    for (const fountain of game.fountains ?? []) {
      if (fountain.teamId !== this.owner.teamId) continue;
      return { position: fountain.position, radius: fountain.radius ?? 0 };
    }
    return null;
  }

  /** Standing on it, i.e. actually being restored rather than merely near it. */
  private atOwnFountain(): boolean {
    const home = this.homeFountain();
    if (!home) return false;
    const away = Math.hypot(
      home.position.x - this.owner.position.x,
      home.position.y - this.owner.position.y
    );
    return away <= home.radius;
  }

  private atRetreatPoint(): boolean {
    // The platform counts, and it has to: `retreatPoint()` is the nearest
    // friendly *turret*, so a bot that has just recalled reads as not-yet-
    // arrived, flips back to RETREAT and walks out of the one place on the map
    // that restores it — 12% of health and mana every half second, against a
    // turret's regen of nothing at all.
    if (this.atOwnFountain()) return true;
    // `refuge`, not `point`: `point` is a p5 global in this project and a local
    // of the same name shadows it — see CLAUDE.md. Inert here, banned anyway.
    const refuge = this.retreatPoint();
    if (!refuge) return true; // nowhere to go: stand and recover where you are
    return (
      Math.hypot(refuge.x - this.owner.position.x, refuge.y - this.owner.position.y) <=
      RETREAT_ARRIVE_PX
    );
  }

  /** Injected so a test is deterministic. Never `random()` — that is a p5 global. */
  rng: () => number = Math.random;

  /**
   * Whether this spell fits inside the mana the bot is willing to spend now.
   *
   * The whole of the "cụt tay" fix: a bot used to fire whatever was off
   * cooldown until the pool was empty, then stand in a fight with nothing to
   * press. The reserve is only held while the ultimate could actually be cast —
   * mana saved for a spell on cooldown is mana thrown away.
   *
   * Priced through `effectiveManaCost`, so under URF's `manaFree` every cost is
   * 0 and the budget stops blocking anything, which is exactly right.
   */
  withinManaBudget(spell: Spell, mask: SpellRoleMask): boolean {
    if (hasRole(mask, SpellRole.Ultimate)) return true;
    const ultimate = this.owner.spells[ULTIMATE_SLOT];
    if (!ultimate?.isCastableNow) return true;
    const reserve = this.owner.stats.maxMana.value * this.profile.manaReservePct;
    return spell.effectiveManaCost <= this.owner.stats.mana.value - reserve;
  }

  /**
   * How far this spell can actually be thrown.
   *
   * **An undeclared range is not an infinite one.** It used to read as
   * `+Infinity`, and three things followed from that in one expression: the
   * out-of-reach skip in `scoreSpell` never fired, `Zone`'s bonus was granted
   * unconditionally (`Infinity <= Infinity`), and `aimFor` passed no `maxRange`
   * so `predictAim` never clamped. `Flash` is the concrete case — `POINT`, no
   * declared range, `manaCost` 100, so `inferRoles` calls it
   * `Damage | Zone | Burst`, which scores 18 with a target and 32 against a
   * wounded one against a typical Q's 10-16. Every bot carries it, so a bot's
   * best combat spell was blinking at whatever it could see, on cooldown. 27
   * other `POINT`/`DIRECTION` spells declare no range either.
   *
   * `profile.aggroRange` is the honest stand-in: it is already the furthest
   * this tier was willing to acquire a target at.
   */
  private reachOf(spell: Spell, target: AttackableUnit | null): number {
    const declared = spell.declaredRange;
    return declared === undefined
      ? this.profile.aggroRange
      : effectiveRange(declared, this.owner, target);
  }

  scoreSpell(
    spell: Spell,
    slotIndex: number,
    mask: SpellRoleMask,
    target: AttackableUnit | null,
    view: TeamView
  ): number {
    void slotIndex;
    const healthPct = ratio(this.owner.stats.health.value, this.owner.stats.maxHealth.value);
    const distance = target
      ? Math.hypot(
          target.position.x - this.owner.position.x,
          target.position.y - this.owner.position.y
        )
      : Number.POSITIVE_INFINITY;
    const knownReach = spell.declaredRange !== undefined;
    const inReach = distance <= this.reachOf(spell, target);

    // A spell that cannot reach is not worth scoring — unless closing the gap
    // is the thing it does.
    if (target && !inReach && !hasRole(mask, SpellRole.Dash)) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (hasRole(mask, SpellRole.Damage) && target) score += SCORE_DAMAGE;
    // `&& target` is load-bearing: `distance` is +Infinity with no target, which
    // satisfies the reach test, so without it a roaming bot scores a poke at 6,
    // wins its own selection, and fires skillshots into empty ground on cooldown.
    // `inferRoles` tags every DIRECTION/POINT spell of range >= 400 as Poke, so
    // that is a large share of the roster.
    if (target && hasRole(mask, SpellRole.Poke) && distance > this.owner.stats.attackRange.value) {
      score += SCORE_POKE;
    }
    if (hasRole(mask, SpellRole.Burst) && target && effectiveHealth(target) < BURST_TARGET_HEALTH) {
      score += SCORE_BURST;
    }
    if (hasRole(mask, SpellRole.Cc) && target && target === view.focusTarget) score += SCORE_CC;
    if (hasRole(mask, SpellRole.Heal) || hasRole(mask, SpellRole.Shield)) {
      score += healthPct < SUPPORT_HEALTH_PCT ? SCORE_SUPPORT : SCORE_SUPPORT_WASTED;
    }
    if (hasRole(mask, SpellRole.Escape)) {
      score += this.posture === 'RETREAT' ? SCORE_ESCAPE : SCORE_ESCAPE_WASTED;
    }
    if (hasRole(mask, SpellRole.Dash)) {
      score += target && !inReach ? SCORE_DASH_GAPCLOSE : SCORE_DASH_WASTED;
    }
    if (hasRole(mask, SpellRole.Buff)) score += SCORE_BUFF;
    // `knownReach`: a spell that declares no range has none of the area this
    // bonus is paid for — the reach above it was measured against is a guess
    // (`profile.aggroRange`), and a guess must not earn a bonus. Before, every
    // range-less spell collected it, because `Infinity <= Infinity`.
    if (hasRole(mask, SpellRole.Zone) && inReach && knownReach) score += SCORE_ZONE;
    if (hasRole(mask, SpellRole.Ultimate)) score += SCORE_ULTIMATE;

    // The randomness, and the only place it lives.
    //
    // Symmetric about 1 — range [1-noise, 1+noise] — and that is the whole
    // point. An always->=1 multiplier is ranking-NEUTRAL: a factor common to
    // every candidate cancels, so only the spread matters. Under `1 + u*n` a
    // lower-scoring spell displaces a higher one only when
    // `base(B) > base(A) / (1 + n)` — a 1.9x band at easy and 1.2x at hard —
    // so the easy tier got a faintly jittered copy of the hard tier's ranking
    // rather than odd-but-legal choices. Symmetric widens that band to 19x at
    // easy and 1.5x at hard, which is the graded behaviour the tier table is
    // written for.
    //
    // Every shipped `noise` is < 1, so the multiplier never reaches 0 and a
    // negative score stays negative: the `score <= 0` filter below is unaffected.
    return score * (1 + (this.rng() * 2 - 1) * this.profile.noise);
  }

  /**
   * `retreating` narrows the kit to what a bot running away may press — the
   * three axes of `isRetreatCandidate`, not the role mask alone. Left false,
   * every castable spell is a candidate, which is every other posture.
   */
  chooseSpell(
    target: AttackableUnit | null,
    view: TeamView,
    mode: CastMode = 'FREE'
  ): SpellChoice | null {
    let best: SpellChoice | null = null;
    // From 1: slot 0 is the basic attack, which is the attack controller's job.
    for (let slotIndex = 1; slotIndex < this.owner.spells.length; slotIndex++) {
      const spell = this.owner.spells[slotIndex];
      if (!spell?.isCastableNow) continue;
      const mask = rolesOf(spell, slotIndex);
      if (mode === 'RETREAT' && !isRetreatCandidate(spell, mask)) continue;
      if (mode === 'WAVE' && !isWaveClearCandidate(mask)) continue;
      if (!target && !isTargetlessCandidate(spell, mask)) continue;
      if (!this.withinManaBudget(spell, mask)) continue;
      const score = this.scoreSpell(spell, slotIndex, mask, target, view);
      if (score <= 0 || !Number.isFinite(score)) continue;
      if (!best || score > best.score) best = { spell, slotIndex, mask, score };
    }
    return best;
  }

  /**
   * One area spell thrown at a position the bot can no longer see.
   *
   * This is the moment that reads as "it guessed where I went" — and the reason
   * `easy` sets `ghostCastWindowMs` to 0 rather than getting a smaller version.
   */
  chooseGhostSpell(entry: SeenEnemy, nowMs: number, aimPoint: Vec2): SpellChoice | null {
    // `windowMs`, not `window`: `window` is a global. See CLAUDE.md.
    const windowMs = this.profile.ghostCastWindowMs;
    if (windowMs <= 0 || nowMs - entry.atMs > windowMs) return null;

    const away = Math.hypot(aimPoint.x - this.owner.position.x, aimPoint.y - this.owner.position.y);

    for (let slotIndex = 1; slotIndex < this.owner.spells.length; slotIndex++) {
      const spell = this.owner.spells[slotIndex];
      if (!spell?.isCastableNow) continue;
      const mask = rolesOf(spell, slotIndex);
      if (!hasRole(mask, SpellRole.Zone) && !hasRole(mask, SpellRole.Poke)) continue;
      // Never the ultimate. An area spell at a half-second-old position is a
      // fair read; the one cooldown a bot cannot afford to spend on a position
      // that may already be empty is this one, and a wasted R is exactly what
      // reads as a bot flailing rather than as one guessing well.
      if (hasRole(mask, SpellRole.Ultimate)) continue;
      if (!this.withinManaBudget(spell, mask)) continue;
      // The same reach discipline `scoreSpell` applies, through the same helper.
      // Without it a bot throws a 300-range zone at a point 2000px away and pays
      // the mana for it — and an *undeclared* range is not an unlimited one, the
      // ruling `reachOf` already makes for `scoreSpell` and `aimFor`. It bites
      // hardest here: `inferRoles` calls every range-less `POINT` spell
      // `Damage | Zone`, so all of them (23, plus `Flash`) are candidates on this
      // path, the aim can sit `SEARCH_MAX_DISTANCE_PX + SEARCH_MAX_LEAD_PX` out,
      // and nothing clamps it because the ghost cast does not go through
      // `aimFor`. A bot summoned Tibbers at a guessed point 1200px away.
      if (away > this.reachOf(spell, null)) continue;
      return { spell, slotIndex, mask, score: SCORE_ZONE };
    }
    return null;
  }

  /**
   * Called every frame. Only the charge tick runs every frame; the decision
   * runs four times a second, which is the whole performance story: the code
   * this replaces rolled `random() < 0.1` sixty times a second per bot.
   */
  update(nowMs: number, deltaMs: number): void {
    this.nowMs = nowMs;
    // Deliberately not a `return` the way a charge is. A charge is a key held
    // down and owns the frame; a recast window is the spell being ACTIVE, which
    // the bot is free to think and move through.
    this.advanceRecast(nowMs);
    if (this.advanceCharge(deltaMs)) return;
    if (nowMs - this.lastThinkAtMs < THINK_INTERVAL_MS) return;
    this.lastThinkAtMs = nowMs;
    this.think(nowMs);
  }

  private think(nowMs: number): void {
    const owner = this.owner;
    if (owner.isDead) return;

    const view = this.currentView();
    // One `pickTarget` per tick. It used to run twice — here and again inside
    // `decidePosture` — and at `easy` each pass costs a `canSee` raycast per
    // living enemy.
    const target = this.pickTarget(view);
    const posture = this.evaluatePosture(view, nowMs, target);

    if (owner._autoMove) this.drive(posture, view, target, nowMs);
    // Going home is a movement decision, not a cast one, whatever the trip is
    // implemented as: a bot the panel has parked stays where it was parked.
    if (owner._autoMove) this.manageRecall(posture, view, nowMs);
    if (owner._autoCast) this.maybeCast(posture, view, target, nowMs);
  }

  /**
   * The movement half of a think tick. Not `private`: it is one of the two
   * things a posture actually *does*, and the suites drive it directly rather
   * than through a whole match.
   */
  drive(posture: Posture, view: TeamView, target: Champion | null, nowMs: number): void {
    const owner = this.owner;
    // See `castWouldBreakOnMove`: the bot used to cancel its own cast by walking.
    if (this.castWouldBreakOnMove()) return;
    switch (posture) {
      case 'RETREAT': {
        // A standing attack order out-drives everything below it:
        // `BasicAttackController.update` re-issues `navigateTo(target)` every
        // frame while the target is out of reach, and plants the bot with
        // `stopMovement()` while it is in reach. So a retreating bot that still
        // held an order simply stayed and traded — the retreat was a posture
        // nobody could see. Leaving is a decision to stop fighting, and this is
        // where it gets said.
        owner.basicAttack?.clear();
        // `refuge`, not `point`: `point` is a p5 global. See CLAUDE.md.
        const refuge = this.retreatPoint();
        if (refuge) owner.navigateTo(refuge.x, refuge.y);
        return;
      }
      case 'RECOVER':
        owner.basicAttack?.clear();
        owner.stopMovement();
        return;
      case 'DISENGAGE': {
        owner.basicAttack?.clear();
        const tower = this.threateningTurret(view);
        if (!tower) return;
        // Straight back out of the guns, which is the shortest way there is.
        const out = escapePoint(tower, owner.position, this.bodyRadius, TURRET_KEEP_OUT_PX);
        owner.navigateToWalkable(out.x, out.y);
        return;
      }
      case 'FIGHT': {
        if (!target) return;
        const held = this.safely(view, target, target.position);
        if (held.x !== target.position.x || held.y !== target.position.y) {
          // The target is standing somewhere this bot may not follow. Dropping
          // the order is not optional: the attack controller owns the walking
          // while one is out, and it has never heard of a turret.
          owner.basicAttack?.clear();
          owner.navigateTo(held.x, held.y);
          return;
        }
        const step = this.kiteStep(view, target);
        if (step) {
          // The other half of the step, without which the attack controller
          // plants the bot again on the very next frame. See `kiteStep`.
          if (owner.basicAttack) owner.basicAttack.repositionMs = KITE_WINDOW_MS;
          owner.navigateTo(step.x, step.y);
          return;
        }
        // The attack order owns the walking while it has one; only step in when
        // there is a target but no order, which is the frame before one is given.
        if (!owner.basicAttack?.target) owner.navigateTo(held.x, held.y);
        return;
      }
      case 'SEARCH': {
        const entry = this.rememberedTarget(view, nowMs);
        if (!entry) return;
        const hunch = this.safely(view, target, this.searchPoint(entry, nowMs));
        owner.navigateTo(hunch.x, hunch.y);
        return;
      }
      case 'ENGAGE':
        if (view.focusTarget) {
          const toward = this.safely(view, view.focusTarget, view.focusTarget.position);
          owner.navigateTo(toward.x, toward.y);
        }
        return;
      case 'PUSH': {
        // As in FIGHT: an order already running owns the walking, and stepping
        // in would fight the attack controller for the destination every tick.
        if (owner.basicAttack?.target) return;
        // The single most visible symptom this layer was written for.
        // `pushTarget` answers with the enemy turret's own coordinates once the
        // lane holds no friendly wave, and this used to walk to them — while
        // `findObjectiveTarget`, which does have an escort rule, handed the bot
        // nothing to shoot. It stood in the guns, attacking nothing, and died.
        //
        // `pushApproach`, not `pushTarget`: the same helper the posture asked,
        // so the two can never disagree about whether this lane is walkable.
        // `stop`, not `line` — `line` is a p5 global. See CLAUDE.md.
        const stop = this.pushApproach(view, nowMs);
        if (!stop) return;
        owner.navigateTo(stop.x, stop.y);
        return;
      }
      default: {
        // ROAM: hang around the team rather than crossing the map alone.
        if (owner.position.dist(owner.destination) >= owner.moveSpeed) return;
        const anchor = view.rally ?? this.retreatPoint();
        if (!anchor) {
          // Clamped like every other walk here. This was the one branch in
          // `drive` that reached the world directly, and it only ever ran when
          // a bot had nowhere in particular to be — which is exactly the state
          // a bot that has just given its lane up is in. It wandered into the
          // guns it had spent the last two seconds walking out of.
          const roll = this.safely(view, null, {
            x: this.rng() * owner.game.mapSize,
            y: this.rng() * owner.game.mapSize,
          });
          owner.navigateToWalkable(roll.x, roll.y);
          return;
        }
        const angle = this.rng() * Math.PI * 2;
        const radius = this.rng() * ROAM_RADIUS;
        const wander = this.safely(view, null, {
          x: anchor.x + Math.cos(angle) * radius,
          y: anchor.y + Math.sin(angle) * radius,
        });
        owner.navigateToWalkable(wander.x, wander.y);
      }
    }
  }

  /**
   * The trip home: opened in RECOVER, dropped the moment RECOVER ends.
   *
   * RECOVER is where a hurt bot spends most of its time, and what it used to do
   * there was stand at its own turret waiting on health regen — a minute of a
   * bot that reads as switched off. The platform restores 12% of health and
   * mana every half second, so the same recovery takes about four seconds plus
   * the channel. `Recall` is `SpellForm.HELD`, so this can only be pressed once
   * the bot has actually stopped: RETREAT is still walking, and a channel
   * opened there would be cancelled by the bot's own next step, every tick, for
   * the whole way home.
   *
   * Cancelled rather than left running when the posture changes, because the
   * posture may have changed for a reason the interrupt table cannot see — a
   * heal landing and the bot being fit to play again is not a move, a stun or a
   * hit.
   */
  private manageRecall(posture: Posture, view: TeamView, nowMs: number): void {
    const recall = this.owner.recall;
    if (!recall) return;

    const wanted =
      posture === 'RECOVER' &&
      !this.atOwnFountain() &&
      this.homeFountain() !== null &&
      this.safeToRecall(view, nowMs);
    if (!wanted) {
      if (recall.state === 'CASTING' || recall.state === 'CHANNELING') {
        recall.cancel('PLAYER_CANCEL');
      }
      return;
    }
    if (!recall.isCastableNow) return;
    const context = this.contextFor(recall, this.fallbackAim());
    if (context) recall.press(context);
  }

  /**
   * One step back, for a bot whose next swing is not ready yet.
   *
   * The whole of kiting: a ranged champion's damage arrives in beats and the
   * gap between two of them is free, so standing in it is throwing away the
   * only thing range buys. Melee gets nothing here — closing is already what
   * the attack controller does, and a melee bot that backed off would simply
   * never land a hit.
   *
   * The step stays inside `KITE_HOLD_PCT` of the attack's own reach, because
   * `BasicAttackController.update` chases anything further out: a step past the
   * line is undone on the next frame and reads as a bot vibrating in place.
   */
  private kiteStep(view: TeamView, target: AttackableUnit): Vec2 | null {
    const owner = this.owner;
    const attack = owner.basicAttack;
    if (!attack || attack.target !== target) return null;
    if (owner.stats.attackRange.value <= MELEE_RANGE_THRESHOLD) return null;
    // About to swing: planting and firing beats another step back.
    if (attack.cooldownMs <= KITE_COMMIT_MS) return null;

    const hold = attack.reachTo(target) * KITE_HOLD_PCT;
    const dx = owner.position.x - target.position.x;
    const dy = owner.position.y - target.position.y;
    const away = Math.hypot(dx, dy);
    if (away >= hold) return null;

    // A direction must never be (0,0) — `Game.facing()`'s convention.
    const towardX = away > 0.01 ? dx / away : 1;
    const towardY = away > 0.01 ? dy / away : 0;
    const step = Math.min(KITE_STEP_PX, hold - away);
    return this.safely(view, target, {
      x: owner.position.x + towardX * step,
      y: owner.position.y + towardY * step,
    });
  }

  private maybeCast(
    posture: Posture,
    view: TeamView,
    target: Champion | null,
    nowMs: number
  ): void {
    if (nowMs - this.lastCastAtMs < this.profile.castIntervalMs) return;

    if (posture === 'SEARCH') {
      const entry = this.rememberedTarget(view, nowMs);
      if (!entry) return;
      // The aim is computed first and handed to both: `chooseGhostSpell` gates
      // on whether the spell can actually reach that point, so it has to see
      // the same point the cast will use.
      const aim = this.searchPoint(entry, nowMs);
      const ghost = this.chooseGhostSpell(entry, nowMs, aim);
      if (ghost) this.cast(ghost, aim, nowMs, null);
      return;
    }
    if (posture === 'PUSH') {
      this.castOnWave(view, nowMs);
      return;
    }
    // A bot running away still casts — but only what helps it leave. See
    // `RETREAT_ROLES`: without this branch the `SCORE_ESCAPE` and
    // `SCORE_SUPPORT` rows were both unreachable in a running match.
    const running = isLeavingPosture(posture);
    if (!running && posture !== 'FIGHT' && posture !== 'ENGAGE') return;

    const choice = this.chooseSpell(target, view, running ? 'RETREAT' : 'FREE');
    if (!choice) return;
    this.cast(choice, this.aimFor(choice, target), nowMs, target);
  }

  /**
   * One ability into the wave, for a bot with nobody to fight and mana to spare.
   *
   * PUSH used to press nothing: `maybeCast` returned unless the posture was
   * FIGHT, ENGAGE, SEARCH or one of the running ones — and a quiet match is
   * mostly PUSH. So a bot walked at the wave and plinked it with autoattacks
   * while four abilities sat off cooldown, which is a large part of why the
   * whole layer read as *less* alive than the version that sprayed spells at
   * the player's cursor sixty times a second.
   *
   * How much mana a bot keeps back before it will do this is a *tier* knob
   * (`DifficultyProfile.waveClearManaPct`), not one number for every bot:
   * clearing a wave with abilities is a mechanic a better player has, so an
   * easy bot hoards at 85% where a hard one spends down to 45%.
   *
   * Minions only, deliberately. `findObjectiveTarget` also answers with the
   * enemy turret once our wave escorts one, and a building neither dodges nor
   * cares which ability hits it — spending a cooldown on it buys nothing the
   * basic attack does not.
   */
  private castOnWave(view: TeamView, nowMs: number): void {
    const manaPct = ratio(this.owner.stats.mana.value, this.owner.stats.maxMana.value);
    if (manaPct < this.profile.waveClearManaPct) return;

    const objective = this.findObjectiveTarget(view);
    if (!(objective instanceof Minion)) return;

    const choice = this.chooseSpell(objective, view, 'WAVE');
    if (!choice) return;
    this.cast(choice, this.aimFor(choice, objective), nowMs, objective);
  }

  /** Where this spell should point. The replacement for the player's cursor. */
  private aimFor(choice: SpellChoice, target: AttackableUnit | null): Vec2 {
    const owner = this.owner;
    if (!target) return this.fallbackAim();
    if (choice.spell.castSpec.targeting === 'UNIT' || choice.spell.castSpec.targeting === 'SELF') {
      // The resolver picks the body; pointing at it is all this has to do.
      return { x: target.position.x, y: target.position.y };
    }
    const Ctor = choice.spell.constructor as { aiProjectileSpeed?: number };
    return predictAim(owner.position, target, {
      leadFactor: this.profile.leadFactor,
      aimErrorPx: this.profile.aimErrorPx,
      projectileSpeed: Ctor.aiProjectileSpeed ?? DEFAULT_PROJECTILE_SPEED,
      // Always a number now. `undefined` here meant "do not clamp", which is
      // what let a range-less spell be aimed anywhere on the map — see `reachOf`.
      maxRange: this.reachOf(choice.spell, target),
      rng: this.rng,
    });
  }

  /**
   * Where to point when there is no target — a self-buff, or a spell cast in
   * ENGAGE before anyone is in reach.
   *
   * `Game.facing()`'s rule restated for a bot: body heading, then a fixed
   * vector, and never the caster's own position. Returning the position itself
   * gives `TargetResolver` a zero direction, which every consumer multiplies by
   * a range to get a dot at the caster's feet.
   */
  private fallbackAim(): Vec2 {
    const owner = this.owner;
    const dx = owner.destination.x - owner.position.x;
    const dy = owner.destination.y - owner.position.y;
    const length = Math.hypot(dx, dy);
    if (length > 0.01) {
      return {
        x: owner.position.x + (dx / length) * FALLBACK_AIM_PX,
        y: owner.position.y + (dy / length) * FALLBACK_AIM_PX,
      };
    }
    return { x: owner.position.x + FALLBACK_AIM_PX, y: owner.position.y };
  }

  private cast(choice: SpellChoice, aim: Vec2, nowMs: number, target: AttackableUnit | null): void {
    const context = this.contextFor(choice.spell, aim);
    if (!context || !choice.spell.press(context)) return;
    this.lastCastAtMs = nowMs;

    const castSpec = choice.spell.castSpec;
    if (isChargeActivation(castSpec.activation)) {
      this.pendingCharge = {
        spell: choice.spell,
        context,
        elapsedMs: 0,
        releaseAtMs: requireChargeSpec(castSpec).maxDurationMs / 2,
      };
      return;
    }

    if (castSpec.activation !== 'RECAST') return;
    // `recasts` defaults to 1 in the runtime, which is every recast spell here
    // bar the four-round ultimate: a detonation spell detonates, a slash lands, a second dash goes a second
    // time and that is the end of it.
    const remaining = castSpec.active?.recasts ?? 1;
    if (remaining < 1) return;
    const delayMs = castSpec.active?.recastDelayMs ?? 0;
    this.pendingRecast = {
      choice,
      context,
      target,
      remaining,
      delayMs,
      nextAtMs: nowMs + delayMs,
    };
  }

  /**
   * Sends the next press a recast ability is owed.
   *
   * The runtime owns the window — a max duration lapsing, a cancel, and the last
   * recast all end it — so anything but `ACTIVE` means there is nothing left to
   * press into and the follow-through is dropped rather than counted down.
   *
   * `castIntervalMs` deliberately does not apply. That knob rate-limits a bot
   * *deciding* to cast; finishing an ability already on screen is not a second
   * decision, and gating it would leave the four-round ultimate's later rounds unfired at easy.
   */
  private advanceRecast(nowMs: number): void {
    const pending = this.pendingRecast;
    if (!pending) return;
    if (this.owner.isDead || pending.choice.spell.state !== 'ACTIVE') {
      this.pendingRecast = undefined;
      return;
    }
    if (nowMs < pending.nextAtMs) return;

    const aim =
      pending.target && !pending.target.isDead
        ? this.aimFor(pending.choice, pending.target)
        : pending.context.cursorWorld;
    const context = this.contextFor(pending.choice.spell, aim) ?? pending.context;
    pending.context = context;
    pending.choice.spell.press(context);

    pending.remaining -= 1;
    if (pending.remaining < 1) {
      this.pendingRecast = undefined;
      return;
    }
    pending.nextAtMs = nowMs + pending.delayMs;
  }

  /**
   * Whether a fresh move order would cancel one of this bot's own casts.
   *
   * `drive()` re-issues `navigateTo` every think tick and `navigateTo` bumps
   * `movementRevision`, which `CancelPolicy` reads as `'MOVE'` — cancelled by the
   * default `SpellForm.HELD`. The think interval is 250ms, so every ability with
   * a cast time at or above it died mid-cast, ten of them on the shipped roster:
   * one ultimate at 1000ms down to another ability at 250. Following an existing route is
   * fine and stays allowed — only a *new* order bumps the counter.
   *
   * The basic attack is exempt by `attackOrder: 'keep'`, the marker for the one
   * spell where casting *is* the order. Without that check a bot mid-swing would
   * read as mid-cast and stand still for the rest of the match.
   */
  private castWouldBreakOnMove(): boolean {
    for (const spell of this.owner.spells) {
      if (!spell) continue;
      if (spell.state !== 'CASTING' && spell.state !== 'CHANNELING') continue;
      const spec = spell.castSpec;
      if (spec.attackOrder === 'keep') continue;
      if (resolveInterrupts(spec.interrupts).move) return true;
    }
    return false;
  }

  private contextFor(spell: Spell, aim: Vec2): CastContext | undefined {
    const game = this.owner.game;
    if (typeof game.createSpellContext === 'function') {
      return game.createSpellContext(spell, this.owner, aim);
    }
    const result = TargetResolver.resolve(spell.castSpec.targeting, {
      spellId: spell.id,
      activationId: uuidv4(),
      startedAtMs: Date.now(),
      caster: this.owner,
      casterTeamId: this.owner.teamId,
      origin: this.owner.position,
      cursorWorld: aim,
      ...spell.targetingRequest,
    });
    return result.ok ? result.context : undefined;
  }

  /** True while a charged cast owns the frame. Moved here verbatim from `AIChampion`. */
  private advanceCharge(deltaMs: number): boolean {
    const pending = this.pendingCharge;
    if (!pending) return false;
    // A corpse does not finish a charge. The deleted `AIChampion` branch never
    // asked either, so a bot killed while holding one kept calling `hold` and
    // then `release` from the floor.
    if (this.owner.isDead) {
      this.pendingCharge = undefined;
      return false;
    }
    pending.elapsedMs += Math.max(0, deltaMs);
    const context = this.contextFor(pending.spell, pending.context.cursorWorld);
    if (context) {
      pending.context = context;
      pending.spell.hold(context);
    }
    if (pending.elapsedMs >= pending.releaseAtMs) {
      pending.spell.release(pending.context);
      this.pendingCharge = undefined;
    }
    return true;
  }

  /**
   * Whether this bot is currently getting out rather than getting stuck in.
   *
   * Read by `AIChampion.takeDamage`, which hits back at whoever hit it: a bot
   * walking out of a turret's reach that answers every shot with a fresh attack
   * order re-acquires the fight it is trying to leave, four times a second.
   */
  get isLeaving(): boolean {
    return isLeavingPosture(this.posture);
  }

  /** The quadtree scan, moved off `AIChampion` so perception has one home. */
  findAttackTarget(): Champion | null {
    const owner = this.owner;
    // A bot on its way out of a turret's guns is not shopping for a fight. The
    // posture layer clears the standing order, and without this the attack scan
    // — which runs on its own 250ms clock — simply hands it back.
    if (this.isLeaving) return null;
    // optional call for the same reason MissileSpellObject uses one: spell tests
    // hand in an object manager stub that only knows how to collect added objects
    const found =
      owner.game.objectManager.queryObjects?.({
        area: new Circle({
          x: owner.position.x,
          y: owner.position.y,
          r: this.profile.aggroRange,
        }),
        filters: [
          PredefinedFilters.type(Champion),
          PredefinedFilters.canTakeDamageFromTeam(owner.teamId),
          PredefinedFilters.excludeStealthed,
        ],
      }) ?? [];

    const view = this.currentView();
    let best: Champion | null = null;
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const candidate of found) {
      if (!(candidate instanceof Champion)) continue;
      if (!this.canPerceive(candidate)) continue;
      // Acquisition, not retention: an order already out is dropped by the
      // posture layer. Without this the bot orders an attack on a champion
      // standing under its own turret and the attack controller — which has
      // never heard of a building — walks it in.
      if (this.guardedByTurret(view, candidate)) continue;
      const score = this.scoreTarget(candidate, view);
      if (score > bestScore) {
        bestScore = score;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * What a *pushing* bot swings at when there is no champion to swing at.
   *
   * Deliberately a second, lower lookup rather than a widening of
   * `findAttackTarget`: that one answers the aggro question and stays champions
   * only, because an enemy champion in range always outranks farming (decision
   * 2 of this layer). This one is reachable only from PUSH, which
   * `decidePosture` places below every champion rule there is — so the priority
   * is expressed once, in the posture chain, rather than twice.
   *
   * Nearest enemy minion **in the bot's own lane**, else the lane's next
   * turret. The lane test is not cosmetic: a minion leashed off BOT and
   * standing beside a MID bot is a fight that drags it off its wave, and
   * `Minion.lane` is fixed at spawn so a straggler still answers honestly.
   *
   * A turret is only ever attacked with our own wave standing under it
   * (`PUSH_TURRET_ESCORT_PX`) and only from inside the tier's aggro range. A
   * bot that walks up to a building alone is a bot that feeds it.
   *
   * **This is the only entry point to PvE farming — lane creeps and jungle
   * camps alike — and it is gated on `posture === 'PUSH'`, which is
   * structurally unreachable with no lane assignment.** A laneless map
   * (Task 8, `lanes.ts`'s `setActiveLanes(undefined)`) is therefore not
   * merely lane-free: every jungle camp on it stands there forever untouched,
   * because nothing in the posture chain ever calls this. Correct scope for
   * that task — a laneless map today is the cheap half of the
   * battle-royale question, and its bots are expected to only ROAM/FIGHT.
   * The eventual battle-royale mode (a jungle map where everyone farms *and*
   * fights) will need PvE farming reachable from a posture other than PUSH —
   * `findObjectiveTarget` split from its lane test, or a second caller for
   * whichever posture that mode adds — not a fix here so much as a thing
   * this comment is here so it is not rediscovered the hard way.
   */
  findObjectiveTarget(from?: TeamView): AttackableUnit | null {
    // The posture test first, and only then the board: `AIChampion` calls this
    // on every attack scan, in every posture, and a default argument would ask
    // for a snapshot before finding out the answer is `null`.
    if (this.posture !== 'PUSH') return null;
    const view = from ?? this.currentView();
    const lane = view.laneAssignments.get(this.owner);
    if (lane === undefined) return null;

    const minion = this.nearestLaneMinion(lane);
    if (minion && !this.guardedByTurret(view, minion)) return minion;

    const state = view.lanes.get(lane);
    const turret = state?.nextEnemyTurret;
    if (!turret || turret.isDead || turret.toRemove || !turret.targetable) return null;

    const escort = state?.frontier;
    if (!escort) return null;
    if (
      Math.hypot(escort.x - turret.position.x, escort.y - turret.position.y) > PUSH_TURRET_ESCORT_PX
    ) {
      return null;
    }

    const owner = this.owner;
    const away = Math.hypot(
      turret.position.x - owner.position.x,
      turret.position.y - owner.position.y
    );
    return away <= this.profile.aggroRange ? turret : null;
  }

  /**
   * The nearest hostile minion walking `lane`, inside the tier's aggro radius.
   *
   * A quadtree query on a bounded radius, on the attack-scan clock — never a
   * walk of `objectManager.objects`, which is the blackboard's one pass and
   * nobody else's (`TeamBlackboard.lanes.test.ts` scans this directory for it).
   *
   * Terrain gates acquisition here the same way `canPerceive` gates it for a
   * champion, so `easy` can still be broken line of sight with and the other
   * two tiers pay nothing for the question.
   */
  private nearestLaneMinion(lane: string): Minion | null {
    const owner = this.owner;
    const found =
      owner.game.objectManager.queryObjects?.({
        area: new Circle({
          x: owner.position.x,
          y: owner.position.y,
          r: this.profile.aggroRange,
        }),
        filters: [
          PredefinedFilters.type(Minion),
          PredefinedFilters.canTakeDamageFromTeam(owner.teamId),
          PredefinedFilters.excludeStealthed,
        ],
      }) ?? [];

    let best: Minion | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of found) {
      if (!(candidate instanceof Minion)) continue;
      if (candidate.lane !== lane) continue;
      if (!this.sees(owner, candidate)) continue;
      const away = Math.hypot(
        candidate.position.x - owner.position.x,
        candidate.position.y - owner.position.y
      );
      if (away < bestDistance) {
        bestDistance = away;
        best = candidate;
      }
    }
    return best;
  }

  /**
   * This bot's team's snapshot, dated from the clock `update` last wrote.
   *
   * One helper because three callers need it on three different clocks —
   * `think` runs on the brain's tick, `findAttackTarget` and
   * `findObjectiveTarget` on `AIChampion`'s scan interval, which is not the
   * same one. `blackboardFor` rebuilds at most once per `BLACKBOARD_TTL_MS`
   * whoever asks, so the extra calls cost a map lookup.
   */
  private currentView(): TeamView {
    return blackboardFor(this.owner.game as BlackboardHost, this.nowMs).viewFor(this.owner.teamId);
  }
}

export default BotBrain;
