import { describe, expect, it } from 'vitest';
import {
  buttonAt,
  computeTouchLayout,
  hitRecall,
  insideJoystickZone,
  RECALL_SLOT,
} from '../../../src/game/input/TouchLayout';
import { minimapRect } from '../../../src/game/gameObject/map/Minimap';

/** A landscape phone: iPhone 14 rotated, in CSS pixels. */
const PHONE = { width: 844, height: 390 };
const SLOTS = 7;

describe('computeTouchLayout', () => {
  it('places every slot the champion has', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(layout.buttons.map(button => button.slot)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('makes slot 0 the biggest button, because it is the attack', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const attack = layout.buttons[0];

    expect(attack.primary).toBe(true);
    for (const other of layout.buttons.slice(1)) {
      expect(other.radius).toBeLessThan(attack.radius);
    }
  });

  it('gives every button a target far bigger than the 3em desktop icon', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    // 48px is the smallest tap target the platform guidelines accept; the
    // desktop icons are 48px *square*, which is a 34px inscribed circle.
    for (const button of layout.buttons) {
      expect(button.radius * 2).toBeGreaterThanOrEqual(44);
    }
    expect(layout.buttons[0].radius * 2).toBeGreaterThanOrEqual(78);
  });

  it('puts the stick bottom-left and the spells bottom-right', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(layout.joystickHome.x).toBeLessThan(PHONE.width * 0.3);
    expect(layout.joystickHome.y).toBeGreaterThan(PHONE.height * 0.6);
    expect(layout.buttons[0].x).toBeGreaterThan(PHONE.width * 0.7);
    expect(layout.buttons[0].y).toBeGreaterThan(PHONE.height * 0.6);
  });

  it('arcs the abilities from beside the attack button round to above it', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const abilities = [1, 2, 3, 4].map(slot => layout.buttons.find(b => b.slot === slot)!);

    // Each one is higher than the last: the arc sweeps anticlockwise.
    for (let i = 1; i < abilities.length; i++) {
      expect(abilities[i].y).toBeLessThan(abilities[i - 1].y);
    }
    // Q is the leftmost, R the highest.
    expect(abilities[0].x).toBeLessThan(abilities[3].x);
    expect(abilities[3].y).toBeLessThan(abilities[0].y);
  });

  it('keeps every ability compact around attack without crowding touch targets', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const attack = layout.buttons.find(button => button.slot === 0)!;
    const abilities = [1, 2, 3, 4].map(slot =>
      layout.buttons.find(button => button.slot === slot)!
    );
    const summoners = [5, 6].map(slot => layout.buttons.find(button => button.slot === slot)!);

    for (const ability of abilities) {
      const edgeGap =
        Math.hypot(ability.x - attack.x, ability.y - attack.y) - ability.radius - attack.radius;
      expect(edgeGap, `slot ${ability.slot} is too far from attack`).toBeLessThanOrEqual(32);
      expect(edgeGap, `slot ${ability.slot} crowds attack`).toBeGreaterThanOrEqual(8);
      expect(ability.radius * 2).toBeGreaterThanOrEqual(44);
    }

    const furthestAbilityCentre = Math.max(
      ...abilities.map(ability => Math.hypot(ability.x - attack.x, ability.y - attack.y))
    );
    for (const summoner of summoners) {
      expect(Math.hypot(summoner.x - attack.x, summoner.y - attack.y)).toBeGreaterThan(
        furthestAbilityCentre
      );
    }
  });

  it('never lets two buttons overlap, at any viewport', () => {
    for (const viewport of [
      PHONE,
      { width: 667, height: 375 },
      { width: 932, height: 430 },
      { width: 1280, height: 800 },
    ]) {
      const layout = computeTouchLayout(viewport, SLOTS);
      for (let i = 0; i < layout.buttons.length; i++) {
        for (let j = i + 1; j < layout.buttons.length; j++) {
          const a = layout.buttons[i];
          const b = layout.buttons[j];
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
          expect(
            gap,
            `${viewport.width}x${viewport.height}: slots ${a.slot} and ${b.slot} overlap by ${-gap}`
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('keeps a real thumb gap between buttons on short landscape phones', () => {
    for (const viewport of [PHONE, { width: 667, height: 375 }]) {
      const buttons = computeTouchLayout(viewport, SLOTS).buttons;
      for (let i = 0; i < buttons.length; i++) {
        for (let j = i + 1; j < buttons.length; j++) {
          const a = buttons[i];
          const b = buttons[j];
          const gap = Math.hypot(a.x - b.x, a.y - b.y) - a.radius - b.radius;
          expect(
            gap,
            `${viewport.width}x${viewport.height}: slots ${a.slot}/${b.slot}`
          ).toBeGreaterThanOrEqual(10);
        }
      }
    }
  });

  it('keeps the stick clear of every spell button', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    for (const button of layout.buttons) {
      const gap =
        Math.hypot(button.x - layout.joystickHome.x, button.y - layout.joystickHome.y) -
        button.radius -
        layout.joystickHome.radius;
      expect(gap).toBeGreaterThan(0);
    }
  });

  it('keeps every button fully on screen', () => {
    for (const viewport of [PHONE, { width: 667, height: 375 }, { width: 1280, height: 800 }]) {
      const layout = computeTouchLayout(viewport, SLOTS);
      for (const button of layout.buttons) {
        expect(button.x - button.radius).toBeGreaterThanOrEqual(0);
        expect(button.y - button.radius).toBeGreaterThanOrEqual(0);
        expect(button.x + button.radius).toBeLessThanOrEqual(viewport.width);
        expect(button.y + button.radius).toBeLessThanOrEqual(viewport.height);
      }
    }
  });

  it('leaves the middle of the screen free of both thumbs', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const midX = PHONE.width / 2;

    expect(layout.joystickZone.x + layout.joystickZone.w).toBeLessThan(midX);
    for (const button of layout.buttons) {
      expect(button.x - button.radius).toBeGreaterThan(midX);
    }
  });

  it('copes with a champion carrying fewer slots', () => {
    const layout = computeTouchLayout(PHONE, 5);

    expect(layout.buttons.map(button => button.slot)).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('buttonAt', () => {
  it('finds the button under a thumb', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const target = layout.buttons[2];

    expect(buttonAt(layout, target.x, target.y)?.slot).toBe(target.slot);
  });

  it('is forgiving at the rim but not beyond it', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const attack = layout.buttons[0];

    expect(buttonAt(layout, attack.x + attack.radius * 1.1, attack.y)?.slot).toBe(0);
    expect(buttonAt(layout, attack.x + attack.radius * 3, attack.y)).toBeNull();
  });

  it('gives an overlapping thumb to the nearest centre', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const attack = layout.buttons[0];
    const q = layout.buttons.find(b => b.slot === 1)!;
    const midX = (attack.x + q.x) / 2;
    const midY = (attack.y + q.y) / 2;

    const nearAttack = buttonAt(
      layout,
      midX + (attack.x - midX) * 0.6,
      midY + (attack.y - midY) * 0.6
    );
    expect(nearAttack?.slot).toBe(0);
  });

  it('returns nothing for the empty middle of the screen', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(buttonAt(layout, PHONE.width / 2, PHONE.height / 2)).toBeNull();
  });
});

describe('insideJoystickZone', () => {
  it('accepts a thumb anywhere in the lower left', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(insideJoystickZone(layout, 40, PHONE.height - 40)).toBe(true);
    expect(insideJoystickZone(layout, PHONE.width * 0.4, PHONE.height * 0.5)).toBe(true);
  });

  it('rejects the right half, so a spell gesture is never eaten', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(insideJoystickZone(layout, PHONE.width * 0.6, PHONE.height - 40)).toBe(false);
  });

  it('rejects the top strip, where the HUD lives', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(insideJoystickZone(layout, 60, 10)).toBe(false);
  });
});

