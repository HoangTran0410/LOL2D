/**
 * A step taken every frame has to be scaled by how long the frame took.
 *
 * `Stats.speed`, `MissileSpellObject.speed`, `Dash.dashSpeed` and the rest are
 * authored per frame, so without scaling the distance covered is a function of
 * the frame *count*. Two things fell out of that and both shipped: the `30 FPS`
 * render option halved the game's movement speed while cooldowns kept their own
 * pace, and — because no two real frames are the same length — every body's
 * velocity jittered, which became plainly visible as soon as the camera started
 * interpolating over time.
 *
 * `frameScale()` in `game/time.ts` is the conversion. This scan is what stops
 * the next per-frame mover from forgetting it: `moveVectorToVector` advances a
 * vector by a fixed magnitude and does not clamp to the target, so an unscaled
 * call is both a frame-rate dependency and, at a long frame, an overshoot that
 * the matching arrival test will miss.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(__dirname, '..', '..', 'src');

/**
 * Calls that move a vector by a *distance*, not by a per-frame speed. Each is
 * allowed by name and reason; adding one is a deliberate act.
 */
const GEOMETRIC: readonly { file: string; because: string }[] = [
  {
    file: 'game/gameObject/spells/Teemo_R.ts',
    because:
      'the bounce computes a new destination `throwRange * 2` away — a distance, ' +
      'not a step, and it runs once on contact rather than every frame',
  },
];

const filesUnder = (dir: string): string[] => {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...filesUnder(full));
    else if (entry.endsWith('.ts')) found.push(full);
  }
  return found;
};

/** Comments carry the word `frameScale` in prose; matching them would hide a real miss. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');

/** Every `moveVectorToVector(...)` call's argument text, brackets balanced. */
const callsIn = (source: string): string[] => {
  const calls: string[] = [];
  const needle = 'moveVectorToVector(';
  let at = source.indexOf(needle);
  while (at !== -1) {
    let depth = 0;
    let cursor = at + needle.length - 1;
    for (; cursor < source.length; cursor++) {
      if (source[cursor] === '(') depth++;
      else if (source[cursor] === ')' && --depth === 0) break;
    }
    calls.push(source.slice(at, cursor + 1));
    at = source.indexOf(needle, cursor);
  }
  return calls;
};

describe('every per-frame step is scaled by frame length', () => {
  it('no moveVectorToVector call advances by an unscaled per-frame speed', () => {
    const offenders: string[] = [];

    for (const file of filesUnder(SRC)) {
      const relative = file.slice(SRC.length + 1).replaceAll('\\', '/');
      // The helper's own definition takes a magnitude and is not a call site.
      if (relative === 'utils/vector.utils.ts') continue;
      const allowed = GEOMETRIC.find(entry => entry.file === relative);

      const source = stripComments(readFileSync(file, 'utf8'));
      for (const call of callsIn(source)) {
        if (call.includes('frameScale')) continue;
        // A value already carrying the scale — `step`, `slideStep`,
        // `stepDistance` — is fine.
        if (/\b\w*[sS]tep\w*\b/.test(call)) continue;
        if (allowed) continue;
        offenders.push(`${relative}: ${call.replace(/\s+/g, ' ')}`);
      }
    }

    expect(offenders).toEqual([]);
  });

  it('the allowlist names only files that still exist and still call it', () => {
    for (const entry of GEOMETRIC) {
      const source = stripComments(readFileSync(join(SRC, entry.file), 'utf8'));
      expect(callsIn(source).length).toBeGreaterThan(0);
      expect(entry.because.length).toBeGreaterThan(20);
    }
  });
});
