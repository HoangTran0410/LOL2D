import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../src/seams/importScan';
import { packIsInstalled, requireRoot } from './installedPacks';

/**
 * "Does this text carry Riot's vocabulary?" — asked once, here, by everything
 * that has to ask it.
 *
 * `tests/content/vocabularyBoundary.test.ts` has asked it of core's `src/`
 * tree since batch 4. The whole-branch review of batch 5 found the same
 * question needed asking of a second, differently-shaped population —
 * **`@moba2d/core`'s published tarball** — where `corePackTarball.test.ts`
 * was instead asserting a *proxy* (`!path.startsWith('packs/')`) that could
 * not see 296 rows of Riot image provenance, six Riot-Wiki scripts and a dead
 * script naming 19 champions, all of which that tarball carried. Two
 * populations, one rule; a second hand-written copy of the needle list is how
 * the two would drift, so there is one.
 *
 * ## The needles are derived, never listed
 *
 * `packs/riot/spells/`'s own filenames are the champion roster and
 * `packs/riot/monsters/`'s are the monster list, so a champion added
 * tomorrow is covered without anyone editing this file. `DISPLAY_VARIANTS`
 * is the only hand-written part, and only because a few filename tokens are
 * not the spelling prose uses (`ChoGath` -> `Cho'Gath`).
 *
 * The riot pack not being installed is a legitimate "there is no vocabulary
 * to certify anything against" — the needle list is empty and every scan
 * correctly finds nothing. The pack installed with one of its roots *missing*
 * is a different question and a real bug, which is what `requireRoot` turns
 * into a named failure (batch 5 task 7).
 *
 * ## The exemptions are derived too, where they can be
 *
 * `Vera_Q`/`Vera_W`/... are `packs/reference/`'s **fictional** champion, the
 * placeholder that exists to prove the multi-pack qualifying scheme. Those
 * ids used to be exempt by the literal string `'Vera_Q'`; they are exempt now
 * because `Vera` is a name `packs/reference/spells/` itself yields, so the
 * reference pack gaining a second champion does not need an edit here. The
 * three genuinely hand-written exemptions left are `GRANDFATHERED_LINES`, and
 * each carries its argument in the test that owns the file.
 */
const REPO_ROOT = join(__dirname, '..', '..');
const PACKS = join(REPO_ROOT, 'packs');

/** Every summoner-spell id — the shape a real content leak into core takes. */
export const SUMMONER_SPELL_IDS = ['Flash', 'Ghost', 'Heal', 'Ignite', 'StealthWard'];