/**
 * Hồi Thành's button. On a phone there is no `B` key, so without this the
 * ability is simply unreachable — but a recall pressed in the middle of a
 * teamfight is a death, so the whole design question is *where it is not*.
 *
 * It is kept out of `layout.buttons` on purpose: that array is indexed by kit
 * slot and drives `SpellInputController`, which knows nothing about a spell
 * that is not in `spells[]`.
 */
describe('the recall button', () => {
  const VIEWPORTS = [PHONE, { width: 667, height: 375 }, { width: 932, height: 430 }];

  it('is not one of the kit slots', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(RECALL_SLOT).toBeLessThan(0);
    expect(layout.recall.slot).toBe(RECALL_SLOT);
    expect(layout.buttons.map(button => button.slot)).not.toContain(RECALL_SLOT);
  });

  it('is a thumb-sized target at every viewport, fully on screen', () => {
    for (const viewport of [...VIEWPORTS, { width: 1280, height: 800 }]) {
      const recall = computeTouchLayout(viewport, SLOTS).recall;

      expect(recall.radius * 2, `${viewport.width}x${viewport.height}`).toBeGreaterThanOrEqual(44);
      expect(recall.x - recall.radius).toBeGreaterThanOrEqual(0);
      expect(recall.y - recall.radius).toBeGreaterThanOrEqual(0);
      expect(recall.x + recall.radius).toBeLessThanOrEqual(viewport.width);
      expect(recall.y + recall.radius).toBeLessThanOrEqual(viewport.height);
    }
  });

  it('sits along the top edge, where neither thumb rests during a fight', () => {
    for (const viewport of VIEWPORTS) {
      const layout = computeTouchLayout(viewport, SLOTS);
      const recall = layout.recall;

      expect(recall.y + recall.radius, `${viewport.width}x${viewport.height}`).toBeLessThan(
        viewport.height * 0.3
      );
      expect(insideJoystickZone(layout, recall.x, recall.y)).toBe(false);
    }
  });

  /**
   * Far wider than the 10px the abilities get from each other. A thumb that
   * slips between Q and W casts the wrong spell; a thumb that slips onto this
   * one leaves the fight.
   */
  it('keeps a wide moat between itself and every ability', () => {
    for (const viewport of VIEWPORTS) {
      const layout = computeTouchLayout(viewport, SLOTS);
      const recall = layout.recall;
      for (const button of layout.buttons) {
        const gap =
          Math.hypot(recall.x - button.x, recall.y - button.y) - recall.radius - button.radius;
        expect(gap, `${viewport.width}x${viewport.height}: slot ${button.slot}`).toBeGreaterThan(
          40
        );
      }
    }
  });

  /**
   * Two things already own the top-right: `InGameHUD.vue`'s practice-panel
   * button (a DOM control, `top: 6px; right: 6px`, 46px square in touch mode)
   * and the expanded minimap, which `Game.syncTouches` gives first refusal on
   * every new finger — a tap that lands on it teleports instead.
   */
  it('clears the practice-panel corner button and the expanded minimap', () => {
    for (const viewport of VIEWPORTS) {
      const recall = computeTouchLayout(viewport, SLOTS).recall;
      const label = `${viewport.width}x${viewport.height}`;

      // 46px button + its 6px inset from the right edge.
      expect(recall.x + recall.radius, `${label}: corner button`).toBeLessThan(
        viewport.width - 52 - 12
      );

      const map = minimapRect(true, viewport);
      const overlaps =
        recall.x + recall.radius > map.x &&
        recall.x - recall.radius < map.x + map.size &&
        recall.y + recall.radius > map.y &&
        recall.y - recall.radius < map.y + map.size;
      expect(overlaps, `${label}: expanded minimap`).toBe(false);
    }
  });

  it('is hit-tested with no slack at all, unlike the ability buttons', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);
    const recall = layout.recall;

    expect(hitRecall(layout, recall.x, recall.y)).toBe(true);
    // `buttonAt` forgives a thumb out to 1.15 radii. This one does not: it is
    // the one button on screen a mis-hit is expensive on.
    expect(hitRecall(layout, recall.x + recall.radius * 1.1, recall.y)).toBe(false);
  });

  it('is invisible to buttonAt, so it can never be read as a kit slot', () => {
    const layout = computeTouchLayout(PHONE, SLOTS);

    expect(buttonAt(layout, layout.recall.x, layout.recall.y)).toBeNull();
  });
});
