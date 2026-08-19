import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { BOT_DIFFICULTY_ORDER } from '../../../src/game/config/PregameConfig';

/**
 * The per-bot difficulty control on the Đội tab, checked where it is actually
 * written down: the template.
 *
 * There is no jsdom and no `@vue/test-utils` in this repo, so a mounted
 * component is not available to press — but the rule this has to protect is a
 * property of the markup rather than of any behaviour behind it.
 * **`GameScene` calls `preventDefault()` on every touch on the page**, so the
 * browser synthesises no trailing `click`: a control wired with `@click` alone
 * is perfect under a mouse and completely dead under a thumb, which is a bug
 * nothing else in the suite can see and nobody notices on a desktop. Each tier
 * button therefore has to carry a touch handler *beside* its click handler, and
 * both have to reach the same setter — a touch that called something else, or
 * called it with a different argument, would be the same bug wearing a
 * handler.
 *
 * The `.prevent` modifier on the touch half is what stops the pair firing twice
 * on a device that does synthesise the click.
 */
const ROSTER_TAB = join(__dirname, '../../../src/game/hud/config/RosterTab.vue');

/** The first element in `markup` whose tag body mentions `className`. */
const elementWithClass = (markup: string, className: string): string => {
  const pattern = new RegExp(`<(\\w+)([^>]*${className}[^>]*)>`, 's');
  const found = pattern.exec(markup);
  if (!found) throw new Error(`no element carrying class "${className}"`);
  return found[2];
};

/**
 * Everything between the tag opening at `start` and its own closing tag, nesting
 * counted — so "is this control inside that `v-if`?" is answerable rather than
 * guessed at from document order.
 */
const elementAt = (markup: string, start: number): string => {
  const tag = /^<(\w+)/.exec(markup.slice(start))?.[1];
  if (!tag) throw new Error(`no element opens at ${start}`);
  const scanner = new RegExp(`<${tag}\\b|</${tag}>`, 'g');
  scanner.lastIndex = start;
  let depth = 0;
  let step: RegExpExecArray | null;
  while ((step = scanner.exec(markup)) !== null) {
    depth += step[0].startsWith('</') ? -1 : 1;
    if (depth === 0) return markup.slice(start, step.index + step[0].length);
  }
  throw new Error(`unbalanced <${tag}>`);
};

/** `@click="x"` / `@touchend.prevent="x"` → `{ click: 'x', touchend: 'x' }`. */
const handlersOf = (element: string): Record<string, string> => {
  const handlers: Record<string, string> = {};
  for (const [, event, expression] of element.matchAll(/@([a-z]+)(?:\.[a-z]+)*\s*=\s*"([^"]+)"/g)) {
    handlers[event] = expression.trim();
  }
  return handlers;
};

describe('the difficulty control on a bot row', () => {
  const source = readFileSync(ROSTER_TAB, 'utf8');
  const template = source.slice(source.indexOf('<template>'));
  const button = elementWithClass(template, 'practice-difficulty-btn');

  it('answers a touch and a click with the same setter', () => {
    const handlers = handlersOf(button);
    expect(handlers.click, 'no @click handler').toBeDefined();
    expect(handlers.touchend, 'no @touchend handler — dead under a thumb').toBeDefined();
    expect(handlers.touchend).toBe(handlers.click);
  });

  it('cancels the synthesised click so one press is not two', () => {
    expect(button).toMatch(/@touchend\.prevent/);
  });

  it('renders one button per tier, from the config’s own list', () => {
    expect(button).toMatch(/v-for="tier of BOT_DIFFICULTY_ORDER"/);
    expect(BOT_DIFFICULTY_ORDER).toHaveLength(3);
  });

  /**
   * Bots only, and this is the whole of what enforces it. The player's row has
   * no `behaviour` at all (`ConfigRosterEntry.behaviour` is optional, and both
   * sources leave it undefined there) — but `tsconfig.json` sets
   * `strict: false`, so `strictNullChecks` is off and `vue-tsc` will happily
   * compile `row.behaviour.difficulty` outside the `v-if` that guards it. On
   * the player's row that renders three dead buttons over `undefined`. The
   * guard is a template fact, so it is checked as one.
   */
  it('sits inside the v-if that only a bot satisfies', () => {
    const guard = template.indexOf('<div v-if="row.behaviour"');
    expect(guard, 'no v-if="row.behaviour" block to live in').toBeGreaterThan(-1);
    expect(elementAt(template, guard)).toContain('practice-difficulty-btn');
  });

  it('reads the tier off that row’s behaviour rather than a copy of it', () => {
    expect(button).toMatch(/row\.behaviour\.difficulty/);
  });

  it('the scan can see the violations it is meant to catch', () => {
    const clickOnly = elementWithClass(
      '<button type="button" class="practice-difficulty-btn" @click="setDifficulty(row, tier)">',
      'practice-difficulty-btn'
    );
    const handlers = handlersOf(clickOnly);
    expect(handlers.click).toBe('setDifficulty(row, tier)');
    expect(handlers.touchend).toBeUndefined();

    // …and a control that sits after the guard instead of inside it.
    const escaped =
      '<div v-if="row.behaviour"><input /></div><button class="practice-difficulty-btn">';
    expect(elementAt(escaped, escaped.indexOf('<div v-if'))).not.toContain(
      'practice-difficulty-btn'
    );
  });
});
