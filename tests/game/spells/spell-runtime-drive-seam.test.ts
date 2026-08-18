import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../../src/managers/AssetManager', () => ({
  default: { get: () => undefined, getAsset: () => undefined, placeholder: () => undefined },
}));

import Spell from '../../../src/game/gameObject/Spell';
import type { CastSpec } from '../../../src/game/spell/runtime/types';
import {
  createGame,
  createUnit,
  installSketchMathGlobals,
  installSpellObjectGlobals,
  pressSpell,
} from '../spell/fixtures';

/**
 * A spell test drives the spell, not one of its hooks.
 *
 * `onSpellCast` and its siblings are hooks the *runtime* calls. Calling one by
 * hand runs that hook alone: no activation pattern, no recast budget, no
 * `onComplete`, no resource commit, no cooldown, no targeting rejection. The
 * test is then a test of a function, and the ability it is named after is
 * unobserved.
 *
 * This is not theoretical. Jhin R shipped declaring `activation: 'PRESS'` with
 * no `active` block, so the real runtime ran `onSpellCast` (curtain up) and
 * `onComplete` (curtain down) inside one keypress — the ultimate was unplayable.
 * All five of its assertions were green, because all five called
 * `r.onSpellCast()`. Jhin Q was the same story: a `POINT` skillshot that hunted
 * a target after arriving, worth a guaranteed hit for a key pressed at empty
 * ground, and its test never asked the runtime whether the cast was allowed.
 *
 * A source scan rather than a behaviour test, for the reason the other seams
 * are: the mistake is a *shape*, `tsc` is perfectly happy with it, and one
 * millisecond rules it out across every spell test at once.
 *
 * The sanctioned way in is `pressSpell` / `releaseSpell` from
 * `tests/game/spell/fixtures.ts`, which build the same `CastContext` the game
 * builds. `spell.press(context)` by hand is equally fine — the ban is on
 * reaching past the runtime, not on the helper being mandatory.
 */
const SPELL_TESTS_DIR = __dirname;

/** Every hook the runtime owns. A test may observe them; it may not call them. */
const RUNTIME_HOOKS = [
  'onSpellCast',
  'onCastStart',
  'onChargeUpdate',
  'onRelease',
  'onChannelTick',
  'onActivate',
  'onRecast',
  'onCancel',
  'onComplete',
] as const;

/**
 * `.onSpellCast(` and friends — a call on some object.
 *
 * `super.onSpellCast(` is excluded because that is a subclass delegating inside
 * a declaration, which is the one legitimate way the name appears with a dot in
 * front of it. A declaration (`onSpellCast() {`) has no dot at all.
 */
const CALL_PATTERN = new RegExp(`(?<!super)\\.\\s*(?:${RUNTIME_HOOKS.join('|')})\\s*\\(`, 'g');

/**
 * Spell tests written before the ban, still reaching past the runtime.
 *
 * This list is debt, not permission. It may only ever shrink: migrating one
 * means rewriting its casts as `pressSpell(...)` and dealing with whatever the
 * runtime then has to say about mana, cooldown and targeting — which is the
 * whole point, and which is how the Jhin bugs would have been caught on the day
 * they were written.
 */
const GRANDFATHERED = new Set([
  'Annie_QE.test.ts',
  'bonus-health-ultimates.test.ts',
  'Caitlyn.test.ts',
  'Camille.test.ts',
  'Darius.test.ts',
  'Diana.test.ts',
  'Ekko.test.ts',
  'execute-stacks.test.ts',
  'Ezreal.test.ts',
  'JarvanIV.test.ts',
  'Jinx_R.test.ts',
  'Malzahar.test.ts',
  'MasterYi.test.ts',
  'Nautilus.test.ts',
  'Nocturne_Q.test.ts',
  'Pantheon.test.ts',
  'Pantheon_Q.test.ts',
  'Rammus_R.test.ts',
  'Rammus_WE.test.ts',
  'Renekton.test.ts',
  'Riven.test.ts',
  'Sett.test.ts',
  'Singed_E.test.ts',
  'spell-hit-timing.test.ts',
  'Syndra.test.ts',
  'Thresh_WE.test.ts',
  'Tryndamere.test.ts',
  'Varus_Q.test.ts',
  'Vayne.test.ts',
  'Vi.test.ts',
  'XinZhao.test.ts',
  'Ziggs.test.ts',
]);

