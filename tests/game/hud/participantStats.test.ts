/**
 * The numbers the roster tab reads out, formatted away from Vue.
 *
 * `RosterTab.vue` is a `<script setup>`, which is a setup function that reruns
 * on every mount — a bad place for anything worth asserting, and an expensive
 * place to test from. So the whole "what does a participant's card say" question
 * lives in a plain module and this suite drives it directly, the same split
 * `panelTab.ts` already uses for the tab state.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { scoreLine, statGroups } from '../../../src/game/hud/practice/participantStats';
import { createGame, stubGameGlobals, type TestGame } from '../fixtures';

let game: TestGame;

beforeEach(() => {
  stubGameGlobals();
  game = createGame();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const unit = (): Champion => {
  const champion = new Champion({ game, teamId: 'subject' });
  game.setPlayer(champion);
  champion.stats.maxHealth.baseValue = 100;
  champion.stats.health.baseValue = 87.4;
  champion.stats.maxMana.baseValue = 500;
  champion.stats.mana.baseValue = 240.9;
  champion.stats.attackDamage.baseValue = 12;
  champion.stats.attackSpeed.baseValue = 0.8;
  champion.stats.attackRange.baseValue = 125;
  champion.stats.speed.baseValue = 3;
  champion.stats.critChance.baseValue = 0.25;
  champion.stats.omnivamp.baseValue = 0.1;
  champion.stats.healthRegen.baseValue = 0.06;
  return champion;
};

/** Every row across every group, so a test can look one up by label. */
const rowsOf = (champion: Champion): Record<string, string> => {
  const found: Record<string, string> = {};
  for (const group of statGroups(champion)) {
    for (const row of group.rows) found[row.label] = row.value;
  }
  return found;
};

describe('scoreLine', () => {
  it('reads the three headline numbers off the tally', () => {
    const champion = unit();
    champion.tally.kills = 2;
    champion.tally.deaths = 1;
    champion.tally.minionsKilled = 37;

    expect(scoreLine(champion)).toEqual({ kills: 2, deaths: 1, cs: 37 });
  });

  it('starts a fresh champion at zero rather than undefined', () => {
    expect(scoreLine(unit())).toEqual({ kills: 0, deaths: 0, cs: 0 });
  });
});

describe('statGroups', () => {
  it('shows pools as whole points out of their maximum', () => {
    const rows = rowsOf(unit());
    // 87.4 truncated, not rounded up to 88 — the health bar's own `~~`.
    expect(rows['Máu']).toBe('87 / 100');
    expect(rows['Năng lượng']).toBe('240 / 500');
  });

  it('says a unit has no resource rather than showing it an empty bar', () => {
    const champion = unit();
    champion.stats.maxMana.baseValue = 0;
    champion.stats.mana.baseValue = 0;

    expect(rowsOf(champion)['Năng lượng']).toBe('—');
  });

  it('states attack speed the way the swing timer means it', () => {
    // `BasicAttackController.attacksPerSecond` is the stat itself, floored at
    // 0.05. Printing anything else would put a number on screen that the timer
    // disagrees with.
    expect(rowsOf(unit())['Tốc đánh']).toBe('0.80 đòn/giây');
  });

  it('never prints a swing rate the timer could not run', () => {
    const champion = unit();
    champion.stats.attackSpeed.baseValue = 0;

    expect(rowsOf(champion)['Tốc đánh']).toBe('0.05 đòn/giây');
  });

  it('turns per-frame regeneration into per-second', () => {
    // `Stats.update` adds `healthRegen` once per frame; at 60fps 0.06 is 3.6/s.
    // Arithmetic written out here rather than derived from the same constant.
    expect(rowsOf(unit())['Hồi máu']).toBe('3.6 / giây');
  });

  it('shows chance-like stats as percentages', () => {
    const rows = rowsOf(unit());
    expect(rows['Chí mạng']).toBe('25%');
    expect(rows['Hút máu']).toBe('10%');
  });

  it('carries the tally through as its own group', () => {
    const champion = unit();
    champion.tally.damageDealt = 1234.6;
    champion.tally.damageTaken = 87;

    const rows = rowsOf(champion);
    expect(rows['Sát thương gây ra']).toBe('1235');
    expect(rows['Sát thương nhận']).toBe('87');
  });

  it('groups every row under a titled section, with no duplicate labels', () => {
    const groups = statGroups(unit());
    const labels = groups.flatMap(group => group.rows.map(row => row.label));

    expect(groups.length).toBeGreaterThan(1);
    expect(groups.every(group => group.title.length > 0 && group.rows.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(labels.length);
  });
});
