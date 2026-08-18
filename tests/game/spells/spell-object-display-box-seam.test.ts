import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * A `SpellObject` that paints past its own centre owes the quadtree a box.
 *
 * `GameObject.getDisplayBoundingBox` derives the box from `visionRadius`, which
 * is **0** for a plain `SpellObject` — a zero-area box sitting on the object's
 * own centre. `ObjectManager.draw` picks what to draw by querying the display
 * tree with that box, so an effect painting a 400px cone but reporting a
 * zero-size box is drawn only while its *centre point* is on screen and
 * vanishes at the camera edge while its damage lands normally. Lux R's beam
 * crossed the map invisibly this way, and six of the twelve effects added with
 * Camille/Ekko/Jarvan shipped with it.
 *
 * `tests/game/spells/aoe-display-bounds.test.ts` is the behavioural half: it
 * instantiates named effects and asserts the box actually contains the radius
 * they paint. That is the stronger check and it stays. But it is a hand-written
 * list, so it only ever covers the effects somebody remembered to add — and the
 * failure it guards against is invisible in the file you are editing, which is
 * exactly the shape that comes back. Ten champions landing at once is forty new
 * objects and forty chances to forget.
 *
 * So this is the cheap structural half, in the shape of
 * `mana-spend-seam.test.ts`: every exported class extending `SpellObject`
 * directly must state its own extent, and it fails on the *pattern* rather than
 * on any one effect's geometry. Milliseconds, and it closes the class for every
 * champion written after this one.
 *
 * Two ways to satisfy it, because there are two correct answers:
 *
 *   - declare `getDisplayBoundingBox()` — the usual one, and the only option
 *     when the box is not a square centred on the object (a beam, a tether back
 *     to the caster, a ribbon over several victims);
 *   - set a non-zero `visionRadius` — which is what the default box is derived
 *     from, so an effect that grants sight over the area it paints (Lux E) is
 *     already telling the truth and needs nothing further.
 *
 * Deliberately **not** checked here: whether the declared box is big enough.
 * A regex cannot compare a box to the radius a `draw()` actually reaches, and
 * pretending otherwise would be a check that agrees with itself however wrong
 * it is. That comparison is `aoe-display-bounds.test.ts`'s job, against a real
 * instance.
 *
 * Subclasses of `MissileSpellObject`, `AreaSpellObject`, `BeamSpellObject` and
 * `HomingMissileSpellObject` are out of scope: those primitives supply a box
 * sized to their own geometry. A missile that paints *wider* than the missile
 * still has to override it, but that is a size question, not a missing-seam
 * one, and it belongs to the behavioural test.
 */
const SPELL_DIRECTORIES = ['spells', 'spellObjects'];
const GAME_OBJECT_DIR = fileURLToPath(new URL('../../../src/game/gameObject/', import.meta.url));

/**
 * Only classes extending `SpellObject` *directly*. `[^{]*` absorbs an
 * `implements` clause without letting the match run past the class body's
 * opening brace.
 */
const DIRECT_SPELL_OBJECT =
  /export\s+(?:default\s+)?class\s+(\w+)\s+extends\s+SpellObject\b[^{]*\{/g;

/** Either sanctioned way to state an extent. */
const STATES_ITS_EXTENT = /getDisplayBoundingBox\s*\(|\bvisionRadius\b/;

/**
 * Three effects that predate the rule and are caster-centred enough that the
 * zero-area box never showed: Flash's and Heal's flourishes land on the
 * champion's own body, and Lee Sin R's kick trail was drawn beside its victim.
 * Grandfathered so the scan can be introduced without a drive-by rewrite of
 * three unrelated spells — not an endorsement. Adding a name here is how the
 * rule gets lost, so a new entry needs a reason in this comment.
 */
const GRANDFATHERED = new Set(['Flash_Object', 'Heal_Object', 'LeeSin_R_Object']);

/** Comments describe the trap; a scan that reads them flags its own docs. */
const stripComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[^\n]*?\/\/.*$/gm, '');

interface Offender {
  file: string;
  className: string;
}

const collectOffenders = (): Offender[] => {
  const offenders: Offender[] = [];
  for (const directory of SPELL_DIRECTORIES) {
    const path = join(GAME_OBJECT_DIR, directory);
    for (const file of readdirSync(path).filter(name => name.endsWith('.ts'))) {
      const source = stripComments(readFileSync(join(path, file), 'utf8'));
      DIRECT_SPELL_OBJECT.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = DIRECT_SPELL_OBJECT.exec(source)) !== null) {
        const className = match[1];
        // Walk from the class body's opening brace to its match, so a sibling
        // class in the same file cannot satisfy the rule on this one's behalf.
        let depth = 0;
        let end = source.length;
        for (let index = DIRECT_SPELL_OBJECT.lastIndex - 1; index < source.length; index += 1) {
          if (source[index] === '{') depth += 1;
          else if (source[index] === '}') {
            depth -= 1;
            if (depth === 0) {
              end = index;
              break;
            }
          }
        }
        const body = source.slice(DIRECT_SPELL_OBJECT.lastIndex, end);
        if (STATES_ITS_EXTENT.test(body)) continue;
        if (GRANDFATHERED.has(className)) continue;
        offenders.push({ file: `${directory}/${file}`, className });
      }
    }
  }
  return offenders;
};

describe('every SpellObject states the extent it paints', () => {
  it('finds the classes to check at all', () => {
    // Guards the regex itself: a rename of `SpellObject` or a change of export
    // style would otherwise make this suite pass by scanning nothing.
    let counted = 0;
    for (const directory of SPELL_DIRECTORIES) {
      const path = join(GAME_OBJECT_DIR, directory);
      for (const file of readdirSync(path).filter(name => name.endsWith('.ts'))) {
        const source = stripComments(readFileSync(join(path, file), 'utf8'));
        DIRECT_SPELL_OBJECT.lastIndex = 0;
        while (DIRECT_SPELL_OBJECT.exec(source) !== null) counted += 1;
      }
    }
    expect(counted).toBeGreaterThan(200);
  });

  it('declares getDisplayBoundingBox() or a non-zero visionRadius', () => {
    const offenders = collectOffenders();
    expect(
      offenders.map(offender => `${offender.file} :: ${offender.className}`),
      'a plain SpellObject inherits a zero-area box, so it is culled the moment ' +
        'its centre leaves the camera while its damage still lands'
    ).toEqual([]);
  });

  it('keeps the grandfathered list from growing silently', () => {
    expect([...GRANDFATHERED].sort()).toEqual(['Flash_Object', 'Heal_Object', 'LeeSin_R_Object']);
  });
});
