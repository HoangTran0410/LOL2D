/**
 * What a participant did this match.
 *
 * Before this the game kept exactly one number about anybody — `Champion.score`,
 * `++` on a kill and `--` on a death — so 3 kills and 3 deaths was indexed the
 * same as never having fought. Minions and camps were credited to nobody at
 * all, which meant "farm" was not a quantity this game had, and damage was not
 * one either: the single most useful number for answering "is this new ability
 * tuned right" was thrown away every frame it was computed.
 *
 * Kept on `AttackableUnit` rather than on `Champion`, because the crediting
 * happens in `takeDamage` and `die` — both of which live on the base — and
 * because a turret's damage output is a real question. `score` stays a *view*
 * of two of these so the number painted on the health bar keeps meaning what it
 * has always meant.
 *
 * A match total, deliberately: nothing here is reset on death or respawn.
 */
export default class MatchTally {
  /** Enemy champions finished off. */
  kills = 0;
  /** Times this unit was finished off. */
  deaths = 0;
  /** Minions and jungle camps finished off — the CS number. */
  minionsKilled = 0;
  /** Damage that actually landed on someone else, after their shields. */
  damageDealt = 0;
  /** Damage that actually landed on this unit, after its own shields. */
  damageTaken = 0;

  /** Kills minus deaths — the figure `Champion.drawHealthBar` has always shown. */
  get score(): number {
    return this.kills - this.deaths;
  }
}

/**
 * What killing this unit is worth on someone else's scoreboard.
 *
 * `'none'` is not an oversight: a `Pet` extends `Champion`, so without it every
 * summoned pet's kill would read as a champion kill, and a turret would read
 * as a minion. Neither is a thing you get credit for here.
 */
export type KillCredit = 'champion' | 'minion' | 'none';
