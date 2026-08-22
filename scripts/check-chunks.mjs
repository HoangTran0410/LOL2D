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
import { contentPackInstalled, installedContentPackages } from './installed-packs.mjs';

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

/** Every chunk whose filename starts with `prefix-` — for a family with many members (`spell-*`). */
function chunksMatching(prefix) {
  return readdirSync(assets).filter(name => new RegExp(`^${prefix}-[^.]+\\.js$`).test(name));
}

/**
 * Each rule is "this chunk (or, with `many`, every chunk in this family)
 * must not *statically* reach that family". `many` exists for `spell-*`:
 * there are dozens of them, one per champion, so `chunk()`'s "exactly one"
 * assumption does not hold.
 */
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
  {
    chunk: 'spell',
    many: true,
    forbidden: /^game-/,
    why:
      'this is the exact edge batch 4 killed to stop the chunk cascade (59/59 spell chunks re-hashed ' +
      'on a core edit, before; 0/59, after) — a static import of `game-` by filename hash re-links ' +
      'every spell chunk the moment `game-*.js` re-hashes, even when the spell itself did not change',
  },
  {
    // Fix round 1 on content-pack-extraction batch 5 task 1 found this rule
    // missing: `src/content/install.ts` folds core's `Recall` onto the
    // installed pack with a *dynamic* `import('@/game/gameObject/coreSpells/Recall')`,
    // deliberately, because `install.ts` sits in `pregame` and `Recall.ts`
    // falls into `game` — a static import there would open exactly this
    // edge. Nothing was actually checking that choice stuck: `install.ts`
    // is a named exclusion in `pregameBootPath.test.ts`'s own scan (it
    // legitimately needs `packs/riot/pack` and friends, which that scan
    // would otherwise flag), and `contentApiChunk.test.ts` walks outward
    // from `catalog.ts` and never reaches it either. Reproduced against a
    // real build before this rule existed: turning that one dynamic import
    // static compiled clean, `pregame-*.js` genuinely gained a static
    // `from"./game-*.js"` edge, and `chunks:check` still printed "ok" — the
    // same class of gap batch 4's review found for `spell-*` importing
    // `game-*`, one level up the chunk graph. A source scan cannot see this
    // (`vite.config.ts`'s own header on the `map-<id>` carve-out makes the
    // same point about a different chunk); only the compiled bytes can.
    chunk: 'pregame',
    forbidden: /^game-/,
    why: 'the pregame screen (menu + setup) would statically pull in the whole match chunk',
  },
];

const failures = [];

