#!/usr/bin/env node
/**
 * Sync every spell's Vietnamese display name against Riot's own vi_VN
 * localisation.
 *
 * The names in `src/game/gameObject/spells/` were written by hand and drifted:
 * Pantheon W was "Khiên Xung Kích" where the Vietnamese client calls it
 * "Khiên Trời Giáng", R was "Thiên Thạch Giáng Thế" against the official
 * "Trời Sập". Riot publishes the real strings in Data Dragon, so this reads
 * them rather than guessing, caches the answer, and rewrites the one substring
 * of each file that holds the name.
 *
 * Only the name changes. Descriptions stay hand-written on purpose — the
 * official ones carry no numbers, and LOL2D's are scaled to a ~100 health pool.
 *
 *   node scripts/wiki/sync-spell-names.mjs            # report drift, write nothing
 *   node scripts/wiki/sync-spell-names.mjs --apply    # rewrite the spell files
 *   node scripts/wiki/sync-spell-names.mjs --refresh  # re-download from Data Dragon
 *
 * The cache it writes (`docs/abilities/generated/spell-names-vi.json`) is what
 * `tests/game/spells/vi-spell-names.test.ts` asserts against, so the check runs
 * offline in milliseconds as part of the normal suite and only this script ever
 * touches the network.
 */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SPELL_DIR = join(ROOT, 'src', 'game', 'gameObject', 'spells');
// Deliberately outside `docs/abilities/`: `ability:check` walks that tree and
// validates every JSON in it against the imported-ability schema.
const CACHE_FILE = join(ROOT, 'docs', 'spell-names-vi.json');
const DDRAGON = 'https://ddragon.leagueoflegends.com';
const LOCALE = 'vi_VN';

/** DDragon's `spells` array is ordered Q, W, E, R. */
const SLOTS = ['Q', 'W', 'E', 'R'];

/**
 * Spells LOL2D has that are not champion abilities. Data Dragon keeps summoner
 * spells in `summoner.json` and the ward in `item.json`; the basic attack is
 * ours alone and has no upstream string at all.
 */
const SUMMONER_KEYS = {
  Flash: 'SummonerFlash',
  Ghost: 'SummonerHaste',
  Heal: 'SummonerHeal',
  Ignite: 'SummonerDot',
};
const ITEM_KEYS = { StealthWard: '3340' };
/** No upstream string exists for these, so they are left exactly as written. */
const NOT_FROM_RIOT = new Set(['BasicAttack', '_EmptyExample', 'index']);

const argv = new Set(process.argv.slice(2));
const APPLY = argv.has('--apply');
const REFRESH = argv.has('--refresh');

