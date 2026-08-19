import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import GameObject from '../../../src/game/gameObject/GameObject';
import ObjectManager from '../../../src/game/managers/ObjectManager';
import Camera from '../../../src/game/gameObject/map/Camera';
import { RENDER_SNAP_PX } from '../../../src/game/render/Interpolation';
import { Rectangle } from '../../../src/libs/quadtree';
import { stubGameGlobals } from '../fixtures';

/**
 * The pure maths lives in `Interpolation.test.ts`. This file proves the *wiring*
 * the design's §3 asks for: the tick origin every object records, the
 * substitute/restore the draw pass does around it, and the same for the camera.
 */

// A camera that retrieves the whole tree, so nothing is culled before it can be
// interpolated — culling on the true position is a separate concern.
const wideCamera = {
  getBoundingBox: () => new Rectangle({ x: 0, y: 0, w: 4000, h: 4000 }),
  constantSize: (px: number) => px,
  currentScale: 1,
};

/** Records the position the renderer actually handed it, so a blend is visible. */
class DrawProbe extends GameObject {
  seenX = NaN;
  seenY = NaN;
  drawCount = 0;
  constructor() {
    super({ visionRadius: 20 });
  }
  draw() {
    this.seenX = this.position.x;
    this.seenY = this.position.y;
    this.drawCount++;
  }
}

function managerWith(probe: GameObject): ObjectManager {
  const manager = new ObjectManager({ mapSize: 4000, camera: wideCamera } as never);
  manager.objects = [probe];
  manager._objectsTree.insert(probe.getDisplayBoundingBox());
  return manager;
}

beforeEach(() => stubGameGlobals());
afterEach(() => vi.unstubAllGlobals());

describe('GameObject render origin', () => {
  it('starts at the object position and collapses back onto it', () => {
    const o = new GameObject({ visionRadius: 10 });
    expect(o.renderOriginX).toBe(0);
    expect(o.renderOriginY).toBe(0);
    o.position.set(40, 60);
    o.snapRenderOrigin();
    expect(o.renderOriginX).toBe(40);
    expect(o.renderOriginY).toBe(60);
  });

  it('teleportTo snaps the origin so a blink is not drawn as a slide', () => {
    const o = new GameObject({ visionRadius: 10 });
    o.position.set(10, 10);
    o.snapRenderOrigin();
    o.teleportTo(900, 900);
    expect(o.renderOriginX).toBe(900);
    expect(o.renderOriginY).toBe(900);
  });
});

describe('ObjectManager.update snapshots the tick origin', () => {
  it('records where each object began the tick, before its own update moved it', () => {
    class Mover extends GameObject {
      constructor() {
        super({ visionRadius: 5 });
        this.position.set(0, 0);
      }
      update() {
        this.position.set(this.position.x + 3, this.position.y);
      }
    }
    const mover = new Mover();
    const manager = new ObjectManager({ mapSize: 4000, camera: wideCamera } as never);
    manager.objects = [mover];
    manager.update();
    expect(mover.renderOriginX).toBe(0);
    expect(mover.position.x).toBe(3);
  });
});

describe('ObjectManager.draw interpolates between the tick endpoints', () => {
  it('alpha 1 is a no-op — the object is drawn at its true position', () => {
    const probe = new DrawProbe();
    probe.position.set(100, 60);
    probe.renderOriginX = 0;
    probe.renderOriginY = 0;
    const manager = managerWith(probe);
    manager.draw(1);
    expect(probe.drawCount).toBe(1);
    expect(probe.seenX).toBe(100);
    expect(probe.seenY).toBe(60);
    expect(probe.position.x).toBe(100);
    expect(probe.position.y).toBe(60);
  });

  it('alpha 0.5 draws the object at the midpoint of its step', () => {
    const probe = new DrawProbe();
    probe.position.set(100, 60);
    probe.renderOriginX = 0;
    probe.renderOriginY = 0;
    const manager = managerWith(probe);
    manager.draw(0.5);
    expect(probe.seenX).toBe(50);
    expect(probe.seenY).toBe(30);
  });

  it('restores the true position after the draw pass', () => {
    const probe = new DrawProbe();
    probe.position.set(100, 60);
    probe.renderOriginX = 0;
    probe.renderOriginY = 0;
    const manager = managerWith(probe);
    manager.draw(0.5);
    expect(probe.position.x).toBe(100);
    expect(probe.position.y).toBe(60);
  });

  it('draws a jump at its true position rather than sliding across it', () => {
    const probe = new DrawProbe();
    const jump = RENDER_SNAP_PX + 50;
    probe.position.set(jump, 60);
    probe.renderOriginX = 0;
    probe.renderOriginY = 0;
    const manager = managerWith(probe);
    manager.draw(0.5);
    // A step past the snap distance is not a journey: drawn where it is, not halfway.
    expect(probe.seenX).toBe(jump);
    expect(probe.seenY).toBe(60);
  });
});

describe('Camera render interpolation', () => {
  it('blends position and scale to the midpoint, then restores', () => {
    const cam = new Camera();
    cam.position.set(0, 0);
    cam.currentScale = 1;
    cam.snapshotRenderOrigin();
    cam.position.set(100, 200);
    cam.currentScale = 2;

    cam.applyRenderOrigin(0.5);
    expect(cam.position.x).toBe(50);
    expect(cam.position.y).toBe(100);
    expect(cam.currentScale).toBe(1.5);

    cam.restoreRenderOrigin();
    expect(cam.position.x).toBe(100);
    expect(cam.position.y).toBe(200);
    expect(cam.currentScale).toBe(2);
  });

  it('restore is a no-op when nothing was substituted', () => {
    const cam = new Camera();
    cam.position.set(300, 400);
    cam.currentScale = 1.25;
    cam.restoreRenderOrigin();
    expect(cam.position.x).toBe(300);
    expect(cam.position.y).toBe(400);
    expect(cam.currentScale).toBe(1.25);
  });
});
