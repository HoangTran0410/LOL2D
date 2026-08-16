import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: () => 'asset',
    getAsset: () => 'asset',
    renderable: () => 'image',
  },
}));

import { Leblanc_W_Object } from '../../../src/game/gameObject/spells/Leblanc_W';
import Champion from '../../../src/game/gameObject/attackableUnits/Champion';
import { createGame } from '../fixtures';

/**
 * LeBlanc's W marker is a decoy, and a decoy has to fool somebody.
 *
 * The two things it must do pull against each other: LeBlanc needs to know how
 * long she has left to blink back, and the enemy must not be told which
 * LeBlanc is the real one. Drawing the countdown for everybody resolves that
 * in the enemy's favour — a ring under the copy is a label reading "fake" —
 * which is what reduced the ability to a mobility tool.
 *
 * So the property is an asymmetry, and it has to be tested as one: the same
 * object, drawn twice, differing by nothing but who is looking.
 */
let calls: Record<string, unknown[][]>;

function record(name: string) {
  return (...args: unknown[]) => {
    (calls[name] ??= []).push(args);
  };
}

function stubDrawing() {
  calls = {};
  for (const name of [
    'push', 'pop', 'translate', 'rotate', 'fill', 'noFill', 'stroke', 'noStroke',
    'strokeWeight', 'circle', 'ellipse', 'arc', 'line', 'image', 'tint', 'noTint',
    'blendMode', 'triangle', 'rect', 'beginShape', 'vertex', 'endShape', 'quad',
  ]) {
    vi.stubGlobal(name, record(name));
  }
  vi.stubGlobal('ADD', 'add');
  vi.stubGlobal('BLEND', 'blend');
  vi.stubGlobal('constrain', (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi));
  vi.stubGlobal('lerp', (a: number, b: number, k: number) => a + (b - a) * k);
  vi.stubGlobal('sin', Math.sin);
  vi.stubGlobal('cos', Math.cos);
  vi.stubGlobal('random', (lo = 0, hi = 1) => (lo + hi) / 2);
  vi.stubGlobal('frameCount', 0);
  vi.stubGlobal('deltaTime', 16);
  vi.stubGlobal('PI', Math.PI);
  vi.stubGlobal('TWO_PI', Math.PI * 2);
  vi.stubGlobal('HALF_PI', Math.PI / 2);
  vi.stubGlobal('createVector', (x = 0, y = 0) => ({
    x, y, copy() { return { ...this }; }, set(a: number, b: number) { this.x = a; this.y = b; return this; },
  }));
}

/** A marker owned by LeBlanc, seen by whoever `viewer` says. */
function markerSeenBy(viewer: 'ally' | 'enemy') {
  const game = createGame();
  Object.assign(game.camera, { currentScale: 1, constantSize: (px: number) => px });
  const leblanc = new Champion({ game, position: createVector(0, 0), teamId: 'blue' } as never);
  leblanc.stats.size.baseValue = 60;
  (leblanc as unknown as { avatar: string }).avatar = 'asset';

  if (viewer === 'ally') {
    game.setPlayer(leblanc);
  } else {
    const foe = new Champion({ game, position: createVector(0, 0), teamId: 'red' } as never);
    game.setPlayer(foe);
  }

  const marker = new Leblanc_W_Object(leblanc);
  marker.position = createVector(0, 0) as never;
  marker.age = 1_000; // fully formed, well before decay
  return marker;
}

beforeEach(() => stubDrawing());
afterEach(() => vi.unstubAllGlobals());

describe('the W marker fools the enemy and informs LeBlanc', () => {
  it('shows LeBlanc her countdown, and hides it from the enemy', () => {
    markerSeenBy('ally').draw();
    const allySawArc = (calls.arc ?? []).length;

    stubDrawing();
    markerSeenBy('enemy').draw();
    const enemySawArc = (calls.arc ?? []).length;

    expect(allySawArc).toBeGreaterThan(0);
    expect(enemySawArc).toBe(0);
  });

  it('draws the champion avatar for both, because that is the lie', () => {
    for (const viewer of ['ally', 'enemy'] as const) {
      stubDrawing();
      markerSeenBy(viewer).draw();
      expect((calls.image ?? []).length, `${viewer} saw no avatar`).toBeGreaterThan(0);
    }
  });

  it('throws no glass — the decoy is a reflection, not a broken window', () => {
    for (const viewer of ['ally', 'enemy'] as const) {
      stubDrawing();
      markerSeenBy(viewer).draw();
      expect((calls.triangle ?? []).length, `${viewer} saw shards`).toBe(0);
    }
  });

  it('never paints an opaque disc over the avatar', () => {
    stubDrawing();
    markerSeenBy('enemy').draw();
    // the old version washed the copy with fill(126,62,200,~150) and a circle
    // the size of her body, which is what made it unmistakably not a champion
    const heavyWash = (calls.fill ?? []).some(
      args => typeof args[3] === 'number' && (args[3] as number) > 100
    );
    expect(heavyWash).toBe(false);
  });
});
