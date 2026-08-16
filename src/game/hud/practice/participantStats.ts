import type AttackableUnit from '../../gameObject/attackableUnits/AttackableUnit';

/**
 * What a roster card says about a participant.
 *
 * A plain module rather than logic inside `RosterTab.vue`, for the reason at the
 * bottom of CLAUDE.md's Code Style: `<script setup>` *is* the setup function, it
 * reruns on every mount, and none of this wants to be re-derived by Vue or
 * tested through a mount. The tab renders what this returns and owns no
 * formatting of its own.
 *
 * Everything is read live off the unit. The practice panel holds the match
 * paused while it is open, so these are a snapshot by construction — which is
 * the honest thing for a stat sheet to be.
 */

/** How many times `Stats.update` — and so regeneration — runs in a second. */
const FRAMES_PER_SECOND = 60;

/**
 * `BasicAttackController.attacksPerSecond`'s floor, restated here rather than
 * imported so the display cannot quietly diverge into showing a swing rate the
 * timer would refuse to run. If that floor ever moves, this test goes red:
 * `tests/game/hud/participantStats.test.ts`.
 */
const MIN_ATTACKS_PER_SECOND = 0.05;

export interface StatRow {
  label: string;
  value: string;
}

export interface StatGroup {
  title: string;
  rows: StatRow[];
}

export interface ScoreLine {
  kills: number;
  deaths: number;
  /** Minions and camps — the CS number. */
  cs: number;
}

/** The three headline numbers, always on the card. */
export function scoreLine(unit: AttackableUnit): ScoreLine {
  const tally = unit.tally;
  return { kills: tally.kills, deaths: tally.deaths, cs: tally.minionsKilled };
}

/** Truncated, not rounded — the same `~~` the health bar prints. */
const pool = (current: number, max: number): string => (max > 0 ? `${~~current} / ${~~max}` : '—');

const whole = (value: number): string => String(Math.round(value));

const percent = (fraction: number): string => `${Math.round(fraction * 100)}%`;

/** One decimal, and no trailing `.0` to make a round number look measured. */
const perSecond = (perFrame: number): string =>
  `${Number((perFrame * FRAMES_PER_SECOND).toFixed(1))} / giây`;

/**
 * Everything else, in sections. Ordered the way a player asks: can I survive,
 * can I hit back, can I get there, and what have I actually done.
 */
export function statGroups(unit: AttackableUnit): StatGroup[] {
  const stats = unit.stats;
  const tally = unit.tally;

  return [
    {
      title: 'Sinh tồn',
      rows: [
        { label: 'Máu', value: pool(stats.health.value, stats.maxHealth.value) },
        { label: 'Năng lượng', value: pool(stats.mana.value, stats.maxMana.value) },
        { label: 'Hồi máu', value: perSecond(stats.healthRegen.value) },
        { label: 'Hồi năng lượng', value: perSecond(stats.manaRegen.value) },
      ],
    },
    {
      title: 'Tấn công',
      rows: [
        { label: 'Sát thương', value: whole(stats.attackDamage.value) },
        {
          label: 'Tốc đánh',
          value: `${Math.max(MIN_ATTACKS_PER_SECOND, stats.attackSpeed.value).toFixed(2)} đòn/giây`,
        },
        { label: 'Tầm đánh', value: whole(stats.attackRange.value) },
        { label: 'Chí mạng', value: percent(stats.critChance.value) },
        { label: 'Hút máu', value: percent(stats.omnivamp.value) },
      ],
    },
    {
      title: 'Cơ động',
      rows: [
        { label: 'Tốc chạy', value: whole(stats.speed.value) },
        { label: 'Kích thước', value: whole(stats.size.value) },
        { label: 'Tầm nhìn', value: whole(stats.visionRadius.value) },
      ],
    },
    {
      title: 'Thành tích',
      rows: [
        { label: 'Hạ gục', value: whole(tally.kills) },
        { label: 'Bị hạ', value: whole(tally.deaths) },
        { label: 'Lính & quái', value: whole(tally.minionsKilled) },
        { label: 'Sát thương gây ra', value: whole(tally.damageDealt) },
        { label: 'Sát thương nhận', value: whole(tally.damageTaken) },
      ],
    },
  ];
}
