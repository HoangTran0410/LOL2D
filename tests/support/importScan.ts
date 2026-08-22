/**
 * `tests/support/` — shared machinery for this repo's source-scan tests.
 *
 * No such home existed before this file: `stripComments` alone is defined
 * independently in 21 different test files, and every import-scanning test
 * (`corePacksBoundary.test.ts`, `packBoundary.test.ts`,
 * `contentApiChunk.test.ts`, `menuBootPath.test.ts`, `pregameBootPath.test.ts`,
 * `aboutBootPath.test.ts`) carried its own copy of a parser answering the
 * same question. `src/seams/` is the closest existing precedent for
 * "extract inline scan logic into an importable module" — but it is a
 * different kind of thing on purpose: those are content-authoring rules,
 * `(root: string) => SeamViolation[]`, published as `@moba2d/core/seams` so a
 * *pack*, in a future separate repository, can run them against its own
 * tree. This module answers a question about *this engine's own* source —
 * what does a file import, and is each one a type or a value — that no pack
 * ever needs to ask, so it has no business shipping in `src/` or behind that
 * public surface. It lives here, under `tests/`, imported by plain relative
 * path the way `tests/game/fixtures.ts` and friends already are for their
 * own subtree, one level up so both `tests/content/` and `tests/scenes/`
 * (this module's six current callers span both) can reach it without
 * reaching *into* a sibling directory that is not the shared one.
 *
 * ## Why one parser, not six
 *
 * `content-pack-extraction-batch-5` task 1's fix round 1 and round 2 each
 * found and fixed a hole in `corePacksBoundary.test.ts`'s own copy of this
 * parser — first a `type` keyword captured off one statement silently
 * attaching to a neighbouring statement's specifier, then (after bounding on
 * a terminating `;`) a specifier being **dropped outright** whenever ASI let
 * a statement end without one, or two statements shared a line. Round 3
 * found the same two shapes of parser copied into five *other* files —
 * `packBoundary.test.ts` (the rule the whole content-pack extraction rests
 * on) carried the exact original, doubly-vulnerable regex; the three
 * boot-path scans carried a related-but-different one vulnerable to the
 * "two statements on one line" drop specifically. Fixing five call sites
 * individually would have left a seventh copy free to be written next week,
 * with the same hole, the day after this file did not exist yet. One parser,
 * used everywhere a file's import graph needs reading, means a bug found
 * once is fixed everywhere at once — and the reverse: a form this parser
 * does not yet handle is missing from every caller at once too, which is
 * why its own test suite (`importScan.test.ts`) is deliberately larger than
 * any one caller's needs.
 *
 * ## What this module answers, and what it deliberately does not
 *
 * `scanImports(source)` answers exactly one question per reference a file
 * makes: **what specifier, and is it a type or a value (or a side-effect, or
 * a dynamic load)?** It does not know what a "core" or a "pack" or "the
 * game chunk" is — which specifiers are banned, which are allow-listed, what
 * population floor proves the scan is not silently checking nothing — all
 * of that stays in each individual scan, because it is genuinely different
 * in every one of them. A shared parser that also carried policy would stop
 * being shared the first time two callers disagreed about it.
 *
 * `import.meta.glob('/packs/...')` is deliberately **not** a form this
 * module recognises: it is a Vite API call, not import syntax, and today
 * only `corePacksBoundary.test.ts` cares about it (nothing "copied" that
 * particular check anywhere). That file layers its own small, local
 * `import.meta.glob(...)` regex on top of this module's output rather than
 * this module growing a fifth `ImportKind` for a shape none of its other
 * five callers need.
 */

/**
 * `'value'` — a real module load a bundler must keep; `'type'` — fully
 * erased before Rollup ever sees it (`import type ...`, or a named clause
 * whose every member is individually `type`-prefixed); `'side-effect'` —
 * `import 'x';`, no binding, still a real load; `'dynamic'` — `import('x')`,
 * a runtime `import()` call, always a value reach and never type-only (there
 * is no dynamic form of `import type`).
 */
export type ImportKind = 'value' | 'type' | 'side-effect' | 'dynamic';

export interface ImportReference {
  /** The module specifier exactly as written — never resolved, never normalized. */
  readonly specifier: string;
  readonly kind: ImportKind;
}

