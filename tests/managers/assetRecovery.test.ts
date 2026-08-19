import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import AssetManager from '../../src/managers/AssetManager';
import { assetManifest, type AssetKey } from '../../src/generated/assetManifest';

/**
 * Recovering from the browser throwing away every image in the game.
 *
 * Reported from a real match on an installed PWA: background the app, come back
 * five minutes later, and every avatar and every spell icon is blank while
 * every shape the game *draws* is fine. That split is the whole diagnosis. p5
 * 1.11 builds a `p5.Image` out of `document.createElement('canvas')`
 * (`p5.js:96392`) and `loadImage` draws the decoded `<img>` into it exactly once
 * before dropping it (`p5.js:94848`) — so all ~370 assets live as off-DOM
 * canvas backing stores, which is precisely what a mobile browser reclaims
 * under memory pressure. Vector drawing survives because it repaints the
 * visible canvas every frame.
 *
 * The repaint has to land in the **same** `p5.Image` object: every champion,
 * spell and HUD row is holding a reference to it, and swapping the handle's
 * `data` for a fresh image would leave all of them pointing at the blank one.
 *
 * Both halves of the browser contact are injectable, because the suite runs on
 * `environment: 'node'` — there is no `document` to make a canvas out of and no
 * `Image` to decode with.
 */

/** Stands in for a `p5.Image`: the one method the repaint reaches for. */
const fakeImage = () => {
  const painted: unknown[] = [];
  return {
    painted,
    width: 4,
    height: 4,
    drawingContext: {
      drawImage: (source: unknown) => painted.push(source),
    },
  };
};

const imageKeys = (Object.keys(assetManifest) as AssetKey[]).filter(
  key => assetManifest[key].kind === 'image'
);

/** A key nobody else in this file has touched, so the static caches cannot collide. */
let nextKey = 0;
const freshKey = (): AssetKey => imageKeys[nextKey++];

const realLost = AssetManager.backingStoresLost;
const realArm = AssetManager.armBackingStoreProbe;

describe('recovering images the browser threw away', () => {
  beforeEach(() => {
    AssetManager.armBackingStoreProbe = () => undefined;
  });

  afterEach(() => {
    AssetManager.backingStoresLost = realLost;
    AssetManager.armBackingStoreProbe = realArm;
    AssetManager.configureLoaders({
      image: () => Promise.reject(new Error('no loader')),
      json: () => Promise.reject(new Error('no loader')),
      audio: () => Promise.reject(new Error('no loader')),
    });
  });

  /** Loads `key` with a stand-in image and hands both back. */
  const loaded = async () => {
    const key = freshKey();
    const image = fakeImage();
    AssetManager.configureLoaders({
      image: () => Promise.resolve(image),
      json: () => Promise.reject(new Error('unused')),
      audio: () => Promise.reject(new Error('unused')),
    });
    await AssetManager.ensure(key);
    return { key, image };
  };

  it('does nothing at all while the pixels are still there', async () => {
    const { image } = await loaded();
    AssetManager.backingStoresLost = () => false;

    expect(await AssetManager.recoverIfLost(() => Promise.resolve('decoded'))).toEqual([]);
    expect(image.painted).toEqual([]);
  });

  it('repaints into the image object everything is already holding', async () => {
    // The identity check is the point. Champions, spells and HUD rows are all
    // holding this exact object; replacing `handle.data` would fix the manager
    // and leave every one of them drawing a blank.
    const { key, image } = await loaded();
    AssetManager.backingStoresLost = () => true;
    const decoded = { tag: 'decoded' };

    expect(await AssetManager.recoverIfLost(() => Promise.resolve(decoded))).toContain(key);
    expect(image.painted).toEqual([decoded]);
    expect(AssetManager.get(key).data).toBe(image);
  });

  it('re-arms the probe, so the next resume is free', async () => {
    await loaded();
    AssetManager.backingStoresLost = () => true;
    let armed = 0;
    AssetManager.armBackingStoreProbe = () => {
      armed++;
    };

    await AssetManager.recoverIfLost(() => Promise.resolve('decoded'));
    expect(armed).toBe(1);
  });

  it('leaves an asset nobody ever loaded alone', async () => {
    // `get` hands back an idle handle with `data: null`; repainting into that
    // would throw, and there is nothing to repaint into anyway.
    const key = freshKey();
    expect(AssetManager.get(key).status).toBe('idle');
    AssetManager.backingStoresLost = () => true;

    expect(await AssetManager.recoverIfLost(() => Promise.resolve('decoded'))).not.toContain(key);
  });

  it('carries on when one file cannot be decoded', async () => {
    // Offline, or one entry missing from the precache. The other 369 assets are
    // not held hostage by it.
    const first = await loaded();
    const second = await loaded();
    AssetManager.backingStoresLost = () => true;

    const restored = await AssetManager.recoverIfLost(url =>
      url === AssetManager.get(first.key).url
        ? Promise.reject(new Error('offline'))
        : Promise.resolve('decoded')
    );

    expect(restored).not.toContain(first.key);
    expect(restored).toContain(second.key);
    expect(second.image.painted).toEqual(['decoded']);
  });
});
