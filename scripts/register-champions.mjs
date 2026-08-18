/**
 * One-shot registration for a batch of champions built in parallel.
 *
 * The three registration points — `spells/index.ts`, `SpellGroups` in
 * `preset.ts`, and that file's `RANDOM_AVATAR_POOL` — are the one place N
 * independent champions collide, and agents sharing a working tree would have
 * overwritten each other's edits there. So each is told to write only its own
 * spell files, and this puts all the exports and roster entries in afterwards,
 * in one pass.
 *
 * Idempotent and fussy on purpose: it refuses to write anything unless every
 * file it is about to reference exists, and skips whatever is already
 * registered. Run it as many times as you like.
 *
 *   node scripts/register-champions.mjs
 *
 * `CHAMPIONS` is the batch being registered. It is rewritten per batch rather
 * than accumulating every champion ever added: the script's whole job is
 * "land the ones that are new", and a stale name in the list would trip the
 * preflight forever once its files were, say, renamed. The previous batch
 * (Darius, Renekton, Xin Zhao, Tryndamere, Master Yi, Malzahar, Ezreal,
 * Caitlyn, Soraka, Brand) is already registered and lives in git history.
 *
 * One thing that has already moved once: the insertion point. `SpellGroups`
 * used to end with the summoner-spell shelf, so champions went in *above* it;
 * the shelves are now pinned to the top of the array and champions follow, so
 * new entries append at the very end instead. The anchor below is the array's
 * closing bracket, matched together with the comment that follows it so it
 * cannot collide with some other `];` in the file.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SPELLS_DIR = join(root, 'src/game/gameObject/spells');
const INDEX = join(SPELLS_DIR, 'index.ts');
const PRESET = join(root, 'src/game/preset.ts');

/** [class prefix, display name, ATTACK archetype, avatar asset key] */
const CHAMPIONS = [
  ['Katarina', 'Katarina', 'ASSASSIN', 'champ_katarina'],
  ['Vayne', 'Vayne', 'MARKSMAN', 'champ_vayne'],
  ['Riven', 'Riven', 'BRUISER', 'champ_riven'],
  ['Sett', 'Sett', 'BRUISER', 'champ_sett'],
  ['Jhin', 'Jhin', 'MARKSMAN', 'champ_jhin'],
  ['Nautilus', 'Nautilus', 'TANK', 'champ_nautilus'],
  ['Diana', 'Diana', 'ASSASSIN', 'champ_diana'],
  ['Vi', 'Vi', 'BRUISER', 'champ_vi'],
  ['Syndra', 'Syndra', 'MAGE', 'champ_syndra'],
  ['Ziggs', 'Ziggs', 'MAGE', 'champ_ziggs'],
];

const SLOTS = ['Q', 'W', 'E', 'R'];

// ---------------------------------------------------------------- preflight
const missing = [];
for (const [prefix] of CHAMPIONS) {
  for (const slot of SLOTS) {
    if (!existsSync(join(SPELLS_DIR, `${prefix}_${slot}.ts`))) missing.push(`${prefix}_${slot}.ts`);
  }
}
if (missing.length > 0) {
  console.error(
    `Not registering — ${missing.length} spell file(s) missing:\n  ${missing.join('\n  ')}`
  );
  process.exit(1);
}

// ------------------------------------------------------------------ index.ts
let index = readFileSync(INDEX, 'utf8');
const added = [];
for (const [prefix] of CHAMPIONS) {
  const block = SLOTS.map(
    slot => `export { default as ${prefix}_${slot} } from './${prefix}_${slot}';`
  );
  if (index.includes(block[0])) continue;
  index += `\n${block.join('\n')}\n`;
  added.push(prefix);
}
if (added.length > 0) writeFileSync(INDEX, index);
console.log(`index.ts: ${added.length ? `+${added.join(', ')}` : 'already registered'}`);

// ----------------------------------------------------------------- preset.ts
let preset = readFileSync(PRESET, 'utf8');

// The champion shelves run to the end of `SpellGroups`, so new entries append
// at the closing bracket. Matched with the comment that follows so this cannot
// hit any other `];` in the file.
const GROUPS_END = '];\n\n// ---------------------------------------------------------------------------\n// Pregame setup screen data';
if (!preset.includes(GROUPS_END)) {
  console.error('Could not find the end of SpellGroups; preset.ts has moved.');
  process.exit(1);
}

const entries = [];
for (const [prefix, name, attack, image] of CHAMPIONS) {
  if (preset.includes(`name: '${name}',`)) continue;
  entries.push(
    `  {\n` +
      `    name: '${name}',\n` +
      `    attack: ATTACK.${attack},\n` +
      `    image: '${image}',\n\n` +
      `    spells: [${SLOTS.map(slot => `AllSpells.${prefix}_${slot}`).join(', ')}],\n` +
      `  },\n`
  );
}
if (entries.length > 0) {
  preset = preset.replace(GROUPS_END, `${entries.join('')}${GROUPS_END}`);
}
console.log(`preset.ts: ${entries.length ? `+${entries.length} champions` : 'already registered'}`);

// --------------------------------------------------- preset.ts avatar pool
// Every champion in this batch has a real imported portrait, so each belongs in
// the pool a fully random loadout draws its avatar from.
const POOL_END = "  'champ_camille',\n];";
const pooled = [];
if (preset.includes(POOL_END)) {
  const lines = [];
  for (const [, , , image] of CHAMPIONS) {
    if (preset.includes(`  '${image}',\n`)) continue;
    lines.push(`  '${image}',`);
    pooled.push(image);
  }
  if (lines.length > 0) {
    preset = preset.replace(POOL_END, `  'champ_camille',\n${lines.join('\n')}\n];`);
  }
} else {
  console.error('Could not find the end of RANDOM_AVATAR_POOL; skipping avatars.');
}
console.log(`avatar pool: ${pooled.length ? `+${pooled.length} portraits` : 'already registered'}`);

if (entries.length > 0 || pooled.length > 0) writeFileSync(PRESET, preset);
