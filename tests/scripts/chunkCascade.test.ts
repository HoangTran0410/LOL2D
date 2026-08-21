import { describe, expect, it } from 'vitest';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { changedFilenames, spellChunks, summarize } from '../../scripts/measure-chunk-cascade.mjs';

/**
 * `scripts/measure-chunk-cascade.mjs` builds the app twice and diffs
 * `dist/assets` filenames — expensive, and deliberately outside `npm run
 * verify` (`npm run e2e:chunk-cascade` runs it on demand). What is cheap to
 * check on every `verify` run is the pure comparison logic underneath it:
 * given two filename snapshots, does it correctly tell a genuine rename from
 * an unrelated add/remove.
 */
describe('spellChunks', () => {
  it('keeps only per-champion/shared spell chunks', () => {
    const files = [
      'spell-yasuo-abc123.js',
      'spell-common-def456.js',
      'game-ghi789.js',
      'pregame-jkl.js',
    ];
    expect(spellChunks(files)).toEqual(['spell-yasuo-abc123.js', 'spell-common-def456.js']);
  });

  it('returns nothing when the split has collapsed to zero spell chunks', () => {
    expect(spellChunks(['game-abc.js', 'pregame-def.js'])).toEqual([]);
  });
});

describe('changedFilenames', () => {
  it('reports nothing changed when both snapshots match exactly', () => {
    const files = ['spell-yasuo-abc.js', 'game-def.js'];
    expect(changedFilenames(files, files)).toEqual({ removed: [], added: [] });
  });

  it('treats a re-hash as one name leaving and a different one arriving', () => {
    const before = ['spell-yasuo-abc123.js', 'game-hash1.js'];
    const after = ['spell-yasuo-xyz789.js', 'game-hash2.js'];
    expect(changedFilenames(before, after)).toEqual({
      removed: ['spell-yasuo-abc123.js', 'game-hash1.js'],
      added: ['spell-yasuo-xyz789.js', 'game-hash2.js'],
    });
  });

  it('does not confuse an untouched file for a change', () => {
    const before = ['spell-yasuo-abc.js', 'game-hash1.js'];
    const after = ['spell-yasuo-abc.js', 'game-hash2.js'];
    expect(changedFilenames(before, after)).toEqual({
      removed: ['game-hash1.js'],
      added: ['game-hash2.js'],
    });
  });
});

describe('summarize', () => {
  it('scores the cascade dead when a core chunk re-hashes but no spell chunk does', () => {
    // The shape this migration predicts: `game` moves, `spell-*` do not.
    const before = [
      'spell-yasuo-abc.js',
      'spell-common-abc.js',
      'game-hash1.js',
      'pregame-hash1.js',
    ];
    const after = [
      'spell-yasuo-abc.js',
      'spell-common-abc.js',
      'game-hash2.js',
      'pregame-hash1.js',
    ];
    const result = summarize(before, after);
    expect(result.spellChanged).toBe(0);
    expect(result.totalChanged).toBe(1);
    expect(result.changedSpellNames).toEqual([]);
  });

  it('scores the cascade alive when spell chunks re-hash alongside the core chunk', () => {
    // The shape measured on `main`: every spell chunk statically imports
    // `game` by its hashed filename, so all of them move together.
    const before = ['spell-yasuo-abc.js', 'spell-ahri-abc.js', 'game-hash1.js'];
    const after = ['spell-yasuo-def.js', 'spell-ahri-def.js', 'game-hash2.js'];
    const result = summarize(before, after);
    expect(result.spellChanged).toBe(2);
    expect(result.changedSpellNames).toEqual(['spell-yasuo-abc.js', 'spell-ahri-abc.js']);
    expect(result.totalChanged).toBe(3);
  });
});
