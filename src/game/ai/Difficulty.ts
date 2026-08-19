/**
 * How well a bot plays, as data. Imports nothing on purpose: every other AI
 * module reads a profile, so a dependency here would be a dependency everywhere.
 *
 * The table is the whole tuning surface. Retuning a tier is editing one column,
 * and no test asserts a specific value except the two that encode a promise:
 * `normal.aggroRange` (today's reach, so the default match is unchanged) and
 * `easy.ghostCastWindowMs` (0, so the easiest bots never throw at a memory).
 */
export type BotDifficulty = 'easy' | 'normal' | 'hard';

export interface DifficultyProfile {
  /** Minimum gap between two ability casts. */
  castIntervalMs: number;
  /** 0 aims where the target is, 1 where it will be. */
  leadFactor: number;
  aimErrorPx: number;
  /** Amplitude of the random multiplier on every spell score. */
  noise: number;
  retreatHealthPct: number;
  /** Fraction of the mana pool held back for the ultimate. */
  manaReservePct: number;
  focusBonus: number;
  playerBias: number;
  aggroRange: number;
  /**
   * Whether walls and bushes are ignored when *acquiring* a target. Never
   * ignores sight range, and never reveals a STEALTHED unit.
   */
  seesThroughTerrain: boolean;
  memoryTtlMs: number;
  /** 0 disables throwing an area spell at a last-known position entirely. */
  ghostCastWindowMs: number;
}

export const DEFAULT_DIFFICULTY: BotDifficulty = 'normal';

export const BOT_DIFFICULTIES: readonly BotDifficulty[] = Object.freeze([
  'easy',
  'normal',
  'hard',
] as const);

const PROFILES: Readonly<Record<BotDifficulty, Readonly<DifficultyProfile>>> = Object.freeze({
  easy: Object.freeze({
    castIntervalMs: 1400,
    leadFactor: 0.15,
    aimErrorPx: 70,
    noise: 0.9,
    retreatHealthPct: 0.2,
    manaReservePct: 0,
    focusBonus: 2,
    playerBias: 0,
    aggroRange: 360,
    seesThroughTerrain: false,
    memoryTtlMs: 1200,
    ghostCastWindowMs: 0,
  }),
  normal: Object.freeze({
    castIntervalMs: 900,
    leadFactor: 0.6,
    aimErrorPx: 30,
    noise: 0.45,
    retreatHealthPct: 0.3,
    manaReservePct: 0.25,
    focusBonus: 8,
    playerBias: 6,
    aggroRange: 420,
    seesThroughTerrain: true,
    memoryTtlMs: 2500,
    ghostCastWindowMs: 500,
  }),
  hard: Object.freeze({
    castIntervalMs: 550,
    leadFactor: 0.95,
    aimErrorPx: 8,
    noise: 0.2,
    retreatHealthPct: 0.4,
    manaReservePct: 0.4,
    focusBonus: 14,
    playerBias: 12,
    aggroRange: 480,
    seesThroughTerrain: true,
    memoryTtlMs: 4000,
    ghostCastWindowMs: 900,
  }),
});

export const profileFor = (difficulty: BotDifficulty): Readonly<DifficultyProfile> =>
  PROFILES[difficulty] ?? PROFILES[DEFAULT_DIFFICULTY];
