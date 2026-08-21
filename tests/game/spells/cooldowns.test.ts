import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('arcade cooldown boundary', () => {
  it('keeps every numeric spell cooldown at ten seconds or less', () => {
    const directory = 'packs/riot/spells';
    for (const name of readdirSync(directory).filter(name => name.endsWith('.ts'))) {
      const file = `${directory}/${name}`;
      const source = readFileSync(file, 'utf8');
      for (const match of source.matchAll(/coolDown\s*=\s*([\d_]+)/g)) {
        const milliseconds = Number(match[1].replaceAll('_', ''));
        expect(milliseconds, file).toBeLessThanOrEqual(10_000);
      }
    }
  });
});