const fetchJson = async url => {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${response.statusText} for ${url}`);
  return response.json();
};

/** Every `Champion_Q.ts` in the spell folder, as `{ slug, champion, slot }`. */
const spellFiles = () =>
  readdirSync(SPELL_DIR)
    .filter(file => file.endsWith('.ts'))
    .map(file => {
      const slug = file.slice(0, -3);
      const [champion, slot] = slug.split('_');
      return { file, slug, champion, slot };
    })
    .filter(entry => !NOT_FROM_RIOT.has(entry.slug));

const download = async () => {
  const versions = await fetchJson(`${DDRAGON}/api/versions.json`);
  const version = versions[0];
  const data = `${DDRAGON}/cdn/${version}/data/${LOCALE}`;

  // The index is the only reliable way from our file prefix to Riot's key:
  // we write `ChoGath_Q.ts`, Data Dragon files it under `Chogath`.
  const index = (await fetchJson(`${data}/champion.json`)).data;
  const byLowerKey = new Map(Object.keys(index).map(key => [key.toLowerCase(), key]));

  // Only `Champion_Q.ts`-shaped files name a champion; Flash and the ward are
  // looked up further down, in `summoner.json` and `item.json`.
  const champions = [
    ...new Set(spellFiles().filter(entry => entry.slot).map(entry => entry.champion)),
  ].sort();

  const names = {};
  const missing = [];

  for (const champion of champions) {
    const key = byLowerKey.get(champion.toLowerCase());
    if (!key) {
      missing.push(champion);
      continue;
    }
    const detail = (await fetchJson(`${data}/champion/${key}.json`)).data[key];
    detail.spells.forEach((spell, i) => {
      names[`${champion}_${SLOTS[i]}`] = spell.name;
    });
    // Passives have no spell file today, but recording them costs one field and
    // is what a passive slot would need the day one is added.
    names[`${champion}_P`] = detail.passive.name;
    process.stdout.write(`  ${key}\n`);
  }

  const summoners = (await fetchJson(`${data}/summoner.json`)).data;
  for (const [slug, key] of Object.entries(SUMMONER_KEYS)) {
    if (summoners[key]) names[slug] = summoners[key].name;
  }
  const items = (await fetchJson(`${data}/item.json`)).data;
  for (const [slug, key] of Object.entries(ITEM_KEYS)) {
    if (items[key]) names[slug] = items[key].name;
  }

  if (missing.length) {
    console.warn(`\n! no Data Dragon champion for: ${missing.join(', ')}`);
  }

  return {
    $comment:
      'Generated by scripts/wiki/sync-spell-names.mjs from Riot Data Dragon vi_VN. ' +
      'Do not hand-edit; run `npm run names:sync -- --refresh` instead.',
    version,
    locale: LOCALE,
    source: `${DDRAGON}/cdn/${version}/data/${LOCALE}/`,
    fetchedAt: new Date().toISOString(),
    names: Object.fromEntries(Object.entries(names).sort(([a], [b]) => a.localeCompare(b))),
  };
};

const loadCache = async () => {
  if (!REFRESH && existsSync(CACHE_FILE)) {
    return JSON.parse(readFileSync(CACHE_FILE, 'utf8'));
  }
  console.log(`fetching ${LOCALE} names from Data Dragon...`);
  const payload = await download();
  mkdirSync(dirname(CACHE_FILE), { recursive: true });
  writeFileSync(CACHE_FILE, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`\nwrote ${CACHE_FILE} (${Object.keys(payload.names).length} names)`);
  return payload;
};

/**
 * The name line, split so only the human-readable half is replaceable:
 * `  name = 'Khiên Xung Kích (Pantheon_W)';` → prefix / quote / name / tag.
 *
 * The quote is captured and back-referenced because Cho'Gath's tag contains an
 * apostrophe, so those four files are written with double quotes instead.
 *
 * The parenthetical tag is left alone. It is not always the slug — the ward
 * writes `(Stealth Ward)` — and it is a debug label, not a translation.
 */
const NAME_LINE = /^(\s*name = (['"]))(.*?)(\s*\([^)]*\)\2;)\s*$/m;

const main = async () => {
  const cache = await loadCache();
  const official = cache.names;

  const drift = [];
  const unmatched = [];

  for (const entry of spellFiles()) {
    const expected = official[entry.slug];
    if (!expected) {
      unmatched.push(entry.slug);
      continue;
    }
    const path = join(SPELL_DIR, entry.file);
    const source = readFileSync(path, 'utf8');
    const match = source.match(NAME_LINE);
    if (!match) {
      unmatched.push(`${entry.slug} (no name line)`);
      continue;
    }
    const current = match[3];
    if (current === expected) continue;

    drift.push({ slug: entry.slug, current, expected });
    if (!APPLY) continue;
    // Written through a replacer function, not a `$1…` template: a name is
    // arbitrary text and `$&` inside one would otherwise expand. Whichever
    // quote the file already uses has to survive appearing in the new name.
    writeFileSync(
      path,
      source.replace(NAME_LINE, (_line, prefix, quote, _old, tag) => {
        const escaped = expected
          .replace(/\\/g, '\\\\')
          .replace(new RegExp(quote, 'g'), `\\${quote}`);
        return `${prefix}${escaped}${tag}`;
      })
    );
  }

  console.log(`\nData Dragon ${cache.version} (${cache.locale})`);
  if (!drift.length) {
    console.log('all spell names already match the Vietnamese client.');
  } else {
    console.log(`${drift.length} name${drift.length === 1 ? '' : 's'} ${APPLY ? 'updated' : 'differ'}:`);
    for (const { slug, current, expected } of drift) {
      console.log(`  ${slug.padEnd(16)} ${current}  ->  ${expected}`);
    }
    if (!APPLY) console.log('\nrun with --apply to rewrite the spell files.');
  }
  if (unmatched.length) console.log(`\nno upstream name for: ${unmatched.join(', ')}`);
};

main().catch(error => {
  console.error(error);
  process.exit(1);
});
