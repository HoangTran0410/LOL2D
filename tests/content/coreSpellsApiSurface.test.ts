import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packIsInstalled, requireRoot } from '../support/installedPacks';

vi.mock('../../src/managers/AssetManager', () => ({
  default: { get: (key: string) => ({ key, path: key, status: 'ready', data: null }) },
}));

import { buildContentApi } from '../../src/content/ContentApi';

/**
 * Renamed from `contentApi-surface-seam.test.ts` in batch 4 task 3's review
 * round, because that name stopped describing what this file actually
 * guards. It used to walk `content` and `coreSpells` together — 241 spell
 * files reaching directly into `@/game/...` — and assert every value-level
 * symbol they named was reachable off `buildContentApi()`. Batch 4 task 3
 * moved the 238 content spells into `packs/riot/spells/` and converted them
 * to the `make<Name>(api: ContentApi)` factory shape, so they no longer name
 * a single `@/` core module — `packBoundary.test.ts` forbids it outright, and
 * `packs/**` sits under `typecheck:core` (`tsconfig.strict-core.json`), which
 * would refuse to compile a pack file reaching for something `ContentApi`
 * does not carry. Those two together now hold the property this file used to
 * check, structurally, for every pack file — this file's remaining, real job
 * is `coreSpells/` alone. `Recall.ts` joined `BasicAttack.ts` there in batch 5
 * task 1, but contributes nothing to this scan's population: its own two
 * `@/`-prefixed imports (`@/content/ContentApi`, `@/content/types`) are both
 * `import type`, erased before this file's `isType` filter even runs. So
 * `BasicAttack.ts` stays, today, the one spell core constructs directly and
 * imports `@/game/...` from as a plain value.
 *
 * `ContentApi` is a hand-assembled list, and a hand-assembled list drifts.
 * The first cut of this file imported the default export of every core
 * module the measured import table named and stopped there — but eight of
 * those modules also carry named exports real spells import alongside the
 * default (`PredefinedParticleSystems` beside `ParticleSystem`, `createReveal`
 * beside `TrueSight`, `unitCastBarAnchor` beside `CastBar`, and more), and
 * three modules real spells import were not carried at all
 * (`PredefinedFilters` off `ObjectManager` — 153 files — `SpellForm` off
 * `CancelPolicy`, `SpellRole`). None of that showed up in
 * `contentApi.test.ts`, because asserting `toBeTypeOf('object')` on a
 * namespace passes for `{}` just as well as for the real thing.
 *
 * So this is a source scan, in the shape of `dash-onupdate-seam.test.ts` and
 * `mana-spend-seam.test.ts`: walk every spell file (today, that population is
 * `coreSpells/` alone), collect every `@/`-prefixed import and the symbols it
 * names, and assert each one is reachable somewhere off `buildContentApi()`.
 * A core spell that starts importing something new now fails this test
 * instead of leaving a silent hole `ContentApi` never covered.
 *
 * Two things this scan has to be honest about:
 *
 * - **`import type` is skipped, not asserted differently.** A type is erased
 *   by the compiler; there is no runtime object it could be "reachable"
 *   through, and requiring `ContentApi` to re-export types would conflate a
 *   compile-time question with this runtime seam. A pack that needs
 *   `CastContext` or `CastSpec` still `import type`s it directly — that
 *   costs nothing at runtime and pulls in no bundle, which is the entire
 *   reason the type/value line matters here.
 * - **Relative imports are out of scope.** Only `@/`-prefixed imports are
 *   core; a spell importing from `./OtherSpell` is content reaching into
 *   content, which this file has no opinion on.
 *
 * Reachability is checked by *name*, not by reference identity: the scan
 * walks the object graph `buildContentApi()` returns and asks whether a key
 * of that name exists anywhere in it (top level or inside a namespace, one
 * or two levels deep — `combat.Reach.effectiveRange` is three). That is
 * weaker than an identity check, but it is the same strength as every other
 * scan in this tree, it is what makes the "the module used to carry it, now
 * expose the name" fix mechanical, and a same-named-but-wrong-thing
 * collision across ~110 distinct, mostly single-purpose symbol names is not
 * a real risk this codebase has hit.
 *
 * A default import has no fixed name to check by — `import RootBuff from
 * '.../Root'` and `import Root from '.../Root'` are the same binding under
 * two spellings the *importer* chose, and the first draft of this scan
 * flagged `RootBuff` as a missing symbol because of it. Every default export
 * in this tree is a class or object named for its file (`Root.ts` exports
 * `class Root`), so the scan checks a default import by the module's own
 * basename instead of whatever local name a given spell happened to pick.
 *
 * `@/managers/AssetManager` is a deliberate exclusion, not an oversight: the
 * module doc comment above explains that `asset(key)` stands in for
 * `AssetManager.get(key)` on purpose — the *class* is not meant to be
 * reachable, the function is, and `contentApi.test.ts` already covers it.
 * Every pack spell has migrated to `api.asset()` as of batch 4 task 3;
 * `coreSpells/BasicAttack.ts`, core, still imports `AssetManager` directly
 * and always will — this exclusion is permanent, not a "not yet".
 */

