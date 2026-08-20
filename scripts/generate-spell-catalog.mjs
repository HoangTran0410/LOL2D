/**
 * Generates `src/generated/spellCatalog.ts` — every spell's *display* data as
 * plain values, so the pregame screen can render the whole roster without
 * importing a single spell class.
 *
 * ## Why this exists
 *
 * `preset.ts` used to answer "what does this ability look like in the picker?"
 * by doing `new SpellClass({ game: { matchRules } })` and reading seven fields
 * off the instance. Correct, and cheap per call — but it needs the *class*, so
 * the setup screen imported `import * as AllSpells`, and that one line put all
 * 238 spell modules (~71% of the 1.1MB game chunk) behind a screen that only
 * ever wanted names, icons and numbers.
 *
 * Constructing them once here, at build time, is the same answer with the code
 * left behind.
 *
 * ## What is stored, and what is not
 *
 * Two of `SpellDisplay`'s seven fields depend on match rules, and both are pure
 * functions of the other five — `Spell.reducedCooldown` is `d * multiplier` and
 * `Spell.effectiveMana` is `manaFree ? 0 : amount`. So this stores the *rule-free*
 * numbers and `config/spellCatalog.ts` reapplies the rules at render time. Nothing
 * here knows what URF is.
 *
 * `iconKey`, not `iconUrl`: a URL is a content hash that changes every time the
 * image does, and baking one into a checked-in file would mean this generator
 * had to re-run for a reason that has nothing to do with spells.
 *
 * ## The catch that isn't
 *
 * `getSpellDisplay` wraps construction in a `try/catch` because it runs in a
 * browser where one broken spell must not take the picker down with it. Here
 * the opposite is right: a spell that cannot describe itself is a bug, and the
 * build is exactly where it should stop. So this reimplements the read rather
 * than calling `getSpellDisplay`, and throws.
 *
 *   npm run catalog:generate     # rewrite the file
 *   npm run catalog:check        # fail if it is stale (runs in `verify`)
 *
 * Descriptions interpolate tuning constants (`${Q_DAMAGE}`), which is why the
 * check is in `verify`: retuning a spell without regenerating would leave the
 * setup screen quoting numbers the engine no longer uses.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const scriptPath = fileURLToPath(import.meta.url);
const root = resolve(dirname(scriptPath), '..');
const outputPath = resolve(root, 'src/generated/spellCatalog.ts');
const modulesPath = resolve(root, 'src/generated/spellModules.ts');
const barrelPath = resolve(root, 'src/game/gameObject/spells/index.ts');
const coreBarrelPath = resolve(root, 'src/game/gameObject/coreSpells/index.ts');

/** No cooldown reduction, no URF — the rule-free numbers this file stores. */
const NO_MATCH_RULES = { cooldownMultiplier: 1, manaFree: false };

/**
 * Reads one spell's display fields off a throwaway instance.
 *
 * Deliberately not `preset.getSpellDisplay`: that one catches and returns a
 * placeholder, which is right in a browser and wrong in a build step. Every
 * field is also asserted rather than defaulted, so "this spell forgot a name"
 * fails here instead of shipping an empty string to the picker.
 */
function describe(id, SpellClass) {
  const instance = new SpellClass({ game: { matchRules: NO_MATCH_RULES } });

  const name = instance.name;
  if (typeof name !== 'string' || !name) throw new Error(`${id}: no name`);

  const description = instance.description;
  if (typeof description !== 'string') throw new Error(`${id}: description is not a string`);

  const coolDownMs = typeof instance.coolDown === 'number' ? instance.coolDown : 0;
  const manaCost = typeof instance.manaCost === 'number' ? instance.manaCost : 0;

  // `Spell.effectiveCoolDownMs` reads `castSpec.cooldown.durationMs`, not
  // `coolDown` — for most spells the same number, but not all, and the picker
  // must show the one a countdown will actually run. Under a multiplier of 1
  // this getter *is* that duration.
  const specCoolDownMs =
    typeof instance.effectiveCoolDownMs === 'number' ? instance.effectiveCoolDownMs : 0;

  for (const [field, value] of [
    ['coolDownMs', coolDownMs],
    ['manaCost', manaCost],
    ['specCoolDownMs', specCoolDownMs],
  ]) {
    if (!Number.isFinite(value)) throw new Error(`${id}: ${field} is ${value}`);
  }

  // `image` is an `AssetHandle`, already resolved by the spell's own field
  // initializer. Its `key` is the manifest key; its `url` is a build hash.
  const handle = instance.image;
  const iconKey = handle && typeof handle.key === 'string' ? handle.key : null;

  return { id, name, description, iconKey, coolDownMs, manaCost, specCoolDownMs };
}

