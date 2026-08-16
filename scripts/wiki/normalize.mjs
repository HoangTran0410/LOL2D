const RAW_FIELDS = /^(description[2-6]?|leveling[2-6]?|notes)$/;
const SOURCE_FIELDS = { name: '1', casttime: 'cast time', effectradius: 'effect radius' };

export const ABILITY_FIELDS = [
  // Icon slots run to 4 because the wiki fills them positionally rather than
  // as fallbacks: `Template:Data Garen/Courage` has `icon = false` and the
  // real art in `icon3`. Dropping the later slots here made the importer
  // report those abilities as having no icon at all.
  'name', 'icon', 'icon2', 'icon3', 'icon4',
  'description', 'description2', 'description3', 'description4', 'description5', 'description6',
  'leveling', 'leveling2', 'leveling3', 'leveling4', 'leveling5', 'leveling6',
  'range', 'radius', 'effectradius', 'width', 'speed', 'casttime', 'cost', 'cooldown',
  'targeting', 'damagetype', 'spellshield', 'projectile', 'notes',
];

export function wikiTextToText(raw) {
  return raw
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/\[\[File:[^\]]+\]\]/gi, '')
    .replace(/\[\[(?:[^\]|]+\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\{\{[^{}|]+\|([^{}]+)\}\}/g, '$1')
    .replace(/\{\{([^{}]+)\}\}/g, '$1')
    .replace(/'''?|<[^>]+>/g, '')
    .replace(/^\s*[*#]\s*/gm, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim();
}

export function parseExpandedFields(source) {
  const fields = {};
  const pattern = /@@([a-z][a-z0-9]*)@@([^]*?)(?=@@[a-z][a-z0-9]*@@|@@$)/gi;
  for (const match of source.matchAll(pattern)) fields[match[1].toLowerCase()] = match[2].trim();
  if (!Object.keys(fields).length) throw new Error('Expanded template response contains no sentinel fields');
  return fields;
}

export function normalizeAbilityFields(source) {
  const parsed = parseExpandedFields(source);
  const normalized = {};
  for (const field of ABILITY_FIELDS) {
    const raw = parsed[field];
    if (raw == null || raw === '') continue;
    if (/^\{\{\{[^{}]+\}\}\}$/.test(raw.trim())) continue;
    const text = wikiTextToText(raw);
    if (field === 'projectile' || field === 'spellshield') {
      normalized[field] = /^(?:1|true|yes)$/i.test(text);
    } else {
      normalized[field] = RAW_FIELDS.test(field) ? { raw, text } : text;
    }
  }
  return normalized;
}

export function renderFieldRequest(page) {
  return `${ABILITY_FIELDS.map(field => `@@${field}@@{{${page}|pst2|${SOURCE_FIELDS[field] ?? field}}}`).join('')}@@`;
}