const CORE_SPELLS_DIR = join(__dirname, '../../src/game/gameObject/coreSpells');

/** Comments describe the rule; matching them would flag the documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function tsFilesIn(dir: string): string[] {
  return readdirSync(dir).filter(name => name.endsWith('.ts'));
}

/**
 * `coreSpells/` alone now — `packs/riot/spells/` moved out in batch 4 task 3
 * and cannot name a `@/` core module at all any more (`packBoundary.test.ts`
 * plus `packs/**` under `typecheck:core`), so scanning it here would only
 * ever contribute nothing. `index.ts` is a barrel, not a spell, so it is
 * excluded.
 */
function allSpellFiles(): { dir: string; file: string }[] {
  return tsFilesIn(CORE_SPELLS_DIR)
    .filter(file => file !== 'index.ts')
    .map(file => ({ dir: CORE_SPELLS_DIR, file }));
}

interface ImportedSymbol {
  /** The name a pack would need off `ContentApi` — the exported name, not a local alias. */
  name: string;
  isType: boolean;
}

interface ParsedImport {
  module: string;
  symbols: ImportedSymbol[];
}

/** `import`, an optional whole-clause `type`, a clause, then `from '<module>'` — spans newlines. */
const IMPORT_RE = /import\s+(type\s+)?([\s\S]*?)\s+from\s+['"]([^'"]+)['"]/g;

/**
 * A module the scan does not hold the spell tree to, because `ContentApi`
 * answers the same need a different way. See the module doc comment above.
 */
const EXCLUDED_MODULES = new Set(['@/managers/AssetManager']);

/**
 * The name a default export is known by, absent any caller-chosen alias.
 *
 * Every module here names its default export after its file — `Root.ts`
 * exports `class Root` — except the two dotted `*.utils.ts` files, whose
 * export is the PascalCase of the whole filename (`vector.utils.ts` exports
 * `VectorUtils`). PascalCasing every segment handles the plain case (a
 * single already-capitalised segment round-trips unchanged) and the dotted
 * one without needing a separate exception list.
 */
function basenameOf(modulePath: string): string {
  const last = modulePath.split('/').pop() ?? modulePath;
  const stripped = last.replace(/\.tsx?$/, '');
  return stripped
    .split(/[._-]/)
    .filter(Boolean)
    .map(part => part[0].toUpperCase() + part.slice(1))
    .join('');
}

function parseNamedClause(raw: string): ImportedSymbol[] {
  return raw
    .split(',')
    .map(part => part.trim())
    .filter(Boolean)
    .map(part => {
      const isType = /^type\s+/.test(part);
      const withoutType = part.replace(/^type\s+/, '').trim();
      // `Foo as Bar` — the exported name is Foo, not the local alias Bar.
      const asMatch = withoutType.match(/^(\w+)\s+as\s+\w+$/);
      const name = asMatch ? asMatch[1] : withoutType;
      return { name, isType };
    });
}

/** Every `@/`-prefixed import in one file, with the symbols each one names. */
function parseImports(source: string): ParsedImport[] {
  const imports: ParsedImport[] = [];
  let match: RegExpExecArray | null;
  IMPORT_RE.lastIndex = 0;
  while ((match = IMPORT_RE.exec(source))) {
    const wholeClauseIsType = !!match[1];
    const clause = match[2].trim();
    const modulePath = match[3];
    if (!modulePath.startsWith('@/')) continue; // relative imports are content-to-content, out of scope
    if (EXCLUDED_MODULES.has(modulePath)) continue;

    const symbols: ImportedSymbol[] = [];
    const markType = (s: ImportedSymbol) => ({ ...s, isType: s.isType || wholeClauseIsType });
    // A default binding's real name is the module's own, not whatever a
    // given call site happens to alias it to — see the module doc comment.
    const defaultName = basenameOf(modulePath);

    const namespaceOnly = clause.match(/^\*\s+as\s+\w+$/);
    const defaultAndNamespace = clause.match(/^(\w+)\s*,\s*\*\s+as\s+\w+$/);
    const defaultAndNamed = clause.match(/^(\w+)\s*,\s*\{([\s\S]*)\}$/);
    const namedOnly = clause.match(/^\{([\s\S]*)\}$/);
    const defaultOnly = clause.match(/^(\w+)$/);

    if (namespaceOnly) {
      // A namespace import brings every named export of the module in; the
      // scan has nothing to check per-symbol, so it is skipped rather than
      // treated as an offense. `ContentApi.ts` uses this form for exactly
      // the modules where it wants the whole surface (`combat.Reach`, etc.).
    } else if (defaultAndNamespace) {
      symbols.push(markType({ name: defaultName, isType: false }));
    } else if (defaultAndNamed) {
      symbols.push(markType({ name: defaultName, isType: false }));
      symbols.push(...parseNamedClause(defaultAndNamed[2]).map(markType));
    } else if (namedOnly) {
      symbols.push(...parseNamedClause(namedOnly[1]).map(markType));
    } else if (defaultOnly) {
      symbols.push(markType({ name: defaultName, isType: false }));
    }
    // Any clause shape not recognised above (there are none among real
    // imports as of this writing) simply contributes no symbols, rather than
    // throwing — a parser this scan owns should degrade, not crash the suite.

    imports.push({ module: modulePath, symbols });
  }
  return imports;
}

