import { execFileSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackEntry {
  path: string;
}

function packedPaths(): string[] {
  const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  const [{ files }] = JSON.parse(stdout) as [{ files: PackEntry[] }];
  return files.map(entry => entry.path);
}

/**
 * HIGH 2 from fix round 1 review: `package.json` had no `files` field, so
 * `npm pack` swept the whole working tree into `@moba2d/core`'s tarball —
 * confirmed at review time as 641 files under `packs/`, all of Riot's own
 * content. A core whose published tarball carries the content it exists to
 * be free of is not a content-free engine, whatever its source tree looks
 * like — this is the reason the whole content-pack-extraction programme
 * exists.
 *
 * `npm pack --dry-run --json` is real: it runs the actual `files` field
 * resolution (plus npm's own always-excluded set — `.git`, `node_modules`,
 * etc.) rather than reimplementing that logic, so this test can't silently
 * drift from what a real `npm publish` would actually ship. `--dry-run`
 * writes nothing to disk — confirmed by hand, no `.tgz` appears.
 */
describe("@moba2d/core's published tarball", () => {
  it('ships no file under packs/', () => {
    const underPacks = packedPaths().filter(path => path.startsWith('packs/'));

    expect(underPacks).toEqual([]);
  });

  it('still ships the engine itself', () => {
    const paths = packedPaths();

    expect(paths).toContain('package.json');
    expect(paths.some(path => path.startsWith('src/'))).toBe(true);
    expect(paths).toContain('scripts/generate-spell-catalog.mjs');
    expect(paths).toContain('scripts/check-seams.mjs');
  });
});
