import { beforeEach, describe, expect, it, vi } from 'vitest';
import TouchControls, {
  describeButtonVisual,
  LOCKOUT_WEDGE_COLOR,
  RHYTHM_WEDGE_COLOR,
  MANA_BADGE_COLOR,
  MANA_BADGE_SHORT_COLOR,
  type TouchControlsHost,
  type TouchSpellView,
} from '../../../src/game/input/TouchControls';
import { computeTouchLayout } from '../../../src/game/input/TouchLayout';
import type { TargetingMode } from '../../../src/game/spell/runtime/types';

const PHONE = { width: 844, height: 390 };
const RANGE = 800;
const ORIGIN = { x: 1000, y: 1000 };

const view = (targeting: TargetingMode): TouchSpellView => ({
  targeting,
  activation: 'PRESS',
  range: RANGE,
  label: 'Q',
  icon: null,
  cooldownRatio: 0,
  onCooldown: false,
  remainingSeconds: 0,
  manaCost: 0,
  affordable: true,
  castable: true,
  charging: false,
});

interface Harness {
  controls: TouchControls;
  host: TouchControlsHost;
  calls: {
    begin: number[];
    commit: number[];
    cancel: number[];
    steer: ({ x: number; y: number } | null)[];
    aim: { slot: number; world: { x: number; y: number } | null }[];
  };
  setTargeting(mode: TargetingMode): void;
  setAutoTarget(target: { position: { x: number; y: number } } | null): void;
  setUnitPick(target: { position: { x: number; y: number } } | null): void;
}

const harness = (): Harness => {
  let targeting: TargetingMode = 'DIRECTION';
  let autoTarget: { position: { x: number; y: number } } | null = null;
  let unitPick: { position: { x: number; y: number } } | null = null;

  const calls: Harness['calls'] = { begin: [], commit: [], cancel: [], steer: [], aim: [] };

  const host: TouchControlsHost = {
    viewport: () => PHONE,
    slotCount: () => 7,
    spellView: () => view(targeting),
    recallView: () => view('SELF'),
    recall: () => undefined,
    playerPosition: () => ORIGIN,
    playerFacing: () => ({ x: 1, y: 0 }),
    autoTargetWithin: () => autoTarget,
    pickUnitNear: () => unitPick,
    steer: direction => {
      calls.steer.push(direction ? { x: direction.x, y: direction.y } : null);
    },
    setSlotAim: (slot, world) => {
      calls.aim.push({ slot, world: world ? { x: world.x, y: world.y } : null });
    },
    beginSlot: slot => calls.begin.push(slot),
    commitSlot: slot => calls.commit.push(slot),
    cancelSlot: slot => calls.cancel.push(slot),
    withWorldTransform: draw => draw(),
  };

  return {
    controls: new TouchControls(host, true),
    host,
    calls,
    setTargeting: mode => {
      targeting = mode;
    },
    setAutoTarget: target => {
      autoTarget = target;
    },
    setUnitPick: target => {
      unitPick = target;
    },
  };
};

const layout = computeTouchLayout(PHONE, 7);
const attack = layout.buttons[0];
const qButton = layout.buttons.find(button => button.slot === 1)!;
/** Somewhere in the stick's band, well clear of every button. */
const STICK = { x: 140, y: 320 };

const lastAim = (h: Harness, slot: number) =>
  [...h.calls.aim].reverse().find(entry => entry.slot === slot && entry.world)?.world ?? null;

describe('TouchControls — the joystick', () => {
  it('drives the champion from a held stick', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, ...STICK }]);
    h.controls.syncPointers([{ id: 1, x: STICK.x, y: STICK.y - 70 }]);
    h.controls.update();

    expect(h.calls.steer).toHaveLength(1);
    expect(h.calls.steer[0]!.x).toBeCloseTo(0, 6);
    expect(h.calls.steer[0]!.y).toBeCloseTo(-1, 6);
  });

  it('says nothing while the thumb rests inside the dead zone', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, ...STICK }]);
    h.controls.syncPointers([{ id: 1, x: STICK.x + 4, y: STICK.y }]);
    h.controls.update();

    expect(h.calls.steer).toHaveLength(0);
  });

  it('stops exactly once when the thumb lifts', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, ...STICK }]);
    h.controls.syncPointers([{ id: 1, x: STICK.x + 70, y: STICK.y }]);
    h.controls.update();
    h.controls.syncPointers([]);
    h.controls.update();
    h.controls.update();

    expect(h.calls.steer.filter(entry => entry === null)).toHaveLength(1);
  });

  it('never lets a spell gesture grab the stick', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x - 90, y: attack.y - 90 }]);
    h.controls.update();

    expect(h.calls.steer).toHaveLength(0);
    expect(h.calls.begin).toEqual([0]);
  });

  it('runs both thumbs at once', () => {
    const h = harness();

    h.controls.syncPointers([
      { id: 1, ...STICK },
      { id: 2, x: qButton.x, y: qButton.y },
    ]);
    h.controls.syncPointers([
      { id: 1, x: STICK.x + 70, y: STICK.y },
      { id: 2, x: qButton.x, y: qButton.y - 80 },
    ]);
    h.controls.update();

    expect(h.calls.steer).toHaveLength(1);
    expect(h.calls.begin).toEqual([1]);
  });
});

