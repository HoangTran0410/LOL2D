import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Every spell's display name must be the one Riot's Vietnamese client uses.
 *
 * The names were hand-written and 97 of them had drifted — Pantheon W read
 * "Khiên Xung Kích" against the official "Khiên Trời Giáng", R read "Thiên
 * Thạch Giáng Thế" against "Trời Sập". `scripts/wiki/sync-spell-names.mjs`
 * pulls the real strings from Data Dragon's `vi_VN` locale into
 * `docs/abilities/generated/spell-names-vi.json` and rewrites the files; this
 * is the offline half, so the rule holds on every run of the suite without
 * anybody touching the network.
 *
 * A source scan rather than instantiating the spells: `name` is a class field
 * initialiser, so reading it means constructing 148 spells with a live p5 and
 * an owner, to check a string literal that is right there in the file.
 *
 * Descriptions are deliberately **not** covered. The official ones carry no
 * damage numbers and LOL2D's are scaled to a ~100 health pool.
 */
const SPELL_DIR = fileURLToPath(new URL('../../../packs/riot/spells/', import.meta.url));
const NAMES: { version: string; names: Record<string, string> } = JSON.parse(
  readFileSync(fileURLToPath(new URL('../../../docs/spell-names-vi.json', import.meta.url)), 'utf8')
);

/**
 * Basic attack and Recall are ours — this game's own abilities, not Riot ones,
 * so Data Dragon ships no `vi_VN` string to check them against. The example and
 * the barrel file are not spells at all.
 */
const NOT_FROM_RIOT = new Set(['BasicAttack', 'Recall', '_EmptyExample', 'index']);

const NAME_LINE = /^(\s*name = (['"]))(.*?)(\s*\([^)]*\)\2;)\s*$/m;

const spellFiles = readdirSync(SPELL_DIR)
  .filter(file => file.endsWith('.ts'))
  .map(file => ({ file, slug: file.slice(0, -3) }))
  .filter(entry => !NOT_FROM_RIOT.has(entry.slug));

describe(`spell names match Riot's vi_VN localisation (Data Dragon ${NAMES.version})`, () => {
  it('has an upstream name recorded for every spell file', () => {
    const missing = spellFiles.filter(entry => !NAMES.names[entry.slug]).map(entry => entry.slug);
    expect(missing, 'run `npm run names:sync -- --refresh` to pick up new spells').toEqual([]);
  });

  it.each(spellFiles.map(entry => [entry.slug, entry.file] as const))('%s', (slug, file) => {
    const source = readFileSync(`${SPELL_DIR}${file}`, 'utf8');
    const match = source.match(NAME_LINE);
    expect(match, `${file} has no \`name = '… (Tag)';\` line`).toBeTruthy();
    expect(match![3]).toBe(NAMES.names[slug]);
  });
});
