import { describe, expect, it, vi } from 'vitest';
import { computeHudState, HUD_UPDATE_INTERVAL_MS } from '../../../src/game/hud/hudState';
import InGameHUD from '../../../src/game/hud/InGameHUD';

/**
 * `computeHudState` only ever reads `game.player` — a fake shaped like the
 * bits it touches is enough, and keeps this suite free of the real engine
 * (no p5, no asset loading, no spell classes).
 */
const fakeSpell = (overrides: Record<string, unknown> = {}) => ({
  image: { path: 'spell.png', key: 'spell_x', status: 'ready' },
  disabled: false,
  coolDown: 6000,
  currentCooldown: 0,
  state: 'READY',
  name: 'Test Spell',
  description: 'does a thing',
  manaCost: 40,
  cooldownLocksOut: true,
  ...overrides,
});

const fakePlayer = (overrides: Record<string, unknown> = {}) => ({
  avatar: { path: 'avatar.png', key: 'champ_x', status: 'ready' },
  isDead: false,
  deathData: null,
  canCast: true,
  shieldAmount: 0,
  stats: {
    health: { value: 60 },
    maxHealth: { value: 100 },
    mana: { value: 40 },
    maxMana: { value: 100 },
  },
  spells: [fakeSpell()],
  buffs: [],
  ...overrides,
});