/** Every distinct (module, value-level symbol) pair real spells import. */
function collectRequiredSymbols(): { module: string; name: string; files: Set<string> }[] {
  const byKey = new Map<string, { module: string; name: string; files: Set<string> }>();

  for (const { dir, file } of allSpellFiles()) {
    const source = stripComments(readFileSync(join(dir, file), 'utf8'));
    for (const { module, symbols } of parseImports(source)) {
      for (const symbol of symbols) {
        if (symbol.isType) continue; // erased at runtime — see the module doc comment
        const key = `${module}::${symbol.name}`;
        if (!byKey.has(key)) byKey.set(key, { module, name: symbol.name, files: new Set() });
        byKey.get(key)!.files.add(file);
      }
    }
  }

  return [...byKey.values()];
}

/**
 * Every key reachable off `root`, walked a few levels deep — enough to reach
 * `combat.Reach.effectiveRange` (three) — without descending into class
 * internals: only plain objects (the frozen namespace objects `ContentApi`
 * assembles) are recursed into, never a function's own properties or
 * prototype, so a constructor like `AttackableUnit` contributes its own name
 * and nothing beneath it.
 */
function collectReachableNames(root: unknown, maxDepth: number): Set<string> {
  const names = new Set<string>();
  const seen = new WeakSet<object>();

  const visit = (value: unknown, depth: number) => {
    if (depth < 0) return;
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return;
    if (seen.has(value)) return;
    seen.add(value);
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      names.add(key);
      visit(child, depth - 1);
    }
  };

  visit(root, maxDepth);
  return names;
}

describe('every core symbol a spell imports is reachable through buildContentApi()', () => {
  it('exposes every value-level @/ symbol the spell tree actually imports', () => {
    const required = collectRequiredSymbols();
    const reachable = collectReachableNames(buildContentApi(), 4);

    const offenders = required
      .filter(({ name }) => !reachable.has(name))
      .map(({ module, name, files }) => {
        const sample = [...files].slice(0, 3).join(', ');
        const more = files.size > 3 ? ` (+${files.size - 3} more)` : '';
        return `${module} -> ${name}  [${sample}${more}]`;
      })
      .sort();

    expect(offenders).toEqual([]);
  });

  it('the scan is looking at a real population, not an empty one', () => {
    // A parser that silently matched nothing would pass forever while the
    // rule it enforces rots. The bar dropped hard in batch 4 task 3, and on
    // purpose: `SPELLS_DIR` moved to `packs/riot/spells/`, and every one of
    // those 238 files converted to the `make<Name>(api: ContentApi)` factory
    // pattern — `packBoundary.test.ts` now forbids them from naming a `@/`
    // core module at all, so this scan's own population there is
    // structurally zero, not silently broken. What is left to require a
    // value-level symbol here is `coreSpells/BasicAttack.ts` alone (still a
    // plain `@/`-importing class, on purpose — see `coreSpells/index.ts`'s
    // own header), so "not empty" is the honest bar now, not "over 50".
    const required = collectRequiredSymbols();
    expect(required.length).toBeGreaterThan(0);
  });
});

const CONTENT_API_FILE = join(__dirname, '../../src/content/ContentApi.ts');

