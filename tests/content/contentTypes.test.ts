import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const read = (path: string) => readFileSync(join(__dirname, '../../', path), 'utf8');

describe('src/content/types.ts', () => {
  it('re-exports every type src/game/spell/runtime/types.ts declares', () => {
    const runtime = read('src/game/spell/runtime/types.ts');
    const declared = [...runtime.matchAll(/^export (?:interface|type) (\w+)/gm)].map(m => m[1]);

    expect(declared.length).toBeGreaterThan(10);

    const barrel = read('src/content/types.ts');
    const missing = declared.filter(name => !new RegExp(`\\b${name}\\b`).test(barrel));
    expect(missing, 'a pack cannot import these — add them to the barrel').toEqual([]);
  });
});
