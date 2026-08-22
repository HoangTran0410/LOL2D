import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Task 10 of the content-pack extraction: a scan over `src/` for Riot's
 * specific vocabulary — a champion's name, a spell's name — as distinct
 * from the ordinary English words for ordinary things (`Champion`,
 * `Minion`, `Turret`, `Fountain`) that CLAUDE.md is explicit stay.
 *
 * Three independent checks, because "a spell's name" shows up in `src/` in
 * three different shapes and each needed its own fix when this scan first
 * ran:
 *
 * 1. **Champion and monster proper nouns** in prose — mostly doc comments
 *    illustrating an engine bug with the real spell that first exposed it
 *    ("Camille E, Ekko E and Jarvan Q all shipped with it unnoticed"). Zero
 *    tolerance, derived from the pack's own filenames so a future champion
 *    or monster is covered automatically.
 * 2. **Spell-id-shaped identifiers** (`Ahri_Q`, `JarvanIV_R`) — a
 *    structural pattern, not a word list, so it also catches an id for a
 *    champion not in the list above (a typo, a future roster change). One
 *    grandfathered id: `Vera_Q`, the *fictional* placeholder
 *    `packs/reference/` uses to illustrate the multi-pack qualifying
 *    scheme — not a real champion, nothing to purge.
 * 3. **Summoner-spell id string literals** (`'Flash'`, `'Heal'`, ...) — the
 *    shape a real data leak takes (`SUMMONER_SPELL_IDS` used to be exactly
 *    this, a five-id array sitting in `spellCatalog.ts`; it now reads the
 *    bundled pack's own roster through `ChampionEntry.summonerShelf`
 *    instead). Two grandfathered lines, both in
 *    `src/game/config/PregameConfig.ts`: `DEFAULT_CHAMPION_LOADOUT`'s
 *    `summonerD`/`summonerF` defaults, which restate two content facts as
 *    literals because that module is deliberately pure data with no
 *    content-system import (`DEFAULT_MAP_ID` right above them is the same
 *    trade for the map id) — see that field's own doc comment, and
 *    `PregameConfig.test.ts`'s cross-check against the live shelf.
 *
 * Not attempted: banning `Flash`/`Ghost`/`Heal`/`Ignite` as bare words.
 * They are ordinary English words with legitimate generic uses in this
 * codebase (`SpellRole.Heal`, a spell-role bitmask that classifies *any*
 * healing spell, pack-agnostic) — banning the word would either misfire on
 * that or need more context-sensitivity than a source scan can safely
 * encode. Every prose sentence that named one of these as the specific
 * summoner spell was found and rewritten by hand (see git history for this
 * file's own commit); the literal-string check above is what stops the
 * shape that actually matters — a pack's id sitting in core as data — from
 * coming back.
 *
 * `src/scenes/about/changelog.ts` and `articles.ts` are excluded from all
 * three checks: hand-written, player-facing history of this fan game's own
 * past changes ("Reworked <champion>'s W"), not engine code — CLAUDE.md is
 * explicit these are written in Vietnamese for players, and
 * `tests/scenes/aboutContent.test.ts` already bans the opposite leak
 * (internal class/module names) from the same two files. A changelog entry
 * with the champion's name redacted is not more pack-neutral, it is
 * useless to the player reading it.
 */
const SRC = join(__dirname, '../../src');
const PACKS = join(__dirname, '../../packs');
const EXCLUDED = new Set([
  join(SRC, 'scenes/about/changelog.ts'),
  join(SRC, 'scenes/about/articles.ts'),
]);

function filesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, extensions));
    else if (extensions.some(ext => name.endsWith(ext))) out.push(full);
  }
  return out;
}

const scannedFiles = (): string[] => filesUnder(SRC, ['.ts', '.vue']).filter(f => !EXCLUDED.has(f));