/** `Ahri_Q.ts` -> `Ahri`; `index.ts` and `_EmptyExample.ts` yield nothing. */
function championNamesIn(dir: string): string[] {
  const names = new Set<string>();
  for (const file of readdirSync(dir)) {
    const match = file.match(/^([A-Za-z]+)_[QWERP][A-Za-z0-9]*\.ts$/);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/** `[]` when the riot pack is not installed — see this file's header. */
export function riotChampionNames(): string[] {
  if (!packIsInstalled('riot')) return [];
  return championNamesIn(
    requireRoot(join(PACKS, 'riot/spells'), 'riotVocabulary: packs/riot/spells')
  );
}

/** `Baron.ts` -> `Baron`. `[]` when the riot pack is not installed. */
export function riotMonsterNames(): string[] {
  if (!packIsInstalled('riot')) return [];
  const dir = requireRoot(join(PACKS, 'riot/monsters'), 'riotVocabulary: packs/riot/monsters');
  return readdirSync(dir)
    .filter(file => file.endsWith('.ts'))
    .map(file => file.replace(/\.ts$/, ''));
}

/**
 * The reference pack's own fictional champions — `Vera` today. Not Riot's,
 * so a `Vera_R` identifier is not a leak; see this file's header.
 */
export function referenceChampionNames(): string[] {
  if (!packIsInstalled('reference')) return [];
  return championNamesIn(
    requireRoot(join(PACKS, 'reference/spells'), 'riotVocabulary: packs/reference/spells')
  );
}

/**
 * A handful of champions whose filename token (PascalCase, a valid TS
 * identifier) is not the display name a doc comment actually writes in prose.
 * Both forms are banned; this only adds the second.
 */
const DISPLAY_VARIANTS: Record<string, string[]> = {
  ChoGath: ["Cho'Gath"],
  JarvanIV: ['Jarvan IV', 'Jarvan'],
  LeeSin: ['Lee Sin'],
  MasterYi: ['Master Yi'],
  XinZhao: ['Xin Zhao'],
};

/** Every champion and monster proper noun, in both its identifier and prose spellings. */
export function bannedRiotNames(): string[] {
  const base = [...riotChampionNames(), ...riotMonsterNames()];
  const out = [...base];
  for (const name of base) out.push(...(DISPLAY_VARIANTS[name] ?? []));
  return out;
}

/**
 * `${repo-relative path}: ${trimmed line}` for the three lines allowed to
 * carry Riot vocabulary, each argued where it lives:
 *
 *  - `PregameConfig.ts`'s two loadout defaults — that module is deliberately
 *    pure data with no content-system import, so it restates two content
 *    facts as literals the way `DEFAULT_MAP_ID` right above them does.
 *    `PregameConfig.test.ts` cross-checks them against the live shelf.
 *  - one `changelog.ts` highlight — hand-written, player-facing history of
 *    this fan game's own past changes, written in Vietnamese for players. A
 *    changelog entry with the champion's name redacted is not more
 *    pack-neutral, it is useless to the player reading it.
 */
export const GRANDFATHERED_LINES: ReadonlySet<string> = new Set([
  "src/game/config/PregameConfig.ts: summonerD: 'Flash',",
  "src/game/config/PregameConfig.ts: summonerF: 'Heal',",
  "src/scenes/about/changelog.ts: 'Làm lại kỹ năng W của Shaco.',",
]);

export interface VocabularyOffence {
  /** Repo-relative, POSIX-separated. */
  readonly path: string;
  readonly rule: 'champion-or-monster-name' | 'spell-id' | 'summoner-id';
  readonly token: string;
  readonly line: string;
}

/**
 * Every Riot-vocabulary offence in one file's text, grandfathered lines
 * already removed.
 *
 * Comments are **not** stripped for the name and spell-id rules: most of the
 * real hits this scan ever found were doc comments illustrating an engine bug
 * with the spell that first exposed it, and that is exactly the vocabulary
 * being purged. They *are* stripped for the summoner-id rule, whose subject
 * is a quoted id sitting in core as data.
 */
export function riotVocabularyOffences(path: string, source: string): VocabularyOffence[] {
  const offences: VocabularyOffence[] = [];
  const allowed = (line: string) => GRANDFATHERED_LINES.has(`${path}: ${line.trim()}`);

  const namePatterns = bannedRiotNames().map(name => ({
    name,
    re: new RegExp(`\\b${name.replace(/'/g, "'?")}\\b`),
  }));
  for (const line of source.split('\n')) {
    for (const { name, re } of namePatterns) {
      if (re.test(line) && !allowed(line)) {
        offences.push({ path, rule: 'champion-or-monster-name', token: name, line: line.trim() });
      }
    }
  }

  const fictional = referenceChampionNames();
  const spellIdPattern = /\b[A-Z][a-z]+(?:IV)?_[QWERP][A-Za-z0-9]*\b/g;
  for (const match of source.matchAll(spellIdPattern)) {
    const champion = match[0].slice(0, match[0].indexOf('_'));
    if (fictional.includes(champion)) continue;
    offences.push({ path, rule: 'spell-id', token: match[0], line: match[0] });
  }

  const summonerPattern = new RegExp(`['"](${SUMMONER_SPELL_IDS.join('|')})['"]`, 'g');
  for (const line of stripComments(source).split('\n')) {
    for (const match of line.matchAll(summonerPattern)) {
      if (allowed(line)) continue;
      offences.push({ path, rule: 'summoner-id', token: match[0], line: line.trim() });
    }
  }

  return offences;
}

/** One offence rendered the way both callers report it. */
export function describeOffence(offence: VocabularyOffence): string {
  return `${offence.path}: ${offence.token} (${offence.line})`;
}
