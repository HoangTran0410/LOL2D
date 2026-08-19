import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import Camera from '../../../src/game/gameObject/map/Camera';

const camera = (): Camera => {
  vi.stubGlobal('createVector', (x = 0, y = 0) => ({ x, y }));
  return new Camera();
};

describe('Camera under resize', () => {
  it('a resize recomputes the scale and leaves the manual factor alone', () => {
    const c = camera();
    c.fitTo(2560, 1440);
    c.setZoomFactor(1.3);
    const desktop = c.scale;

    c.fitTo(844, 390);

    // The factor is the player's; only the base moved.
    expect(c.zoomFactor).toBeCloseTo(1.3, 5);
    expect(c.scale).toBeCloseTo(0.39 * 1.3, 5);
    expect(c.scale).toBeLessThan(desktop);
  });

  it('a phone at the default factor lands at 0.39, not clipped to 0.5', () => {
    const c = camera();
    c.fitTo(844, 390);
    expect(c.scale).toBeCloseTo(0.39, 5);
  });

  it('snapToScale drops the opening lerp', () => {
    const c = camera();
    c.fitTo(844, 390);
    expect(c.currentScale).toBe(0.5); // the constructed default, un-lerped
    c.snapToScale();
    expect(c.currentScale).toBeCloseTo(0.39, 5);
  });

  /**
   * The zoom slider lives in the config panel's Cài đặt tab and reaches the
   * camera through `MatchConfigSource.live` — which is `null` on the menu, so
   * the control is not rendered there at all. The two halves are scanned
   * separately because they now sit in different files: the adapter owns the
   * camera calls, the tab owns the DOM wiring.
   */
  it('the paused settings slider snaps live zoom and persists only the committed mode', () => {
    const adapter = readFileSync('src/game/hud/config/MatchDirectorSource.ts', 'utf8');
    const tab = readFileSync('src/game/hud/config/SettingsTab.vue', 'utf8');

    // Snapped, because `Camera.update()` cannot lerp toward the new target
    // while the panel holds the match paused.
    expect(adapter).toMatch(
      /setZoom\(factor: number\): void \{[\s\S]*setZoomFactor\(factor\);[\s\S]*snapToScale\(\);/
    );
    expect(adapter).toContain('setZoomFactorPreference(host.camera.zoomFactor, host.touchUi)');
    // Dragging applies; only releasing writes the preference.
    expect(tab).toContain('@input="onZoomInput"');
    expect(tab).toContain('@change="persistZoom"');
  });
});
