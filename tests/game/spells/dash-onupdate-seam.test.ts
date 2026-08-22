import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined },
}));

import Dash from '../../../src/game/gameObject/buffs/Dash';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
} from '../spell/fixtures';

/**
 * Nobody may assign `onUpdate` on a Dash (or any buff that implements its own).
 *
 * `Buff.update()` calls `this.onUpdate()`, and `Dash` implements the movement in
 * `Dash.prototype.onUpdate`. An instance assignment shadows the prototype, so
 * what looks like a per-frame callback silently deletes the step towards the
 * destination, the arrival check and the interrupt check — the champion runs the
 * spell's own logic while standing perfectly still.
 *
 * Camille E, Ekko E and Jarvan Q all shipped with it, all three unnoticed,
 * because the spell still dealt its damage and still ended on time. Use
 * `onDashUpdate`, which the base calls.
 *
 * A source scan rather than a behaviour test: the mistake is a shape, it is
 * invisible to `tsc` (assigning a method is perfectly legal), and it costs a
 * millisecond to rule out across every spell at once.
 */
// ## The source scan that used to live here is core's own `check-seams` now
//
// `npm run check-seams` (in `verify`) runs `src/seams/dashOnUpdate.ts` — the
// exported form of this exact rule — over `coreSpells/`, `spellObjects/`,
// `buffs/` and `attackableUnits/`, wider than the one directory this file
// walked by hand, and `packs/riot`'s own `check-seams` runs it over the
// pack's tree. Batch 5 task 6 fix round 1 collapsed ten hand-written
// duplicates into that CLI; the very next commit gave core its own
// invocation of it, which re-created the duplication from the other side.
// Proven before deleting: a planted `dash.onUpdate = () => {};` in `buffs/`
// produces `dash-onupdate :: dash.onUpdate =` and exit 1.
//
// What is left below is what the CLI has no equivalent for: that `Dash`
// still owns its movement, and that a hooked dash still moves and still
// fires `onReachedDestination`.
const BUFFS_DIR = join(__dirname, '../../../src/game/gameObject/buffs');

describe('Dash still owns its movement, so the ban keeps meaning something', () => {
  it('keeps the frame in onUpdate and offers onDashUpdate as the seam', () => {
    const source = readFileSync(join(BUFFS_DIR, 'Dash.ts'), 'utf8');
    expect(source).toMatch(/onUpdate\(\)\s*:\s*void\s*\{/);
    expect(source).toMatch(/moveVectorToVector/);
    // and the sanctioned seam exists for spells to use instead
    expect(source).toMatch(/onDashUpdate\?\(\)/);
  });
});

describe('Dash still moves while a spell hooks its per-frame update', () => {
  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 16);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('moves the champion while a per-frame hook is installed', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    owner.stats.speed.baseValue = 10;

    const dash = new Dash(1000, owner, owner);
    dash.showTrail = false;
    dash.dashDestination = createVector(300, 0);
    dash.dashSpeed = 20;

    let hookRan = 0;
    dash.onDashUpdate = () => {
      hookRan++;
    };

    dash.activateBuff();
    const startX = owner.position.x;
    dash.update();

    expect(hookRan).toBe(1);
    expect(owner.position.x).toBeGreaterThan(startX);
  });

  it('still fires onReachedDestination with a hook installed', () => {
    const game = createGame();
    const owner = createUnit(game, 0, 'blue');
    owner.stats.speed.baseValue = 10;

    const dash = new Dash(1000, owner, owner);
    dash.showTrail = false;
    dash.dashDestination = createVector(30, 0);
    dash.dashSpeed = 20;

    let arrived = false;
    dash.onDashUpdate = () => {};
    dash.onReachedDestination = () => {
      arrived = true;
    };

    dash.activateBuff();
    for (let i = 0; i < 10 && !arrived; i++) dash.update();

    expect(arrived).toBe(true);
  });
});
