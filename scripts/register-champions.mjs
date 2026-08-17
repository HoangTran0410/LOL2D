/**
 * One-shot registration for the ten champions built in parallel.
 *
 * The two registration points — `spells/index.ts` and `preset.ts` — are the one
 * place ten independent champions collide, and five agents sharing a working
 * tree would have overwritten each other's edits there. So they were told to
 * write only their own spell files, and this puts all forty exports and all ten
 * roster entries in afterwards, in one pass.
 *
 * Idempotent and fussy on purpose: it refuses to write anything unless every
 * file it is about to reference exists, and skips whatever is already
 * registered. Run it as many times as you like.
 *
 *   node scripts/register-champions.mjs
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
  ['Darius', 'Darius', 'BRUISER', 'champ_darius'],
  ['Renekton', 'Renekton', 'BRUISER', 'champ_renekton'],
  ['XinZhao', 'Xin Zhao', 'BRUISER', 'champ_xinzhao'],
  ['Tryndamere', 'Tryndamere', 'BRUISER', 'champ_tryndamere'],
  ['MasterYi', 'Master Yi', 'ASSASSIN', 'champ_masteryi'],
  ['Malzahar', 'Malzahar', 'MAGE', 'champ_malzahar'],
  ['Ezreal', 'Ezreal', 'MARKSMAN', 'champ_ezreal'],
  ['Caitlyn', 'Caitlyn', 'MARKSMAN', 'champ_caitlyn'],
  ['Soraka', 'Soraka', 'SUPPORT', 'champ_soraka'],
  ['Brand', 'Brand', 'MAGE', 'champ_brand'],
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
// The summoner-spell shelf is deliberately last in SpellGroups, so champions go
// in above it rather than at the end of the array.
const ANCHOR = "  {\n    name: 'Phép Bổ Trợ',";
if (!preset.includes(ANCHOR)) {
  console.error('Could not find the summoner-spell group; preset.ts has moved.');
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
  preset = preset.replace(ANCHOR, `${entries.join('')}${ANCHOR}`);
  writeFileSync(PRESET, preset);
}
console.log(`preset.ts: ${entries.length ? `+${entries.length} champions` : 'already registered'}`);
