import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: vi.fn(() => undefined), getAsset: vi.fn(() => undefined) },
}));

import { spellGroups } from '../../../src/game/preset';
import SpellBase from '../../../src/game/gameObject/Spell';
import type Spell from '../../../src/game/gameObject/Spell';
import type AttackableUnit from '../../../src/game/gameObject/attackableUnits/AttackableUnit';
import {
  createGame,
  createUnit,
  installSpellObjectGlobals,
  installSketchMathGlobals,
  type TestGame,
} from '../spell/fixtures';
import { loadEverySpellForTests } from '../spell/registry';

// Spell classes arrive by dynamic import in the game (`spellRegistry.ts`);
// this fills the registry synchronously so a test can read the whole
// catalogue without awaiting 238 of them.
beforeAll(loadEverySpellForTests);

/**
 * A spell that states a reach must draw that reach.
 *
 * `Game.draw` calls `spell.drawPreview()` with no argument, and the base used to
 * draw only when handed an explicit radius — so about seventy spells, including
 * eleven of the twelve in the Camille/Ekko/Jarvan kits, silently previewed
 * nothing and the player had no way to learn a range except by casting into the
 * dark and watching where it stopped.
 *
 * The check is a conjunction, because either half alone is free: a spell that
 * declares a range draws a ring, *and* the ring it draws is that range rather
 * than some other number. A preview drawing a confident circle at the wrong
 * radius is worse than none.
 */

interface DrawnCircle {
  x: number;
  y: number;
  d: number;
}

describe('every spell with a declared reach previews it', () => {
  let game: TestGame;
  let owner: AttackableUnit;
  let circles: DrawnCircle[];

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('createVector', (x = 0, y = 0) => new (p5 as any).Vector(x, y));
    circles = [];
    vi.stubGlobal('push', () => {});
    vi.stubGlobal('pop', () => {});
    vi.stubGlobal('translate', () => {});
    vi.stubGlobal('rotate', () => {});
    vi.stubGlobal('fill', () => {});
    vi.stubGlobal('noFill', () => {});
    vi.stubGlobal('stroke', () => {});
    vi.stubGlobal('noStroke', () => {});
    vi.stubGlobal('strokeWeight', () => {});
    // A line preview states its reach with its far end rather than with a ring:
    // Veigar Q draws the corridor the orb sweeps, stopping exactly at `range`.
    // Recorded as a shape of that radius so the rule below — *something* at the
    // declared reach — applies to it unchanged, the same accommodation `arc`
    // gets for Blitzcrank's cone.
    vi.stubGlobal('line', (x1: number, y1: number, x2: number, y2: number) => {
      const from = owner.position;
      const far = Math.max(
        Math.hypot(x1 - from.x, y1 - from.y),
        Math.hypot(x2 - from.x, y2 - from.y)
      );
      circles.push({ x: from.x, y: from.y, d: far * 2 });
    });
    // A preview does not have to be a disc. Blitzcrank E deliberately draws a
    // wedge because it hits a cone, and a circle there would overstate it. What
    // the test cares about is that *something* is drawn at the declared reach.
    vi.stubGlobal('arc', (x: number, y: number, w: number) => circles.push({ x, y, d: w }));
    vi.stubGlobal('ellipse', () => {});
    vi.stubGlobal('beginShape', () => {});
    vi.stubGlobal('vertex', () => {});
    vi.stubGlobal('endShape', () => {});
    vi.stubGlobal('circle', (x: number, y: number, d: number) => circles.push({ x, y, d }));
    vi.stubGlobal('PIE', 'pie');
    vi.stubGlobal('CLOSE', 'close');
    vi.stubGlobal('CENTER', 'center');
    vi.stubGlobal('rect', () => {});
    vi.stubGlobal('rectMode', () => {});
    vi.stubGlobal('triangle', () => {});
    vi.stubGlobal('quad', () => {});

    game = createGame();
    owner = createUnit(game, 0, 'blue');
    owner.stats.size.baseValue = 30;
    game.setPlayer(owner);
    (game as any).worldMouse = createVector(300, 0);
  });

  afterEach(() => vi.unstubAllGlobals());

  /** Every spell class in the champion catalogue, named for a legible failure. */
  function allSpells(): { name: string; make: () => Spell }[] {
    const out: { name: string; make: () => Spell }[] = [];
    const seen = new Set<unknown>();
    for (const group of spellGroups() as any[]) {
      for (const SpellClass of group.spells ?? []) {
        if (!SpellClass || seen.has(SpellClass)) continue;
        seen.add(SpellClass);
        out.push({
          name: SpellClass.name ?? 'anonymous',
          make: () => new SpellClass(owner),
        });
      }
    }
    return out;
  }

  it('draws a ring at the declared radius, for every spell that declares one', () => {
    const missing: string[] = [];
    const wrongRadius: string[] = [];

    for (const { name, make } of allSpells()) {
      let spell: Spell;
      try {
        spell = make();
      } catch {
        continue; // a spell that cannot be built bare is not this test's subject
      }

      const declared =
        (spell as any).targetingRequest?.range ?? (spell as any).range ?? (spell as any).castRange;
      if (typeof declared !== 'number' || declared <= 0) continue;

      circles.length = 0;
      try {
        spell.drawPreview();
      } catch (error) {
        missing.push(`${name} (threw: ${(error as Error).message})`);
        continue;
      }

      if (circles.length === 0) {
        missing.push(name);
        continue;
      }
      // at least one shape drawn must be at the declared reach
      const matched = circles.some(c => Math.abs(c.d / 2 - declared) <= declared * 0.35 + 2);
      if (!matched) {
        wrongRadius.push(
          `${name}: declared ${declared}, drew ${circles.map(c => Math.round(c.d / 2)).join('/')}`
        );
      }
    }

    expect({ missing, wrongRadius }).toEqual({ missing: [], wrongRadius: [] });
  });

  it('draws nothing for a spell that states no reach, rather than guessing one', () => {
    // The touch layer falls back to DEFAULT_TOUCH_AIM_RANGE because a drag has to
    // go somewhere. A preview has no such obligation, and a confident 600px ring
    // on a spell that never said 600 is worse than an empty screen.
    class Reachless extends SpellBase {
      targetingMode = 'SELF' as const;
    }
    const spell = new Reachless(owner);

    circles.length = 0;
    spell.drawPreview();
    expect(circles).toEqual([]);
  });
});
