import { describe, expect, it } from 'vitest';
import { scanImports, stripComments } from '@/seams/importScan';

/**
 * `scanImports`'s own proof, independent of any one caller's policy —
 * `src/seams/importScan.ts`'s own header explains why this exists as
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

  // Fix round 1 of content-pack-extraction batch 5 task 4: the previous
  // implementation was two independent global regexes
  // (`source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')`),
  // and every case below is a shape that breaks *some* ordering of that pair
  // — either the real one (block comments stripped first) or its mirror
  // (line comments stripped first), which "just swap the order" is not a
  // fix for. The single-pass, state-tracking replacement handles all of
  // them because none of `//`, `/*`, `*/` are special to it while the
  // cursor is inside a string or template literal, or already inside a
  // comment of the other kind.

  it('a line comment containing "/*" does not open a phantom block comment that swallows the code after it', () => {
    // The exact shape found in packs/riot/maps/summonersRiftGeometry.ts:
    // `**/*.json` inside a `//` comment contains the two characters `/` `*`
    // adjacent, which a block-comments-first pass misreads as an opener —
    // and, since nothing between here and the trailing docblock below
    // contains a real `*/` of its own, the phantom span runs clean through
    // the import in between, exactly as it did in the real file. (An
    // earlier draft of this test put a docblock *before* the import instead
    // of after it, which gave the phantom opener a `*/` to close against
    // early and let the import survive by accident — worth keeping in mind
    // when writing a case like this: the import must sit before the first
    // real `*/`, not after it, or the case does not reproduce anything.)
    const source = [
      "// assetsInclude: ['**/*.json']",
      "import { X } from './real';",
      '',
      '/**',
      ' * a real docblock further down the file',
      ' */',
    ].join('\n');
    expect(stripComments(source)).toContain("import { X } from './real';");
    expect(scanImports(source)).toEqual([{ specifier: './real', kind: 'value' }]);
  });

  it('the real hidden-import case: the same shape, with the real specifier from summonersRiftGeometry.ts', () => {
    const source = [
      "// `assetsInclude: ['**/*.json']` so `AssetManager` can hand out every JSON",
      '// file as a fetchable URL at runtime, and that claims the extension ahead of',
      "import type { MapGeometry } from '@moba2d/core/content/ContentPack';",
      '',
      '/**',
      ' * standing in for the real docblock 19 lines later in the real file',
      ' */',
    ].join('\n');
    expect(scanImports(source)).toEqual([
      { specifier: '@moba2d/core/content/ContentPack', kind: 'type' },
    ]);
  });

  it('a single-quoted string containing "//" is not read as a line comment', () => {
    const source = "const url = 'http://example.com'; import { X } from './real';";
    const stripped = stripComments(source);
    expect(stripped).toContain("const url = 'http://example.com';");
    expect(stripped).toContain("import { X } from './real';");
  });

  it('a double-quoted string containing "/*" is not read as a block comment opener', () => {
    const source = 'const glob = "**/*.json"; import { X } from \'./real\';';
    const stripped = stripComments(source);
    expect(stripped).toContain('const glob = "**/*.json";');
    expect(stripped).toContain("import { X } from './real';");
  });

  it('a template literal containing "//" or "/*" is passed through untouched, not read as either comment form', () => {
    const source = [
      'const url = `http://example.com/${path}`;',
      'const glob = `**/*.json`;',
      "import { X } from './real';",
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped).toContain('const url = `http://example.com/${path}`;');
    expect(stripped).toContain('const glob = `**/*.json`;');
    expect(stripped).toContain("import { X } from './real';");
  });

  it('a block comment containing "//" on the same line as its own closer is not cut short by a naive line-comments-first pass', () => {
    // Not broken by the real (block-first) bug — a non-greedy block-comment
    // match already finds this comment's real closer correctly. Broken by
    // the *mirror* fix ("just strip line comments first"): a `//`-first
    // pass would remove from the `//` inside the URL to end of line,
    // deleting the block comment's own `*/` closer along with it, and leave
    // a dangling opener for the next pass to wrongly pair with whatever
    // real `*/` comes later.
    const source = ['/* see http://example.com */', "import { X } from './real';"].join('\n');
    expect(scanImports(source)).toEqual([{ specifier: './real', kind: 'value' }]);
  });

  it('an unpaired quote does not run past the end of its own line (fix round 2)', () => {
    // The real shape: `src/game/hud/config/MatchConfigPanel.vue`,
    // `MatchTab.vue` and `RosterTab.vue` all carry an apostrophe in ordinary
    // English prose inside an HTML template comment
    // (`<!-- The shell's own way out ... -->`) — a canary probe over every
    // file this module's six real callers scan found exactly these 3 doing
    // it. All three are safe today only because `<script setup>` (their
    // real imports) comes *before* `<template>` (the apostrophe); reproduced
    // here with the trap moved ahead of the code it would otherwise corrupt,
    // and with a real `//` comment in between naming a fake specifier — the
    // shape that turns "swallows a comment" into "invents an import nothing
    // wrote". A version of this scanner without the newline reset finds two
    // references here, `./fake` included; the fix finds exactly the one
    // real one.
    const source = [
      "<!-- The shell's own way out -->",
      "// see import from './fake' for reference",
      "import { Y } from './real';",
    ].join('\n');
    expect(scanImports(source)).toEqual([{ specifier: './real', kind: 'value' }]);
  });

  it('nested template-literal substitutions are tracked by depth, not by the first "}"', () => {
    // Fix round 2: the original version of this case —
    // `` `${`${x}`}` `` plus a real import on the next line — contains no
    // comment marker anywhere, and `stripComments` only ever *removes*
    // characters while in comment state, so its output equals its input for
    // *any* implementation, correct or not (the reviewer proved this by
    // running a deliberately depth-broken stripper — one boolean flag,
    // "am I in a substitution", flipped false by the *first* `}` seen,
    // rather than a real depth count — against the old input: both
    // assertions still passed). An input has to contain something that a
    // wrongly-early return to template-literal state would treat
    // differently than staying in code would, and nothing here did.
    //
    // This one does: a substitution holding a nested object literal's own
    // `{}` ahead of a real block comment. A depth-broken stripper treats
    // the object literal's closing `}` as the *substitution's* closing
    // brace — one bare `}`, first one wins — and drops back into
    // template-literal text a full brace early, where a comment is just
    // more literal text and `/* must be stripped */` is never recognised as
    // one at all. A depth-correct stripper is still one level of nesting
    // away from the substitution's own close at that point, stays in code,
    // and strips it normally. Proved failing under the depth-broken
    // reimplementation before landing this version — see fix round 2 of
    // content-pack-extraction batch 5 task 4's own report for the repro.
    const source = [
      'const t = `${ {} /* must be stripped */ }rest`;',
      "import { X } from './real';",
    ].join('\n');
    const stripped = stripComments(source);
    expect(stripped).not.toContain('must be stripped');
    expect(scanImports(source)).toEqual([{ specifier: './real', kind: 'value' }]);
  });
});