describe('TouchControls — tap versus drag', () => {
  it('commits a tap that never moved, aimed by the auto-target', () => {
    const h = harness();
    h.setAutoTarget({ position: { x: 1000, y: 1600 } });

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x + 3, y: attack.y - 2 }]);
    h.controls.syncPointers([]);

    expect(h.calls.begin).toEqual([0]);
    expect(h.calls.commit).toEqual([0]);
    expect(h.calls.cancel).toEqual([]);
    // Straight down at the victim, at the spell's own range.
    const world = lastAim(h, 0)!;
    expect(world.x).toBeCloseTo(1000, 4);
    expect(world.y).toBeCloseTo(1000 + RANGE, 4);
  });

  it('commits a drag aimed where the drag pointed, not at the auto-target', () => {
    const h = harness();
    h.setAutoTarget({ position: { x: 1000, y: 1600 } });

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x - 120, y: attack.y }]);
    h.controls.syncPointers([]);

    expect(h.calls.commit).toEqual([0]);
    const world = lastAim(h, 0)!;
    expect(world.x).toBeCloseTo(1000 - RANGE, 4);
    expect(world.y).toBeCloseTo(1000, 4);
  });

  it('treats a wobble under the tap slop as a tap', () => {
    const h = harness();
    h.setAutoTarget({ position: { x: 1000, y: 1600 } });

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x - layout.tapSlop + 2, y: attack.y }]);
    h.controls.syncPointers([]);

    const world = lastAim(h, 0)!;
    expect(world.y).toBeCloseTo(1000 + RANGE, 4);
  });

  it('aims a POINT spell at the drag’s length', () => {
    const h = harness();
    h.setTargeting('POINT');

    h.controls.syncPointers([{ id: 1, x: qButton.x, y: qButton.y }]);
    h.controls.syncPointers([{ id: 1, x: qButton.x, y: qButton.y - layout.dragToRange / 2 }]);
    h.controls.syncPointers([]);

    const world = lastAim(h, 1)!;
    expect(world.x).toBeCloseTo(1000, 4);
    expect(world.y).toBeCloseTo(1000 - RANGE / 2, 4);
  });

  it('snaps a UNIT spell onto the body the drag points at', () => {
    const h = harness();
    h.setTargeting('UNIT');
    const victim = { position: { x: 1000, y: 400 } };
    h.setUnitPick(victim);

    h.controls.syncPointers([{ id: 1, x: qButton.x, y: qButton.y }]);
    h.controls.syncPointers([{ id: 1, x: qButton.x, y: qButton.y - 90 }]);
    h.controls.syncPointers([]);

    expect(lastAim(h, 1)).toEqual(victim.position);
  });

  it('casts a SELF spell on itself however the thumb moves', () => {
    const h = harness();
    h.setTargeting('SELF');

    h.controls.syncPointers([{ id: 1, x: qButton.x, y: qButton.y }]);
    h.controls.syncPointers([{ id: 1, x: qButton.x - 200, y: qButton.y - 40 }]);
    h.controls.syncPointers([]);

    expect(h.calls.commit).toEqual([1]);
    expect(lastAim(h, 1)).toEqual(ORIGIN);
  });
});