describe('computeHudState', () => {
  it('is null with no player yet', () => {
    expect(computeHudState({ player: null } as any)).toBeNull();
    expect(computeHudState(null)).toBeNull();
  });

  it('reads health/mana as whole numbers and percentages', () => {
    const state = computeHudState({ player: fakePlayer() } as any)!;
    expect(state.stats).toMatchObject({
      health: 60,
      maxHealth: 100,
      mana: 40,
      maxMana: 100,
      healthPercent: 60,
      manaPercent: 40,
    });
  });

  it('clamps health/mana percent at 100 even if the value overshoots', () => {
    const player = fakePlayer({
      stats: {
        health: { value: 150 },
        maxHealth: { value: 100 },
        mana: { value: 10 },
        maxMana: { value: 100 },
      },
    });
    const state = computeHudState({ player } as any)!;
    expect(state.stats.healthPercent).toBe(100);
  });

  it('reports a shield as a slice of the health bar, capped by remaining health room', () => {
    const player = fakePlayer({ shieldAmount: 50 });
    const state = computeHudState({ player } as any)!;
    expect(state.stats.shield).toBe(50);
    expect(state.stats.shieldPercent).toBe(50);
    // shieldLeftPercent is min(healthPercent, 100 - shieldPercent): whichever
    // leaves less room, so the shield slice never draws past the bar's end
    // nor further left than the health fill itself. Health is 60%, 100-50=50,
    // so 50 is the tighter bound here.
    expect(state.stats.shieldLeftPercent).toBe(50);
  });

  it('marks a real cooldown as locked out, with a seconds-ceiling readout', () => {
    const player = fakePlayer({
      spells: [fakeSpell({ currentCooldown: 4001 })],
    });
    const state = computeHudState({ player } as any)!;
    expect(state.spells[0]).toMatchObject({
      showCoolDown: true,
      lockedOut: true,
      coolDownText: 5,
    });
  });

  it('does not lock out a spell whose cooldown does not block casting (the swing timer)', () => {
    const player = fakePlayer({
      spells: [fakeSpell({ currentCooldown: 300, cooldownLocksOut: false })],
    });
    const state = computeHudState({ player } as any)!;
    expect(state.spells[0]).toMatchObject({ showCoolDown: true, lockedOut: false });
  });

  it('marks a spell unaffordable once its cost exceeds the current mana pool', () => {
    const player = fakePlayer({
      stats: {
        health: { value: 100 },
        maxHealth: { value: 100 },
        mana: { value: 10 },
        maxMana: { value: 100 },
      },
      spells: [fakeSpell({ manaCost: 40 })],
    });
    const state = computeHudState({ player } as any)!;
    expect(state.spells[0].affordable).toBe(false);
  });

  it('flags slot 0 (basic attack) and slots past 4 (summoners) as "small"', () => {
    const spells = [fakeSpell(), fakeSpell(), fakeSpell(), fakeSpell(), fakeSpell(), fakeSpell()];
    const state = computeHudState({ player: fakePlayer({ spells }) } as any)!;
    expect(state.spells.map(s => s.small)).toEqual([true, false, false, false, false, true]);
  });

  it('drops spells with no loaded image rather than rendering a blank slot', () => {
    const spells = [fakeSpell(), fakeSpell({ image: null })];
    const state = computeHudState({ player: fakePlayer({ spells } as any) } as any)!;
    expect(state.spells).toHaveLength(1);
  });

  it('collapses buffs into one row per kind, keyed by stackId, counting stacks', () => {
    const buff = (stackId: string, timeElapsed: number) => ({
      image: { path: 'buff.png', key: 'buff_x', status: 'ready' },
      duration: 5000,
      timeElapsed,
      stackId,
    });
    const player = fakePlayer({
      buffs: [buff('slow', 1000), buff('slow', 3000), buff('root', 2000)],
    });
    const state = computeHudState({ player } as any)!;
    expect(state.buffs).toHaveLength(2);
    const slowRow = state.buffs.find(b => b.stacks === 2)!;
    // the *longer remaining* instance drives the countdown: 5000-1000=4000ms left.
    expect(slowRow.timeLeftText).toBe(4);
  });

  /**
   * A `countedStacks` buff (`ChoGath_R_Growth`, `Veigar_Q_Power` —
   * `src/game/gameObject/Buff.ts`) is one instance carrying its whole count
   * on `.stacks`, not one instance per stack. The row builder used to derive
   * the badge count by incrementing once per array entry sharing a
   * `stackId`, which is exactly wrong for a single instance representing
   * hundreds of stacks — it has to sum `.stacks` instead, falling back to 1
   * for a buff that has never heard of the field (every ordinary,
   * non-counted buff, including the fakes above).
   */
  it('sums .stacks for a countedStacks buff instead of counting the single instance', () => {
    const player = fakePlayer({
      buffs: [
        {
          image: { path: 'buff.png', key: 'buff_x', status: 'ready' },
          duration: 600_000,
          timeElapsed: 1000,
          stackId: 'chogath_r_growth',
          stacks: 500,
        },
      ],
    });
    const state = computeHudState({ player } as any)!;
    expect(state.buffs).toHaveLength(1);
    expect(state.buffs[0].stacks).toBe(500);
  });

  it('reports isDead and the revive countdown in whole seconds', () => {
    const player = fakePlayer({ isDead: true, deathData: { reviveAfter: 3500 } });
    const state = computeHudState({ player } as any)!;
    expect(state.isDead).toBe(true);
    expect(state.reviveAfter).toBe(3);
  });
});

describe('HUD_UPDATE_INTERVAL_MS', () => {
  it('is finer than the whole-second cooldown text it feeds', () => {
    expect(HUD_UPDATE_INTERVAL_MS).toBeLessThan(1000);
    expect(HUD_UPDATE_INTERVAL_MS).toBeGreaterThan(0);
  });

  it('skips state snapshots while the practice panel has paused the game', () => {
    const setState = vi.fn();
    const hud = Object.create(InGameHUD.prototype) as {
      game: { paused: boolean; touchControls: { enabled: boolean } };
      view: { hud: { touchUi: boolean }; setState: typeof setState };
      update(): void;
    };
    hud.game = { paused: true, touchControls: { enabled: true } };
    hud.view = { hud: { touchUi: false }, setState };

    hud.update();

    expect(hud.view.hud.touchUi).toBe(true);
    expect(setState).not.toHaveBeenCalled();
  });
});

/**
 * Cooldown reduction and URF are applied at one seam in `Spell` and surfaced as
 * `effectiveCoolDownMs` / `effectiveManaCost`. The HUD has to read *those*, not
 * the spell's own tuning fields — two separate passes over this code each
 * reached for the raw fields independently, which is exactly why this is
 * pinned down here rather than left to review.
 */