// Deliberately separate from `allSpellFiles()` above: that population
// narrowed to `coreSpells/` alone (this file's real job now — see the header
// comment), but the champion roster genuinely needs every real spell's
// filename, which is `packs/riot/spells/` since batch 4 task 3 moved them.
//
// content-pack-extraction batch 5 task 7: `tsFilesIn(PACK_SPELLS_DIR)` used
// to call `readdirSync` unconditionally, so the moment `packs/riot/` leaves
// this tree (task 8) it throws `ENOENT` and takes the whole file down with
// it. `PACKS_DIR`/`RIOT_INSTALLED` are derived from `packs/`'s own listing —
// no riot pack installed means no champion-named `/vfx/` imports are
// possible to smuggle in from it either, so the scan below legitimately has
// nothing to check and runs over `coreSpells/` alone.
const PACKS_DIR = join(__dirname, '../../packs');
const RIOT_INSTALLED = packIsInstalled('riot');
const PACK_SPELLS_DIR = join(PACKS_DIR, 'riot/spells');

/**
 * Every id `<Champion>_[QWER][0-9]*.ts` names, across `packs/riot/spells/`
 * and `coreSpells/`, filtered to the files that actually carry a champion
 * prefix. `Flash.ts`, `Heal.ts`, `Recall.ts`, `BasicAttack.ts` and friends
 * have no `_[QWER]` suffix at all, so they never enter this set — a summoner
 * spell or the basic attack is not "a champion" for this rule's purpose.
 */
function championRoster(): string[] {
  const names = new Set<string>();
  const packSpellFiles = RIOT_INSTALLED
    ? tsFilesIn(requireRoot(PACK_SPELLS_DIR, 'coreSpellsApiSurface: packs/riot/spells'))
    : [];
  const files = [
    ...packSpellFiles,
    ...tsFilesIn(CORE_SPELLS_DIR).filter(file => file !== 'index.ts'),
  ];
  for (const file of files) {
    const match = /^([A-Za-z0-9]+)_[QWER][0-9]*\.ts$/.exec(file);
    if (match) names.add(match[1]);
  }
  return [...names];
}

/**
 * The inversion of the scan above, and the point of it: `ContentApi.vfx`
 * demanded exactly three champion-named exports (`LuxBeamEffect`,
 * `drawAxeArc`, `drawDariusAxe`) because `Darius_Q/W/E.ts` and `Lux_R.ts`
 * reached `@/game/vfx/LuxBeamEffect`/`@/game/vfx/DariusAxe` directly — a seam
 * that exists to keep core's surface pack-neutral, requiring the opposite. A
 * hard-coded list of those three names would pass again the moment a fourth
 * champion did the same thing; this states the rule instead: no import this
 * file makes under `@/game/vfx/` may come from a module named after a real
 * champion.
 *
 * "Named after a champion" is judged the way `LuxBeamEffect.ts`/`DariusAxe.ts`
 * actually are named: the module's own basename *starts with* a roster
 * champion id, not a bare substring match — a prefix is what Riot's naming
 * looks like on disk (`Lux` -> `LuxBeamEffect.ts`), and a substring match
 * would false-positive on a short id like `Vi` turning up inside an unrelated
 * word (`VfxGroup`, `unitCastBarAnchor`).
 *
 * Scoped to `/vfx/` imports specifically — every such import in this file
 * today feeds `ContentApi.vfx` (see the `VFX` object literal above) — rather
 * than re-parsing that object literal's members, which is both simpler and
 * strictly more protective: it also refuses a champion-named `/vfx/` module
 * smuggled into a *different* namespace.
 */
describe('ContentApi.vfx carries no champion-named symbol', () => {
  it('flags every vfx import whose own module is named after a roster champion', () => {
    const champions = championRoster();
    // Sanity, same shape as the population check above: an empty roster
    // would make every assertion below vacuously pass forever. Only checked
    // when riot is installed — a `packs/riot/spells`-less roster is meant to
    // be small (`coreSpells/` alone contributes no `_[QWER]`-suffixed file),
    // so the honest floor here is "did the pack we expect to be there
    // actually contribute something", not a literal that stops meaning
    // anything once the pack is legitimately gone.
    if (RIOT_INSTALLED) {
      expect(champions.length, 'packs/riot/spells contributed 0 champion names').toBeGreaterThan(0);
    }

    const source = stripComments(readFileSync(CONTENT_API_FILE, 'utf8'));
    const offenders: string[] = [];

    for (const { module, symbols } of parseImports(source)) {
      if (!module.includes('/vfx/')) continue; // scope: ContentApi.vfx's own feed
      const basename = basenameOf(module).toLowerCase();
      const champion = champions.find(name => basename.startsWith(name.toLowerCase()));
      if (!champion) continue;

      for (const symbol of symbols) {
        if (symbol.isType) continue; // erased at runtime — nothing for `vfx` to carry
        offenders.push(
          `${module} -> ${symbol.name}  (module name starts with champion "${champion}")`
        );
      }
    }

    expect(offenders.sort()).toEqual([]);
  });
});
