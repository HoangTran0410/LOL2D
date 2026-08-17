import { describe, expect, it } from 'vitest';
import { JOYSTICK_DEAD_ZONE, VirtualJoystick } from '../../../src/game/input/VirtualJoystick';

const VIEWPORT = { width: 900, height: 420 };

const grab = (x = 200, y = 300, radius = 80) => {
  const stick = new VirtualJoystick();
  stick.begin(1, x, y, radius, VIEWPORT);
  return stick;
};

describe('VirtualJoystick', () => {
  it('reads as centred until it is touched', () => {
    const stick = new VirtualJoystick();

    expect(stick.active).toBe(false);
    expect(stick.magnitude).toBe(0);
    expect(stick.vector).toEqual({ x: 0, y: 0 });
  });

  it('re-centres its base under the thumb that grabbed it', () => {
    const stick = grab(210, 330);

    expect(stick.base).toEqual({ x: 210, y: 330 });
    expect(stick.active).toBe(true);
  });

  it('keeps the whole ring on screen when grabbed at the very edge', () => {
    const stick = grab(4, 416, 80);

    expect(stick.base.x).toBe(80);
    expect(stick.base.y).toBe(VIEWPORT.height - 80);
  });

  it('stays silent inside the dead zone', () => {
    const stick = grab(200, 300, 80);
    // 10px out of 80 is 0.125 of the throw, inside the 0.18 dead zone.
    stick.moveTo(210, 300);

    expect(stick.magnitude).toBe(0);
    expect(stick.vector).toEqual({ x: 0, y: 0 });
  });

  it('produces a unit direction once out of the dead zone', () => {
    const stick = grab(200, 300, 80);
    stick.moveTo(200 + 30, 300 + 40); // length 50, comfortably past the zone

    expect(stick.vector.x).toBeCloseTo(0.6, 6);
    expect(stick.vector.y).toBeCloseTo(0.8, 6);
  });

  it('remaps the throw so it starts at zero where the dead zone ends', () => {
    const stick = grab(200, 300, 100);

    stick.moveTo(200 + JOYSTICK_DEAD_ZONE * 100, 300);
    expect(stick.magnitude).toBe(0);

    // Exactly halfway between the edge of the dead zone and the rim.
    const half = JOYSTICK_DEAD_ZONE + (1 - JOYSTICK_DEAD_ZONE) / 2;
    stick.moveTo(200 + half * 100, 300);
    expect(stick.magnitude).toBeCloseTo(0.5, 6);
  });

  it('saturates at full throw beyond the ring', () => {
    const stick = grab(200, 300, 80);
    stick.moveTo(200 + 400, 300);

    expect(stick.magnitude).toBe(1);
    expect(stick.vector).toEqual({ x: 1, y: 0 });
  });

  it('clamps the drawn knob to the ring while the direction keeps reading', () => {
    const stick = grab(200, 300, 80);
    stick.moveTo(200 + 400, 300);

    expect(stick.knob).toEqual({ x: 280, y: 300 });
  });

  it('leaves the knob where the thumb is while inside the ring', () => {
    const stick = grab(200, 300, 80);
    stick.moveTo(230, 320);

    expect(stick.knob).toEqual({ x: 230, y: 320 });
  });

  it('goes quiet the instant it is released', () => {
    const stick = grab(200, 300, 80);
    stick.moveTo(400, 300);
    stick.end();

    expect(stick.active).toBe(false);
    expect(stick.magnitude).toBe(0);
    expect(stick.vector).toEqual({ x: 0, y: 0 });
  });

  it('ignores movement from a thumb it does not have', () => {
    const stick = new VirtualJoystick();
    stick.moveTo(500, 500);

    expect(stick.active).toBe(false);
    expect(stick.magnitude).toBe(0);
  });
});
