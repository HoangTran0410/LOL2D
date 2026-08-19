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
import type AIChampion from '@/game/gameObject/attackableUnits/AIChampion';
import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';
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

export type Posture = 'RETREAT' | 'RECOVER' | 'FIGHT' | 'SEARCH' | 'ENGAGE' | 'PUSH' | 'ROAM';

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
 * so it always wins. `Zed_R` is exactly that shape — `SELF`, 50 mana, `range`
 * 500 — and it auto-locks the nearest enemy inside 500px and dashes *behind*
 * them. So a bot below its retreat threshold ulted into the champion chasing it,
 * where before the last wave it pressed nothing at all. `Warwick_R`,
 * `Nocturne_R` and `Diana_R` are the same shape.
 *
 * The `Shield` bit is therefore inference noise on every costed `SELF` cast, and
 * the retreat set cannot trust it alone. Two further axes separate a genuine
 * self-preservation spell from a self-cast engage tool, and both must hold:
 *
 * - **Not the ultimate slot.** That catches those four by construction.
 * - **Declares no range.** A real shield or heal reaches nobody; a `SELF` spell
 *   carrying a `declaredRange` reaches *out* to something, and Zed R's 500 is
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
   *   chased and cast at a champion holding `Untargetable` (Fizz E, a Zed
   *   shadow): the `UNIT` resolve fizzles and the skillshot is spent mana.
   * - **Range** is `profile.aggroRange`, at every tier. It is not vision's job:
   *   `canSee` applies no sight-radius cap on purpose (`Vision.ts:33`), because
   *   `Reach.ts` owns range and a 500px cap here once trimmed Warwick R to 500
   *   from its authored 550. And it is emphatically not
   *   `AttackableUnit.visionRadius`, which is a lerped animation value written
   *   every frame from 0 upward, not a constant.
   * - **Stealth** blocks at every tier. `seesThroughTerrain` does not reveal it.
   * - **Terrain and bushes** block only when `!seesThroughTerrain` — `easy`.
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

    return this.profile.seesThroughTerrain || this.sees(this.owner, target);
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
   * `target` is the enemy this tick already picked, handed in so the scan runs
   * once. `undefined` means "nobody has asked yet" and `null` is a real answer
   * — a bot that can perceive nobody — so this cannot be a `??`.
   */
  evaluatePosture(view: TeamView, nowMs: number, target?: Champion | null): Posture {
    const chosen = target === undefined ? this.pickTarget(view) : target;
    const posture = this.decidePosture(view, nowMs, chosen);
    this.posture = posture;
    return posture;
  }

  private decidePosture(view: TeamView, nowMs: number, target: Champion | null): Posture {
    const healthPct = ratio(this.owner.stats.health.value, this.owner.stats.maxHealth.value);
    const manaPct = ratio(this.owner.stats.mana.value, this.owner.stats.maxMana.value);

    if (this.recovering) {
      if (healthPct > RECOVER_HEALTH_PCT && manaPct > RECOVER_MANA_PCT) this.recovering = false;
      else return this.atRetreatPoint() ? 'RECOVER' : 'RETREAT';
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
    // `Pet` and `Zed_W_Clone` both extend `Champion`.
    if (this.owner.basicAttack?.target?.killCredit === 'champion') return 'FIGHT';
    if (target) return 'FIGHT';
    if (this.rememberedTarget(view, nowMs)) return 'SEARCH';
    if (this.assistableFocus(view)) return 'ENGAGE';
    // Below every way of answering "is there a champion to deal with" and above
    // wandering: decision 2 of the lane layer. A bot only farms when there is
    // nobody to fight.
    if (this.pushTarget(view)) return 'PUSH';
    return 'ROAM';
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

  /** Nearest living friendly turret, else the team fountain. */
  retreatPoint(): Vec2 | null {
    const game = this.owner.game as {
      turrets?: { teamId?: unknown; isDead?: boolean; position: Vec2 }[];
      fountains?: { teamId?: unknown; position: Vec2 }[];
    };
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

  private atRetreatPoint(): boolean {
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
  private reachOf(spell: Spell, target: Champion | null): number {
    const declared = spell.declaredRange;
    return declared === undefined
      ? this.profile.aggroRange
      : effectiveRange(declared, this.owner, target);
  }

  scoreSpell(
    spell: Spell,
    slotIndex: number,
    mask: SpellRoleMask,
    target: Champion | null,
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
  chooseSpell(target: Champion | null, view: TeamView, retreating = false): SpellChoice | null {
    let best: SpellChoice | null = null;
    // From 1: slot 0 is the basic attack, which is the attack controller's job.
    for (let slotIndex = 1; slotIndex < this.owner.spells.length; slotIndex++) {
      const spell = this.owner.spells[slotIndex];
      if (!spell?.isCastableNow) continue;
      const mask = rolesOf(spell, slotIndex);
      if (retreating && !isRetreatCandidate(spell, mask)) continue;
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
    if (owner._autoCast) this.maybeCast(posture, view, target, nowMs);
  }

  private drive(posture: Posture, view: TeamView, target: Champion | null, nowMs: number): void {
    const owner = this.owner;
    switch (posture) {
      case 'RETREAT': {
        // `refuge`, not `point`: `point` is a p5 global. See CLAUDE.md.
        const refuge = this.retreatPoint();
        if (refuge) owner.navigateTo(refuge.x, refuge.y);
        return;
      }
      case 'RECOVER':
        owner.stopMovement();
        return;
      case 'FIGHT':
        // The attack order owns the walking while it has one; only step in when
        // there is a target but no order, which is the frame before one is given.
        if (!owner.basicAttack?.target && target) {
          owner.navigateTo(target.position.x, target.position.y);
        }
        return;
      case 'SEARCH': {
        const entry = this.rememberedTarget(view, nowMs);
        if (!entry) return;
        const hunch = this.searchPoint(entry, nowMs);
        owner.navigateTo(hunch.x, hunch.y);
        return;
      }
      case 'ENGAGE':
        if (view.focusTarget) {
          owner.navigateTo(view.focusTarget.position.x, view.focusTarget.position.y);
        }
        return;
      case 'PUSH': {
        // As in FIGHT: an order already running owns the walking, and stepping
        // in would fight the attack controller for the destination every tick.
        if (owner.basicAttack?.target) return;
        // `front`, not `line` — `line` is a p5 global. See CLAUDE.md.
        const front = this.pushTarget(view);
        if (front) owner.navigateTo(front.x, front.y);
        return;
      }
      default: {
        // ROAM: hang around the team rather than crossing the map alone.
        if (owner.position.dist(owner.destination) >= owner.moveSpeed) return;
        const anchor = view.rally ?? this.retreatPoint();
        if (!anchor) {
          owner.moveToRandomLocation();
          return;
        }
        const angle = this.rng() * Math.PI * 2;
        const radius = this.rng() * ROAM_RADIUS;
        owner.navigateToWalkable(
          anchor.x + Math.cos(angle) * radius,
          anchor.y + Math.sin(angle) * radius
        );
      }
    }
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
      if (ghost) this.cast(ghost, aim, nowMs);
      return;
    }
    // A bot running away still casts — but only what helps it leave. See
    // `RETREAT_ROLES`: without this branch the `SCORE_ESCAPE` and
    // `SCORE_SUPPORT` rows were both unreachable in a running match.
    const running = posture === 'RETREAT' || posture === 'RECOVER';
    if (!running && posture !== 'FIGHT' && posture !== 'ENGAGE') return;

    const choice = this.chooseSpell(target, view, running);
    if (!choice) return;
    this.cast(choice, this.aimFor(choice, target), nowMs);
  }

  /** Where this spell should point. The replacement for the player's cursor. */
  private aimFor(choice: SpellChoice, target: Champion | null): Vec2 {
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

  private cast(choice: SpellChoice, aim: Vec2, nowMs: number): void {
    const context = this.contextFor(choice.spell, aim);
    if (!context || !choice.spell.press(context)) return;
    this.lastCastAtMs = nowMs;

    const castSpec = choice.spell.castSpec;
    if (!isChargeActivation(castSpec.activation)) return;
    this.pendingCharge = {
      spell: choice.spell,
      context,
      elapsedMs: 0,
      releaseAtMs: requireChargeSpec(castSpec).maxDurationMs / 2,
    };
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

  /** The quadtree scan, moved off `AIChampion` so perception has one home. */
  findAttackTarget(): Champion | null {
    const owner = this.owner;
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
    if (minion) return minion;

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
      if (!this.profile.seesThroughTerrain && !this.sees(owner, candidate)) continue;
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
