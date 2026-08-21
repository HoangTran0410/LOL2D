import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

/**
 * `castSpec` is read **once**, on the first cast, and never again.
 *
 * `Spell.runtime` is a lazy getter: the first press builds a `SpellRuntime` from
 * `this.castSpec` and stores the result as `resolvedSpec`. Every later question
 * the runtime asks — which activation, is there a channel, how many recasts,
 * where does the cooldown start — is answered from that frozen copy. A getter
 * that computes any of it from live state therefore describes the spell *as it
 * was on the opening press*, for the rest of the match.
 *
 * Jhin R is the worked example. It computed `cooldown.durationMs` from
 * `shotsRemaining`, meaning to charge 250ms between shots and the full 10s after
 * the finale; what it actually did was freeze the opening press's 250ms in
 * forever, and the HUD — which reads `castSpec` *fresh* every frame through
 * `effectiveCoolDownMs` — drew a different number from the one being counted
 * down. That disagreement between the frozen copy and the fresh read is the
 * whole bug class, and it is invisible from the spell file.
 *
 * The sanctioned ways to vary something per cast:
 *
 * - **cooldown length** — leave `durationMs: this.coolDown` alone and let
 *   `Spell.reducedCooldown` / the `cooldownDurationMs` delegate hook do it; the
 *   runtime asks at the moment each countdown starts. For a spell that sets its
 *   own mid-cast, write `this.currentCooldown = this.reducedCooldown(n)`.
 * - **repeat presses** — `active.recasts`, which the runtime counts down itself.
 * - **anything else** — put it in a hook, not in the spec.
 *
 * A source scan, like the other seams here: the mistake is a shape, `tsc` is
 * happy with it, and one millisecond rules it out across every spell at once.
 */
const SPELLS_DIR = join(__dirname, '../../../packs/riot/spells');
const CORE_SPELLS_DIR = join(__dirname, '../../../src/game/gameObject/coreSpells');

/**
 * Fields that genuinely do not change over a spell's life, so reading them in
 * the getter says the same thing on every read.
 *
 * `coolDown` is here because a third of spells write `durationMs: this.coolDown`
 * and the number itself is a class field set once — retuning it is editing a
 * constant. `owner` and `game` are identity, not state.
 */
const CONSTANT_FIELDS = new Set([
  'coolDown',
  'owner',
  'game',
  'image',
  'range',
  'manaCost',
  'healthCost',
  'targetingMode',
  'name',
]);

/**
 * Spells reading live state in `castSpec` from before the rule existed.
 *
 * Debt, not permission — each one is a spell whose runtime is running a spec
 * from its first cast while its HUD reads a fresher one. Some may turn out to
 * be harmless (a field that is in practice set before the first press and never
 * again); each still has to be *checked* rather than assumed, and the list may
 * only shrink.
 */
const GRANDFATHERED = new Set([
  'Janna_Q.ts',
  'Janna_R.ts',
  'Lux_R.ts',
  'Malzahar_R.ts',
  'MasterYi_W.ts',
  'Pantheon_Q.ts',
  'Rammus_Q.ts',
  'Riven_Q.ts',
  'Varus_Q.ts',
  'Vayne_Q.ts',
]);

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

/** The body of `get castSpec() { … }`, brace-matched so nested objects survive. */
function castSpecBody(source: string): string | null {
  const opener = /get castSpec\([^)]*\)[^{]*\{/.exec(source);
  if (!opener) return null;

  let index = opener.index + opener[0].length;
  let depth = 1;
  const start = index;
  while (index < source.length && depth > 0) {
    const char = source[index];
    if (char === '{') depth += 1;
    else if (char === '}') depth -= 1;
    index += 1;
  }
  return source.slice(start, index - 1);
}

function liveStateReads(body: string): string[] {
  const seen = new Set<string>();
  for (const [, field] of body.matchAll(/\bthis\.(\w+)/g)) {
    if (!CONSTANT_FIELDS.has(field)) seen.add(`this.${field}`);
  }
  return [...seen].sort();
}

describe('castSpec is resolved once, so it may not depend on live state', () => {
  // `coreSpells/` left the population `spells/` scans but did not stop being
  // spells; `index.ts` there is a barrel, not a spell, so it is excluded.
  const files = [
    ...readdirSync(SPELLS_DIR)
      .filter(name => name.endsWith('.ts'))
      .map(file => ({ dir: SPELLS_DIR, file })),
    ...readdirSync(CORE_SPELLS_DIR)
      .filter(name => name.endsWith('.ts') && name !== 'index.ts')
      .map(file => ({ dir: CORE_SPELLS_DIR, file })),
  ];

  it('no new spell computes its cast spec from mutable state', () => {
    const offenders: string[] = [];

    for (const { dir, file } of files) {
      if (GRANDFATHERED.has(file)) continue;
      const body = castSpecBody(stripComments(readFileSync(join(dir, file), 'utf8')));
      if (body === null) continue;
      const reads = liveStateReads(body);
      if (reads.length > 0) offenders.push(`${file}: ${reads.join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('the debt list only names spells that still read live state', () => {
    const stale: string[] = [];

    for (const file of GRANDFATHERED) {
      const body = castSpecBody(stripComments(readFileSync(join(SPELLS_DIR, file), 'utf8')));
      if (body === null || liveStateReads(body).length === 0) stale.push(file);
    }

    expect(stale).toEqual([]);
  });

  it('the debt only shrinks', () => {
    expect(GRANDFATHERED.size).toBeLessThanOrEqual(10);
  });

  it('the scan can actually see a violation', () => {
    // The shape Jhin R shipped with, so the matcher above is shown to catch it
    // rather than merely returning an empty list for the wrong reason.
    const sample = `
      get castSpec(): Readonly<CastSpec> {
        return {
          activation: 'PRESS',
          cooldown: { startAt: 'release', durationMs: this.shotsRemaining <= 1 ? this.coolDown : 500 },
        };
      }
    `;
    expect(liveStateReads(castSpecBody(sample)!)).toEqual(['this.shotsRemaining']);
  });

  it('a spec built only from constants is clean', () => {
    const sample = `
      get castSpec(): Readonly<CastSpec> {
        return {
          activation: 'RECAST',
          targeting: 'DIRECTION',
          cooldown: { startAt: 'end', durationMs: this.coolDown },
        };
      }
    `;
    expect(liveStateReads(castSpecBody(sample)!)).toEqual([]);
  });
});