for (const rule of RULES) {
  const files = rule.many ? chunksMatching(rule.chunk) : [chunk(rule.chunk)];
  for (const file of files) {
    const offenders = staticDeps(file).filter(dep => rule.forbidden.test(dep));
    if (offenders.length) {
      failures.push(`${file} statically imports ${offenders.join(', ')} — ${rule.why}`);
    }
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
// (329 wall polygons, 40 bush, 26 water). At the time nothing read the map
// yet, so the whole `MapDefinition` — terrain included — sat in `pregame` in
// its entirety.
//
// Task 4 is the fix that comment predicted was coming: `MapDefinition` split
// into an eager `MapSummary` (`id`/`name`/`size`/`factions`) and a lazy
// `geometry` — `summonersRift.ts` now exports only the summary, and
// `src/content/maps/summonersRiftGeometry.ts` (the terrain, the slots, the
// lanes, and the `?raw` JSON import that dominates their weight) sits behind
// `() => import('./summonersRiftGeometry')`, fetched only once a match is
// starting. **The split alone did not move a single byte on the first
// build** — `vite.config.ts`'s `manualChunks` pinned everything under
// `/src/content/` to `pregame` by *path*, with no exception for a module
// reached only through a dynamic import, so the geometry chunk landed back
// in `pregame` anyway and the measurement did not move. The real fix is the
// `map-<id>` rule added just above the blanket `/src/content/` one — it
// carves out `src/content/maps/*Geometry.ts` ahead of it, the same way the
// `ContentApi`/`registry` exception already did for a different reason. With
// that in place, `pregame` dropped back to just above Task 1's 207,858
// baseline, confirming the geometry genuinely left rather than merely being
// renamed. It now lives in its own `map-summonersrift-*.js` chunk, fetched
// by `GameScene.startGame()` alongside the match's spell/art loads — never
// by the menu. `game` itself barely moved, confirming nothing leaked the
// other way.
//
// The ceiling drops back to what a near-identical measurement already
// justified once, at Task 1 — 225,000 leaves comfortable headroom above
// pregame's actual size, room for the summary half to grow (a longer name, a
// third faction) without room for a stray static import of the geometry, or
// the engine, to fit back in unnoticed. **It does not move again in this
// batch** — Tasks 5-8 wire up readers for data this chunk already carries
// (or, for slots/lanes, will only ever reach through the same lazy loader),
// and Task 9's second map gets its own `map-<id>` chunk rather than growing
// this one.
//
// Deliberately no exact byte figure in this comment any more: an earlier
// version pinned one down twice (209,139, then again after this batch had
// already moved it to 213,148) and both went stale the moment the next
// task touched this chunk. The number the check actually enforces is
// `PREGAME_SIZE_CEILING_BYTES` below; read `dist/assets/pregame-*.js`'s own
// size after a real build if you need today's figure.
const PREGAME_SIZE_CEILING_BYTES = 225_000;

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
//
// Gated on the pack that provides those champions actually being installed —
// the same distinction `tests/support/installedPacks.ts` draws for the source
// scans. Every `spell-<champion>-*.js` chunk comes from that pack's spells
// (`vite.config.ts`'s rule matches that path and no other); the reference
// pack's four spells ride in `pregame` by design. So in a checkout with no
// riot pack the honest count is zero and a floor would fail a perfectly good
// build — which is exactly what `npm run verify:without-packs` measured the
// first time it got this far.
//
// **Derived, not `RIOT_SPELL_CHUNK_FLOOR = 40`.** That literal sat against an
// actual 59, under a comment reasoning carefully about *when* the floor may be
// applied, in a repository whose whole programme is moving spell files — so it
// would have stayed green through a rule that lost a third of the split. The
// pack's own generated module map is exactly what Rollup splits, and
// `vite.config.ts` names each chunk `spell-<champion>` for an id shaped
// `<Champion>_<slot>` and `spell-common` for everything else, so the expected
// set is computable rather than guessable. `installedContentPackages` gives
// the pack's resolved directory, which is the workspace symlink today and a
// real `node_modules` directory once the pack is a repository of its own.
const spellChunks = readdirSync(assets).filter(name => /^spell-.+\.js$/.test(name));
if (contentPackInstalled(root, 'riot')) {
  const pack = installedContentPackages(root).find(entry => entry.name === 'riot');
  const moduleMap = readFileSync(join(pack.dir, 'generated/spellModules.ts'), 'utf8');
  const ids = [...moduleMap.matchAll(/^\s*"([^"]+)":\s*\(\)\s*=>\s*import\(/gm)].map(m => m[1]);
  if (ids.length === 0) {
    failures.push(`${pack.name}: no dynamic spell imports parsed out of generated/spellModules.ts`);
  }
  const expected = new Set(
    ids.map(id => {
      const champion = /^([A-Za-z0-9]+)_[QWER][0-9]*$/.exec(id);
      return `spell-${champion ? champion[1].toLowerCase() : 'common'}`;
    })
  );
  // Matched by prefix, not by stripping the hash: Vite's hash is base64url
  // and can itself contain `-`, so any "cut the last segment" rule turns
  // `spell-ahri-V-Ag.js` into `spell-ahri-V` or `spell`.
  const missing = [...expected].filter(
    name => !spellChunks.some(chunk => chunk.startsWith(`${name}-`))
  );
  if (missing.length > 0) {
    failures.push(
      `${missing.length} of ${expected.size} per-champion spell chunks are missing ` +
        `(${missing.slice(0, 5).join(', ')}${missing.length > 5 ? ', …' : ''}) — ` +
        'the per-champion split is not applying'
    );
  }
}

if (failures.length) {
  console.error('Chunk graph regressed:\n' + failures.map(line => `  - ${line}`).join('\n'));
  process.exitCode = 1;
} else {
  console.log(
    `chunks ok: menu and pregame stay off the match chunk, ${spellChunks.length} per-champion spell chunks`
  );
}
