import { describe, expect, it } from 'vitest';
import {
  DEBUG_LAYER_KEYS,
  type DebugLayerConfig,
} from '../../../src/game/config/PregameConfig';
import { createDebugFlags, type DebugFlags } from '../../../src/game/debug/DebugOverlay';

/**
 * `DebugLayerConfig` (in `game/config/PregameConfig.ts`) and `DebugFlags` (in
 * `game/debug/DebugOverlay.ts`) describe the same five layers and are two
 * declarations on purpose: the config module is pure data that the menu reads
 * without pulling the match chunk, and `DebugOverlay` is code that draws.
 *
 * Two declarations of one shape drift. This is the only thing stopping them:
 * add a layer to the overlay and forget the config and the settings tab
 * silently cannot persist it, which is exactly the class of bug the unified
 * panel exists to remove.
 *
 * Both directions are checked. A key added to `DebugFlags` alone fails the
 * first assertion; a key added to `DebugLayerConfig` alone fails the second.
 */
describe('debug layer shape', () => {
  it('lists exactly the keys createDebugFlags produces, in a stable order', () => {
    const flags = createDebugFlags({ navigation: { debugRoutes: false } });
    expect([...DEBUG_LAYER_KEYS].sort()).toEqual(Object.keys(flags).sort());
  });

  it('assigns between the two shapes without a cast', () => {
    const flags: DebugFlags = createDebugFlags({ navigation: { debugRoutes: false } });
    // The compiler is the assertion here: either direction failing to assign
    // is a type error, and `typecheck` is part of `verify`.
    const asConfig: DebugLayerConfig = { ...flags };
    const asFlags: DebugFlags = { ...asConfig };
    expect(asFlags).toEqual(asConfig);
  });
});
