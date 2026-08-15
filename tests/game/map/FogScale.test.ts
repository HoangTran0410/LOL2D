import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

// A source assertion, deliberately. The defect is "reads the target scale
// instead of the lerped one", which is invisible in any single-frame render
// test — the two values are equal whenever the camera is at rest, which is
// every frame a unit test ever produces. What is actually being pinned is
// that nobody reintroduces `camera.scale` here.
describe('FogOfWar reads the lerped scale', () => {
  it('uses currentScale, never the target scale', () => {
    const source = readFileSync('src/game/gameObject/map/FogOfWar.ts', 'utf8');
    expect(source).not.toMatch(/camera\.scale\b/);
    expect(source).toMatch(/camera\.currentScale\b/);
  });
});
