/**
 * The join between the generated catalogue and the code it was generated from.
 *
 * `config/spellCatalog.ts` answers "what does this ability look like?" from a
 * checked-in table so the pregame screen never loads a spell class. That is a
 * second source of truth, and a second source of truth is only safe while
 * something proves it agrees with the first — so this builds every spell for
 * real and demands the two answers match, field by field, under several sets of
 * match rules.
 *
 * Two different guards, and both are needed:
 *
 * - `npm run catalog:check` (in `verify`) catches the file being **stale** —
 *   a retune that never regenerated.
 * - This catches the file being **wrong** — a generator that reads the wrong
 *   field, or a `spellDisplayOf` that reapplies match rules differently from
 *   `Spell.reducedCooldown`/`Spell.effectiveMana`. Staleness and wrongness fail
 *   in completely different ways and neither check sees the other's failure.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: vi.fn((key: string) => ({ key, url: `url:${key}` })),
    getAsset: vi.fn(() => undefined),
    placeholder: vi.fn(() => ({ url: 'x' })),
  },
}));

import * as AllSpells from '../../../src/game/gameObject/spells/index';
import * as CoreSpells from '../../../src/game/gameObject/coreSpells/index';
import { getSpellDisplay } from '../../../src/game/preset';
import {
  isSpellCatalogId,
  spellCatalogIds,
  spellDisplayOf,
} from '../../../src/game/config/spellCatalog';
import { spellCatalog } from '../../../src/generated/spellCatalog';
import type { MatchRules } from '../../../src/game/config/PregameConfig';

// The catalogue is generated from two barrels — `spells/` (content) and
// `coreSpells/` (`BasicAttack`) — merged content-last, so "the barrel" this
// file checks against means both, merged the same way.
const AllSpellsById: Record<string, unknown> = { ...AllSpells, ...CoreSpells };
const barrelKeys = Object.keys(AllSpellsById);

/** Plain, half CDR, URF, and both at once — the four corners of the rule space. */
const RULE_SETS: { label: string; rules: MatchRules }[] = [
  { label: 'no rules', rules: { cooldownMultiplier: 1, manaFree: false } },
  { label: '50% CDR', rules: { cooldownMultiplier: 0.5, manaFree: false } },
  { label: 'URF', rules: { cooldownMultiplier: 1, manaFree: true } },
  { label: 'URF + 40% CDR', rules: { cooldownMultiplier: 0.6, manaFree: true } },
];

describe('the generated spell catalogue', () => {
  it('has exactly one entry per export in the AllSpells barrel', () => {
    expect(new Set(spellCatalogIds())).toEqual(new Set(barrelKeys));
  });

  it('recognises every barrel key and nothing else', () => {
    for (const key of barrelKeys) expect(isSpellCatalogId(key)).toBe(true);
    expect(isSpellCatalogId('Yasuo_T')).toBe(false);
    expect(isSpellCatalogId('')).toBe(false);
  });

  describe.each(RULE_SETS)('agrees with the real class under $label', ({ rules }) => {
    it('on every spell, field for field', () => {
      const disagreements: string[] = [];

      for (const id of spellCatalogIds()) {
        const fromData = spellDisplayOf(id, rules);
        const fromClass = getSpellDisplay(AllSpellsById[id], rules);

        for (const field of Object.keys(fromClass) as (keyof typeof fromClass)[]) {
          const left = fromData[field];
          const right = fromClass[field];
          // Cooldowns are a float multiply on both sides; compare them as such
          // rather than demanding bit equality of `9000 * 0.6`.
          const same =
            typeof left === 'number' && typeof right === 'number'
              ? Math.abs(left - right) < 1e-6
              : left === right;
          if (!same) disagreements.push(`${id}.${String(field)}: ${left} vs ${right}`);
        }
      }

      expect(disagreements).toEqual([]);
    });
  });

  it('stores an icon key rather than a built URL', () => {
    // A URL is a content hash; baking one in would make this file churn on
    // every image change. The key is what `AssetManager.get` takes.
    for (const id of spellCatalogIds()) {
      const { iconKey } = spellCatalog[id];
      if (iconKey === null) continue;
      expect(iconKey).not.toMatch(/[/.]/);
      expect(spellDisplayOf(id).iconUrl).toBe(`url:${iconKey}`);
    }
  });

  it('gives every spell a real, non-empty name and description', () => {
    const empty = spellCatalogIds().filter(
      id => !spellCatalog[id].name.trim() || !spellCatalog[id].description.trim()
    );
    expect(empty).toEqual([]);
  });

  it('can see a disagreement it is meant to catch', () => {
    // The comparison above is only worth anything if it would fire. Same shape
    // as the real loop, against a value that is deliberately wrong.
    const real = spellDisplayOf('Yasuo_Q', { cooldownMultiplier: 0.5, manaFree: false });
    const wrong = { ...real, effectiveCoolDownMs: real.effectiveCoolDownMs + 1 };
    expect(Math.abs(wrong.effectiveCoolDownMs - real.effectiveCoolDownMs) < 1e-6).toBe(false);
  });
});