describe('TouchControls — cancel', () => {
  it('aborts when the thumb comes back to the button it left', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x - 200, y: attack.y - 60 }]);
    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([]);

    expect(h.calls.cancel).toEqual([0]);
    expect(h.calls.commit).toEqual([]);
  });

  it('does not arm the abort until the thumb has actually left the button', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x + attack.radius * 0.9, y: attack.y }]);
    // A short drag that never clears the cancel circle is still an aim, not an
    // abort — otherwise a thumb landing on the rim could never cast at all.
    h.controls.syncPointers([{ id: 1, x: attack.x + attack.radius * 1.2, y: attack.y }]);
    h.controls.syncPointers([]);

    expect(h.calls.cancel).toEqual([]);
    expect(h.calls.commit).toEqual([0]);
  });

  it('re-arms if the thumb leaves the button again', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x - 200, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x - 200, y: attack.y }]);
    h.controls.syncPointers([]);

    expect(h.calls.cancel).toEqual([]);
    expect(h.calls.commit).toEqual([0]);
  });

  it('clears the slot’s aim when it aborts', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x - 200, y: attack.y }]);
    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([]);

    expect(h.calls.aim.at(-1)).toEqual({ slot: 0, world: null });
  });
});

describe('TouchControls — lifecycle', () => {
  it('aims before it presses, so a charge starts pointed somewhere', () => {
    const h = harness();
    h.setAutoTarget({ position: { x: 1000, y: 1600 } });

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);

    const aimIndex = h.calls.aim.findIndex(entry => entry.slot === 0 && entry.world);
    expect(aimIndex).toBeGreaterThanOrEqual(0);
    expect(h.calls.begin).toEqual([0]);
    // Order matters: beginSlot presses a charge, and it builds its context then.
    expect(h.calls.aim[aimIndex].world).not.toBeNull();
  });

  it('ignores everything while it is switched off', () => {
    const h = harness();
    h.controls.setEnabled(false);

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([]);
    h.controls.update();

    expect(h.calls.begin).toEqual([]);
    expect(h.calls.commit).toEqual([]);
  });

  it('cancels rather than casts when it is switched off mid-gesture', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.setEnabled(false);

    expect(h.calls.cancel).toEqual([0]);
    expect(h.calls.commit).toEqual([]);
  });

  it('drops gestures when the viewport changes under them', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.resize(390, 844);

    expect(h.calls.cancel).toEqual([0]);
    expect(h.controls.currentLayout.buttons[0].x).not.toBe(attack.x);
  });

  it('gives one slot to one thumb', () => {
    const h = harness();

    h.controls.syncPointers([
      { id: 1, x: attack.x, y: attack.y },
      { id: 2, x: attack.x + 4, y: attack.y + 4 },
    ]);

    expect(h.calls.begin).toEqual([0]);
  });

  it('ends a gesture whose touchend never arrived', () => {
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    // The finger simply stops appearing in the list.
    h.controls.syncPointers([]);

    expect(h.calls.commit).toEqual([0]);
  });
});

describe('TouchControls — haptics', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('pulses once when a combat button accepts a new thumb', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const h = harness();

    h.controls.syncPointers([{ id: 1, x: attack.x, y: attack.y }]);
    h.controls.syncPointers([
      { id: 1, x: attack.x, y: attack.y },
      { id: 2, x: attack.x + 2, y: attack.y + 2 },
    ]);

    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(vibrate).toHaveBeenCalledWith(10);
  });

  it('does not pulse for the movement joystick', () => {
    const vibrate = vi.fn();
    vi.stubGlobal('navigator', { vibrate });
    const h = harness();

    h.controls.syncPointers([{ id: 1, ...STICK }]);

    expect(vibrate).not.toHaveBeenCalled();
  });
});

describe('TouchControls — preference', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('reads an explicit query override before anything else', async () => {
    vi.stubGlobal('window', {
      location: { search: '?touch=1' },
      localStorage: { getItem: () => '0', setItem: () => undefined },
    });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(true);
  });

  it('lets the query switch the controls off on a real phone', async () => {
    vi.stubGlobal('window', {
      location: { search: '?touch=0' },
      localStorage: { getItem: () => '1', setItem: () => undefined },
    });
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(false);
  });

  it('remembers the on-screen toggle', async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => '1', setItem: () => undefined },
    });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(true);
  });

  it('falls back to whether the device has a touch screen', async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => null, setItem: () => undefined },
    });
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(true);
  });
});

