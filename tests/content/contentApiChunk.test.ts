import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = join(__dirname, '../../');

const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

/** Resolve a `@/`-aliased or relative specifier to a file under src/. */
const resolveSpecifier = (from: string, specifier: string): string | null => {
  const base = specifier.startsWith('@/')
    ? join(ROOT, 'src', specifier.slice(2))
    : specifier.startsWith('.')
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.endsWith('.ts')) return candidate;
  }
  return null;
};

/** Every module reachable from `entry` by a *value* import. */
const valueClosure = (entry: string): Set<string> => {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = stripComments(readFileSync(file, 'utf8'));
    const pattern = /^\s*(?:import|export)\s+(type\s+)?[\s\S]*?\bfrom\s+'([^']+)'/gm;
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(source)) !== null) {
      if (match[1]) continue; // `import type` is erased; it cannot pull code in.
      const target = resolveSpecifier(file, match[2]);
      if (target) queue.push(target);
    }
  }
  return seen;
};

describe('the data half of the pack contract', () => {
  const closure = valueClosure(join(ROOT, 'src/content/catalog.ts'));

  it('walked a real graph', () => {
    expect(closure.size).toBeGreaterThan(3);
  });

  it('does not reach ContentApi, and so does not reach the engine', () => {
    const offenders = [...closure].filter(
      file => file.endsWith('src/content/ContentApi.ts') || file.includes('/src/game/gameObject/')
    );
    expect(offenders.map(f => f.slice(ROOT.length))).toEqual([]);
  });
});
