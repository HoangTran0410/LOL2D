import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { packIsInstalled } from '../support/installedPacks';
import { srcSourceFilePaths } from '../support/srcTree';
import {
  describeOffence,
  riotChampionNames,
  riotMonsterNames,
  riotVocabularyOffences,
} from '../support/riotVocabulary';

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
 * `src/scenes/about/changelog.ts` is hand-written, player-facing history of
 * this fan game's own past changes ("Reworked <champion>'s W"), not engine
 * code — CLAUDE.md is explicit it is written in Vietnamese for players, and
 * `tests/scenes/aboutContent.test.ts` already bans the opposite leak
 * (internal class/module names) from it. A changelog entry with the
 * champion's name redacted is not more pack-neutral, it is useless to the
 * player reading it.
 *
 * Both files used to be excluded wholesale. Scanning both together turned
 * up exactly **one** real hit — `Shaco`, in one changelog highlight line —
 * so the exception below grandfathers that single line rather than either
 * whole file: `articles.ts` names no champion, monster, spell id or
 * summoner-spell literal anywhere and gets no exception at all, and the
 * rest of `changelog.ts`'s copy stays covered by every one of the three
 * checks below.
 *
 * ## Task 7 note (was: "A note for whoever does batch 5")
 *
 * `championNamesFromPack()` and `monsterNamesFromPack()` below build this
 * scan's own needle list by reading `packs/riot/spells` and
 * `packs/riot/monsters` off disk — the only way to derive "every current
 * champion and monster name" without hand-maintaining a second copy of the
 * roster. That means this file's whole premise — "core carries none of
 * Riot's vocabulary" — depends on Riot's content still being *somewhere
 * this repo can read at test time*, and it always will: this rule audits
 * *core's own tree* for leaked vocabulary, which is not something the pack's
 * own `check-seams` (it scans its own tree, not core's) can ever take over.
 *
 * What batch 5 task 7 changes is what happens once `packs/riot/` really
 * does stop being a directory in this checkout (task 8): `RIOT_INSTALLED`,
 * derived from `packs/`'s own listing rather than hardcoded, decides
 * whether there is a riot vocabulary to certify core against at all. Not
 * installed is a legitimate "nothing to check core against" — the scan
 * below runs over an empty needle list and finds nothing, correctly.
 * Installed-but-missing (the directory gone while the pack still claims to
 * be there) is the real bug, and `requireRoot` is what turns that into a
 * loud, named failure instead of `readdirSync`'s bare `ENOENT`.
 */
const REPO_ROOT = join(__dirname, '../..');
const SRC = join(REPO_ROOT, 'src');

function filesUnder(dir: string, extensions: string[]): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...filesUnder(full, extensions));
    else if (extensions.some(ext => name.endsWith(ext))) out.push(full);
  }
  return out;
}

const scannedFiles = (): string[] => filesUnder(SRC, ['.ts', '.vue']);

describe("core carries none of Riot's vocabulary", () => {
  it('has real champion and monster names to check core against, when riot is installed', () => {
    // Not `names.length > 50` any more: that combined total survived riot's
    // departure looking healthy right up until it didn't — 50 is a number
    // about today's roster size, not about whether the scan is looking at
    // anything real. Per-root instead: each source independently
    // contributed something, which is the actual failure worth naming if
    // one of them quietly stops.
    if (!packIsInstalled('riot')) return; // nothing installed to certify core against
    expect(
      riotChampionNames().length,
      'packs/riot/spells contributed 0 champion names'
    ).toBeGreaterThan(0);
    expect(
      riotMonsterNames().length,
      'packs/riot/monsters contributed 0 monster names'
    ).toBeGreaterThan(0);
  });

  it('finds source files under src/ to scan, or this scan proves nothing', () => {
    // Derived, not `> 20` — see `tests/support/srcTree.ts` for why a floor
    // over `src/` is a number about last month's tree.
    const viaVite = srcSourceFilePaths();

    expect(viaVite.length).toBeGreaterThan(0);
    expect(scannedFiles().length).toBe(viaVite.length);
  });

  /** Every offence in `src/`, grouped by which of the three rules caught it. */
  function offendersByRule(): Record<string, string[]> {
    const out: Record<string, string[]> = {
      'champion-or-monster-name': [],
      'spell-id': [],
      'summoner-id': [],
    };
    for (const file of scannedFiles()) {
      const rel = relative(REPO_ROOT, file).split(sep).join('/');
      for (const offence of riotVocabularyOffences(rel, readFileSync(file, 'utf8'))) {
        out[offence.rule].push(describeOffence(offence));
      }
    }
    return out;
  }

  it('names no champion or monster from the bundled pack, comments included', () => {
    expect(offendersByRule()['champion-or-monster-name']).toEqual([]);
  });

  it('carries no spell-id-shaped identifier (ChampionName_Slot) anywhere', () => {
    expect(offendersByRule()['spell-id']).toEqual([]);
  });

  it('carries no summoner-spell id as a quoted string literal, outside the documented defaults', () => {
    expect(offendersByRule()['summoner-id']).toEqual([]);
  });
});
