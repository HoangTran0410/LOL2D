import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scanImports } from '../../src/seams/importScan';
import { describeOffence, riotVocabularyOffences } from '../support/riotVocabulary';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface PackEntry {
  path: string;
}

let cached: string[] | undefined;

/**
 * `npm pack --dry-run --json` is real: it runs the actual `files` field
 * resolution (plus npm's own always-included set — `package.json`, `README`
 * — and always-excluded set — `.git`, `node_modules`) rather than
 * reimplementing that logic, so this test cannot silently drift from what a
 * real `npm publish` would ship. `--dry-run` writes nothing to disk.
 */
function packedPaths(): string[] {
  if (!cached) {
    const stdout = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    const [{ files }] = JSON.parse(stdout) as [{ files: PackEntry[] }];
    cached = files.map(entry => entry.path);
  }
  return cached;
}

/**
 * What `@moba2d/core`'s published tarball is allowed to contain, asked as the
 * question that actually matters rather than as a path prefix.
 *
 * ## Why the prefix was not the question
 *
 * Fix round 1 of batch 5 task 5 found `package.json` had no `files` field at
 * all, so `npm pack` swept the working tree: 2068 files, 641 of them under
 * `packs/`. The `files` field it gained fixed that and this test asserted it
 * — `!path.startsWith('packs/')` — and stayed green while the same tarball
 * shipped `assets/source-manifest.json` (296 rows of Riot image provenance),
 * `scripts/wiki/*` (the Riot Wiki import toolchain), `scripts/new-spell.mjs`
 * and a dead `scripts/register-champions.mjs` hardcoding 19 champion names.
 * A path prefix answers "is it in the pack directory". The question is "is
 * it Riot's", and none of those four ever lived in the pack directory.
 *
 * So `files` is an **allow-list of what ships** now — the engine (`src/`),
 * the art its own generated manifest imports, core's own bundled
 * content (`packs/reference/`), the two `bin` scripts, the tsconfigs a pack
 * extends, and the app shell — and the two tests below assert the two
 * properties that make an allow-list right rather than merely short:
 *
 *  1. **Nothing Riot's.** The same derived needle list
 *     `vocabularyBoundary.test.ts` runs over `src/`, run over every text
 *     file in the tarball. One rule, one exemption ledger, two populations
 *     (`tests/support/riotVocabulary.ts`).
 *  2. **Nothing missing.** Every relative import a shipped source makes must
 *     resolve to another shipped file. `src/content/install.ts:47` shipped a
 *     static `'../../packs/reference/pack'` while `files` excluded `packs/`
 *     — a published package importing a path it does not contain, which no
 *     count of files can see.
 *
 * Property 2 is also what decides the reference pack's disposition. The two
 * packs are reached differently on purpose and stay that way: **riot** is
 * optional, may be absent, and after the split is installed from a registry,
 * so it is named by *package* (`@moba2d/content-riot`, through
 * `src/generated/installedPacks.ts`) — a relative path would resolve to
 * nothing there. **reference** is core's own content, never optional and
 * never installed, so a path inside core's own tree is the truthful
 * specifier and naming it by package would claim a dependency core does not
 * have. The incoherence was never the import; it was `files` omitting a
 * directory core statically imports.
 */
describe("@moba2d/core's published tarball", () => {
  const TEXT = /\.(ts|tsx|vue|mjs|cjs|js|json|css|html|svg|md|txt|yml|yaml)$/;
  // The engine's own module graph — what Vite resolves. Build scripts
  // (`.mjs`) are deliberately out: their relative *reads* are `resolve()`
  // calls, not imports, and the import statements in their text are the
  // source they **emit**, whose specifiers are relative to the generated
  // file rather than to the generator. `generate-spell-catalog.mjs`'s
  // `"import type { AssetKey } from './assetManifest';"` is exactly that,
  // and scanning it would report a file that is correctly absent.
  const CODE = /\.(ts|vue)$/;

  it('ships no file of the riot pack', () => {
    expect(packedPaths().filter(path => path.startsWith('packs/riot'))).toEqual([]);
  });

  it("carries none of Riot's vocabulary, in any file it ships", () => {
    const paths = packedPaths().filter(path => TEXT.test(path));

    // A tarball with no text in it would pass the scan below for the wrong
    // reason. `src/` alone is well over a hundred files.
    expect(paths.length).toBeGreaterThan(packedPaths().length / 2);

    const offenders: string[] = [];
    for (const path of paths) {
      const source = readFileSync(join(repoRoot, path), 'utf8');
      for (const offence of riotVocabularyOffences(path, source)) {
        offenders.push(describeOffence(offence));
      }
    }

    expect(offenders).toEqual([]);
  });

  it('ships every file its own shipped sources import by relative path', () => {
    const shipped = new Set(packedPaths());
    // A relative specifier may be written without its extension, or point at
    // a directory's `index.ts`, and may carry a Vite query (`?url`, `?raw`).
    const suffixes = ['', '.ts', '.tsx', '.vue', '.mjs', '.cjs', '.js', '.json', '.d.ts'];
    const missing: string[] = [];

    for (const path of packedPaths().filter(candidate => CODE.test(candidate))) {
      const source = readFileSync(join(repoRoot, path), 'utf8');
      for (const { specifier } of scanImports(source)) {
        if (!specifier.startsWith('.')) continue;
        const bare = specifier.split('?')[0];
        const target = posix.normalize(posix.join(posix.dirname(path), bare));
        const candidates = [
          ...suffixes.map(suffix => `${target}${suffix}`),
          ...suffixes.map(suffix => posix.join(target, `index${suffix}`)),
        ];
        if (candidates.some(candidate => shipped.has(candidate))) continue;
        // A path that is not in the tarball *and* not in the repository is
        // a different bug (a broken import); report it either way, but say
        // which, so the reader is not sent looking for the wrong thing.
        const inRepo = candidates.some(candidate => existsSync(join(repoRoot, candidate)));
        missing.push(
          `${path} -> ${specifier}${inRepo ? ' (in the repo, not in the tarball)' : ''}`
        );
      }
    }

    expect(missing).toEqual([]);
  });

  it('still ships the engine itself', () => {
    const paths = packedPaths();

    expect(paths).toContain('package.json');
    expect(paths.some(path => path.startsWith('src/'))).toBe(true);
    expect(paths).toContain('scripts/generate-spell-catalog.mjs');
    expect(paths).toContain('scripts/check-seams.mjs');
    expect(paths).toContain('packs/reference/pack.ts');
  });
});
