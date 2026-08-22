import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '@/seams/importScan';

/**
 * `checkSeams(root, options)` hands **one** options object to every seam
 * (`src/seams/index.ts`), so two seams naming their own set the same thing
 * silently share it. That is not a hypothetical:
 *
 * - Fix round 3 of content-pack-extraction batch 5 task 6 found
 *   `castspec-frozen` and `spell-object-display-box` both calling their set
 *   `grandfathered` — one keyed by file basename, the other by class name.
 *   Harmless while an exemption only ever *suppressed* something (the two
 *   vocabularies never collided), and fatal the moment staleness checking
 *   existed: each seam saw the other's entries in its own set and reported
 *   every one of them stale. It was renamed to `grandfatheredClasses`.
 * - Fix round 4 found a **third** field still called `grandfathered`, in
 *   `spell-runtime-drive`. `packs/riot/spells/seam-debt.mjs`'s ten
 *   grandfathered cast specs were being handed to that seam as test-file
 *   exemptions all along; inert only because it ignores anything that is
 *   not a `*.test.ts`, which is luck, not design.
 *
 * Both were renamed away. Neither was *prevented* — nothing stopped the next
 * pair of seams picking the same word, and the symptom is a wave of bogus
 * `stale-exemption` reports pointing at entries that are perfectly correct.
 * This is the source scan that closes the class, in the shape CLAUDE.md
 * argues for every other "nobody may do X" rule here: milliseconds, and it
 * cannot be forgotten.
 *
 * A scan rather than a type-level check on purpose. TypeScript is happy to
 * let two independent interfaces share a field name — that is the whole
 * problem — and an intersection type that would make it an error would have
 * to be written by hand and kept up to date, which is the same discipline
 * this replaces.
 */

const SEAMS_DIR = join(__dirname, '../../src/seams');

/** `export interface FooOptions extends SeamCheckOptions { … }`, brace-matched. */
function optionInterfaces(source: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const opener = /export interface (\w+) extends SeamCheckOptions\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let index = opener.lastIndex;
    let depth = 1;
    const start = index;
    while (index < source.length && depth > 0) {
      if (source[index] === '{') depth += 1;
      else if (source[index] === '}') depth -= 1;
      index += 1;
    }
    const body = source.slice(start, index - 1);
    const fields = [...body.matchAll(/^\s*(\w+)\??\s*:/gm)].map(field => field[1]);
    out.set(match[1], fields);
  }
  return out;
}

describe('every seam names its own options fields', () => {
  const byInterface = new Map<string, { file: string; fields: string[] }>();

  for (const file of readdirSync(SEAMS_DIR)) {
    if (!file.endsWith('.ts')) continue;
    const source = stripComments(readFileSync(join(SEAMS_DIR, file), 'utf8'));
    for (const [name, fields] of optionInterfaces(source)) {
      byInterface.set(name, { file, fields });
    }
  }

  it('finds the option interfaces to compare, or this proves nothing', () => {
    // Guards the guard: a rename of `SeamCheckOptions`, or these interfaces
    // moving, would otherwise leave the assertion below vacuously green.
    //
    // Derived, not `>= 5`. That literal was created inside batch 5 task 6
    // fix round 4 — the same batch that spent task 7 deleting this class —
    // over a population the batch itself was still adding to. The honest
    // statement is that `optionInterfaces()`'s parse agrees with a plain
    // substring count of the files that declare one: two different readings
    // of the same text, so a regex that stops matching moves one and not the
    // other.
    const declaring = readdirSync(SEAMS_DIR).filter(
      file =>
        file.endsWith('.ts') &&
        /\binterface\s+\w+\s+extends\s+SeamCheckOptions\b/.test(
          stripComments(readFileSync(join(SEAMS_DIR, file), 'utf8'))
        )
    );

    expect(declaring.length).toBeGreaterThan(0);
    expect(new Set([...byInterface.values()].map(entry => entry.file)).size).toBe(declaring.length);
    for (const { fields } of byInterface.values()) expect(fields.length).toBeGreaterThan(0);
  });

  it('no two seams claim the same field name on the shared options object', () => {
    const owners = new Map<string, string[]>();
    for (const [name, { fields }] of byInterface) {
      for (const field of fields) {
        owners.set(field, [...(owners.get(field) ?? []), name]);
      }
    }

    const collisions = [...owners.entries()]
      .filter(([, claimants]) => claimants.length > 1)
      .map(([field, claimants]) => `${field}: ${claimants.join(', ')}`);

    expect(collisions).toEqual([]);
  });

  it('no seam redeclares a field the shared SeamCheckOptions already owns', () => {
    // `skip` is honoured identically by every seam through `walkTsFiles`; a
    // seam narrowing or widening it under the same name would be the same
    // collision from the other direction.
    const shared = stripComments(readFileSync(join(SEAMS_DIR, 'types.ts'), 'utf8'));
    const base = /export interface SeamCheckOptions\s*\{([\s\S]*?)\n\}/.exec(shared);
    expect(base).not.toBeNull();
    const baseFields = [...base![1].matchAll(/^\s*(\w+)\??\s*:/gm)].map(field => field[1]);
    expect(baseFields).toContain('skip');

    for (const [name, { fields }] of byInterface) {
      for (const field of fields) {
        expect({ interface: name, field }).not.toEqual(
          expect.objectContaining({ field: expect.stringMatching(`^(${baseFields.join('|')})$`) })
        );
      }
    }
  });
});