/**
 * Strips `/* … *‍/` and `// …` comments before any of this module's other
 * functions run. Every source-scan test in this repository needs this —
 * without it, a doc comment illustrating the very rule being enforced would
 * flag itself, which is why so many of this file's own paragraphs above are
 * written the way they are. `scanImports` below always applies this first;
 * exported separately only so a caller that wants stripped source for some
 * *other* reason (a second regex of its own, unrelated to imports) does not
 * have to strip twice or duplicate this one line a 22nd time.
 *
 * A single left-to-right pass that always knows which of six things the
 * cursor is inside — plain code, a line comment, a block comment, a
 * single-quoted string, a double-quoted string, or a template literal — not
 * two independent regexes run back to back. That used to be
 * `source.replace(/\/\*[\s\S]*?\*‍/g, '').replace(/\/\/[^\n]*‍/g, '')`, and
 * it was wrong in both directions at once: stripping block comments first
 * means a `//` line whose *text* happens to contain the two characters `/`
 * `*` next to each other — `// assetsInclude: ['**‍/*.json']`, a real line in
 * this repository's own `packs/riot/maps/summonersRiftGeometry.ts` — opens a
 * *phantom* block comment there, which then runs to the next real `*‍/`
 * anywhere later in the file, silently deleting every line, including a real
 * `import type {...} from '@moba2d/core/content/ContentPack'`, in between.
 * Swapping the order does not fix it, it mirrors it: a block comment
 * containing `//` (a URL in a JSDoc line, `* see https://example.com/x`)
 * would then end early at that `//`, leaving a dangling `/*` for the *next*
 * pass to pair with whatever real `*‍/` comes next. Neither ordering can be
 * right, because both treat "comment start" as a property of two adjacent
 * characters, when it is really a property of *where those characters sit*
 * — never inside a string or template literal, and a `//` or `/*` inside
 * one of those is just data. A regex has no notion of "inside a string";
 * this function tracks it explicitly instead.
 *
 * Escapes (`\'`, `\"`, `` \` ``) keep a string or template literal open past
 * a quote character that would otherwise close it. A template literal's
 * `${...}` substitution is code again — it can hold its own strings,
 * comments, and even a nested template literal — so `braceDepth` on the
 * stack tracks exactly which `}` closes the substitution and returns to the
 * literal's text, one frame per nesting level (`` `${`${x}`}` `` is legal
 * JavaScript and round-trips through this correctly). A comment's own
 * characters are dropped; everything else, including every character inside
 * a string or template literal, passes through unchanged — this module's
 * callers only ever look for `import`/`export` keywords and specifiers
 * outside of strings, so string *contents* are never this function's
 * business. **Stated limit, inherited from the version this replaces and
 * unchanged by it:** a `/` that starts a regex literal (not a string, not a
 * comment) is not modelled — `/[/*]/` would still be misread as opening a
 * comment. No file this module currently scans contains that shape
 * (checked, not assumed, the same way `STATIC_PATTERN`'s own stated limit
 * above documents a checked-not-assumed boundary); a caller that starts
 * scanning a tree where it might would need to widen this.
 */
export function stripComments(source: string): string {
  type State = 'code' | 'line' | 'block' | 'single' | 'double' | 'template';
  // One frame per open template-literal `${...}` substitution the cursor is
  // currently nested inside, so its matching `}` — not some inner object
  // literal's — is the one that returns to that literal's own text.
  const braceDepth: number[] = [];
  let state: State = 'code';
  let out = '';
  let i = 0;
  const n = source.length;

  while (i < n) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === 'line') {
      if (ch === '\n') {
        out += ch;
        state = 'code';
      }
      i++;
      continue;
    }

    if (state === 'block') {
      if (ch === '*' && next === '/') {
        i += 2;
        state = 'code';
        continue;
      }
      if (ch === '\n') out += ch; // preserves line numbers in the result
      i++;
      continue;
    }

    if (state === 'single' || state === 'double') {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      out += ch;
      if ((state === 'single' && ch === "'") || (state === 'double' && ch === '"')) state = 'code';
      i++;
      continue;
    }

    if (state === 'template') {
      if (ch === '\\' && next !== undefined) {
        out += ch + next;
        i += 2;
        continue;
      }
      if (ch === '$' && next === '{') {
        out += ch + next;
        braceDepth.push(1);
        state = 'code';
        i += 2;
        continue;
      }
      out += ch;
      if (ch === '`') state = 'code';
      i++;
      continue;
    }

    // state === 'code'
    if (ch === '/' && next === '/') {
      state = 'line';
      i += 2;
      continue;
    }
    if (ch === '/' && next === '*') {
      state = 'block';
      i += 2;
      continue;
    }
    if (ch === "'") {
      out += ch;
      state = 'single';
      i++;
      continue;
    }
    if (ch === '"') {
      out += ch;
      state = 'double';
      i++;
      continue;
    }
    if (ch === '`') {
      // A backtick always opens a new template literal's own text region —
      // whether the cursor is in top-level code or nested inside an outer
      // template's `${...}` substitution, `braceDepth` is untouched either
      // way, so the matching close still finds the right enclosing frame.
      out += ch;
      state = 'template';
      i++;
      continue;
    }
    if (braceDepth.length > 0) {
      // Only braces reachable from inside a template substitution are worth
      // counting — a `{`/`}` pair in ordinary top-level code never changes
      // what state this function is in, so it is left alone.
      if (ch === '{') braceDepth[braceDepth.length - 1]++;
      else if (ch === '}') {
        braceDepth[braceDepth.length - 1]--;
        if (braceDepth[braceDepth.length - 1] === 0) {
          braceDepth.pop();
          out += ch;
          state = 'template';
          i++;
          continue;
        }
      }
    }
    out += ch;
    i++;
  }

  return out;
}

