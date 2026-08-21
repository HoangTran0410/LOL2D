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

// `fromData` (below) reads `iconKey` off the registry, which qualifies it
// (`riot:spell_ahri_e` — `PackRegistry.writeData`); `fromClass` reads it off
// a spell built directly through `buildContentApi()`, whose `asset()` stays
// the single shared, unqualified function every pack's factory receives
// (`install.test.ts`'s "hands every pack code factory the same api object"
// pins that identity, so `asset` cannot close over a packId). Both keys
// resolve to the identical file through a real `AssetManager` — this test's
// mock has to agree, or it fails on a cosmetic prefix a real resolver never
// sees as a difference. Stripping any `<packId>:` before echoing is that
// agreement, not a loophole: `AssetManager.resolveDescriptor`'s own
// qualified-and-bare arms are which two forms this models.
const localKey = (key: string): string => {
  const separator = key.indexOf(':');
  return separator > 0 ? key.slice(separator + 1) : key;
};

vi.mock('../../../src/managers/AssetManager', () => ({
  default: {
    get: vi.fn((key: string) => ({ key, url: `url:${localKey(key)}` })),
    getAsset: vi.fn(() => undefined),
    placeholder: vi.fn(() => ({ url: 'x' })),
  },
}));
import * as CoreSpells from '../../../src/game/gameObject/coreSpells/index';
import * as AllSpellFactories from '../../../packs/riot/spells/index';
import { buildContentApi } from '../../../src/content/ContentApi';
import { getSpellDisplay } from '../../../src/game/preset';
import {
  isSpellCatalogId,
  spellCatalogIds,
  spellDisplayOf,
} from '../../../src/game/config/spellCatalog';
import { spellCatalog as coreSpellCatalog } from '../../../src/generated/spellCatalog';
import { spellCatalog as riotSpellCatalog } from '../../../packs/riot/generated/spellCatalog';
import { BUNDLED_PACK_ID } from '../../../src/content/install';
import type { MatchRules } from '../../../src/game/config/PregameConfig';

// Every pack spell's `default` export is now `(api: ContentApi) => SpellClass`
// (batch 4 task 3) — resolved once here so `AllSpells.Ahri_Q` etc. stay plain
// constructible classes, exactly like `tests/game/spell/registry.ts` does.
const __api = buildContentApi();
const AllSpells: Record<string, unknown> = Object.fromEntries(
  Object.entries(AllSpellFactories).map(([id, factory]) => [
    id,
    typeof factory === 'function' ? (factory as (api: typeof __api) => unknown)(__api) : factory,
  ])
);

// The generated catalogue now splits across two trees the same way the spell
// classes do — core's own (`BasicAttack`) and the riot pack's (everything
// else) — so "the generated catalogue" this file checks against means both,
// merged core-last exactly as `scripts/generate-spell-catalog.mjs` merges
// them (core spread after content, so it wins a collision).
const spellCatalog: Record<string, { name: string; description: string; iconKey: unknown }> = {
  ...riotSpellCatalog,
  ...coreSpellCatalog,
};

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

  it("qualifies a bare id under the real bundled pack's id, not a stale copy", () => {
    // `spellCatalog.ts` cannot import `BUNDLED_PACK_ID` from
    // `@/content/install` (or `qualifySpellId` from `@/game/spellRegistry`,
    // which reads that same constant) without closing a `pregame -> game ->
    // pregame` chunk cycle — see `BUNDLED_PACK_PREFIX`'s doc comment. It
    // restates the pack id as a literal instead, and this is the guard
    // against the two drifting: a
    // renamed `BUNDLED_PACK_ID` would make every registry lookup in this file
    // miss silently, degrading every spell to `MISSING_SPELL_DISPLAY` rather
    // than failing loudly.
    expect(`${BUNDLED_PACK_ID}:Yasuo_Q`).toBe('riot:Yasuo_Q');
    const display = spellDisplayOf('Yasuo_Q');
    expect(display.name).not.toBe('?');
    expect(display.name.length).toBeGreaterThan(0);
  });
});
