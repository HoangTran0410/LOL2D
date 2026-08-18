import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

/**
 * A `UNIT` spell says whose body it is allowed to pick.
 *
 * `TargetResolver` defaults `targetTeam` to `'ANY'`, and its candidate list
 * includes `request.caster`. So a `UNIT` spell that does not declare a team,
 * cast with the cursor over empty ground, resolves **the caster** through the
 * nearest-to-cursor fallback — and then dashes to, damages, or suppresses the
 * champion who pressed the key. Diana E, Sett R, Syndra R and Vi R all shipped
 * exactly like that.
 *
 * Two declarations make it impossible:
 *
 * - `targetTeam: 'ENEMY'` (or `'ALLY'`) in `targetingRequest`, which is what the
 *   resolver actually filters on;
 * - a `press()` override that runs `TargetResolver` when the incoming context
 *   carries no `target`, so the spell is refused rather than resolved onto
 *   whatever was closest.
 *
 * The team declaration additionally has to be *inside* `targetingRequest` — the
 * scan below only proves the name appears in the file, which is as far as a
 * source scan honestly reaches. The behaviour is pinned per spell in its own
 * suite; this is the net that catches the eighteenth one.
 */
const SPELLS_DIR = join(__dirname, '../../../src/game/gameObject/spells');

/**
 * `Annie_Q` resolves correctly on the path the game actually uses —
 * `Game.createSpellContext` runs `TargetResolver` for `UNIT` targeting before
 * `press` is ever called — so it has no live self-cast bug. What it lacks is the
 * fallback for a context that arrives *without* a target, which is the shape
 * `Spell.cast()` and hand-built test contexts produce. Debt, and the list may
 * only shrink.
 */
const NO_PRESS_OVERRIDE = new Set(['Annie_Q.ts']);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function unitSpellFiles(): { file: string; source: string }[] {
  const found: { file: string; source: string }[] = [];
  for (const file of readdirSync(SPELLS_DIR).filter(name => name.endsWith('.ts'))) {
    const source = stripComments(readFileSync(join(SPELLS_DIR, file), 'utf8'));
    if (/targeting:\s*'UNIT'/.test(source)) found.push({ file, source });
  }
  return found;
}

describe('a UNIT spell declares whose body it may pick', () => {
  it('finds the UNIT spells at all, so an empty pass cannot look like a pass', () => {
    expect(unitSpellFiles().length).toBeGreaterThan(10);
  });

  it('every UNIT spell declares a targetTeam', () => {
    const offenders = unitSpellFiles()
      .filter(({ source }) => !/targetTeam\s*:/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('every UNIT spell supplies a targetingRequest for the resolver to read', () => {
    const offenders = unitSpellFiles()
      .filter(({ source }) => !/targetingRequest/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('every UNIT spell resolves a target when the context arrives without one', () => {
    const offenders = unitSpellFiles()
      .filter(({ file }) => !NO_PRESS_OVERRIDE.has(file))
      .filter(({ source }) => !/\bpress\s*\(/.test(source))
      .map(({ file }) => file);

    expect(offenders).toEqual([]);
  });

  it('the press-override debt only shrinks', () => {
    expect(NO_PRESS_OVERRIDE.size).toBeLessThanOrEqual(1);
  });
});
