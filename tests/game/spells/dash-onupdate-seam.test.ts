import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
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
const SPELLS_DIR = join(__dirname, '../../../src/game/gameObject/spells');
const BUFFS_DIR = join(__dirname, '../../../src/game/gameObject/buffs');

/** Comments describe the rule; matching them would flag the documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir).filter(name => name.endsWith('.ts'));
}

describe('a spell hooks a dash frame, it does not replace it', () => {
  it('no spell assigns onUpdate onto a buff instance', () => {
    const offenders: string[] = [];

    for (const file of tsFilesIn(SPELLS_DIR)) {
      const source = stripComments(readFileSync(join(SPELLS_DIR, file), 'utf8'));
      // `<identifier>.onUpdate =` — an assignment onto an existing object, as
      // opposed to `onUpdate() {}` declared inside a class body.
      const matches = source.match(/\b\w+\.onUpdate\s*=/g);
      if (matches) offenders.push(`${file}: ${matches.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('Dash still owns its movement in onUpdate, so the ban keeps meaning something', () => {
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
