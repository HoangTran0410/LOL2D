/**
 * "What does this spell do?" on the loadout editor, and the two holes this
 * suite was written to close:
 *
 *   1. The slot bar above the roster answered the question for *no* spell.
 *      Hovering a `.catalog-spell-card` described it; hovering the `.kit-slot-pill`
 *      holding the very same spell — the one already in your kit, the one you
 *      are most likely to be asking about — did nothing at all.
 *   2. A description opened by a thumb could not be closed by one. There was
 *      no dismiss target: `.spell-peek` is `pointer-events: none` (deliberately
 *      — a hover panel must not be a click target), and the only thing that
 *      ever took it down was a 3s timer started by `touchEnd()`, which runs off
 *      the *click* the browser synthesises after the hold. When that click
 *      never arrives — a long press that raises the platform's own
 *      image/context menu is the common way — the timer is never armed and the
 *      panel stays up for the rest of the session.
 *
 * The composable tests below are the behaviour; the source scans are the
 * wiring, which no unit test in a `node` environment can reach.
 */
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PEEK_LONG_PRESS_MS, useSpellPeek } from '../../src/scenes/setup/useSpellPeek';
import type { SpellDisplay } from '../../src/game/preset';

const display = (name: string): SpellDisplay =>
  ({
    name,
    description: `${name} description`,
    effectiveCoolDownMs: 6000,
    effectiveManaCost: 40,
  }) as SpellDisplay;

/** Enough of an element for `place()`: it only ever reads the rect. */
const target = () =>
  ({
    getBoundingClientRect: () => ({ x: 40, y: 120, width: 42, height: 42, bottom: 162 }),
  }) as unknown as HTMLElement;

const touch = (x = 50, y = 140) =>
  ({ currentTarget: target(), touches: [{ clientX: x, clientY: y }] }) as unknown as TouchEvent;

const hover = () => ({ currentTarget: target() }) as unknown as MouseEvent;

describe('useSpellPeek', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // `window` is the composable's own timer/viewport source; pointing it at
    // `globalThis` is what lets `vi.useFakeTimers()` reach the `setTimeout`
    // inside it (same trick as tests/game/hud/hudInteractions.test.ts).
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('innerWidth', 390);
    vi.stubGlobal('innerHeight', 844);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('opens on a hold and stays open after the thumb lifts', () => {
    const peek = useSpellPeek();

    peek.touchStart(display('Lux Q'), touch());
    vi.advanceTimersByTime(PEEK_LONG_PRESS_MS);
    expect(peek.display.value?.name).toBe('Lux Q');

    // The lift. Nothing here may arm a timer that takes the description away
    // while it is being read — dismissal is a gesture the player makes.
    expect(peek.touchEnd()).toBe(true);
    vi.advanceTimersByTime(60_000);
    expect(peek.display.value?.name).toBe('Lux Q');
  });

  it('marks a held-open description as one a thumb has to dismiss', () => {
    const peek = useSpellPeek();

    expect(peek.heldOpen.value).toBe(false);

    peek.touchStart(display('Lux Q'), touch());
    vi.advanceTimersByTime(PEEK_LONG_PRESS_MS);
    peek.touchEnd();
    expect(peek.heldOpen.value).toBe(true);

    peek.close();
    expect(peek.display.value).toBeNull();
    expect(peek.heldOpen.value).toBe(false);
  });

  it('leaves the hover path alone: no dismiss layer, closes on leave', () => {
    const peek = useSpellPeek();

    peek.hoverStart(display('Ahri Q'), hover());
    expect(peek.display.value?.name).toBe('Ahri Q');
    expect(peek.heldOpen.value).toBe(false);

    peek.hoverEnd();
    expect(peek.display.value).toBeNull();
  });

  it("a hover after a hold is not swallowed as the hold's leftover click", () => {
    const peek = useSpellPeek();

    peek.touchStart(display('Lux Q'), touch());
    vi.advanceTimersByTime(PEEK_LONG_PRESS_MS);
    peek.touchEnd();
    peek.close();

    // `touchEnd()` returning true means "drop the click that follows a hold".
    // Once the panel is gone the hold is over, so the next plain click is a
    // real one and must reach the roster.
    expect(peek.touchEnd()).toBe(false);
  });

  it('a new gesture never inherits the last one’s panel', () => {
    const peek = useSpellPeek();

    peek.touchStart(display('Lux Q'), touch());
    vi.advanceTimersByTime(PEEK_LONG_PRESS_MS);
    // Deliberately no `touchEnd()`: this is the device that swallows it, and
    // the panel is now up with no dismiss layer over it.
    peek.touchStart(display('Ahri Q'), touch());
    expect(peek.display.value).toBeNull();

    vi.advanceTimersByTime(PEEK_LONG_PRESS_MS);
    expect(peek.display.value?.name).toBe('Ahri Q');
  });

  it('a scroll cancels the hold before it opens anything', () => {
    const peek = useSpellPeek();

    peek.touchStart(display('Lux Q'), touch(50, 140));
    peek.touchMove({ touches: [{ clientX: 50, clientY: 220 }] } as unknown as TouchEvent);
    vi.advanceTimersByTime(PEEK_LONG_PRESS_MS * 2);

    expect(peek.display.value).toBeNull();
    expect(peek.touchEnd()).toBe(false);
  });
});

/** Comments describe the rules; only the code may satisfy the scan. */
const codeOf = (path: string): string =>
  readFileSync(path, 'utf8')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

describe('the loadout editor wires one description panel', () => {
  const modal = codeOf('src/scenes/setup/LoadoutEditorModal.vue');
  const roster = codeOf('src/scenes/setup/KitRoster.vue');

  it('the slot bar answers the same question the roster does', () => {
    expect(modal).toContain('hoverStart(detailOf(slot.entry), $event)');
    expect(modal).toContain('hoverEnd()');
    expect(modal).toContain('touchStart(detailOf(slot.entry), $event)');
    expect(modal).toContain('touchMove($event)');
  });

  it('a hold on a slot pill describes it instead of selecting it', () => {
    expect(modal).toMatch(/const selectSlot[^;]*?\{\s*if \(touchEnd\(\)\) return;/s);
  });

  it('is the only owner of the panel, so two can never be up at once', () => {
    expect(modal).toContain('useSpellPeek()');
    expect(roster).not.toContain('useSpellPeek()');
    expect(roster).toContain('peek: SpellPeek');
  });

  it('gives a held-open description something to close it', () => {
    expect(modal).toContain('spell-peek-scrim');
    expect(modal).toContain('@touchstart.prevent="closePeek()"');
    // Rendered by the hold, not by the layout mode: a hold on a
    // touch-capable laptop that is still in pointer layout needs the same
    // way out that a phone does.
    expect(modal).toMatch(/v-if="peekHeldOpen"/);
  });

  it('keeps the hold instead of losing it to the platform image menu', () => {
    expect(modal).toContain('@contextmenu.prevent');
    expect(roster).toContain('@contextmenu.prevent');
  });

  it('starts the gesture state machine on the touch itself, not on the click after it', () => {
    // The bug: `touchEnd()` used to run only from the click handler, so a
    // hold whose click the platform swallowed left the state machine mid-hold.
    expect(modal).toContain('@touchend="touchEnd()"');
    expect(roster).toContain('@touchend="touchEnd()"');
  });
});
