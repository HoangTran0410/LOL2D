import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * The loadout picker's search box, checked at the wiring rather than the maths.
 *
 * `matchesQuery` itself is unit-tested in `pregameCatalog.test.ts`; what a test
 * cannot see from there is the mistake that actually costs a player something,
 * which is a box that types beautifully and filters nothing — the roster still
 * handed the whole catalogue. A source scan is the tool this repo already uses
 * for a `.vue` (see `tests/game/hud/rosterTabDifficulty.test.ts`): the
 * components here are not mounted anywhere in the suite.
 */
const MODAL = resolve(__dirname, '../../src/scenes/setup/LoadoutEditorModal.vue');
const source = readFileSync(MODAL, 'utf8');

/** Comments out first, or the scan matches the paragraph explaining itself. */
const stripComments = (text: string): string =>
  text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/<!--[\s\S]*?-->/g, '');

const code = stripComments(source);

describe('the roster search box', () => {
  it('binds an input to the query', () => {
    expect(code).toMatch(/<input[^>]*v-model="search"/);
  });

  it('hands the roster the filtered shelves and not the whole catalogue', () => {
    // The regression this file exists for.
    expect(code).toContain(':shelves="visibleShelves"');
    expect(code).not.toContain(':shelves="kitShelves"');
  });

  it('filters the saved kits by the same box', () => {
    expect(code).toContain(':saved-kits="visibleSavedKits"');
    expect(code).not.toContain(':saved-kits="savedKits"');
  });

  it('keeps the open shelf whatever the query says', () => {
    // A / D / F open `Đánh Thường` and `Phép Bổ Trợ`, which have no tile and
    // whose names the player never typed; and a champion already open would
    // otherwise vanish mid-keystroke.
    expect(code).toMatch(/visibleShelves\s*=\s*computed\([\s\S]*?openShelf/);
  });

  it('asks the empty state about matches, not about what is on screen', () => {
    // `visibleShelves` carries the open shelf, so testing it would mean the
    // "nothing found" line never appears while a shelf is open.
    expect(code).toMatch(/v-if="search && matchingShelves\.length === 0"/);
  });

  it('gives the clear button a touch handler beside its click handler', () => {
    // The house rule for every HUD control in this codebase.
    const button = code.slice(code.indexOf('kit-search-clear'));
    expect(button).toMatch(/@click="clearSearch"/);
    expect(button).toMatch(/@touchend\.prevent="clearSearch"/);
  });

  it('does not steal focus on open', () => {
    // On a phone an autofocused box opens the keyboard over the grid before the
    // player has looked at it.
    expect(code).not.toMatch(/class="kit-search-input"[^>]*autofocus/);
  });
});
