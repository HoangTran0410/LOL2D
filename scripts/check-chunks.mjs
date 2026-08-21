/**
 * Asserts the chunk graph in `dist/` actually has the shape `vite.config.ts`
 * intends. Runs after `build`, in `verify`.
 *
 * ## Why a build-level check, when two source scans already exist
 *
 * `menuBootPath.test.ts` and `pregameBootPath.test.ts` read `src/` and ban the
 * imports that would collapse the split. They are necessary and they are not
 * sufficient, because twice now the split has collapsed with the source
 * perfectly clean:
 *
 *  - `DomUtils` is imported by both the menu and the match. Left unassigned,
 *    Rollup put the shared module in `game`, so `MenuScene`'s chunk imported
 *    one helper out of a megabyte.
 *  - Vite's own `__vitePreload` runtime is not in `src/` at all. Once
 *    `spellModules.ts` arrived with 238 dynamic imports, it was assigned to
 *    `game` — and the menu imported *that*, dragging the match back in.
 *
 * Neither is visible from any file a human wrote. Both are obvious here.
 *
 *   node scripts/check-chunks.mjs
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = join(root, 'dist', 'assets');

/** Static `import ... from "./x.js"` only — a dynamic import is the point of the split. */
function staticDeps(file) {
  const source = readFileSync(join(assets, file), 'utf8');
  return [...new Set([...source.matchAll(/from"\.\/([A-Za-z0-9_.-]+\.js)"/g)].map(m => m[1]))];
}

function chunk(prefix) {
  // The trailing token is Vite's content hash, whose base64url alphabet
  // includes `-` and `_` — so match anything up to `.js`, not `[^-]+`, or a
  // hash that happens to contain a hyphen (e.g. `MenuScene-7Yhb0-MG.js`) reads
  // as zero chunks and fails a perfectly good split at random.
  const found = readdirSync(assets).filter(name => new RegExp(`^${prefix}-[^.]+\\.js$`).test(name));
  if (found.length !== 1) {
    throw new Error(`expected exactly one ${prefix}-*.js chunk, found ${found.length}`);
  }
  return found[0];
}

/** Each rule is "this chunk must not *statically* reach that family". */
const RULES = [
  {
    chunk: 'MenuScene',
    forbidden: /^game-/,
    why: 'the menu would fetch and parse the whole match before drawing a logo',
  },
  {
    chunk: 'SetupScene',
    forbidden: /^game-/,
    why: 'the pregame screen renders a roster from generated data and needs no spell classes',
  },
  {
    chunk: 'game',
    forbidden: /^spell-/,
    why: 'spell chunks are fetched per champion by `spellRegistry`; a static edge loads all of them',
  },
];

const failures = [];

for (const rule of RULES) {
  const file = chunk(rule.chunk);
  const offenders = staticDeps(file).filter(dep => rule.forbidden.test(dep));
  if (offenders.length) {
    failures.push(`${file} statically imports ${offenders.join(', ')} — ${rule.why}`);
  }
}