/**
 * A static `import ... from '...'` / `export ... from '...'` clause,
 * wherever one starts — bounded only by the one delimiter JavaScript
 * actually guarantees: the `import`/`export` keyword itself, never a
 * semicolon (ASI makes it optional) and never a line start (two statements
 * can share a line).
 *
 * Group 1 is the whole-statement `type` flag (`import type` / `export
 * type`); group 2 is the raw clause text between the keyword and `from`,
 * kept so `isFullyTypeOnlyClause` below can judge an inline `{ type X, Y }`
 * clause the whole-statement flag alone cannot see; group 3 is the
 * specifier.
 *
 * The restricted span — `(?:(?!\b(?:import|export)\b)[\s\S])*?` — covers
 * only the clause between the keyword and its own `from`, and stops the
 * instant `from '` is found. The specifier itself, captured afterward by an
 * unrestricted `[^'"]+`, is deliberately **outside** that span: an early
 * draft of this fix pre-split source into whole "statements" bounded by the
 * same keyword lookahead and ran a second regex on each one's text, which
 * reintroduced the identical bug one level down — a specifier containing
 * the word "import" (hyphen-bounded, e.g. a hypothetical `'my-import-lib'`)
 * tripped the same lookahead while still inside its own quotes and cut the
 * statement short before its closing one, dropping it. This single combined
 * pattern cannot do that: the keyword-boundary restriction is over by the
 * time the specifier's own characters are ever read.
 *
 * **Stated limit:** a `from '...'`-shaped string literal sitting between a
 * keyword that takes no `from` clause of its own (`export default function
 * foo() { ... }`) and the next real `import`/`export` could in principle
 * produce a false match — this pattern only knows "do not cross a keyword,"
 * not "this text is inside a string." That is a false *positive* (an
 * innocent file wrongly flagged), never the dangerous direction a matcher
 * dropping or misclassifying a real reference is: a spurious match would
 * still have to name a specifier some caller's own policy bans to ever
 * surface as an offender. Checked, not just reasoned about: no file in this
 * repository's `src/` today contains a quoted `from '...'`/`from "..."`
 * pattern outside real import syntax that is not already inside a comment
 * (which `stripComments` removes before this pattern ever runs).
 */
const STATIC_PATTERN =
  /\b(?:import|export)\b\s+(type\s+)?((?:(?!\b(?:import|export)\b)[\s\S])*?)\bfrom\s+['"]([^'"]+)['"]/g;

/**
 * A bare side-effect import — `import '../../packs/riot/spells/Yasuo_Q';` —
 * has no `from` clause and nothing between the keyword and its specifier, so
 * unlike `STATIC_PATTERN` it needs no keyword-boundary restriction at all to
 * stay inside one statement: `\s+['"]` immediately after `import` cannot
 * match a named clause (`{ X }`), `type`, or a dynamic call's `(`, so it is
 * unambiguous wherever it occurs. No line-start anchor either, which is
 * what let the "two statements on one line" bug reach side-effect imports
 * under the pattern this replaced.
 */
const SIDE_EFFECT_PATTERN = /\bimport\s+['"]([^'"]+)['"]/g;

/**
 * `import('...')` — a runtime call, not a declaration, so it has no
 * type-only form and needs no keyword-boundary restriction either: `\(`
 * immediately after `import` cannot be confused with a declaration's `\s`.
 */
const DYNAMIC_PATTERN = /\bimport\(\s*['"]([^'"]+)['"]/g;

/**
 * Whether every member of a named-imports/exports clause (`{ a, type b }`)
 * is individually `type`-prefixed — the inline form of `import type`, which
 * a caller checking only the whole-statement flag cannot see. A clause that
 * is not a `{ ... }` form at all (a default binding, `* as X`, or a bare
 * side-effect/dynamic specifier) is never fully type-only *by this route*:
 * the only way a default or namespace import is erased is the whole-
 * statement `import type` this function's caller already checks first.
 */
function isFullyTypeOnlyClause(clause: string): boolean {
  const named = /\{([\s\S]*)\}/.exec(clause);
  if (!named) return false;
  const members = named[1]
    .split(',')
    .map(member => member.trim())
    .filter(Boolean);
  if (members.length === 0) return false;
  return members.every(member => /^type\s+/.test(member));
}

/**
 * Every import/export-from reference a source file makes — static, type,
 * side-effect and dynamic alike — classified. Strips comments internally;
 * callers never need to remember to.
 */
export function scanImports(rawSource: string): ImportReference[] {
  const source = stripComments(rawSource);
  const out: ImportReference[] = [];

  for (const match of source.matchAll(STATIC_PATTERN)) {
    const wholeStatementType = Boolean(match[1]);
    const clause = match[2];
    const specifier = match[3];
    const kind: ImportKind = wholeStatementType || isFullyTypeOnlyClause(clause) ? 'type' : 'value';
    out.push({ specifier, kind });
  }
  for (const match of source.matchAll(SIDE_EFFECT_PATTERN)) {
    out.push({ specifier: match[1], kind: 'side-effect' });
  }
  for (const match of source.matchAll(DYNAMIC_PATTERN)) {
    out.push({ specifier: match[1], kind: 'dynamic' });
  }
  return out;
}