/** `Ahri_Q.ts` -> `Ahri`, `_EmptyExample.ts`/`index.ts` skipped (no `_[QWER]` suffix). */
function championNamesFromPack(): string[] {
  const dir = join(PACKS, 'riot/spells');
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    const match = file.match(/^([A-Za-z]+)_[QWERP][A-Za-z0-9]*\.ts$/);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/** `Baron.ts` -> `Baron`. Every `.ts` file directly under `packs/riot/monsters/`. */
function monsterNamesFromPack(): string[] {
  const dir = join(PACKS, 'riot/monsters');
  return readdirSync(dir)
    .filter(f => f.endsWith('.ts'))
    .map(f => f.replace(/\.ts$/, ''));
}

/**
 * A handful of champions whose filename token (PascalCase, no spaces or
 * punctuation — a valid TS identifier) is not the display name a doc
 * comment actually writes in prose. Both forms are banned; this list only
 * adds the second.
 */
const DISPLAY_VARIANTS: Record<string, string[]> = {
  ChoGath: ["Cho'Gath"],
  JarvanIV: ['Jarvan IV', 'Jarvan'],
  LeeSin: ['Lee Sin'],
  MasterYi: ['Master Yi'],
  XinZhao: ['Xin Zhao'],
};

const bannedNames = (): string[] => {
  const base = [...championNamesFromPack(), ...monsterNamesFromPack()];
  const out = [...base];
  for (const name of base) out.push(...(DISPLAY_VARIANTS[name] ?? []));
  return out;
};

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe("core carries none of Riot's vocabulary", () => {
  it('has a real, non-empty champion/monster name list, or this scan proves nothing', () => {
    const names = bannedNames();
    expect(names.length).toBeGreaterThan(50);
  });

  it('finds source files under src/ to scan, or this scan proves nothing', () => {
    expect(scannedFiles().length).toBeGreaterThan(20);
  });

  it('names no champion or monster from the bundled pack, comments included', () => {
    // Comments are NOT stripped here, unlike packBoundary.test.ts: most of
    // this scan's real hits were doc comments illustrating a bug with the
    // real spell that exposed it, and that is exactly the vocabulary this
    // check exists to purge.
    const names = bannedNames();
    const patterns = names.map(name => ({
      name,
      re: new RegExp(`\\b${name.replace(/'/g, "'?")}\\b`),
    }));
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const source = readFileSync(file, 'utf8');
      const rel = file.slice(SRC.length + 1);
      for (const { name, re } of patterns) {
        if (re.test(source)) offenders.push(`${rel}: ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /** `Vera_Q` is `packs/reference/`'s fictional example id — see this file's own header. */
  const SPELL_ID_GRANDFATHERED = new Set(['Vera_Q']);

  it('carries no spell-id-shaped identifier (ChampionName_Slot) anywhere', () => {
    const pattern = /\b[A-Z][a-z]+(?:IV)?_[QWERP][A-Za-z0-9]*\b/g;
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const source = readFileSync(file, 'utf8');
      const rel = file.slice(SRC.length + 1);
      for (const match of source.matchAll(pattern)) {
        if (!SPELL_ID_GRANDFATHERED.has(match[0])) offenders.push(`${rel}: ${match[0]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * `DEFAULT_CHAMPION_LOADOUT.summonerD`/`summonerF` in `PregameConfig.ts` —
   * see that field's own doc comment and this file's header.
   */
  const PREGAME_CONFIG = join(SRC, 'game/config/PregameConfig.ts');
  const SUMMONER_LITERAL_GRANDFATHERED = new Set([
    `${PREGAME_CONFIG}: summonerD: 'Flash',`,
    `${PREGAME_CONFIG}: summonerF: 'Heal',`,
  ]);

  it('carries no summoner-spell id as a quoted string literal, outside the one documented default', () => {
    const ids = ['Flash', 'Ghost', 'Heal', 'Ignite', 'StealthWard'];
    const pattern = new RegExp(`['"](${ids.join('|')})['"]`, 'g');
    const offenders: string[] = [];
    for (const file of scannedFiles()) {
      const source = stripComments(readFileSync(file, 'utf8'));
      for (const line of source.split('\n')) {
        for (const match of line.matchAll(pattern)) {
          const key = `${file}: ${line.trim()}`;
          if (!SUMMONER_LITERAL_GRANDFATHERED.has(key)) {
            offenders.push(`${file.slice(SRC.length + 1)}: ${line.trim()} (${match[0]})`);
          }
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
