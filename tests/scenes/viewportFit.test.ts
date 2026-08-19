import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A mobile browser's `100vh` is the viewport with its toolbars *retracted* —
 * taller than what is on screen while they are showing. That alone would only
 * overflow, which is survivable; what made it a bug is `.center-page-container
 * > div` in `styles/main.css`, whose `transform` makes each scene root the
 * containing block for its own `position: fixed` chrome. An oversized root
 * therefore carries its pinned buttons off both edges with it, and the menu's
 * About button, fullscreen toggle and version stamp were all off screen in a
 * phone browser while being perfect in a desktop one — a class of bug no unit
 * test and no desktop Playwright run can see, because on a desktop the two
 * units are the same number.
 *
 * A source scan rather than a rendered check, for exactly that reason: the
 * condition cannot be reproduced in a headless browser, but "declares both
 * heights" can be read off the file in milliseconds and closes the class.
 */

const read = (file: string) => readFileSync(resolve(__dirname, '../../', file), 'utf8');

/** Strip comments first, or the scan matches its own documentation. */
const stripCss = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** The full-viewport scene roots, each mounted by a scene in `src/scenes/`. */
const SCENE_ROOTS = [
  { file: 'styles/menu-scene.css', selector: '#menu-scene' },
  { file: 'styles/about-scene.css', selector: '#about-scene' },
  { file: 'styles/pregame-scene.css', selector: '#pregame-scene' },
];

/** The declaration block for `selector`, comments already gone. */
const ruleFor = (css: string, selector: string): string => {
  const at = css.indexOf(`${selector} {`);
  expect(at, `${selector} has no rule of its own`).toBeGreaterThanOrEqual(0);
  return css.slice(at, css.indexOf('}', at));
};

describe('a scene root fits the screen it is on', () => {
  it.each(SCENE_ROOTS)('$selector declares 100vh and then 100dvh', ({ file, selector }) => {
    const rule = ruleFor(stripCss(read(file)), selector);

    expect(rule, `${selector} is not full-height at all`).toMatch(/height:\s*100vh/);
    expect(
      rule,
      `${selector} is 100vh with no 100dvh after it — on a phone that is taller than ` +
        `the screen, and it takes its own position:fixed chrome off the edges with it`
    ).toMatch(/height:\s*100dvh/);

    // Order matters and is the whole trick: a browser that cannot parse `dvh`
    // drops that declaration as invalid and keeps whatever came before, so
    // `vh` first is the fallback and `dvh` second is the answer. Reversed, the
    // fallback wins everywhere.
    expect(
      rule.indexOf('100vh'),
      `${selector} puts 100dvh before 100vh, so the fallback overrides the fix`
    ).toBeLessThan(rule.indexOf('100dvh'));
  });

  /**
   * `env(safe-area-inset-*)` reports 0 unless the viewport meta opts in. The
   * tokens exist and are added by every pinned control; without this they are
   * all quietly zero on the phones that need them.
   */
  it('asks for the whole screen, so the safe-area insets are real numbers', () => {
    const html = read('index.html').replace(/<!--[\s\S]*?-->/g, '');
    const viewport = html.match(/<meta\s+name="viewport"[\s\S]*?>/);
    expect(viewport, 'index.html has no viewport meta').not.toBeNull();
    expect(viewport![0]).toContain('viewport-fit=cover');
  });

  it('defines the four safe-area tokens once, in main.css', () => {
    const main = stripCss(read('styles/main.css'));
    for (const side of ['top', 'right', 'bottom', 'left']) {
      expect(main).toMatch(
        new RegExp(`--safe-${side}:\\s*env\\(safe-area-inset-${side},\\s*0px\\)`)
      );
    }
  });

  /**
   * The menu is the screen the report came from: three controls pinned to an
   * edge, all three off screen. Each has to add the inset for the edge it is
   * pinned to — a control pinned top-right that only offsets `top` still ends
   * up under a landscape notch.
   */
  it('offsets every pinned menu control by the inset for its own edge', () => {
    const css = stripCss(read('styles/menu-scene.css'));
    for (const selector of ['#fullscreen-btn', '#about-btn', '.menu-version', '.menu-update']) {
      const rule = ruleFor(css, selector);
      for (const side of ['top', 'right', 'bottom', 'left']) {
        const pinned = new RegExp(`(^|;|\\s)${side}:`, 'm').test(rule);
        if (!pinned) continue;
        expect(
          rule,
          `${selector} pins ${side} without adding var(--safe-${side})`
        ).toMatch(new RegExp(`${side}:\\s*calc\\([^)]*var\\(--safe-${side}\\)`));
      }
    }
  });
});