// `pregame -> game` used to be an accepted, one-directional edge here:
// `spellCatalog.ts` called `contentRegistry()`, which built a pack's
// `ContentApi` — the real buff/combat/vfx/spell-object classes — because a
// content pack genuinely needs them to construct real spells. Batch 3 closed
// that edge: `spellCatalog.ts` and `pregameCatalog.ts` now read
// `contentCatalog()` (`src/content/catalog.ts`), whose own value closure
// never reaches `ContentApi.ts` (`tests/content/contentApiChunk.test.ts`
// walks it), so `pregame` no longer has any reason to import the engine.
//
// This still checks the *compiled bytes* rather than trusting that, because
// `staticDeps` above cannot see a leak that Rollup's own cycle resolution
// causes silently: these four names are class exports carried as
// `ContentApi`'s object-literal property keys (`buffs: { DamageReflect, ... }`
// and friends), which esbuild's minifier cannot rename — unlike the local
// bindings that actually hold the classes. `BasicAttack` is deliberately not
// in this list: `'BasicAttack'` is also a literal spell id the pregame
// roster carries as data (`BASIC_ATTACK_ID`, a `CHAMPION_KITS` entry), so its
// presence proves nothing either way.
//
// A **class definition** riding along shows up as `Name:` — the object-
// literal key position `ContentApi.ts`'s `buildContentApi()` writes these
// names in (`MissileSpellObject:$t`, `DamageReflect:_r`, ...; confirmed by
// grepping the `game` chunk, where the real definitions live). Batch 3 gave
// this a second, and legitimate, source of the same bare name: `pregame` now
// carries all of `packs/reference/` (its `data` needs the same file's
// tuning constants, and a pack is one file to an author — see
// `packs/reference/pack.ts`'s own header), and a reference-pack spell reads
// the engine through `api.MissileSpellObject` — a **property access**,
// `Name` preceded by `.`, never followed by `:`. That is exactly the
// sanctioned, injected-API pattern working as designed, not a leak: the
// class *definition* stays in `game`, only a ~20-byte member-access string
// crosses. Matching the bare name would flag every pack that touches the API
// at all; requiring the colon is what keeps this rule aimed at the failure
// it exists for.
const PREGAME_ENGINE_LEAK = ['DamageReflect', 'TrueSight', 'ParticleSystem', 'MissileSpellObject'];
// Bytes, uncompressed. Batch 3 moved the whole content-pack *data* path here
// on purpose — `PackRegistry`, `validate.ts`, `install.ts`, `catalog.ts`,
// `ContentPack.ts`, `bundledPack.ts` and all of `packs/reference/` — which
// measured 207,858 bytes against a pre-batch-3 baseline of 163,386 (`game`
// shrank by roughly the same amount, confirming this is code moving chunks,
// not duplicating).
//
// Task 3 of that same batch raised the ceiling again, to 250,000, after
// assembling Summoner's Rift into a `MapDefinition` (`src/content/maps/
// summonersRift.ts`) pushed the measured size to 231,072 — +23,214 bytes,
// almost exactly `assets/json/summoner_map.json`'s own 22,180-byte weight
// (329 wall polygons, 40 bush, 26 water). That data has nowhere lighter to
// live: `src/content/` is `pregame` in its entirety, nothing reads the map
// yet (batches 4-8 move the readers), and the terrain is the map — there is
// no smaller-but-still-correct encoding of 395 polygons. `game`'s own size
// (270,119) barely moved, confirming this is new data, not a leak. The
// ceiling still leaves ~19KB of headroom above the new measurement, for the
// same reason the original one did: room to grow as data without room for
// the engine to fit back in unnoticed.
const PREGAME_SIZE_CEILING_BYTES = 250_000;

{
  const file = chunk('pregame');
  const source = readFileSync(join(assets, file), 'utf8');
  const leaked = PREGAME_ENGINE_LEAK.filter(name => new RegExp(`${name}:`).test(source));
  if (leaked.length) {
    failures.push(
      `${file} contains engine code (${leaked.join(', ')}) that belongs in the game chunk — ` +
        'the buff/combat/vfx surface has drifted into pregame'
    );
  }
  const bytes = Buffer.byteLength(source, 'utf8');
  if (bytes > PREGAME_SIZE_CEILING_BYTES) {
    failures.push(
      `${file} is ${bytes} bytes, over the ${PREGAME_SIZE_CEILING_BYTES}-byte pregame ceiling — ` +
        'the pregame screen should stay data, not carry engine code'
    );
  }
}

// The spell split only means anything while it is actually many chunks: a
// `manualChunks` rule that stops matching returns one big one and nothing else
// would notice.
const spellChunks = readdirSync(assets).filter(name => /^spell-.+\.js$/.test(name));
if (spellChunks.length < 40) {
  failures.push(
    `only ${spellChunks.length} spell-*.js chunks — the per-champion split is not applying`
  );
}

if (failures.length) {
  console.error('Chunk graph regressed:\n' + failures.map(line => `  - ${line}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `chunks ok: menu and pregame stay off the match chunk, ${spellChunks.length} per-champion spell chunks`
  );
}
