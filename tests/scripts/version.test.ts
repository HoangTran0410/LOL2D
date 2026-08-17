import { describe, expect, it } from 'vitest';
// @ts-expect-error — a build script, deliberately plain .mjs with no types.
import { formatVersion } from '../../scripts/version.mjs';

/**
 * The build stamp is the moment its commit was made, so a player reporting a
 * bug can say which build they are on and both sides can find it in the log.
 *
 * Only the formatter is tested. Reading `git log` is one `execFileSync` whose
 * failure path is "fall back to package.json", and a test that shells out to
 * git tests git.
 *
 * The offset in the timestamp is the committer's own, and this reads the
 * digits rather than the instant: `new Date(iso)` would re-express it in
 * whatever zone the build machine happens to be in, so the same commit would
 * stamp differently from a laptop and from CI.
 */
describe('the version is the commit clock, with no leading zeros', () => {
  it('formats the shape the menu shows', () => {
    expect(formatVersion('2026-08-17T15:00:42+07:00')).toBe('2026.8.17.15.0');
  });

  it('keeps the committed offset instead of converting to the build machine', () => {
    // Same instant, written in two zones. A Date-based formatter would collapse
    // these to one answer; the digits are what identify the build.
    expect(formatVersion('2026-08-17T15:00:42+07:00')).toBe('2026.8.17.15.0');
    expect(formatVersion('2026-08-17T08:00:42+00:00')).toBe('2026.8.17.8.0');
  });

  it('strips every leading zero, including a midnight hour', () => {
    expect(formatVersion('2026-01-05T00:09:00+07:00')).toBe('2026.1.5.0.9');
  });

  it('keeps two-digit parts whole', () => {
    expect(formatVersion('2026-12-31T23:59:00+07:00')).toBe('2026.12.31.23.59');
  });

  it('returns null on anything it cannot read, so the caller can fall back', () => {
    expect(formatVersion('')).toBeNull();
    expect(formatVersion('not a date')).toBeNull();
    expect(formatVersion(undefined)).toBeNull();
  });
});