export async function renderSpellCatalogSource() {
  const server = await createServer({
    root,
    configFile: resolve(root, 'vite.config.ts'),
    logLevel: 'error',
    server: { middlewareMode: true, hmr: false },
    appType: 'custom',
  });

  try {
    const CoreSpells = await server.ssrLoadModule('/src/game/gameObject/coreSpells/index.ts');
    const ContentSpells = await server.ssrLoadModule('/src/game/gameObject/spells/index.ts');
    // Content-last: a content id can never shadow a core one.
    const AllSpells = { ...ContentSpells, ...CoreSpells };
    const entries = Object.entries(AllSpells)
      .filter(([, value]) => typeof value === 'function')
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([id, SpellClass]) => describe(id, SpellClass));

    if (!entries.length) throw new Error('the spell barrel exported no classes');
    return render(entries);
  } finally {
    await server.close();
  }
}

function render(entries) {
  const records = entries.map(
    entry =>
      `  ${JSON.stringify(entry.id)}: {\n` +
      `    name: ${JSON.stringify(entry.name)},\n` +
      `    description: ${JSON.stringify(entry.description)},\n` +
      `    iconKey: ${JSON.stringify(entry.iconKey)},\n` +
      `    coolDownMs: ${entry.coolDownMs},\n` +
      `    manaCost: ${entry.manaCost},\n` +
      `    specCoolDownMs: ${entry.specCoolDownMs},\n` +
      `  },`
  );

  return [
    '// Generated by scripts/generate-spell-catalog.mjs. Do not edit.',
    '//',
    "// Every spell's display data as plain values, so the pregame screen can render",
    '// the roster without importing a spell class. See the generator for why, and',
    '// `src/game/config/spellCatalog.ts` for how match rules are reapplied on top.',
    '',
    "import type { AssetKey } from './assetManifest';",
    '',
    'export interface GeneratedSpellDisplay {',
    '  readonly name: string;',
    '  /** Vietnamese HTML — `<span class="damage">`/`.buff`/`.time`/plain `<span>`. */',
    '  readonly description: string;',
    '  /**',
    "   * The icon's manifest key, resolved through `AssetManager.get` — never a",
    '   * built URL, which is a content hash and would drag this file into every',
    '   * rebuild that touched an image. Typed against the *other* generated file,',
    '   * so renaming an icon without renaming it here is a compile error.',
    '   */',
    '  readonly iconKey: AssetKey | null;',
    "  /** The spell's own tuning number, before match rules. */",
    '  readonly coolDownMs: number;',
    "  /** The spell's own tuning number, before match rules. */",
    '  readonly manaCost: number;',
    '  /** `castSpec.cooldown.durationMs` — what a countdown runs before CDR. */',
    '  readonly specCoolDownMs: number;',
    '}',
    '',
    'export const spellCatalog = {',
    ...records,
    '} as const satisfies Record<string, GeneratedSpellDisplay>;',
    '',
    '/**',
    " * Every catalogue id — the spell barrel's own export names.",
    ' *',
    ' * This is what makes a mistyped id a compile error rather than a silently',
    ' * missing ability: `config/spellCatalog.ts` types `CHAMPION_KITS` as these.',
    ' */',
    'export type SpellCatalogId = keyof typeof spellCatalog;',
    '',
  ].join('\n');
}

