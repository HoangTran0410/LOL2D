import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `Buff` has exactly one way to end: `deactivateBuff()`. There is no
 * `Buff.deactivate()` — `deactivate()` is a *`Spell`* method, and `Spell`
 * subclasses call `super.deactivate()` all over this tree, which is what makes
 * the wrong one so easy to reach for.
 *
 * Two spells shipped with `someBuff.deactivate()` in them. Both typechecked:
 * the buff arrays they walked were loosely typed, so `tsc` never saw the call.
 * Both would have thrown `TypeError: buff.deactivate is not a function` the
 * first time the ability fired — Twitch E on any poisoned target, Olaf R while
 * any crowd control was on him.
 *
 * A source scan rather than a test per spell: the mistake is a *pattern*, and
 * this closes it for the next spell someone writes.
 */
const spellsRoot = fileURLToPath(new URL('../../../src/game/gameObject/', import.meta.url));

const sourceFiles = (directory: string): string[] =>
  readdirSync(join(spellsRoot, directory), { recursive: true, encoding: 'utf8' })
    .filter(entry => entry.endsWith('.ts'))
    .map(entry => join(directory, entry));

/** Comments describe the rule; only code may break it. */
const codeOf = (relativePath: string): string =>
  readFileSync(join(spellsRoot, relativePath), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');

/**
 * Every `.deactivate()` call, with whatever it was called on. Optional
 * chaining included: `spell?.deactivate()` is a real call site in
 * `Champion.ts` and has to be recognised as one.
 */
const DEACTIVATE_CALL = /([A-Za-z_$][\w$]*)\s*\??\.deactivate\(\)/g;

/**
 * The receivers that legitimately have a `deactivate()`. `super` is a `Spell`
 * ending its own lifecycle; anything named `spell` is one being ended by its
 * owner. A buff is neither.
 */
const isSpellReceiver = (receiver: string): boolean =>
  receiver === 'super' || /spell/i.test(receiver);

describe('a buff is ended with deactivateBuff(), never deactivate()', () => {
  const files = ['spells', 'coreSpells', 'spellObjects', 'buffs', 'attackableUnits'].flatMap(
    sourceFiles
  );

  it('scans a real set of files, so passing means something', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it.each(files)('%s', file => {
    const offenders: string[] = [];
    for (const line of codeOf(file).split('\n')) {
      for (const [, receiver] of line.matchAll(DEACTIVATE_CALL)) {
        if (!isSpellReceiver(receiver)) offenders.push(line.trim());
      }
    }

    expect(offenders, 'use deactivateBuff() — Buff has no deactivate()').toEqual([]);
  });
});