describe('TouchControls — tri-state mode preference', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to auto with nothing stored', async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => null, setItem: () => undefined },
    });
    const { touchModePreference } = await import('../../../src/game/input/TouchControls');

    expect(touchModePreference()).toBe('auto');
  });

  it('reads a tri-state value back as-is', async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => 'touch', setItem: () => undefined },
    });
    const { touchModePreference } = await import('../../../src/game/input/TouchControls');

    expect(touchModePreference()).toBe('touch');
  });

  it("migrates the old toggle's '1' to 'touch'", async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => '1', setItem: () => undefined },
    });
    const { touchModePreference } = await import('../../../src/game/input/TouchControls');

    expect(touchModePreference()).toBe('touch');
  });

  it("migrates the old toggle's '0' to 'pointer'", async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => '0', setItem: () => undefined },
    });
    const { touchModePreference } = await import('../../../src/game/input/TouchControls');

    expect(touchModePreference()).toBe('pointer');
  });

  it('setTouchModePreference writes the tri-state value, not the legacy one', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => null, setItem },
    });
    const { setTouchModePreference } = await import('../../../src/game/input/TouchControls');

    setTouchModePreference('pointer');

    expect(setItem).toHaveBeenCalledWith('lol2d.touchControls', 'pointer');
  });

  it("'auto' still falls through to capability detection", async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => 'auto', setItem: () => undefined },
    });
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(false);
  });

  it("an explicit 'touch' preference wins over a mouse-only device", async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => 'touch', setItem: () => undefined },
    });
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(true);
  });

  it("an explicit 'pointer' preference wins over a touch-capable device", async () => {
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => 'pointer', setItem: () => undefined },
    });
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(false);
  });

  it('the query parameter still overrides a stored tri-state preference', async () => {
    vi.stubGlobal('window', {
      location: { search: '?touch=1' },
      localStorage: { getItem: () => 'pointer', setItem: () => undefined },
    });
    const { touchControlsPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchControlsPreference()).toBe(true);
  });

  it('rememberTouchControlsPreference still resolves to the equivalent tri-state value', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      location: { search: '' },
      localStorage: { getItem: () => null, setItem },
    });
    const { rememberTouchControlsPreference } =
      await import('../../../src/game/input/TouchControls');

    rememberTouchControlsPreference(true);
    expect(setItem).toHaveBeenCalledWith('lol2d.touchControls', 'touch');

    rememberTouchControlsPreference(false);
    expect(setItem).toHaveBeenCalledWith('lol2d.touchControls', 'pointer');
  });
});

describe('TouchControls — tap target preference', () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it('defaults to the nearest target', async () => {
    vi.stubGlobal('window', {
      localStorage: { getItem: () => null, setItem: () => undefined },
    });
    const { touchTargetPriorityPreference } = await import('../../../src/game/input/TouchControls');

    expect(touchTargetPriorityPreference()).toBe('nearest');
  });

  it('persists the lowest-health option', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', {
      localStorage: { getItem: () => 'lowest-health', setItem },
    });
    const { setTouchTargetPriorityPreference, touchTargetPriorityPreference } =
      await import('../../../src/game/input/TouchControls');

    expect(touchTargetPriorityPreference()).toBe('lowest-health');
    setTouchTargetPriorityPreference('lowest-health');
    expect(setItem).toHaveBeenCalledWith('lol2d.touchTargetPriority', 'lowest-health');
  });
});

describe('TouchControls — button visual', () => {
  const withView = (overrides: Partial<TouchSpellView>): TouchSpellView => ({
    ...view('DIRECTION'),
    ...overrides,
  });

  it('a real lockout dims the icon, draws the dark wedge, and shows seconds', () => {
    const visual = describeButtonVisual(
      withView({ onCooldown: true, remainingSeconds: 4, cooldownRatio: 0.4 })
    );
    expect(visual.dim).toBe(true);
    expect(visual.wedgeColor).toEqual(LOCKOUT_WEDGE_COLOR);
    expect(visual.showSeconds).toBe(true);
  });

  it('the swing rhythm never dims and never shows seconds, only the warm sweep', () => {
    // The basic attack: cooldownRatio ticks the whole game, onCooldown never does.
    const visual = describeButtonVisual(
      withView({
        onCooldown: false,
        remainingSeconds: 0,
        cooldownRatio: 0.7,
        affordable: true,
        castable: true,
      })
    );
    expect(visual.dim).toBe(false);
    expect(visual.wedgeColor).toEqual(RHYTHM_WEDGE_COLOR);
    expect(visual.showSeconds).toBe(false);
  });

  it('not enough mana dims the icon and turns the mana badge red, even off cooldown', () => {
    const visual = describeButtonVisual(
      withView({ onCooldown: false, affordable: false, manaCost: 50 })
    );
    expect(visual.dim).toBe(true);
    expect(visual.manaBadge).toEqual({ color: MANA_BADGE_SHORT_COLOR });
  });

  it('an affordable spell gets the quiet blue mana badge', () => {
    const visual = describeButtonVisual(withView({ manaCost: 40, affordable: true }));
    expect(visual.manaBadge).toEqual({ color: MANA_BADGE_COLOR });
  });

  it('a free spell (no mana cost) gets no badge at all', () => {
    const visual = describeButtonVisual(withView({ manaCost: 0 }));
    expect(visual.manaBadge).toBeNull();
  });

  it('an uncastable spell dims even at full mana and off cooldown', () => {
    const visual = describeButtonVisual(
      withView({ onCooldown: false, affordable: true, castable: false })
    );
    expect(visual.dim).toBe(true);
  });
});