/**
 * The other half: `id → () => import('./Yasuo_Q')`, so a match can fetch the
 * kits it is actually about to play instead of the whole barrel.
 *
 * Parsed out of `spells/index.ts` and `coreSpells/index.ts` rather than
 * guessed from the id, because a barrel is the thing that decides which file
 * and which directory an id names — `BasicAttack` is `coreSpells/BasicAttack`,
 * `Yasuo_Q` is `spells/Yasuo_Q`, and nothing guarantees id and path always
 * agree in future. The two barrels are independent `readFile`s (this function
 * never touches `ssrLoadModule`), so `coreIds` is built here rather than
 * reused from `renderSpellCatalogSource` — that function's `CoreSpells` is a
 * different kind of value (loaded classes, not parsed text) in a scope this
 * one does not share.
 *
 * The importers stay `() => import(...)` thunks rather than a resolved map:
 * Rollup only treats a dynamic import as a split point if it is literal and
 * unexecuted at module scope, so writing them any other way silently collapses
 * this file back into one eager chunk.
 */
export async function renderSpellModulesSource() {
  const pattern = /export\s*\{\s*default\s+as\s+([A-Za-z0-9_]+)\s*\}\s*from\s*'(\.\/[^']+)'/g;
  const parseBarrel = async path => {
    const source = await readFile(path, 'utf8');
    return [...source.matchAll(pattern)].map(([, id, importPath]) => ({ id, path: importPath }));
  };

  const [contentEntries, coreEntries] = await Promise.all([
    parseBarrel(barrelPath),
    parseBarrel(coreBarrelPath),
  ]);

  if (!contentEntries.length && !coreEntries.length) {
    throw new Error('no `export { default as X } from` lines in either barrel');
  }

  const coreIds = new Set(coreEntries.map(entry => entry.id));

  // Content-last, matching `renderSpellCatalogSource`: a content id can never
  // shadow a core one.
  const merged = new Map();
  for (const entry of contentEntries) merged.set(entry.id, entry);
  for (const entry of coreEntries) merged.set(entry.id, entry);

  const entries = [...merged.values()].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  );

  const records = entries.map(entry => {
    const dir = coreIds.has(entry.id) ? 'coreSpells' : 'spells';
    return `  ${JSON.stringify(entry.id)}: () => import('@/game/gameObject/${dir}/${entry.path.slice(2)}'),`;
  });

  return [
    '// Generated by scripts/generate-spell-catalog.mjs. Do not edit.',
    '//',
    '// One dynamic import per spell, so a match loads the kits in play rather',
    '// than all of them. `src/game/spellRegistry.ts` is the read side.',
    '',
    '/** A spell module, as the barrel re-exports it: the class on `default`. */',
    'export interface SpellModule {',
    '  // eslint-disable-next-line @typescript-eslint/no-explicit-any',
    '  default: any;',
    '}',
    '',
    'export const spellModules: Record<string, () => Promise<SpellModule>> = {',
    ...records,
    '};',
    '',
  ].join('\n');
}

export async function generateSpellCatalog(check = false) {
  const [catalog, modules] = await Promise.all([
    renderSpellCatalogSource(),
    renderSpellModulesSource(),
  ]);
  const outputs = [
    { path: outputPath, source: catalog },
    { path: modulesPath, source: modules },
  ];

  if (check) {
    for (const { path, source } of outputs) {
      const current = await readFile(path, 'utf8').catch(() => '');
      if (current !== source) {
        throw new Error(
          `Generated ${path.endsWith('spellModules.ts') ? 'spell module map' : 'spell catalog'} is stale. Run npm run catalog:generate.`
        );
      }
    }
    return;
  }

  await mkdir(dirname(outputPath), { recursive: true });
  for (const { path, source } of outputs) await writeFile(path, source);
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  generateSpellCatalog(process.argv.includes('--check')).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
