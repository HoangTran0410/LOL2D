/**
 * The build's version: the moment its commit was made, as `2026.8.17.15.0`.
 *
 * `package.json`'s `1.0.0` never moved, which made the stamp on the menu
 * useless for the one thing a version is shown for — an installed PWA serves
 * whatever it cached until told otherwise, so two players on the same URL can
 * be on different builds, and "v1.0.0" cannot tell them apart. A commit clock
 * can: a player reads it off the menu, and it is the same number the log is
 * ordered by.
 *
 * Not written back into `package.json`. Five dot-separated parts is not
 * semver, and npm refuses to install a package whose own version it cannot
 * parse. `vite.config.ts` calls this at config time instead, so there is no
 * generated file to drift and dev sees the same answer a build does.
 *
 *   node scripts/version.mjs     # print it
 */
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

/**
 * Reads the digits out of the timestamp rather than parsing it into a `Date`.
 *
 * `git log --format=%cI` carries the committer's own UTC offset, and a `Date`
 * would re-express the instant in whatever zone the build machine is in — the
 * same commit would then stamp one number on a laptop and another on CI,
 * which is exactly the confusion the version exists to remove.
 *
 * @param {string | undefined} iso an ISO 8601 timestamp with an offset
 * @returns {string | null} `YYYY.M.D.H.m`, or null if it could not be read
 */
export function formatVersion(iso) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso ?? '');
  if (!match) return null;
  const [, year, month, day, hour, minute] = match;
  // Number() rather than a regex strip: it turns '08' into 8 and '00' into 0
  // in one step, and the example the format was chosen from has no padding.
  return [year, Number(month), Number(day), Number(hour), Number(minute)].join('.');
}

const packageVersion = () =>
  createRequire(import.meta.url)('../package.json').version ?? '0.0.0';

/**
 * The stamp for this build. Falls back to `package.json` whenever git cannot
 * answer — a source tarball with no `.git`, or a checkout with no commits.
 * A build must not fail over the label in its corner.
 *
 * @returns {string}
 */
export function buildVersion() {
  try {
    const iso = execFileSync('git', ['log', '-1', '--format=%cI'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return formatVersion(iso) ?? packageVersion();
  } catch {
    return packageVersion();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(buildVersion());
}