/**
 * Hồi Thành's button. It does not go through `SpellInputController` — the
 * spell is not in `spells[]`, so there is no slot to press — and it fires on
 * *release inside*, not on touch-down: the whole point of the placement and
 * the gesture is that a thumb which lands on it by mistake can still get away.
 */
describe('TouchControls — the recall button', () => {
  const recallHarness = () => {
    const calls = { recall: 0 };
    const host: TouchControlsHost = {
      viewport: () => PHONE,
      slotCount: () => 7,
      spellView: () => view('DIRECTION'),
      recallView: () => view('SELF'),
      recall: () => {
        calls.recall++;
      },
      playerPosition: () => ORIGIN,
      playerFacing: () => ({ x: 1, y: 0 }),
      autoTargetWithin: () => null,
      pickUnitNear: () => null,
      steer: () => undefined,
      setSlotAim: () => undefined,
      beginSlot: () => undefined,
      commitSlot: () => undefined,
      cancelSlot: () => undefined,
      withWorldTransform: draw => draw(),
    };
    return { controls: new TouchControls(host, true), calls };
  };

  const RECALL = computeTouchLayout(PHONE, 7).recall;

  it('goes home when a thumb lifts off it', () => {
    const h = recallHarness();

    h.controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y }]);
    expect(h.calls.recall, 'fired on touch-down').toBe(0);

    h.controls.syncPointers([]);
    expect(h.calls.recall).toBe(1);
  });

  it('lets a thumb that landed on it by mistake slide off and escape', () => {
    const h = recallHarness();

    h.controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y }]);
    h.controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y + RECALL.radius * 3 }]);
    h.controls.syncPointers([]);

    expect(h.calls.recall).toBe(0);
  });

  it('takes a thumb back, so a slide-off-and-return still goes home', () => {
    const h = recallHarness();

    h.controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y }]);
    h.controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y + RECALL.radius * 3 }]);
    h.controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y }]);
    h.controls.syncPointers([]);

    expect(h.calls.recall).toBe(1);
  });

  it('presses no spell slot: there is no slot for a spell outside spells[]', () => {
    const calls: number[] = [];
    const host: TouchControlsHost = {
      viewport: () => PHONE,
      slotCount: () => 7,
      spellView: () => view('DIRECTION'),
      recallView: () => view('SELF'),
      recall: () => undefined,
      playerPosition: () => ORIGIN,
      playerFacing: () => ({ x: 1, y: 0 }),
      autoTargetWithin: () => null,
      pickUnitNear: () => null,
      steer: () => undefined,
      setSlotAim: () => undefined,
      beginSlot: slot => calls.push(slot),
      commitSlot: slot => calls.push(slot),
      cancelSlot: slot => calls.push(slot),
      withWorldTransform: draw => draw(),
    };
    const controls = new TouchControls(host, true);

    controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y }]);
    controls.syncPointers([]);

    expect(calls).toEqual([]);
  });

  it('does nothing at all for a champion with no recall', () => {
    const calls = { recall: 0 };
    const host: TouchControlsHost = {
      viewport: () => PHONE,
      slotCount: () => 7,
      spellView: () => view('DIRECTION'),
      recallView: () => null,
      recall: () => {
        calls.recall++;
      },
      playerPosition: () => ORIGIN,
      playerFacing: () => ({ x: 1, y: 0 }),
      autoTargetWithin: () => null,
      pickUnitNear: () => null,
      steer: () => undefined,
      setSlotAim: () => undefined,
      beginSlot: () => undefined,
      commitSlot: () => undefined,
      cancelSlot: () => undefined,
      withWorldTransform: draw => draw(),
    };
    const controls = new TouchControls(host, true);

    controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y }]);
    controls.syncPointers([]);

    expect(calls.recall).toBe(0);
  });

  it('drops a held press when touch mode is switched off mid-gesture', () => {
    const h = recallHarness();

    h.controls.syncPointers([{ id: 1, x: RECALL.x, y: RECALL.y }]);
    h.controls.setEnabled(false);
    h.controls.syncPointers([]);

    expect(h.calls.recall).toBe(0);
  });
});