describe('computeHudState honours match rules', () => {
  const ruled = (overrides: Record<string, unknown> = {}) =>
    fakeSpell({
      coolDown: 6000,
      manaCost: 40,
      effectiveCoolDownMs: 3000, // 50% CDR
      effectiveManaCost: 0, // URF
      ...overrides,
    });

  it('shows the reduced cooldown and the URF mana cost, not the raw ones', () => {
    const state = computeHudState({ player: fakePlayer({ spells: [ruled()] }) } as never);
    expect(state?.spells[0].coolDown).toBe(3000);
    expect(state?.spells[0].manaCost).toBe(0);
  });

  it('fills the sweep against the reduced duration', () => {
    // half of the *reduced* 3000ms cooldown remains, so the sweep is half full.
    // Measured against the raw 6000 it would read 25% and drain at half speed.
    const state = computeHudState({
      player: fakePlayer({ spells: [ruled({ currentCooldown: 1500 })] }),
    } as never);
    expect(state?.spells[0].coolDownPercent).toBe(50);
  });

  it('never greys an icon against a cost URF does not charge', () => {
    const state = computeHudState({
      player: fakePlayer({
        spells: [ruled()],
        stats: {
          health: { value: 60 },
          maxHealth: { value: 100 },
          mana: { value: 0 },
          maxMana: { value: 100 },
        },
      }),
    } as never);
    expect(state?.spells[0].affordable).toBe(true);
  });

  it('falls back to the raw fields for a spell that has no effective accessors', () => {
    const state = computeHudState({ player: fakePlayer() } as never);
    expect(state?.spells[0].coolDown).toBe(6000);
    expect(state?.spells[0].manaCost).toBe(40);
  });
});

/**
 * Hồi Thành. It is not in `spells[]` — see `Recall.ts` — so it gets its own
 * entry in `HudState` rather than an eighth `SpellDisplay`, and the desktop
 * button reads that entry. The channel's duration is taken off the spell's own
 * `castSpec.channel`, so retuning `RECALL_CHANNEL_MS` cannot make the readout
 * lie without this suite noticing.
 */
describe('computeHudState — the recall control', () => {
  const fakeRecall = (overrides: Record<string, unknown> = {}) => ({
    name: 'Hồi Thành (Recall)',
    description: 'Tự dịch chuyển về bệ đá của đội mình',
    disabled: false,
    state: 'READY',
    channelProgress: 0,
    castSpec: { channel: { durationMs: 4000 } },
    ...overrides,
  });

  it('is null for a champion that has no recall at all', () => {
    const state = computeHudState({ player: fakePlayer({ recall: null }) } as any)!;
    expect(state.recall).toBeNull();
  });

  it('carries the B hotkey and the spell name, idle', () => {
    const state = computeHudState({ player: fakePlayer({ recall: fakeRecall() }) } as any)!;
    expect(state.recall).toMatchObject({
      hotKey: 'B',
      name: 'Hồi Thành (Recall)',
      channeling: false,
      progressPercent: 0,
      secondsLeft: 4,
      canCast: true,
    });
  });

  it('reports how far through the channel is, and how long is left', () => {
    const player = fakePlayer({
      recall: fakeRecall({ state: 'CHANNELING', channelProgress: 0.25 }),
    });
    const state = computeHudState({ player } as any)!;
    expect(state.recall).toMatchObject({
      channeling: true,
      progressPercent: 25,
      secondsLeft: 3,
    });
  });

  it('clamps an overshooting channel rather than drawing past the button', () => {
    const player = fakePlayer({
      recall: fakeRecall({ state: 'CHANNELING', channelProgress: 1.4 }),
    });
    const state = computeHudState({ player } as any)!;
    expect(state.recall!.progressPercent).toBe(100);
    expect(state.recall!.secondsLeft).toBe(0);
  });

  it('cannot be cast by a corpse', () => {
    const player = fakePlayer({ isDead: true, recall: fakeRecall() });
    expect(computeHudState({ player } as any)!.recall!.canCast).toBe(false);
  });
});
