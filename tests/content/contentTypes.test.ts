import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '../../', path), 'utf8');

// Same stripper `tests/content/packBoundary.test.ts` uses, and for the same
// reason: matching `\bName\b` against the raw file would let a type named
// only in a comment (a doc-comment mentioning it, a commented-out re-export)
// count as "re-exported" when nothing actually is. Not vacuous today, but it
// is the exact shape of false pass every other source scan in this repo is
// careful to avoid.
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

describe('src/content/types.ts', () => {
  it('re-exports every type src/game/spell/runtime/types.ts declares', () => {
    const runtime = read('src/game/spell/runtime/types.ts');
    const declared = [...runtime.matchAll(/^export (?:interface|type) (\w+)/gm)].map(m => m[1]);

    expect(declared.length).toBeGreaterThan(10);

    const barrel = stripComments(read('src/content/types.ts'));
    const missing = declared.filter(name => !new RegExp(`\\b${name}\\b`).test(barrel));
    expect(missing, 'a pack cannot import these — add them to the barrel').toEqual([]);
  });
});