/** Comments describe the rule; matching them would flag the documentation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
}

function spellTestFiles(): string[] {
  return readdirSync(SPELL_TESTS_DIR).filter(
    name => name.endsWith('.test.ts') && name !== 'spell-runtime-drive-seam.test.ts'
  );
}

describe('a spell test presses the spell, it does not call its hooks', () => {
  it('no un-grandfathered spell test reaches past the runtime', () => {
    const offenders: string[] = [];

    for (const file of spellTestFiles()) {
      if (GRANDFATHERED.has(file)) continue;
      const source = stripComments(readFileSync(join(SPELL_TESTS_DIR, file), 'utf8'));
      const matches = source.match(CALL_PATTERN);
      if (matches) offenders.push(`${file}: ${[...new Set(matches)].join(', ')}`);
    }

    expect(offenders).toEqual([]);
  });

  it('the debt list only names files that still owe the migration', () => {
    const stale: string[] = [];

    for (const file of GRANDFATHERED) {
      const source = stripComments(readFileSync(join(SPELL_TESTS_DIR, file), 'utf8'));
      if (!CALL_PATTERN.test(source)) stale.push(file);
      CALL_PATTERN.lastIndex = 0;
    }

    // A migrated file must leave the list in the same commit, or the ban stops
    // applying to it for good and the next edit quietly re-introduces the shape.
    expect(stale).toEqual([]);
  });

  it('the debt only shrinks', () => {
    expect(GRANDFATHERED.size).toBeLessThanOrEqual(33);
  });
});

/**
 * The blind spot itself, stated as a behaviour, so the ban above keeps meaning
 * something if the runtime is ever reshaped: calling the hook cannot observe a
 * lifecycle, and pressing can.
 */
describe('calling a hook cannot see what pressing sees', () => {
  let game: ReturnType<typeof createGame>;

  beforeEach(() => {
    installSpellObjectGlobals();
    installSketchMathGlobals();
    vi.stubGlobal('deltaTime', 16);
    game = createGame();
  });

  afterEach(() => vi.unstubAllGlobals());

  class ProbeSpell extends Spell {
    name = 'Probe (Probe_Q)';
    coolDown = 5_000;
    manaCost = 40;
    casts = 0;
    completions = 0;

    get castSpec(): Readonly<CastSpec> {
      return {
        activation: 'PRESS',
        targeting: 'DIRECTION',
        resource: { commitAt: 'start', refundOn: [] },
        cooldown: { startAt: 'release', durationMs: this.coolDown },
      };
    }

    onSpellCast(): void {
      this.casts += 1;
    }

    onComplete(): void {
      this.completions += 1;
    }
  }

  it('a hook call runs the hook and nothing else — no completion, no cost', () => {
    const owner = createUnit(game, 0, 'blue');
    owner.stats.mana.baseValue = 100;
    owner.stats.maxMana.baseValue = 100;
    const spell = new ProbeSpell(owner);

    spell.onSpellCast();

    expect(spell.casts).toBe(1);
    // The three things the Jhin bugs lived in, all invisible from here.
    expect(spell.completions).toBe(0);
    expect(spell.currentCooldown).toBe(0);
    expect(owner.stats.mana.value).toBe(100);
  });

  it('a press runs the whole lifecycle, which is what the ability actually is', () => {
    const owner = createUnit(game, 0, 'blue');
    owner.stats.mana.baseValue = 100;
    owner.stats.maxMana.baseValue = 100;
    const spell = new ProbeSpell(owner);

    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(true);

    expect(spell.casts).toBe(1);
    expect(spell.completions).toBe(1);
    expect(spell.currentCooldown).toBeGreaterThan(0);
    expect(owner.stats.mana.value).toBe(60);
  });

  it('a press is refused when the spell cannot be paid for — a hook call never is', () => {
    const owner = createUnit(game, 0, 'blue');
    owner.stats.mana.baseValue = 10;
    owner.stats.maxMana.baseValue = 100;
    const spell = new ProbeSpell(owner);

    expect(pressSpell(spell, { at: { x: 300, y: 0 } })).toBe(false);
    expect(spell.casts).toBe(0);

    // ...whereas reaching past the runtime fires the ability for free.
    spell.onSpellCast();
    expect(spell.casts).toBe(1);
  });
});
