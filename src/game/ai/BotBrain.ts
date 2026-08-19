import Champion from '@/game/gameObject/attackableUnits/Champion';
import { canSee, type Seeable } from '@/game/combat/Vision';
import { profileFor, type DifficultyProfile } from '@/game/ai/Difficulty';
import type { TeamView } from '@/game/ai/TeamBlackboard';
import type AIChampion from '@/game/gameObject/attackableUnits/AIChampion';

/** How much a target's remaining health pulls the choice, at full health missing. */
export const TARGET_LOW_HEALTH_WEIGHT = 12;
/** Pixels per point of target score. 100px of walking is worth one point. */
export const TARGET_DISTANCE_DIVISOR = 100;

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
}

export default BotBrain;
