import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Renamed from `recallIsContent.test.ts` in batch 5 task 1, because the
 * ruling that name asserted is reversed. Spec §10 said `BasicAttack` and
 * `Recall` both come back to core as built-in mechanism; `BasicAttack` did
 * in batch 4, `Recall` did not, and batch 4 task 3 swept it into
 * `packs/riot/spells/` with the other 240 on the theory that presupposing a
 * fountain made it map content, the way a battle-royale map with no spawn
 * platform would have nowhere to recall to. That reasoning does not survive
 * contact with `BasicAttack`'s own precedent: no *current* map lacks a
 * fountain, exactly as no unit is unable to swing, and a future map that
 * genuinely has neither is free to leave `Champion.recall` (or the attack
 * controller) unset — `Champion.recall`'s nullability already expresses
 * that, and did before this file's rename. Return-to-base is also a
 * genre-generic mechanic, not a Riot one — Dota calls it a Town Portal — so
 * moving it back does not reopen `vocabularyBoundary.test.ts`'s "core
 * carries none of Riot's vocabulary" rule; that scan's own bannedNames()
 * only draws from champion/monster filenames and summoner-spell ids, none
 * of which "Recall" or "Hồi Thành" is.
 *
 * So `Recall.ts` moved back to `src/game/gameObject/coreSpells/`, beside
 * `BasicAttack.ts`. It is deliberately **not** re-exported from that
 * directory's `index.ts` barrel, though — a different reason than "it is
 * content", the one this file now checks: that barrel doubles as
 * `scripts/generate-spell-catalog.mjs`'s `CORE_SPELL_TREE` catalogue-scan
 * source, and cataloguing `Recall` would put "Hồi Thành" in the loadout
 * picker and the `'random'` slot pool — exactly what `CLAUDE.md` and
 * `tests/game/spellRegistry.test.ts`'s `leaves Recall out of the pool` test
 * forbid. `Champion` still does not construct one — `preset.ts`'s
 * `attachRecall` is the one place that does, for a real match — and
 * `Champion.recall` stays nullable, both invariants this file already
 * checked and both still true for an unrelated reason now: not "a map may
 * lack a fountain" but "a preset swap must not take a champion's way home
 * away from it" (see `Champion.recall`'s own doc comment).
 *
 * Fix round 1 found this file asserted the ruling in prose only: every
 * check below is a source scan of some *other* file (`Champion.ts`,
 * `coreSpells/index.ts`, `ContentPack.ts`), and none of them actually looks
 * at `Recall.ts` itself — moving it back to `packs/riot/spells/` (the
 * reviewer's own reproduction) left all four green, and so did
 * `coreSpells.test.ts` and `corePacksBoundary.test.ts`, which scan `src/`
 * for import *specifiers* and never noticed the file at the far end of one
 * was gone. The first check below closes that: a real dynamic `import()` of
 * `../../src/game/gameObject/coreSpells/Recall`, which only resolves if the
 * file is actually there.
 */
const SRC = join(__dirname, '../../src');
const read = (rel: string): string => readFileSync(join(SRC, rel), 'utf8');
const stripComments = (s: string): string =>
  s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('Recall is core mechanism, kept off the catalogued barrel', () => {
  it('Recall actually resolves as a module from coreSpells/, not from a pack', async () => {
    // Falsifiable exactly the way the reviewer proved the old version was
    // not: `git mv src/game/gameObject/coreSpells/Recall.ts
    // packs/riot/spells/Recall.ts` makes this dynamic import fail to
    // resolve, and every other check in this file keeps passing regardless.
    const recallModule = await import('../../src/game/gameObject/coreSpells/Recall');
    expect(recallModule.default).toBeTypeOf('function');
    expect(recallModule.RECALL_CHANNEL_MS).toBeTypeOf('number');
  });

  it('Champion does not import or construct a Recall', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).not.toMatch(/new Recall\(/);
    expect(source).not.toMatch(/from '[^']*Recall'/);
  });

  it('Champion.recall is nullable, so a preset swap can never take a way home from a champion that has one', () => {
    const source = stripComments(read('game/gameObject/attackableUnits/Champion.ts'));
    expect(source).toMatch(/recall\s*:\s*[^=;]*\|\s*null/);
  });

  it('the exported core spell barrel names only the basic attack — Recall sits beside it, unexported', () => {
    const source = stripComments(read('game/gameObject/coreSpells/index.ts'));
    expect(source).toMatch(/BasicAttack/);
    expect(source).not.toMatch(/Recall/);
  });

  it('a pack can still declare a champion its way home, by string id', () => {
    // `ChampionEntry.recall` outlives this move: `packs/riot/data.ts` still
    // names every champion's recall as the bare string `'Recall'`, and
    // `src/content/install.ts` folds a real class onto that id — the same
    // core-last fold `BasicAttack` already gets.
    const source = stripComments(read('content/ContentPack.ts'));
    expect(source).toMatch(/recall\?\s*:\s*string/);
  });
});
