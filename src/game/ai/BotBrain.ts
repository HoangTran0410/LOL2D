import Champion from '@/game/gameObject/attackableUnits/Champion';
import { canSee, type Seeable } from '@/game/combat/Vision';
import { profileFor, type DifficultyProfile } from '@/game/ai/Difficulty';
import type { SeenEnemy, TeamView } from '@/game/ai/TeamBlackboard';
import type AIChampion from '@/game/gameObject/attackableUnits/AIChampion';
import type { Vec2 } from '@/game/spell/runtime/types';
import { hasRole, rolesOf, SpellRole, ULTIMATE_SLOT, type SpellRoleMask } from '@/game/ai/SpellRole';
import { effectiveRange } from '@/game/combat/Reach';
import { effectiveHealth } from '@/game/combat/ExecuteTargeting';
import type Spell from '@/game/gameObject/Spell';

/** How much a target's remaining health pulls the choice, at full health missing. */
export const TARGET_LOW_HEALTH_WEIGHT = 12;
/** Pixels per point of target score. 100px of walking is worth one point. */
export const TARGET_DISTANCE_DIVISOR = 100;

export type Posture = 'RETREAT' | 'RECOVER' | 'FIGHT' | 'SEARCH' | 'ENGAGE' | 'ROAM';

/** How far from an ally a focus target counts as "a fight worth joining". */
export const ASSIST_RANGE = 700;
export const ROAM_RADIUS = 500;
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

export class BotBrain {
  /**
   * The terrain half of perception, injectable purely so a test can state a
   * line-of-sight answer without building walls. Always `canSee` in the game.
   */
  sees: (observer: AIChampion, target: Champion) => boolean = (observer, target) =>
    canSee(observer as unknown as Seeable, target as unknown as Seeable);

  constructor(readonly owner: AIChampion) {}

  get profile(): Readonly<DifficultyProfile> {
    return profileFor(this.owner._difficulty);
  }

  /**
   * Whether this bot may *acquire* `target`.
   *
   * Three gates, and which of them a tier skips is the whole of the difficulty
   * knob:
   *
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

  private scoreTarget(enemy: Champion, view: TeamView): number {
    const dx = enemy.position.x - this.owner.position.x;
    const dy = enemy.position.y - this.owner.position.y;
    let score = -Math.hypot(dx, dy) / TARGET_DISTANCE_DIVISOR;

    const maxHealth = enemy.stats.maxHealth.value;
    if (maxHealth > 0) {
      const healthPct = enemy.stats.health.value / maxHealth;
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

  evaluatePosture(view: TeamView, nowMs: number): Posture {
    const posture = this.decidePosture(view, nowMs);
    this.posture = posture;
    return posture;
  }

  private decidePosture(view: TeamView, nowMs: number): Posture {
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
    if (this.owner.basicAttack?.target) return 'FIGHT';
    if (this.pickTarget(view)) return 'FIGHT';
    if (this.rememberedTarget(view, nowMs)) return 'SEARCH';
    if (this.assistableFocus(view)) return 'ENGAGE';
    return 'ROAM';
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
    const declared = spell.declaredRange;
    const reach =
      declared === undefined ? Number.POSITIVE_INFINITY : effectiveRange(declared, this.owner, target);
    const inReach = distance <= reach;

    // A spell that cannot reach is not worth scoring — unless closing the gap
    // is the thing it does.
    if (target && !inReach && !hasRole(mask, SpellRole.Dash)) return Number.NEGATIVE_INFINITY;

    let score = 0;
    if (hasRole(mask, SpellRole.Damage) && target) score += SCORE_DAMAGE;
    if (hasRole(mask, SpellRole.Poke) && distance > this.owner.stats.attackRange.value) {
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
    if (hasRole(mask, SpellRole.Zone) && inReach) score += SCORE_ZONE;
    if (hasRole(mask, SpellRole.Ultimate)) score += SCORE_ULTIMATE;

    // The randomness, and the only place it lives. `noise` is what makes an
    // easy bot make odd-but-legal choices and a hard one make good ones,
    // without either of them being a fixed rotation.
    return score * (1 + this.rng() * this.profile.noise);
  }

  chooseSpell(target: Champion | null, view: TeamView): SpellChoice | null {
    let best: SpellChoice | null = null;
    // From 1: slot 0 is the basic attack, which is the attack controller's job.
    for (let slotIndex = 1; slotIndex < this.owner.spells.length; slotIndex++) {
      const spell = this.owner.spells[slotIndex];
      if (!spell?.isCastableNow) continue;
      const mask = rolesOf(spell, slotIndex);
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
  chooseGhostSpell(entry: SeenEnemy, nowMs: number): SpellChoice | null {
    const window = this.profile.ghostCastWindowMs;
    if (window <= 0 || nowMs - entry.atMs > window) return null;

    for (let slotIndex = 1; slotIndex < this.owner.spells.length; slotIndex++) {
      const spell = this.owner.spells[slotIndex];
      if (!spell?.isCastableNow) continue;
      const mask = rolesOf(spell, slotIndex);
      if (!hasRole(mask, SpellRole.Zone) && !hasRole(mask, SpellRole.Poke)) continue;
      if (!this.withinManaBudget(spell, mask)) continue;
      return { spell, slotIndex, mask, score: SCORE_ZONE };
    }
    return null;
  }
}

export default BotBrain;
