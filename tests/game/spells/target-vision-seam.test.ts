import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * A spell that picks an enemy for you must first be able to see them.
 *
 * Two dozen abilities auto-lock — they take the nearest body out of a
 * `queryObjects` circle and commit to it — and every one of those queries knew
 * about teams, death and targetability and nothing about the fog. Warwick R
 * found the blue camp through a jungle wall, on a screen showing nothing but
 * black, and leaped through the wall to bite it. `PredefinedFilters.visibleTo`
 * is the gate; `combat/Vision.ts` is what it asks.
 *
 * A source scan rather than a behaviour test, for the usual reason: the mistake
 * is a *missing* line, so there is no shape for `tsc` to reject and no single
 * place to test — but "picks one unit out of a query" has a recognisable
 * fingerprint, and ruling it out across every spell at once costs a
 * millisecond. It is a net, not a proof: an auto-lock written some other way
 * slips through, and the standing rule (any query whose result is *narrowed to
 * a chosen unit* carries the filter) is what actually governs.
 *
 * Area effects are deliberately out of scope, and that is the whole distinction
 * this module rests on: vision gates target *acquisition*, never damage
 * application. Amumu W ticking on everyone inside its ring hits the champion
 * hiding in the bush, exactly as it should.
 */
const SPELLS_DIR = join(__dirname, '../../../packs/riot/spells');
const CORE_SPELLS_DIR = join(__dirname, '../../../src/game/gameObject/coreSpells');

/** Comments describe the rule; matching them would flag the documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/**
 * Every spell file, content and core alike — `coreSpells/` left the
 * population `spells/` scans but did not stop being spells. `index.ts` is a
 * barrel, not a spell, so it is excluded.
 */
function spellFiles(): { dir: string; file: string }[] {
  return [
    ...readdirSync(SPELLS_DIR)
      .filter(name => name.endsWith('.ts'))
      .map(file => ({ dir: SPELLS_DIR, file })),
    ...readdirSync(CORE_SPELLS_DIR)
      .filter(name => name.endsWith('.ts') && name !== 'index.ts')
      .map(file => ({ dir: CORE_SPELLS_DIR, file })),
  ];
}

/**
 * The auto-lock fingerprint: a running "best so far" distance, which is what
 * every one of these spells uses to narrow a query down to a single victim.
 */
const PICKS_ONE_UNIT = /nearestDistance|closestDistance|nearestDist\b|minD\b/;

/**
 * Exempt: a query restricted to the caster's own team. `canSee` returns true
 * for an ally unconditionally, so the filter there would be a line of noise
 * rather than a rule — Lee Sin W dashing to a friend is the live example.
 */
const ALLIES_ONLY = /PredefinedFilters\.teamId\(/;

describe('an auto-locking spell cannot pick a target it cannot see', () => {
  it('every nearest-enemy picker passes visibleTo to its query', () => {
    const offenders: string[] = [];

    for (const { dir, file } of spellFiles()) {
      const source = stripComments(readFileSync(join(dir, file), 'utf8'));
      if (!source.includes('queryObjects')) continue;
      if (!PICKS_ONE_UNIT.test(source)) continue;
      if (ALLIES_ONLY.test(source)) continue;
      if (!source.includes('PredefinedFilters.visibleTo')) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });

  it('the scan is looking at a real population, not an empty one', () => {
    // A fingerprint that matched nothing would pass forever while the rule rots.
    let scanned = 0;
    for (const { dir, file } of spellFiles()) {
      const source = stripComments(readFileSync(join(dir, file), 'utf8'));
      if (source.includes('queryObjects') && PICKS_ONE_UNIT.test(source)) scanned++;
    }

    expect(scanned).toBeGreaterThan(15);
  });

  /**
   * The other way a spell asks "can I see it", and the wrong one.
   *
   * `visibleToPlayerTeam` (once `willDraw`) is `FogOfWar`'s own flag:
   * `calculateSight` clears it on every unit and re-lights it from
   * `game.player.teamId`'s eyes, so it answers "is this lit *for the human*"
   * and nothing else. Thirteen UNIT-targeted spells
   * gated targeting on it, which meant a bot could not target an enemy beside
   * it in a bush the player happened not to see, and could target one across
   * the map the player did. It is also a *draw* flag, so it says nothing at all
   * before the first frame is painted.
   *
   * `combat/Vision.ts` answers the same question per observer, which is why
   * `findAttackTargetNearPoint` was migrated off `willDraw` first and these
   * followed. Nothing in a spell should read it again: a spell deciding what it
   * may *hit* has no business knowing what the camera is showing.
   */
  it('no spell decides targeting from the fog draw flag', () => {
    // Both names on purpose. `willDraw` is dead and the scan keeps it from
    // being resurrected, but the live risk is the *current* name: the rename
    // made the flag honest, not unreachable, and a spell reaching for
    // `visibleToPlayerTeam` would be the identical bug wearing better
    // spelling. Neither belongs in this directory at all.
    const FOG_DRAW_FLAG = /\bwillDraw\b|\bvisibleToPlayerTeam\b/;
    const offenders: string[] = [];

    for (const { dir, file } of spellFiles()) {
      // Comments stripped first: Lux R documents the flag at length, and
      // flagging that would be the scan reporting its own explanation.
      const source = stripComments(readFileSync(join(dir, file), 'utf8'));
      if (FOG_DRAW_FLAG.test(source)) offenders.push(file);
    }

    expect(offenders).toEqual([]);
  });
});
