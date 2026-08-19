import type AttackableUnit from '@/game/gameObject/attackableUnits/AttackableUnit';

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
  /**
   * A Font Awesome class (`fa-heart`, …) rendered beside the label — a visual
   * anchor to scan by, with the word kept so an unfamiliar icon is never the
   * only thing carrying the meaning. Icons where a convention exists, and a
   * plausible one where it does not; the text is the source of truth.
   */
  icon: string;
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
        { icon: 'fa-heart', label: 'Máu', value: pool(stats.health.value, stats.maxHealth.value) },
        {
          icon: 'fa-droplet',
          label: 'Năng lượng',
          value: pool(stats.mana.value, stats.maxMana.value),
        },
        { icon: 'fa-heart-pulse', label: 'Hồi máu', value: perSecond(stats.healthRegen.value) },
        { icon: 'fa-bolt', label: 'Hồi năng lượng', value: perSecond(stats.manaRegen.value) },
      ],
    },
    {
      title: 'Tấn công',
      rows: [
        { icon: 'fa-khanda', label: 'Sát thương', value: whole(stats.attackDamage.value) },
        {
          icon: 'fa-stopwatch',
          label: 'Tốc đánh',
          value: `${Math.max(MIN_ATTACKS_PER_SECOND, stats.attackSpeed.value).toFixed(2)} đòn/giây`,
        },
        { icon: 'fa-bullseye', label: 'Tầm đánh', value: whole(stats.attackRange.value) },
        { icon: 'fa-burst', label: 'Chí mạng', value: percent(stats.critChance.value) },
        { icon: 'fa-hand-holding-droplet', label: 'Hút máu', value: percent(stats.omnivamp.value) },
      ],
    },
    {
      title: 'Cơ động',
      rows: [
        { icon: 'fa-person-running', label: 'Tốc chạy', value: whole(stats.speed.value) },
        { icon: 'fa-expand', label: 'Kích thước', value: whole(stats.size.value) },
        { icon: 'fa-eye', label: 'Tầm nhìn', value: whole(stats.visionRadius.value) },
      ],
    },
    {
      title: 'Thành tích',
      rows: [
        { icon: 'fa-crosshairs', label: 'Hạ gục', value: whole(tally.kills) },
        { icon: 'fa-skull', label: 'Bị hạ', value: whole(tally.deaths) },
        { icon: 'fa-coins', label: 'Lính & quái', value: whole(tally.minionsKilled) },
        { icon: 'fa-hand-fist', label: 'Sát thương gây ra', value: whole(tally.damageDealt) },
        { icon: 'fa-shield-halved', label: 'Sát thương nhận', value: whole(tally.damageTaken) },
      ],
    },
  ];
}
