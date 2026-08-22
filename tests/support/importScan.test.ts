import { describe, expect, it } from 'vitest';
import { scanImports, stripComments } from './importScan';

/**
 * `scanImports`'s own proof, independent of any one caller's policy —
 * `tests/support/importScan.ts`'s own header explains why this exists as
 * its own file rather than living inside whichever scan happened to need it
 * first. Every case below is a form at least one of this module's six
 * current callers (`corePacksBoundary`, `packBoundary`, `contentApiChunk`,
 * `menuBootPath`, `pregameBootPath`, `aboutBootPath`) actually needs; the
 * first four are the two rounds of fix-round reproductions that found the
 * bugs this module exists to close for good, kept here rather than in the
 * one scan that happened to surface them first.
 */
describe('scanImports', () => {
  // --- The four reproductions that found the bugs this module exists to close ---

  it('round 1, repro A: a from-less "export type" does not lend its type flag to a later value import', () => {
    const sample = [
      'export type { Something };',
      "import { spellCatalog } from '../../../packs/riot/generated/spellCatalog';",
    ].join('\n');

    expect(scanImports(sample)).toEqual([
      { specifier: '../../../packs/riot/generated/spellCatalog', kind: 'value' },
    ]);
  });

  it('round 1, repro B: a from-less side-effect import does not erase a later "import type"\'s flag', () => {
    const sample = [
      "import './side-effect';",
      "import type { SpellCatalogId } from '../../../packs/riot/generated/spellCatalog';",
    ].join('\n');

    expect(scanImports(sample)).toEqual([
      { specifier: '../../../packs/riot/generated/spellCatalog', kind: 'type' },
      { specifier: './side-effect', kind: 'side-effect' },
    ]);
  });

  it('round 2, repro 1: a value import is not dropped when the statement ahead of it has no trailing semicolon', () => {
    const sample = [
      "import type { Something } from './types'",
      "import { spellCatalog } from '../../../packs/riot/generated/spellCatalog';",
    ].join('\n');

    expect(scanImports(sample)).toEqual([
      { specifier: './types', kind: 'type' },
      { specifier: '../../../packs/riot/generated/spellCatalog', kind: 'value' },
    ]);
  });

  it('round 2, repro 2: the second of two import statements sharing one line is not dropped', () => {
    const sample =
      "import type { A } from './a'; import { spellCatalog } from '../../../packs/riot/generated/spellCatalog';";

    expect(scanImports(sample)).toEqual([
      { specifier: './a', kind: 'type' },
      { specifier: '../../../packs/riot/generated/spellCatalog', kind: 'value' },
    ]);
  });

  // --- Forms round 3 requires this module to handle explicitly ---

  it('matches a plain value import', () => {
    expect(scanImports("import { X } from './x';")).toEqual([{ specifier: './x', kind: 'value' }]);
  });

  it('matches "export ... from" the same way as "import ... from"', () => {
    expect(scanImports("export { X } from './x';")).toEqual([{ specifier: './x', kind: 'value' }]);
  });

  it('matches "export type ... from" as fully type-only', () => {
    expect(scanImports("export type { X } from './x';")).toEqual([
      { specifier: './x', kind: 'type' },
    ]);
  });

  it('matches whole-statement "import type"', () => {
    expect(scanImports("import type { X } from './x';")).toEqual([
      { specifier: './x', kind: 'type' },
    ]);
  });

  it('matches whole-statement "import type" on a default/namespace binding', () => {
    expect(scanImports("import type Game from '@/game/Game';")).toEqual([
      { specifier: '@/game/Game', kind: 'type' },
    ]);
  });

  it('classifies an inline mixed clause ("{ a, type B }") as a value — one real binding is enough', () => {
    // The exact shape this repo's own boot-path files use today —
    // `import { createApp, type App } from 'vue';` in `MenuScene.ts`,
    // `AboutScene.ts`, `LoadingScene.ts`, `SetupScene.ts` and others.
    expect(scanImports("import { createApp, type App } from 'vue';")).toEqual([
      { specifier: 'vue', kind: 'value' },
    ]);
  });

  it('classifies an inline clause where every member is "type"-prefixed as fully type-only', () => {
    expect(scanImports("import { type A, type B } from './x';")).toEqual([
      { specifier: './x', kind: 'type' },
    ]);
  });

  it('classifies a single-member inline "{ type A }" clause as fully type-only, same as whole-statement "import type"', () => {
    expect(scanImports("import { type A } from './x';")).toEqual([
      { specifier: './x', kind: 'type' },
    ]);
  });

  it('matches a side-effect import, which has no "from" clause at all', () => {
    expect(scanImports("import '../../packs/riot/spells/Yasuo_Q';")).toEqual([
      { specifier: '../../packs/riot/spells/Yasuo_Q', kind: 'side-effect' },
    ]);
  });

  it('matches a dynamic import(), which has no "from" clause and no type-only form', () => {
    expect(scanImports("const later = () => import('./GameScene');")).toEqual([
      { specifier: './GameScene', kind: 'dynamic' },
    ]);
  });

  it('does not confuse a dynamic import() with a static declaration — no whitespace follows "import"', () => {
    // `\s+` immediately after the keyword is what STATIC_PATTERN and
    // SIDE_EFFECT_PATTERN both require; `import(` has none, so a dynamic
    // call can never masquerade as either.
    const sample =
      "const later = () => import('./x');\nimport { Y } from '../../../packs/riot/generated/spellCatalog';";
    expect(scanImports(sample)).toEqual([
      { specifier: '../../../packs/riot/generated/spellCatalog', kind: 'value' },
      { specifier: './x', kind: 'dynamic' },
    ]);
  });

  it('handles a multi-line named-imports clause', () => {
    const sample = "import {\n  Faction,\n  MinionSlot,\n} from '@/content/ContentPack';";
    expect(scanImports(sample)).toEqual([{ specifier: '@/content/ContentPack', kind: 'value' }]);
  });

  it('strips comments before scanning, so an illustrative import inside one is invisible', () => {
    const sample = [
      "// import { X } from '../../../packs/riot/generated/spellCatalog';",
      '/**',
      " * `import { X } from '../../../packs/riot/generated/spellCatalog'`",
      ' */',
      "import { Y } from './real';",
    ].join('\n');
    expect(scanImports(sample)).toEqual([{ specifier: './real', kind: 'value' }]);
  });

  it('finds nothing in an empty or import-free file', () => {
    expect(scanImports('const x = 1;\nexport default x;')).toEqual([]);
  });

  it('does not let a specifier containing the word "import" cut its own statement short', () => {
    // The bug a first, two-pass draft of this fix reintroduced: pre-splitting
    // into whole "statements" bounded by the same keyword lookahead let a
    // specifier's own text trip that lookahead while still inside its own
    // quotes. The combined pattern here never applies the restriction to the
    // specifier at all.
    const sample =
      "import { X } from 'my-import-package';\nimport { Y } from '../../../packs/riot/generated/spellCatalog';";
    expect(scanImports(sample)).toEqual([
      { specifier: 'my-import-package', kind: 'value' },
      { specifier: '../../../packs/riot/generated/spellCatalog', kind: 'value' },
    ]);
  });
});

describe('stripComments', () => {
  it('removes block and line comments, leaving real code untouched', () => {
    const source = [
      "/** a doc comment mentioning `from './x'` */",
      'const a = 1; // a line comment',
      'const b = 2;',
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped).not.toContain('doc comment');
    expect(stripped).toContain('const a = 1;');
    expect(stripped).toContain('const b = 2;');
  });
});
